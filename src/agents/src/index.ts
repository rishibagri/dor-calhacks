// Production adapters only. Synthetic doubles live in @kinetic/agents/testing and must not be wired into live mode.
export { ClaudeReflectionAdapter, DEFAULT_REFLECTION_MODEL, MAX_SELECTED_TEXT_CHARS, type ClaudeReflectionOptions }
  from './reflection/claude.js';
export { CartesiaVoiceAdapter, CARTESIA_API_VERSION, DEFAULT_VOICE, MAX_AUDIO_BYTES, MAX_SPOKEN_CHARS,
  sniffAudioExtension, type CartesiaVoiceOptions } from './voice/cartesia.js';
export { BoundedCoordinator, AckProposalSchema, MAX_ROUNDS, type AckProposal, type AckProposalInput,
  type AckProposerPort, type CoordinatorDeps, type DeliveryStatePort, type RecipientPreferencesPort } from './coordination/coordinator.js';
export { IntroductionCoordinator, IntroProposalReplySchema, InvalidShortlistError, INTRO_MAX_ROUNDS, INTRO_PROPOSAL_TTL_MS,
  type DiscoveryEligibilityPort, type IntroductionCoordinatorDeps, type IntroductionResult, type IntroProposalInput,
  type IntroProposalReply, type IntroProposerPort } from './introductions/coordinator.js';
export { eligibleOptions, intersectWindow, type AckOption } from './coordination/eligibility.js';
export { ProviderError, httpStatusFor, toProviderError, type Provider, type ProviderErrorCode } from './errors.js';
export { PROVIDER_PROCESSING } from './disclosure.js';
export { handleReflectionRequest, handleVoiceSessionRequest, RateLimiter, type RouteSession } from './http/routes.js';
