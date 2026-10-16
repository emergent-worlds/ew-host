# Decisions: ew-host

Appended newest first. Each entry records the decision, the alternatives considered, and the rationale.

## 2026-10-15: Preserve page requests through explicit remote synchronization

**Decision.** remotePort returns the existing PortClient surface with snapshot installation, current readiness, input/agent/control access, and explicit reconnect. It retains pending opaque request identities across socket replacement, while separately correlating numeric port ids. It refreshes at 55 minutes and preserves one fixed five-minute disconnected window. The App chooses when to retry after connectivity returns; no immediate loop or unrecorded backoff is introduced.

**Alternatives.** Reuse a join ticket on every reconnect, discard requests through the local port's timeout, or resume input before an exact synchronization acknowledgment and the latest ready sequence.

**Rationale.** E8 and PV85 require authoritative page state before input and deduplicated retry. A stalled snapshot installer is raced against its attempt's abort signal; application code must honor that signal before committing its view. Server admission, method authorization, projection, account/payer identity and request outcomes remain server responsibilities.

## 2026-10-15: Validate the remote player wire by direction

**Decision.** Export distinct RemoteClientFrame and RemoteServerFrame schemas with fixed-error JSON codecs and emitted JSON Schemas. They carry E8's four player channels and synchronization controls, with safe integer sequences and port ids, a separate opaque request id, and no host/core vocabulary. Admitted resume credentials are opaque strings; trusted account identities remain server-side.

**Alternatives.** Reuse the privileged host vocabulary, or let the server and App define separate wire shapes.

**Rationale.** The permanent files record and the cycle's canonical E8 wire clarification define one direction-specific contract. Strict outer objects reject unknown authority fields. Server admission, sender stamping, method authorization, projection and request deduplication remain server obligations; a valid envelope grants no capability.

## 2026-10-15: Preserve the authenticated sender across folder dispatch

**Decision.** PortCall accepts optional from and servePort passes it separately from arguments. Remote adapters must overwrite this value from authenticated admission. Port closure rejects waiters and suppresses delayed replies.

**Alternatives.** Trust a sender inside call arguments or lose sender identity before the pack handles the call.

**Rationale.** E8 assigns sender stamping to the server and per-person behavior to pack handlers. The generic dispatch seam transports that identity without claiming to authenticate it.

## 2026-10-15: Host-owned away recap metadata

**Decision.** The optional grant away object carries pace and authoritative monthly compute percentage, with null for unavailable usage. The page may open the away App surface through its own connection.

**Alternatives.** Derive billing share inside the pack or substitute zero when usage is unavailable.

**Rationale.** NP8 reads simulation changes from the record, while pace and metered usage belong to the host. Canonical files amendment `8ed74c0ddd` defines this boundary.

## 2026-10-15: Adapt the server worker through the existing transport contract

**Decision.** `workerTransport(worker)` supports the Node worker_threads event emitter and Bun's Worker EventTarget without a runtime-specific import in shipped code. It forwards payloads, reports errors and termination through `onClose`, removes listeners on disposal, and requests termination once. Error text is a fixed transport description. An early startup buffer holds up to 1,000 messages until the bridge subscribes; this is an internal guard, not a limit on attached traffic. The loader and bridge retain schema, ask, and endpoint enforcement.

**Alternatives.** Node-only imports in the shared package (unusable in browser consumers). A worker-specific protocol (duplicates the host contract). Treating a worker as a sandbox (the approved plan makes no such guarantee).

**Rationale.** E11 requires the server's worker endpoint to carry the same vocabulary as the App. Local tests execute real Node 24.22.0 and Bun 1.4.3 workers, alongside deterministic message and lifecycle fixtures. The transport closes immediately when it observes failure or termination; graceful final save belongs to the correlated `quit` handler, and native exit observation belongs to the runner. Compiled executables and engine loading remain their own gates.

## 2026-10-15: Separate the authoritative core and per-person page connections

**Decision.** Add explicit core/page families to each bridge, enforce them before dispatch, stamp the grant's endpoint, and expose distinct loader APIs and a two-port parent handoff. Retain the deprecated combined connection only for existing local 0.3 consumers during migration.

**Alternatives.** Forward page requests through the shared core (mixes account-specific dialogs and preferences between people); remove the existing API immediately (breaks unchanged Wave 2 consumers before their migration is verified).

**Rationale.** Wave 3 E7 and the files record require per-person page operations to stay on that person's device while the authoritative core can run on a server. Each bridge owns its reply scope. New consumers explicitly choose a family and remote guests never receive combined. See split-endpoints.md for migration and acceptance boundaries.

## 2026-10-15: Observe a save before sending its request

**Decision.** Register the save waiter before sending save.request. If the send is refused or throws, remove and reject that waiter immediately.

**Alternatives.** Require asynchronous transports everywhere (an undocumented condition on Transport); poll for an already completed save (adds state and races).

**Rationale.** D8 promises the committed version in reply to requestSave. The previous ordering missed a synchronous transport's save because receive captured the waiter list before requestSave added it. The correction changes no message shape or policy value.

## 2026-10-15: startCore starts a classic worker that imports the core and holds the page's messages until it listens (0.3.3)

**Decision.** `startCore(url)` (`src/start-core.ts`, exported from the loader) starts the core with `new Worker(blobUrl)`, a classic worker, whose bootstrap imports the core with a dynamic `import()` of its absolute URL. Until the import has resolved, the bootstrap holds every message the worker receives, stops it reaching any other listener, and then dispatches each again in order with its ports, so the page's two handoffs (`handPort` and the pack's own port) reach the core once each. A core that does not load is thrown from the worker's global scope, which the page receives as the worker's error event, as before. `scripts/worker-check.mjs` (`pnpm check:worker`) loads the frame on 127.0.0.1 in an iframe sandboxed with `allow-scripts` only, under a parent on another port, with the App's headers and policy, and starts a core that imports a module under `/uses/` statically and another dynamically, the second loading a WebAssembly module, while both are served late and a third message arrives during the core's own import. It measured:

| Case | Chromium 156 (Playwright) | WebKit 27.2 (Playwright) | Gecko, Firefox 157 (Playwright) |
| --- | --- | --- | --- |
| `startCore`, a core that loads | both handoffs and their ports arrive once each, the late message once, the WebAssembly answers, worker origin `null` | the same | the same |
| `startCore`, a core that does not load | error event | error event | error event |
| the module bootstrap of 0.3.0 to 0.3.2 | error event before the worker runs | runs | runs |

Without the step that stops a held message reaching other listeners, a core listening at its top level and then awaiting an import received the late message twice in Chromium, so the bootstrap keeps that step. The classic form runs on all three engines, so no engine keeps the module form and nothing is detected.

**Alternatives.** The module form for WebKit alone, chosen by detection (not needed, since WebKit runs the classic form); a module worker from a `data:` URL (needs `data:` in the frame's `worker-src`); holding the messages on the page until the core says it listens (a second handshake in every pack's page and core).

**Rationale.** The App's request 9 (ew-app docs/ew-host-requests.md): on WebView2 and Android's WebView the pack's page loads and its core never starts, and the Reality stops at the 20 second opening ceiling (wave 2 faults 27 and 30).

## 2026-10-15: Marks read uses transitively; the journeys drive a Reality's page through hooks of its own

**Decision.** (1) `resolveUses` follows each used folder's own uses, so a Reality that names its pack reaches the engine and the pack's contract is checked against it. (2) A page starts its core with `startCore(url)`, a `blob:` bootstrap that imports the core by its absolute URL, since a sandboxed page cannot start a worker from its own URL. (3) `HostBridge` passes `app.open` to `HostHandlers.appOpen`, and a folder's `Host.open` sends it. (4) A progress of 1, or the first status line, tells the host the folder has opened. (5) `installJourneysHooks()` answers find, click, type, wait, read, and screen on the page's own elements, with the App seam's selector, only for the parent window and only once the App's handoff of the port says `journeys: true`; errors never repeat a typed value.

**Alternatives.** (1) The host flattening uses itself. (5) The journeys hooks over the host contract, which ends in the core's worker and has no page.

**Rationale.** The App team's requests 1 and 4 to 7 of 2026-10-15, found running Salt Harbor in the App.

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
