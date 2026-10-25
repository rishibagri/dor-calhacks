import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { ProviderError, type AckProposalInput, type AckProposerPort, type IntroProposalInput, type IntroProposerPort,
  type PlanProposalInput, type PlanProposerPort } from '@dor/agents';

/** The only tool the Droid may use: a planning list with no file, shell, network or web access. */
export const DROID_ALLOWED_TOOLS = ['TodoWrite'] as const;
/** Picking among pre-approved enum options needs no frontier model; measured ~14 credits/call when cached. */
export const DEFAULT_DROID_MODEL = 'claude-haiku-5-5';
const MAX_STDOUT_BYTES = 64 * 1024;
/** Less remaining JOB budget than this cannot fit a model call: fail with `timeout` instead of starting one to kill it. */
export const MIN_CALL_BUDGET_MS = 250;
/** Variables the subprocess may inherit. Provider keys for Claude/Cartesia and worker secrets are withheld. */
const INHERITED_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TMPDIR', 'XDG_CONFIG_HOME',
  'FACTORY_API_KEY', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS'];

/** The CLI subprocess environment allowlist applied to `source`; `withKey: false` drops FACTORY_API_KEY. */
export function droidEnv(source: NodeJS.ProcessEnv, { withKey = true } = {}): Record<string, string> {
  return Object.fromEntries(INHERITED_ENV.flatMap(k => source[k] === undefined || (!withKey && k === 'FACTORY_API_KEY')
    ? [] : [[k, source[k]!]]));
}

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
  /** Transport path: `ok`, or the ProviderError code the call failed with. */
  outcome?: string;
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
  /**
   * Runs each call instead of spawning `droid exec` (e.g. the SDK warm-session transport in droid-sdk.ts). The
   * runner still owns slots, the queue, deadlines and usage reporting; `spawn`, `env` and `droidPath` are unused.
   */
  transport?: DroidTransport;
}

/** One model call inside a slot's private, freshly emptied directory. */
export interface DroidTransportCall {
  slot: number;
  cwd: string;
  prompt: string;
  /** Already clipped to the job deadline. */
  timeoutMs: number;
}
export interface DroidTransport {
  /** Resolves to the untrusted reply (parsed JSON when possible) plus numbers-only usage; rejects with ProviderError. */
  call(request: DroidTransportCall): Promise<{ reply: unknown; usage: Omit<DroidUsage, 'model' | 'durationMs'> }>;
  close(): Promise<void>;
}

export interface DroidRunOptions {
  /** Aggregate job deadline (epoch ms) covering slot wait and the call. */
  deadlineAt?: number;
}
/** A proposer bound to the worker's shared runner and, optionally, one job's deadline. */
export type DroidProposerOptions = DroidAckProposerOptions & { runner?: DroidRunner; deadlineAt?: number };

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

  /**
   * Runs one prompt and returns the model's reply as untrusted, best-effort parsed JSON. `deadlineAt` (epoch ms)
   * bounds the slot wait and the call together: past it the call fails with `timeout` and never spawns.
   */
  async run(prompt: string, { deadlineAt }: DroidRunOptions = {}): Promise<unknown> {
    const slot = await this.acquire(deadlineAt);
    try {
      return await this.runIn(slot, prompt, deadlineAt);
    } finally {
      this.release(slot);
    }
  }

  private async runIn(slot: number, prompt: string, deadlineAt: number | undefined): Promise<unknown> {
    const cwd = await this.emptyWorkdir(slot);
    const remaining = deadlineAt === undefined ? Infinity : deadlineAt - Date.now();
    if (remaining < MIN_CALL_BUDGET_MS) throw new ProviderError('factory', 'timeout');
    const timeoutMs = Math.min(this.options.timeoutMs ?? 8000, remaining);
    const started = Date.now();
    if (this.options.transport) {
      let outcome;
      try {
        outcome = await this.options.transport.call({ slot, cwd, prompt, timeoutMs });
      } catch (error) {
        this.options.onUsage?.({ model: this.model, durationMs: Date.now() - started, factoryCredits: null,
          cacheReadTokens: null, cacheCreationTokens: null,
          outcome: error instanceof ProviderError ? error.code : 'unknown' });
        throw error;
      }
      this.options.onUsage?.({ model: this.model, durationMs: Date.now() - started, ...outcome.usage, outcome: 'ok' });
      return outcome.reply;
    }
    // A call that never produced an envelope (missing binary, timeout, crash, unparseable output) is still reported,
    // as on the transport path, so a broken droid shows up in droid_call logs rather than only as fallback outcomes.
    const failed = (error: ProviderError) => {
      this.options.onUsage?.({ model: this.model, durationMs: Date.now() - started, factoryCredits: null,
        cacheReadTokens: null, cacheCreationTokens: null, outcome: error.code });
      return error;
    };
    let stdout: string;
    try {
      stdout = await this.exec(cwd, prompt, timeoutMs);
    } catch (error) {
      throw failed(error instanceof ProviderError ? error : new ProviderError('factory', 'unavailable'));
    }
    let envelope;
    try {
      envelope = DroidExecResultSchema.parse(JSON.parse(stdout));
    } catch {
      throw failed(new ProviderError('factory', 'invalid_output'));
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
    await this.options.transport?.close();
    await Promise.all(this.slots.map(async slot => {
      const pending = slot.dir;
      slot.dir = undefined;
      if (pending) await rm(await pending, { recursive: true, force: true });
    }));
  }

  private acquire(deadlineAt?: number): Promise<number> {
    if (deadlineAt !== undefined && deadlineAt <= Date.now()) return Promise.reject(new ProviderError('factory', 'timeout'));
    const free = this.slots.findIndex(s => !s.busy);
    if (free !== -1) {
      this.slots[free]!.busy = true;
      return Promise.resolve(free);
    }
    if (this.waiting.length >= (this.options.maxQueue ?? 16)) {
      return Promise.reject(new ProviderError('factory', 'rate_limited'));
    }
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const waiter = (slot: number) => { clearTimeout(timer); resolve(slot); };
      if (deadlineAt !== undefined) {
        // Leave the queue at the deadline, so a release never hands a slot to a job that has given up.
        timer = setTimeout(() => {
          const at = this.waiting.indexOf(waiter);
          if (at !== -1) this.waiting.splice(at, 1);
          reject(new ProviderError('factory', 'timeout'));
        }, deadlineAt - Date.now());
      }
      this.waiting.push(waiter);
    });
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
    state.dir ??= mkdtemp(join(tmpdir(), 'dor-droid-'));
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

  private exec(sandbox: string, prompt: string, timeoutMs: number): Promise<string> {
    const spawn = this.options.spawn ?? nodeSpawn;
    const env = droidEnv(this.options.env ?? process.env);
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
      const timer = setTimeout(() => { kill(); settle(new ProviderError('factory', 'timeout')); }, timeoutMs);
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
  private readonly deadlineAt: number | undefined;
  constructor(options: DroidProposerOptions = {}) {
    this.runner = options.runner ?? new DroidRunner(options);
    this.deadlineAt = options.deadlineAt;
  }

  propose(input: AckProposalInput, _requestId: string): Promise<unknown> {
    return this.runner.run(buildAckPrompt(input), { deadlineAt: this.deadlineAt });
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
  private readonly deadlineAt: number | undefined;
  constructor(options: DroidProposerOptions = {}) {
    this.runner = options.runner ?? new DroidRunner(options);
    this.deadlineAt = options.deadlineAt;
  }

  propose(input: IntroProposalInput, _requestId: string): Promise<unknown> {
    return this.runner.run(buildIntroPrompt(input), { deadlineAt: this.deadlineAt });
  }

  close(): Promise<void> {
    return this.runner.close();
  }
}

/**
 * Shared-plan agent (AI-R3). Per mutual event it sees normalized topics, format and hours until start only: no
 * titles, descriptions, URLs, venues or people. It cannot act on an event; its reply only selects an option.
 */
export class DroidPlanProposer implements PlanProposerPort {
  readonly runner: DroidRunner;
  private readonly deadlineAt: number | undefined;
  constructor(options: DroidProposerOptions = {}) {
    this.runner = options.runner ?? new DroidRunner(options);
    this.deadlineAt = options.deadlineAt;
  }

  propose(input: PlanProposalInput, _requestId: string): Promise<unknown> {
    return this.runner.run(buildPlanPrompt(input), { deadlineAt: this.deadlineAt });
  }

  close(): Promise<void> {
    return this.runner.close();
  }
}

export function buildPlanPrompt(input: PlanProposalInput): string {
  const options = input.events.map((e, i) =>
    `${i}: topics ${JSON.stringify(e.topics)}; ${e.format === 'online' ? 'online' : 'in person'}; starts in about ${e.startsInHours} hours`).join('\n');
  return [
    input.round === 2 ? 'Your previous reply could not be used. Follow the reply format exactly.\n' : '',
    'Two people in dor both said they are interested in these public events. Suggest the one that makes the easiest first plan together, or none.',
    'Prefer in-person events with enough notice to arrange; do not pick an event just because it is soonest.',
    `Options, already ranked:\n${options}`,
    'Reply with one JSON object and nothing else: {"decision":"suggest","eventIndex":N} or {"decision":"none"}. Do not use tools.',
  ].join('\n');
}

export function buildIntroPrompt(input: IntroProposalInput): string {
  const options = input.candidates.map((c, i) => `${i}: reasons ${JSON.stringify(c.reasons)}; shared interests ` +
    `${JSON.stringify(c.sharedTags)}; ${c.sharedEvent ? 'both plan to attend the same event' : 'no shared event'}`).join('\n');
  return [
    input.round === 2 ? 'Your previous reply could not be used. Follow the reply format exactly.\n' : '',
    'You help one person in dor decide whether to introduce themselves to someone nearby. You see only interests both people chose to publish.',
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
    'You are the recipient-side agent in dor, one bounded coordination step. You see only what both people approved.',
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
