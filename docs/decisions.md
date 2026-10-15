# Decisions: ew-host

Appended newest first. Each entry records the decision, the alternatives considered, and the rationale.

## 2026-10-15: The host keeps the files it writes into a running folder

**Decision.** A save's listing is the folder core's complete tree, so a file absent from it is deleted. Files the host writes into a folder whose core is running (the agent's files and their provenance) are merged by the host into the version it makes from the core's next save; a core's listing never deletes them.

**Alternatives.** The agent writes only through the core (a second write path through every pack); the listing as a diff (a lost message loses a deletion).

**Rationale.** The agent writes files beside a running Reality in the terminal and the build (ew-agent's request, 2026-10-15), and the complete tree keeps saves simple to check.

## 2026-10-15: The host contract terminates in the folder's core, which runs in a worker everywhere

**Decision.** A folder's headless module (its core) is the one end of the host contract: the page receives the App's port with `framePort()` and hands it to the core's worker with `handPort()`, where `workerPort()` and `connect()` take it; the hidden runner and a server hand the same core a transport directly. The page talks to its core over the folder's own port (`src/port.ts`), a call-and-reply envelope the engine's nine calls and a pack's own calls ride. The resolved uses are served under `/uses/<ref>/` on the folder's origin, and the grant lists them with their versions and kinds.

**Alternatives.** The page as the end of the contract, relaying to the worker (two consumers of one channel, a second `ready`); the engine on the page's main thread (the plan puts it behind a port backed by a worker); a protocol per place.

**Rationale.** The same core then runs alike in the frame, in the hidden runner, and in a server, which is the plan's requirement for the engine (Section 3.2), and the page stays a view. The wave 2 design, D4 and D6.

## 2026-10-15: A save is one act, with its reason

**Decision.** `save.request` is a notice carrying a reason (`interval`, `leaving`, `pause`, `handoff`, `before-change`, `build`) and an optional name; the folder answers with its own `save` request carrying the reason, the complete tree with bytes for what changed since the version the host last confirmed (at start, the grant's listing), and the reply is the committed version. The bridge's `requestSave()` resolves when the folder's save for that reason has been committed. A path absent from the listing is a deleted file.

**Alternatives.** Answering `save.request` with a reply that is the listing and a second message for the version; the earlier `save` with `reply_to`, which gave two paths for one act.

**Rationale.** The folder learns its version by the same path whether it saved on request or on its own account, and the host has one handler. The wave 2 design, D8.

## 2026-10-15: The agent's channel carries structured queries, proposals with a preview in four groups, and a forecast or its absence

**Decision.** `state.query` takes a structured query (kind, name, tags, scope, neighbours, a bounded expression, a limit); `change.forecast` projects a change and stores nothing; `change.propose` takes `{ intent, ops, expectations }`, with `ops` in the engine's own documented vocabulary, and replies with a stored proposal, a preview in the four groups the decision card draws (adds, changes, needs, takes), a forecast or `{ available: false, reason }`, the checks, and the gaps; `change.apply` names who approved, the person or the approved plan of a build. Layouts move by `layout.set` and `layout.reset` in the pack's documented form.

**Alternatives.** Free text queries; ops typed in the host contract (which would bind every engine to one vocabulary); a preview as prose only.

**Rationale.** Any engine answers the parts it has and the agent, the App, and the pack parse one shape; the ops stay the engine's. The wave 2 design, D8 and D9.

## 2026-10-15: A Reality takes its entry from the pack it uses

**Decision.** A manifest with `asks` and no `entry` is valid when it uses a folder; the resolver (`resolveEntry`) takes the entry of the nearest used folder that names one, and the asks stay the Reality's own.

**Alternatives.** A one-line `index.html` in every Reality; an `entry` that names a path inside a used folder.

**Rationale.** The first-party Realities are manifests, the pack owns its built page and core, and a Reality asks for what it needs, which may be less than the pack can do. The wave 2 design, D5.

## 2026-10-15: Image jobs are named apart, and granted where the route offers an image model

**Decision.** `asks.models` names `jobs` (a language model) and `image_jobs` (an image model); `model.call` takes a text or an image request; an image job is granted only where the route offers an image model, and a Reality otherwise runs without pictures and its mark says so.

**Alternatives.** One job list with a kind per call; a Reality that asks for images marked won't work on a key with no image model (the plan's reading, put to the operator in the wave 2 design, D10).

**Rationale.** The images module is in the pack's default distribution and the only own key at launch offers no image model. The wave 2 design, D10.

## 2026-10-14: Public, Apache License 2.0

**Decision.** This repository is public under the Apache License 2.0 (the operator's decision of 2026-10-14).

**Alternatives.** Private, like the engine and the pack.

**Rationale.** Third parties write folders, engines, and packs against it, and the licence carries an explicit patent grant. Recorded from the build V2 plan, approved by the operator on 2026-10-14.

## 2026-10-14: The host contract is one JSON vocabulary over three transports

**Decision.** Version 1 of a message vocabulary whose families are the record's asks, carried by a message channel in the frame, a loopback socket for the SDK, and a WebSocket for a server; the bridge refuses any message for an ask the manifest does not make.

**Alternatives.** A protocol per host.

**Rationale.** The same engine and pack run in every place the record names. Recorded from the build V2 plan, approved by the operator on 2026-10-14.
