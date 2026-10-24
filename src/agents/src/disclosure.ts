/**
 * Facts for provider-processing notices. CS renders the copy; Cyber reviews it.
 * `retention: 'unverified'` means no zero-retention claim may be made until someone checks the account settings.
 */
export const PROVIDER_PROCESSING = {
  reflection: {
    provider: 'Anthropic (Claude API)', sends: 'the journal text the owner selects', returns: 'a private reflection and an optional draft signal',
    kineticStores: 'nothing server-side; the result goes to the owner\'s local vault', retention: 'unverified',
    settings: 'SDK logging off; no identifiers or metadata sent with the request',
  },
  voice: {
    provider: 'Cartesia', sends: 'recorded audio for transcription and reply text for speech', returns: 'a transcript and synthesized audio',
    kineticStores: 'nothing server-side; audio is transient', retention: 'unverified (zero data retention is an enterprise-only Cartesia setting)',
    settings: 'TTS save=false; browser sessions use 60-second scoped access tokens',
  },
  coordination: {
    provider: 'Factory (Droid) running a Claude model', sends: 'approved support-mode and availability enums only', returns: 'a choice among pre-approved options',
    kineticStores: 'sanitized outcome codes', retention: 'Factory persists session transcripts; they contain only the approved enums',
    settings: 'single no-I/O tool allowlisted; empty working directory; provider keys withheld from the subprocess',
  },
} as const;
