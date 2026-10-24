/**
 * Privacy controls state machine (Cyber, CYBER-R1). Drives create / show-recovery-once / unlock / recover /
 * change passphrase / lock / delete over a real VaultPort (LocalVault). UI-free so it runs under node --test;
 * `vault-controls.tsx` renders it.
 *
 * Rules enforced here (src/vault/DESIGN.md): the recovery code lives only in this object's memory until the
 * user retypes its last group, then it is dropped; passphrases are never stored; wrong passphrase and wrong
 * recovery code show one identical message; repeated failures back off (UI friction only — the KDF cost is
 * the real control against offline guessing); deletion needs a typed confirmation.
 */
import type { VaultErrorCode, VaultPort } from '../../lib/backend/ports.ts';

export type VaultControlsPort = Pick<VaultPort, 'status' | 'state' | 'refresh' | 'create' | 'unlock' | 'recover' |
  'changePassphrase' | 'lock' | 'destroy' | 'subscribe' | 'getVersion'>;

export type Screen = 'loading' | 'unavailable' | 'create' | 'confirm_recovery' | 'unlock' | 'recover' | 'unlocked' |
  'change_passphrase' | 'confirm_destroy';

export interface VaultControlsView {
  screen: Screen;
  busy: boolean;
  error: string | null;
  notice: string | null;
  /** Present only on `confirm_recovery`. Never persisted, logged or sent anywhere. */
  recoveryCode: string | null;
  /** Milliseconds until another unlock/recover attempt is accepted (0 = now). */
  retryInMs: number;
}

export const MIN_PASSPHRASE = 12;
export const DESTROY_CONFIRMATION = 'DELETE';
const FREE_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 60_000;

/** Constant, content-free copy. One message for wrong passphrase AND wrong recovery code (no oracle). */
export const MESSAGES: Record<VaultErrorCode | 'mismatch' | 'too_soon' | 'confirm_destroy' | 'recovery_check', string> = {
  wrong_secret: "That passphrase or recovery code didn't work.",
  weak_passphrase: `Use at least ${MIN_PASSPHRASE} characters.`,
  mismatch: "The two passphrases don't match.",
  too_soon: 'Too many attempts. Wait a moment and try again.',
  confirm_destroy: `Type ${DESTROY_CONFIRMATION} to delete this device's journal.`,
  recovery_check: "That doesn't match the last group of your recovery code.",
  vault_unavailable: "This browser can't store an encrypted journal (IndexedDB or Web Crypto is missing).",
  vault_absent: 'There is no journal on this device yet.',
  vault_exists: 'A journal already exists on this device.',
  vault_locked: 'Unlock your journal first.',
  invalid_input: 'Check what you entered and try again.',
  not_found: 'Not found.',
  vault_corrupt: "The journal on this device can't be read.",
};

const codeOf = (e: unknown): VaultErrorCode | null => {
  const c = (e as { code?: unknown })?.code;
  return typeof c === 'string' && c in MESSAGES ? c as VaultErrorCode : null;
};

export class VaultControlsController {
  private readonly vault: VaultControlsPort;
  private readonly now: () => number;
  private view: VaultControlsView = { screen: 'loading', busy: false, error: null, notice: null, recoveryCode: null, retryInMs: 0 };
  private failures = 0;
  private blockedUntil = 0;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private unsubscribeVault: (() => void) | null = null;

  constructor(vault: VaultControlsPort, now: () => number = Date.now) {
    this.vault = vault;
    this.now = now;
  }

  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getVersion = (): number => this.version;
  snapshot(): VaultControlsView { return { ...this.view, retryInMs: Math.max(0, this.blockedUntil - this.now()) }; }

  /** Call once on mount. Follows vault-initiated changes (idle lock, pagehide) so the UI never shows stale unlocked state. */
  async start(): Promise<void> {
    if (this.vault.status.kind !== 'live') return this.set({ screen: 'unavailable', error: MESSAGES.vault_unavailable });
    this.unsubscribeVault ??= this.vault.subscribe(() => this.followVault());
    const state = await this.vault.refresh();
    this.set({ screen: state === 'absent' ? 'create' : state === 'unlocked' ? 'unlocked' : 'unlock' });
  }

  stop(): void { this.unsubscribeVault?.(); this.unsubscribeVault = null; }

  async create(passphrase: string, confirm: string): Promise<void> {
    if (passphrase !== confirm) return this.set({ error: MESSAGES.mismatch });
    if (passphrase.normalize('NFKC').length < MIN_PASSPHRASE) return this.set({ error: MESSAGES.weak_passphrase });
    await this.run(async () => {
      const { recoveryCode } = await this.vault.create(passphrase);
      this.set({ screen: 'confirm_recovery', recoveryCode });
    });
  }

  /** The user proves they saved the code by retyping its last group; only then is it dropped from memory. */
  acknowledgeRecovery(lastGroup: string): void {
    const code = this.view.recoveryCode;
    if (!code || this.view.screen !== 'confirm_recovery') return;
    const last = code.split('-').at(-1) ?? '';
    if (lastGroup.trim().toUpperCase() !== last) return this.set({ error: MESSAGES.recovery_check });
    this.set({ screen: this.vault.state === 'unlocked' ? 'unlocked' : 'unlock', recoveryCode: null, notice: 'Recovery code saved. It will not be shown again.' });
  }

  async unlock(passphrase: string): Promise<void> {
    if (!this.attemptAllowed()) return;
    await this.run(async () => {
      await this.vault.unlock(passphrase);
      this.failures = 0;
      this.set({ screen: 'unlocked' });
    }, true);
  }

  showRecover(): void { if (this.view.screen === 'unlock') this.set({ screen: 'recover' }); }

  async recover(recoveryCode: string, newPassphrase: string, confirm: string): Promise<void> {
    if (newPassphrase !== confirm) return this.set({ error: MESSAGES.mismatch });
    if (newPassphrase.normalize('NFKC').length < MIN_PASSPHRASE) return this.set({ error: MESSAGES.weak_passphrase });
    if (!this.attemptAllowed()) return;
    await this.run(async () => {
      const rotated = await this.vault.recover(recoveryCode, newPassphrase);
      this.failures = 0;
      this.set({ screen: 'confirm_recovery', recoveryCode: rotated.recoveryCode, notice: 'Your old recovery code no longer works. Save this new one.' });
    }, true);
  }

  showChangePassphrase(): void { if (this.view.screen === 'unlocked') this.set({ screen: 'change_passphrase' }); }

  async changePassphrase(current: string, next: string, confirm: string): Promise<void> {
    if (next !== confirm) return this.set({ error: MESSAGES.mismatch });
    if (next.normalize('NFKC').length < MIN_PASSPHRASE) return this.set({ error: MESSAGES.weak_passphrase });
    await this.run(async () => {
      await this.vault.changePassphrase(current, next);
      this.set({ screen: 'unlocked', notice: 'Passphrase changed on this device.' });
    });
  }

  lock(): void { this.vault.lock(); this.set({ screen: 'unlock', notice: null }); }

  showDestroy(): void { if (this.view.screen === 'unlocked' || this.view.screen === 'unlock') this.set({ screen: 'confirm_destroy' }); }

  /** Irreversible crypto-shred of this device's vault. Signing in again does not restore it. */
  async destroy(typed: string): Promise<void> {
    if (typed !== DESTROY_CONFIRMATION) return this.set({ error: MESSAGES.confirm_destroy });
    await this.run(async () => {
      await this.vault.destroy();
      this.set({ screen: 'create', notice: "This device's journal was deleted." });
    });
  }

  cancel(): void {
    const back: Partial<Record<Screen, Screen>> = { recover: 'unlock', change_passphrase: 'unlocked' };
    const s = this.view.screen;
    if (s === 'confirm_destroy') return this.set({ screen: this.vault.state === 'unlocked' ? 'unlocked' : 'unlock' });
    if (back[s]) this.set({ screen: back[s]! });
  }

  private attemptAllowed(): boolean {
    if (this.now() < this.blockedUntil) { this.set({ error: MESSAGES.too_soon }); return false; }
    return true;
  }

  private async run(fn: () => Promise<void>, countsAsAttempt = false): Promise<void> {
    if (this.view.busy) return;
    this.set({ busy: true, error: null, notice: null });
    try {
      await fn();
    } catch (e) {
      const code = codeOf(e) ?? 'invalid_input';
      if (countsAsAttempt && code === 'wrong_secret') {
        this.failures++;
        if (this.failures >= FREE_ATTEMPTS) {
          this.blockedUntil = this.now() + Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.failures - FREE_ATTEMPTS));
        }
      }
      this.set({ error: MESSAGES[code] });
    } finally {
      this.set({ busy: false });
    }
  }

  private followVault(): void {
    const s = this.vault.state;
    const unlockedScreens: Screen[] = ['unlocked', 'change_passphrase'];
    if (s === 'locked' && unlockedScreens.includes(this.view.screen)) this.set({ screen: 'unlock', notice: 'Locked to protect your journal.' });
    else if (s === 'absent' && this.view.screen !== 'create' && this.view.screen !== 'loading') this.set({ screen: 'create' });
  }

  private set(patch: Partial<VaultControlsView>): void {
    this.view = { ...this.view, ...patch };
    if (patch.screen && patch.screen !== 'confirm_recovery') this.view.recoveryCode = null;
    this.version++;
    for (const l of this.listeners) l();
  }
}
