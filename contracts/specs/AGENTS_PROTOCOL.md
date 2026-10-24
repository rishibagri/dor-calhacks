# Bounded agent protocol v1
1. PrivateAgent(owner) uses a disclosed transient Claude request on owner-selected local-vault content and reflects on an owner-only journal and proposes an owner-only candidate. No network transmission to peer.
2. Owner previews/approves a schema-constrained signal. Cyber policy service issues a validated envelope; agents cannot mint one.
3. SenderAgent publishes only the approved envelope to the coordinator.
4. RecipientAgent reads that envelope plus its own explicitly approved preferences and returns a schema-constrained ACK: compatible support mode and coarse availability, or decline. It cannot query either journal store. Recipient preferences require their own current consent record; no implicit return disclosure.
5. Factory worker orchestrates the bounded exchange using only approved structured signals and restricted tools. Coordinator intersects approved modes/windows, ranks eligible actions, and emits a template ID. Maximum two rounds and one nudge per pair per 24 hours; no free-form agent conversation or hidden chain-of-thought logging.
6. Before rendering the nudge, policy rechecks every source consent. Lack of an intersection means no nudge, not a request for more private details.

Timeout: proposed 8 seconds per model call, one retry with same idempotency key. Fall back to an approved fixed template only when all policy conditions hold; otherwise return no suggestion. Record only sanitized outcome codes. These are initial engineering targets, not measured performance.

Before each exchange and result commit, enforce both current assigned relationship-preset policy version and item consent version in SpacetimeDB. Trigger jobs carry IDs, not raw transcripts; Factory persistent sessions/logs must never contain private vault data.

## C8 proposed discovery coordination and efficiency
Logical agents for opted-in dor users compare explicitly published interest/event cards after deterministic eligibility and shortlist. No radio/device scan, raw journal, exact location, habit history or private personality labels. At most two proposal rounds; a model may select an allowed option or decline. The proposal never sends a personal message or grants consent. Recheck publication, event intent, expiry and blocks before commit. Public-profile visibility does not require mutual invitation acceptance; contact actions do.

No calls for denied/empty candidates; feed rendering and filtering are deterministic. Evaluate a single-option deterministic path and invoke reasoning only where it adds value. Coalesce change-triggered jobs, use bounded worker concurrency and an aggregate deadline so retries do not multiply indefinitely. Reused Droid workdirs require serialization or isolated pool slots; no shared mutable cleanup across concurrent calls. Cache reusable public/static data only under a reviewed policy; do not cache private journals for savings. Keep final authorization rechecks even on cache hits.
