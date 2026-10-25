# Relationship books (D049)

Each accepted connection has an optional book inside Connections. It gives the owner a private place to keep selected memories and a lightweight interaction history.

## Book contents

- **Photos:** the owner selects JPEG, PNG, or WebP images from their device (up to 1.5 MB each); a short optional caption is stored with the image. Photos are encrypted as local-vault records and shown only while that vault is unlocked.
- **Calls:** the owner can manually log a call, choose Good / Okay / Hard, and add a short private note. dor does not read phone call history.
- **Introductions:** the owner can deliberately link one of their own introduction records to a book. That link is local to the owner's vault.
- **Nudges:** a nudge is added to local history only after it appears in the recipient's own `my_nudges` view. The book stores its fixed template identifier and a local first-seen time, not the sender's approval time. The recipient can record Good / Okay / Hard feedback on that same local entry.

## Storage and use

All book photos, call notes, links and feedback are encrypted by the existing per-account IndexedDB/Web Crypto vault. They are not uploaded, synced, sent to Claude/Factory/Cartesia, put in SpacetimeDB, sent to another person, or passed to Apify. Apify remains for generic public event listings. There is no social-media scraping, remote photo URL import, or phone-call-log integration. Local feedback does not currently train or alter the agent.

On lock, account change or sign-out, the book component unmounts and clears decrypted photo data from its UI state. Vault destruction removes the book records with other vault data. Local storage is single-device; users must not assume these records are backed up or restored on another device.

The book grants no disclosure consent and does not alter the separate D044 automatic-nudge rule. D044 skips per-nudge sender review only for a named pair covered by a current owner-enabled standing rule; recipient opt-in/preferences, pauses, expiry, quiet hours, cooldown and server rechecks remain in force.

## Evidence status

Implementation and offline test status are recorded in `PROJECT_KNOWLEDGE.md` and `docs/updates/{cs,cyber}.md`. A Node/fake-IndexedDB test does not establish real-browser storage, lock lifecycle or provider behavior.
