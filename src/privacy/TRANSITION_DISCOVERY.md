# Transition-first discovery: allowed data (Cyber, D046, README D045 Phase 0–1)

D045 makes new connections and source-backed local events the core path, but it doesn't widen any permission. This page is the single list of what discovery may use, who sees it, and for how long. It summarizes enforced code (D035/D038/D039/D041/D043) plus the D046 additions. **Status: offline-verified; the module is unpublished, and discovery stays behind `discovery_config.enabled` (default off) until the Phase 5 gate.**

## 1. What may be published (peer-visible)
| Field | Rule | Enforced by |
|---|---|---|
| Card ref | random publication id, never an identity | `projectDiscoveryCard` |
| Display name | ≤ 40 chars, NFKC, no contact details, URLs, handles, ids or spoofing characters | `guardPublicationDraft` |
| Interest **and transition** tags | ≤ 8, from the developer tag allowlist only; **sensitive labels can't be allowlisted** (D046 below) | `guardPublicationDraft`, `validSlugAllowlist` |
| Shared tags | overlap with the viewer's own published tags | `projectDiscoveryCard` |
| Revision | integer | — |

Nothing else is ever on a card: no area key, distance, expiry, account, pair, preset, preference, quiz answer, journal, assessment, pause or location.

**Transitions (D045 "choose a transition"):** a transition is private to the owner unless they publish it as a tag. Publishable transitions are ordinary, non-sensitive life stages from the developer allowlist, for example `starting-college`, `new-to-city`, `new-job`, `recent-grad`. Transitions that disclose health, grief, divorce, recovery, sexuality, religion, immigration status, or legal or financial trouble are refused by D046 at configuration time.

## 2. Audience, area and lifetime
- **Audience:** signed-in, registered accounts that are themselves published, in the same configured coarse area, with no block either way. Lurkers see nothing (`guardDiscoveryVisibility`). Already-connected people (an accepted introduction or an accepted pair) are hidden from each other's cards and can't send each other a new introduction (`connectedCounterparts`).
- **Area:** one developer-configured coarse key per person. The device turns a single low-accuracy sample into that key and discards the coordinates; the server refuses coordinates, geohashes or finer cells (`guardAreaKey`). It lasts at most 24 h, with no background refresh, and at most 4 area changes a day.
- **Publication:** at most 7 days, withdrawable at any time; a new revision is an explicit new consent.
- **Event intent (interested/going):** explicit, per event, ends when the event ends. Others see it only where they marked the same event and can see your card; the kind is never shown (`event_companions`).

## 3. Introductions and plans
- An introduction request is human-triggered, to a card visible now. Only the recipient accepts or declines, and the sender never sees a decline (D038). **Acceptance creates no pair, preset, support consent or message**, so it never inherits pair or journal permissions.
- A shared plan is confirmed only when both people accept the same revision while both intents, the basis, a fresh event and no block all hold (D039, D034).

## 4. Revocation (takes effect in the same transaction)
- Withdraw ends area participation, pending introductions and proposals.
- A profile edit stales outgoing requests and proposals.
- Block or report ends introductions and proposals both ways.
- Revoking an event intent stales plans.
- A D041 pause never touches discovery; discovery uses block instead, and nothing reveals a pause.

## 5. What never enters Apify or a shared agent payload
- **Apify** sees only generic developer-configured queries: allowlisted topic, format, limit and locale, identical for every user (`guardPublicCatalogueQuery`, D028). It never sees a profile, journal, quiz answer, pair or account id, attendance intent, transition choice or device location.
- **Discovery/introduction agents** see opaque refs, approved reason codes and shared tags only (D033/D038). Never journals, private assessments, exact times or coordinates.

## 6. Flags and consent scopes (stay independent)
Discovery opt-in, event intent, pair support consent (D035), C7 activity approval and D041 pause can't substitute for one another. The discovery flag stays off until the deployed Phase 5 check passes.
