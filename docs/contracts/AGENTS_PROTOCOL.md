# Bounded agent protocol v1
1. PrivateAgent(owner) reflects on an owner-only journal and proposes an owner-only candidate. No network transmission to peer.
2. Owner previews/approves a schema-constrained signal. Cyber policy service issues a validated envelope; agents cannot mint one.
3. SenderAgent publishes only the approved envelope to the coordinator.
4. RecipientAgent reads that envelope plus its own explicitly approved preferences and returns a schema-constrained ACK: compatible support mode and coarse availability, or decline. It cannot query either journal store. Recipient preferences require their own current consent record; no implicit return disclosure.
5. Coordinator intersects approved modes/windows, ranks eligible actions, and emits a template ID. Maximum two rounds and one nudge per pair per 24 hours; no free-form agent conversation or hidden chain-of-thought logging.
6. Before rendering the nudge, policy rechecks every source consent. Lack of an intersection means no nudge, not a request for more private details.

Timeout: proposed 8 seconds per model call, one retry with same idempotency key. Fall back to an approved fixed template only when all policy conditions hold; otherwise return no suggestion. Record only sanitized outcome codes. These are initial engineering targets, not measured performance.
