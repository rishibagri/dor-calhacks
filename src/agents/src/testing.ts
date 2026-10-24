/**
 * SYNTHETIC TEST DOUBLES ONLY. No provider calls; outputs are canned fixtures. Never wire these into live mode,
 * and never report results produced with them as live integration.
 */
import { PrivateReflectionSchema, VoiceSessionSchema, type PrivateReflection, type PrivateReflectionPort,
  type VoicePort, type VoiceSession } from '@kinetic/contracts';
import type { AckProposalInput, AckProposerPort } from './coordination/coordinator.js';

export class SyntheticReflectionAdapter implements PrivateReflectionPort {
  readonly synthetic = true;
  constructor(private readonly result: PrivateReflection) { PrivateReflectionSchema.parse(result); }
  async reflect(): Promise<PrivateReflection> { return structuredClone(this.result); }
}

export class SyntheticVoiceAdapter implements VoicePort {
  readonly synthetic = true;
  constructor(private readonly session: VoiceSession, private readonly transcript: string) {
    VoiceSessionSchema.parse(session);
  }
  async createSession(): Promise<VoiceSession> { return structuredClone(this.session); }
  async transcribe(): Promise<{ text: string }> { return { text: this.transcript }; }
  async synthesize(): Promise<{ audio: Uint8Array; mimeType: string }> {
    return { audio: new Uint8Array(44), mimeType: 'audio/wav' };
  }
}

/** Replays scripted proposer outputs in order; an Error entry is thrown to simulate timeouts. */
export class ScriptedAckProposer implements AckProposerPort {
  readonly synthetic = true;
  readonly calls: AckProposalInput[] = [];
  constructor(private readonly script: unknown[], private readonly onCall?: (round: number) => void | Promise<void>) {}
  async propose(input: AckProposalInput): Promise<unknown> {
    this.calls.push(structuredClone(input));
    await this.onCall?.(input.round);
    const next = this.script[this.calls.length - 1] ?? { decision: 'decline' };
    if (next instanceof Error) throw next;
    return next;
  }
}
