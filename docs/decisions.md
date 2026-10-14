# Decisions: ew-host

Appended newest first. Each entry records the decision, the alternatives considered, and the rationale.

## 2026-10-14: Public, Apache License 2.0

**Decision.** This repository is public under the Apache License 2.0 (the operator's decision of 2026-10-14).

**Alternatives.** Private, like the engine and the pack.

**Rationale.** Third parties write folders, engines, and packs against it, and the licence carries an explicit patent grant. Recorded from the build V2 plan, approved by the operator on 2026-10-14.

## 2026-10-14: The host contract is one JSON vocabulary over three transports

**Decision.** Version 1 of a message vocabulary whose families are the record's asks, carried by a message channel in the frame, a loopback socket for the SDK, and a WebSocket for a server; the bridge refuses any message for an ask the manifest does not make.

**Alternatives.** A protocol per host.

**Rationale.** The same engine and pack run in every place the record names. Recorded from the build V2 plan, approved by the operator on 2026-10-14.
