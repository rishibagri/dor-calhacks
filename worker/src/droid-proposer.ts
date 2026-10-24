import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { ProviderError, type AckProposalInput, type AckProposerPort, type IntroProposalInput, type IntroProposerPort }
  from '@kinetic/agents';

/** The only tool the Droid may use: a planning list with no file, shell, network or web access. */
export const DROID_ALLOWED_TOOLS = ['TodoWrite'] as const;
/** Picking among pre-approved enum options needs no frontier model; measured ~14 credits/call when cached. */
export const DEFAULT_DROID_MODEL = 'claude-haiku-5-5';
const MAX_STDOUT_BYTES = 64 * 1024;
/** Variables the subprocess may inherit. Provider keys for Claude/Cartesia and worker secrets are withheld. */
const INHERITED_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TMPDIR', 'XDG_CONFIG_HOME',
  'FACTORY_API_KEY', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS'];

const count = z.number().int().nonnegative().optional();
const DroidExecResultSchema = z.object({
  type: z.literal('result'), subtype: z.string(), is_error: z.boolean(), result: z.string(),
  usage: z.object({ input_tokens: count, output_tokens: count, cache_read_input_tokens: count,
    cache_creation_input_tokens: count, factory_credits: z.number().nonnegative().optional() }).optional(),
});

/** Numbers only: no prompt, output or session identifiers. */
export interface DroidUsage {
  model: string;
  durationMs: number;
  factoryCredits: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
}

export interface DroidAckProposerOptions {
  droidPath?: string;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
  /** Injection point for tests; defaults to node:child_process spawn. */
  spawn?: typeof nodeSpawn;
  env?: NodeJS.ProcessEnv;
  /** Receives per-call usage for credit and latency tracking. */
  onUsage?: (usage: DroidUsage) => void;
  /** Simultaneous `droid exec` runs, each in its own private directory. Default 2. */
  concurrency?: number;
  /** Calls allowed to wait for a slot; beyond this a call fails fast with `rate_limited`. Default 16. */
  maxQueue?: number;
}

/**
 * Runs bounded, tool-less `droid exec` prompts for the worker's agents. Each concurrent run gets one of a fixed
 * pool of private, empty working directories (slots). Droid's system prompt includes the working directory, so
 * reusing a slot lets Factory's prompt cache hit (measured 40 → 14 credits per Haiku call). A slot is held for
 * the whole run, so one job never empties a directory another job is using. Share one runner between proposers
 * so the worker has a single concurrency budget. Directories are emptied before every call and removed by close().
 */
export class DroidRunner {
  private readonly slots: { dir: Promise<string> | undefined; busy: boolean }[];
  private readonly waiting: ((slot: number) => void)[] = [];
  constructor(private readonly options: DroidAckProposerOptions = {}) {
    this.slots = Array.from({ length: Math.max(1, options.concurrency ?? 2) }, () => ({ dir: undefined, busy: false }));
  }

  /** Runs one prompt and returns the model's reply as untrusted, best-effort parsed JSON. */
  async run(prompt: string): Promise<unknown> {
    const slot = await this.acquire();
    try {
      return await this.runIn(slot, prompt);
    } finally {
      this.release(slot);
    }
  }

  private async runIn(slot: number, prompt: string): Promise<unknown> {
    const cwd = await this.emptyWorkdir(slot);
    const started = Date.now();
    const stdout = await this.exec(cwd, prompt);
    let envelope;
    try {
      envelope = DroidExecResultSchema.parse(JSON.parse(stdout));
    } catch {
      throw new ProviderError('factory', 'invalid_output');
    }
    const usage = envelope.usage;
    this.options.onUsage?.({ model: this.model, durationMs: Date.now() - started,
      factoryCredits: usage?.factory_credits ?? null, cacheReadTokens: usage?.cache_read_input_tokens ?? null,
      cacheCreationTokens: usage?.cache_creation_input_tokens ?? null });
    if (envelope.is_error || envelope.subtype !== 'success') throw new ProviderError('factory', 'unavailable');
    return extractJsonObject(envelope.result);
  }

  /** Removes the slot directories. Safe to call more than once; call after in-flight runs finish. */
  async close(): Promise<void> {
    await Promise.all(this.slots.map(async slot => {
      const pending = slot.dir;
      slot.dir = undefined;
      if (pending) await rm(await pending, { recursive: true, force: true });
    }));
  }

  private acquire(): Promise<number> {
    const free = this.slots.findIndex(s => !s.busy);
    if (free !== -1) {
      this.slots[free]!.busy = true;
      return Promise.resolve(free);
    }
    if (this.waiting.length >= (this.options.maxQueue ?? 16)) {
      return Promise.reject(new ProviderError('factory', 'rate_limited'));
    }
    return new Promise(resolve => this.waiting.push(resolve));
  }

  /** Hands the slot straight to the next waiter, so it never looks free in between. */
  private release(slot: number): void {
    const next = this.waiting.shift();
    if (next) next(slot);
    else this.slots[slot]!.busy = false;
  }

  private get model(): string {
    return this.options.model ?? DEFAULT_DROID_MODEL;
  }

  private async emptyWorkdir(slot: number): Promise<string> {
    const state = this.slots[slot]!;
    state.dir ??= mkdtemp(join(tmpdir(), 'kinetic-droid-'));
    const dir = await state.dir;
    for (const entry of await readdir(dir)) await rm(join(dir, entry), { recursive: true, force: true });
    return dir;
  }

  /** Arguments for one run; exported shape is asserted in tests so the allowlist cannot silently widen. */
  args(sandbox: string, prompt: string): string[] {
    return ['exec', '--output-format', 'json', '--only-tools', DROID_ALLOWED_TOOLS.join(','), '--disable-builtin-skills',
      '--model', this.model, '--reasoning-effort', this.options.reasoningEffort ?? 'low',
      '--cwd', sandbox, prompt];
  }

  private exec(sandbox: string, prompt: string): Promise<string> {
    const spawn = this.options.spawn ?? nodeSpawn;
    const source = this.options.env ?? process.env;
    const env = Object.fromEntries(INHERITED_ENV.flatMap(k => source[k] === undefined ? [] : [[k, source[k]!]]));
    return new Promise((resolve, reject) => {
      let stdout = '', bytes = 0, settled = false;
      const child = spawn(this.options.droidPath ?? 'droid', this.args(sandbox, prompt),
        { cwd: sandbox, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const settle = (error: ProviderError | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(stdout);
      };
      const kill = () => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1000).unref();
      };
      const timer = setTimeout(() => { kill(); settle(new ProviderError('factory', 'timeout')); },
        this.options.timeoutMs ?? 8000);
      child.stdout!.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_STDOUT_BYTES) { kill(); settle(new ProviderError('factory', 'invalid_output')); }
        else stdout += chunk.toString('utf8');
      });
      // stderr is drained and discarded; it is never logged.
      child.stderr!.resume();
      child.on('error', () => settle(new ProviderError('factory', 'not_configured')));
      child.on('close', code => settle(code === 0 ? null : new ProviderError('factory', 'unavailable')));
    });
  }
}

/**
 * Recipient agent backed by a headless `droid exec` run. It receives approved enums and pre-filtered options
 * only, and its reply is untrusted input to the bounded coordinator.
 */
export class DroidAckProposer implements AckProposerPort {
  readonly runner: DroidRunner;
  constructor(options: DroidAckProposerOptions & { runner?: DroidRunner } = {}) {
    this.runner = options.runner ?? new DroidRunner(options);
  }

  propose(input: AckProposalInput, _requestId: string): Promise<unknown> {
    return this.runner.run(buildAckPrompt(input));
  }

  close(): Promise<void> {
    return this.runner.close();
  }
}

/**
 * Viewer-side introduction agent (AI-R2). It sees, per eligible candidate, only the published tags both people
 * chose and a count of shared events: no names, refs, areas, bios or event titles. Its reply is untrusted input
 * to IntroductionCoordinator, which can only pick among the options it was given.
 */
export class DroidIntroProposer implements IntroProposerPort {
  readonly runner: DroidRunner;
  constructor(options: DroidAckProposerOptions & { runner?: DroidRunner } = {}) {
    this.runner = options.runner ?? new DroidRunner(options);
  }

  propose(input: IntroProposalInput, _requestId: string): Promise<unknown> {
    return this.runner.run(buildIntroPrompt(input));
  }

  close(): Promise<void> {
    return this.runner.close();
  }
}

export function buildIntroPrompt(input: IntroProposalInput): string {
  const options = input.candidates.map((c, i) =>
    `${i}: shared interests ${JSON.stringify(c.overlapTags)}; shared events ${c.sharedEventCount}`).join('\n');
  return [
    input.round === 2 ? 'Your previous reply could not be used. Follow the reply format exactly.\n' : '',
    'You help one person in Kinetic decide whether to introduce themselves to someone nearby. You see only interests both people chose to publish.',
    'Pick the person and the single opening most likely to lead to a comfortable first conversation, or reply none if no option is a real fit.',
    'A shared event is a concrete opening; a specific shared interest beats a generic one.',
    `Options, already ranked:\n${options}`,
    'Reply with one JSON object and nothing else: {"decision":"suggest","candidateIndex":N,"lead":"tag","tagIndex":M} or',
    '{"decision":"suggest","candidateIndex":N,"lead":"event"} or {"decision":"none"}. Do not use tools.',
  ].join('\n');
}

export function buildAckPrompt(input: AckProposalInput): string {
  const options = input.options.map((o, i) => `${i}: ${JSON.stringify(o)}`).join('\n');
  return [
    input.round === 2 ? 'Your previous reply could not be used. Follow the reply format exactly.\n' : '',
    'You are the recipient-side agent in Kinetic, one bounded coordination step. You see only what both people approved.',
    'Pick the option that would be the gentlest, lowest-pressure way for the recipient to reach out, or decline if none fits.',
    `Approved by the sender: ${JSON.stringify(input.approved)}`,
    `Options the recipient already agreed to offer, most preferred first:\n${options}`,
    'Reply with one JSON object and nothing else: {"decision":"compatible","optionIndex":N} or {"decision":"decline"}. Do not use tools.',
  ].join('\n');
}

/** Pulls the outermost JSON object from model text; returns the raw text when none parses. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return text;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return text;
  }
}
