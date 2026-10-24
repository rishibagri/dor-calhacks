import { ProviderError } from '@dor/agents';
import { DEFAULT_DROID_MODEL, DROID_ALLOWED_TOOLS, extractJsonObject, type DroidTransport, type DroidTransportCall }
  from './droid-proposer.js';

/**
 * EXPERIMENTAL Droid transport over `@factory/droid-sdk` (Node entrypoint), selected with DOR_DROID_TRANSPORT=sdk.
 * Not benchmarked yet: the CLI transport stays the default until a measured live comparison says otherwise.
 *
 * Why: about 3.5 s of every `droid exec` call is CLI startup. The SDK separates starting and initializing a Droid
 * session from sending the prompt, so each slot keeps one spare session warm and the startup happens between
 * calls instead of on the job's critical path.
 *
 * Isolation is unchanged from the CLI path: a session answers exactly one prompt and is then closed, so no job ever
 * shares conversation context with another. The session runs in the slot's private, emptied directory (stable per
 * slot, which keeps Factory's prompt cache warm, as with the CLI).
 *
 * Tool safety: the SDK only offers a deny-list (`disabledToolIds`), and by default a session enables 16 tools including
 * Execute, FetchUrl, WebSearch and Read (measured). Each new session's tools are listed and checked against
 * SDK_ALLOWED_TOOLS; any other enabled tool is added to a learned deny-list and the session is recreated.
 * A session that still exposes an unlisted tool is never used (fail closed). Autonomy is off, permission requests
 * are auto-rejected, builtin skills are disabled, and a turn that calls any tool is treated as invalid output.
 */

/** The subset of `@factory/droid-sdk/node` 0.10.0 this transport uses (kept structural so the SDK stays optional). */
export interface SdkToolInfo { id: string; allowed: boolean }
export interface SdkStreamMessage {
  type: string;
  name?: string;
  success?: boolean;
  interrupted?: boolean;
  text?: string;
  tokenUsage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number;
    factoryCredits?: number } | null;
}
export interface SdkSession {
  listTools(): Promise<SdkToolInfo[]>;
  stream(prompt: string, options?: { abortSignal?: AbortSignal }): AsyncIterable<SdkStreamMessage>;
  close(): Promise<void>;
}
export interface SdkSessionOptions {
  cwd: string;
  modelId: string;
  reasoningEffort: 'low' | 'medium' | 'high';
  autonomyLevel: 'off';
  autoRejectPermissionRequests: true;
  disableBuiltinSkills: true;
  disabledToolIds: string[];
  apiKey: string;
  env: Record<string, string>;
  execPath?: string;
  abortSignal?: AbortSignal;
}
export type CreateSdkSession = (options: SdkSessionOptions) => Promise<SdkSession>;

export interface DroidSdkTransportOptions {
  /** `createSession` from `@factory/droid-sdk/node` (or a test double). */
  createSession: CreateSdkSession;
  /** FACTORY_API_KEY. The SDK does not use the CLI login. Never logged. */
  apiKey: string | undefined;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  droidPath?: string;
  /** Environment for the droid subprocess; same allowlist as the CLI path, minus the key (passed as apiKey). */
  env?: Record<string, string>;
  /** Tools a session may expose. Default SDK_ALLOWED_TOOLS. */
  allowedTools?: readonly string[];
  /** Bound on starting + verifying one session. Default 15 s. */
  startTimeoutMs?: number;
}

/**
 * Tools an SDK session may expose. `ToolSearch` cannot be disabled through `disabledToolIds` (measured with droid
 * 0.248.0 / SDK 0.10.0); it only returns tool definitions, and any tool call in a turn is still rejected below.
 */
export const SDK_ALLOWED_TOOLS = [...DROID_ALLOWED_TOOLS, 'ToolSearch'] as const;

const RESULT = 'result';
const TOOL_CALL = 'tool_call';

export class DroidSdkTransport implements DroidTransport {
  /** One warm (started, tool-verified, unused) session per slot. */
  private readonly spares = new Map<number, Promise<SdkSession>>();
  private readonly deny = new Set<string>();
  private closed = false;

  constructor(private readonly options: DroidSdkTransportOptions) {
    if (!options.apiKey) throw new ProviderError('factory', 'not_configured');
  }

  async call({ slot, cwd, prompt, timeoutMs }: DroidTransportCall) {
    const abort = AbortSignal.timeout(timeoutMs);
    const session = await this.take(slot, cwd, abort);
    let result: SdkStreamMessage | undefined;
    try {
      for await (const message of session.stream(prompt, { abortSignal: abort })) {
        // The agent only picks among options; any tool use is out of bounds, whatever the tool.
        if (message.type === TOOL_CALL) throw new ProviderError('factory', 'invalid_output');
        if (message.type === RESULT) { result = message; break; }
      }
    } catch (error) {
      if (abort.aborted) throw new ProviderError('factory', 'timeout');
      throw error instanceof ProviderError ? error : new ProviderError('factory', 'unavailable');
    } finally {
      // One prompt per session: close it and warm the next one for this slot off the critical path.
      void session.close().catch(() => undefined);
      this.warm(slot, cwd);
    }
    if (!result) throw new ProviderError('factory', abort.aborted ? 'timeout' : 'unavailable');
    if (!result.success) throw new ProviderError('factory', result.interrupted ? 'timeout' : 'unavailable');
    const u = result.tokenUsage ?? null;
    // No outputFormat is requested, so the reply is parsed from the text exactly as on the CLI path.
    return {
      reply: extractJsonObject(result.text ?? ''),
      usage: { factoryCredits: u?.factoryCredits ?? null, cacheReadTokens: u?.cacheReadTokens ?? null,
        cacheCreationTokens: u?.cacheCreationTokens ?? null },
    };
  }

  /** Starts a session for each slot ahead of the first call (optional; calls warm on demand otherwise). */
  prewarm(slots: { slot: number; cwd: string }[]): void {
    for (const { slot, cwd } of slots) this.warm(slot, cwd);
  }

  async close(): Promise<void> {
    this.closed = true;
    const spares = [...this.spares.values()];
    this.spares.clear();
    await Promise.all(spares.map(p => p.then(s => s.close(), () => undefined).catch(() => undefined)));
  }

  /** Learned deny-list (tool ids only); exposed for logging and tests. */
  get deniedTools(): string[] {
    return [...this.deny].sort();
  }

  private async take(slot: number, cwd: string, abort: AbortSignal): Promise<SdkSession> {
    const spare = this.spares.get(slot);
    this.spares.delete(slot);
    if (spare) {
      try {
        return await spare;
      } catch {
        // A failed warm-up is retried once on the critical path below.
      }
    }
    return this.start(cwd, abort);
  }

  private warm(slot: number, cwd: string): void {
    if (this.closed || this.spares.has(slot)) return;
    const pending = this.start(cwd);
    pending.catch(() => { if (this.spares.get(slot) === pending) this.spares.delete(slot); });
    this.spares.set(slot, pending);
  }

  /** Creates a session and verifies its tools; recreates once with a widened deny-list; otherwise fails closed. */
  private async start(cwd: string, abort?: AbortSignal): Promise<SdkSession> {
    const signal = abort ? AbortSignal.any([abort, AbortSignal.timeout(this.options.startTimeoutMs ?? 15_000)])
      : AbortSignal.timeout(this.options.startTimeoutMs ?? 15_000);
    for (let attempt = 0; attempt < 2; attempt++) {
      let session: SdkSession;
      try {
        session = await this.options.createSession({
          cwd, modelId: this.options.model ?? DEFAULT_DROID_MODEL, reasoningEffort: this.options.reasoningEffort ?? 'low',
          autonomyLevel: 'off', autoRejectPermissionRequests: true, disableBuiltinSkills: true,
          disabledToolIds: [...this.deny].sort(), apiKey: this.options.apiKey!, env: this.options.env ?? {},
          ...(this.options.droidPath ? { execPath: this.options.droidPath } : {}), abortSignal: signal,
        });
      } catch {
        throw new ProviderError('factory', signal.aborted ? 'timeout' : 'unavailable');
      }
      let extra: string[];
      try {
        const allowed = new Set(this.options.allowedTools ?? SDK_ALLOWED_TOOLS);
        extra = (await session.listTools()).filter(t => t.allowed && !allowed.has(t.id)).map(t => t.id);
      } catch {
        await session.close().catch(() => undefined);
        throw new ProviderError('factory', 'unavailable');
      }
      if (extra.length === 0) return session;
      await session.close().catch(() => undefined);
      for (const id of extra) this.deny.add(id);
    }
    // Disabling did not take effect: never run a session with tools outside the allowlist.
    throw new ProviderError('factory', 'not_configured');
  }
}
