# Remote player connection

The permanent files record and the cycle's E8 wire contract define protocol version 1. `RemoteClientFrame` and `RemoteServerFrame` validate its distinct directions. `parseRemoteClientFrame` and `parseRemoteServerFrame` accept JSON text only, enforce the 4 MiB UTF-8 bound, and throw fixed errors without echoing input. The corresponding encode helpers refuse non-JSON values and oversized frames. The same schemas are emitted under `schemas/` for other bindings.

The first client control frame is join with its one-use ticket, or resume with the separate rotating credential and last applied sequence. Admission returns slot, trusted sender, epoch, and the new opaque resume credential. Credentials belong only to these control frames and memory. Account ids remain server-side. They never belong in a URL, diagnostic, snapshot, player list, or folder RPC.

Entry installs an authoritative per-person page snapshot, receives the synchronization boundary, acknowledges that exact boundary, and waits for ready before input. Resume installs a replacement snapshot or contiguous replay. Sequenced notices are positive safe integers; a snapshot can start at zero. Duplicates are ignored, while a gap requires synchronization. The server flushes notices queued beyond the acknowledged boundary before ready; ready's sequence is the latest issued sequence after that flush.

Folder calls and replies carry a stable opaque requestId independently from the folder port's numeric id. Input and agent operations use the same request identity principle. Retries retain requestId and never choose sender or paying account. The server stamps sender, deduplicates concurrently pending and completed work for the slot, and unicasts its reply. A changed request under the same identity is refused. Epoch loss prevents blind retry of uncertain operations.

The four channels are folder port, input, agent, and control. These envelopes do not include grants, file access, model calls, saves, or other privileged host controls. A structurally valid folder method is not an authorized one. The server's injected folder adapter defaults to denying guest calls and must explicitly authorize each method and supply the requesting person's projection. Read, query and forecast are also private until such an adapter authorizes and projects them.

## The page client

`remotePort(url, options)`, exported from the package root and `host/loader`, returns the local port's `call`, `on`, and `close` surface, with `ready`, `state`, `lastSeq`, `reconnect`, `input`, `ask`, and `decide`. It does not start a core. Supply the initial join token and an `installSnapshot(notices, seq, signal)` callback that replaces the page's projection. That callback consumes the snapshot notices; ordinary sequenced notices go through `on`. Await `ready` before issuing new requests.

The snapshot installer may prepare asynchronously, but must check its attempt signal before committing page state. Replacing a socket aborts that signal and abandons the old wait, so a stalled installer does not block the new synchronization. Generation checks prevent an old completion from advancing sequence or acknowledging state. The library cannot prevent arbitrary application code from mutating its own UI after ignoring cancellation. A rejected installer or notice handler closes the connection without acknowledging partial state.

```ts
const page = remotePort(serverUrl, {
  token: joinToken,
  async installSnapshot(notices, seq, signal) {
    const view = await prepareProjection(notices);
    signal.throwIfAborted();
    replaceProjection(view, seq);
  },
  onState(state) { showConnectionState(state); },
  onControl(frame) { updateSessionMenu(frame); },
});
page.on('np.view', updateProjectedView);
await page.ready;
await page.call('np.projected_read', { section: 'scene' }, operationId);
```

The App calls `reconnect()` when connectivity returns. There is no automatic immediate retry loop or invented backoff schedule. The client refreshes its live connection at PV85's 55 minutes. Once disconnected it retains operations and its last applied sequence, uses only the rotating resume credential, and closes after the fixed five-minute window; another failed attempt never extends that window. `ready` refers to the current synchronization promise. The public admission property exposes slot, sender and epoch, without its credential. Control callbacks exclude admission and synchronization frames.

Each pending call, input, or agent request keeps its generated requestId and immutable JSON arguments across replacement. An explicit requestId can also be supplied for a caller's later retry. A duplicate pending identity returns the same promise; changing its channel, method or arguments is refused. Port ids are separately correlated, and a reply with the wrong channel or numeric id closes the client. An epoch or slot change rejects uncertain operations and prevents automatic resubmission. Reconcile against committed state before beginning work under a new holder.

No per-operation timeout silently discards an uncertain request identity. A request settles on its matching result, a refusal, or terminal connection closure. If an application stops waiting, it must retain the operation id for retry. Agent partial text is advisory. The server remains the authority for deduplication, actor, paying account, terminal policy and guest method authorization.

Default sockets use WSS, with plain loopback allowed for local fixtures. A remote plain-WebSocket address requires an explicit native socket adapter; a webview does not bypass its policy. Userinfo, query strings and fragments are not accepted in the endpoint. The initial token and subsequent resume credentials stay in memory and first control frames, with no raw transport errors echoed to callers.

The client bounds unread replay notices at PV85's 1,000 and replay bytes at 4 MiB, with one additional frame's space for a snapshot awaiting installation. A valid snapshot at the frame bound can therefore be followed by its synchronization control. Malformed direction, oversized or binary data, invalid sequence boundaries and epoch changes cannot produce readiness. Duplicate notices are ignored, and a gap stops new calls until explicit reconnect and synchronization.

Five schema and 21 client tests cover the wire shapes, snapshot/ack/ready ordering, replay and replacement, stale generation callbacks, stalled-installer cancellation, operation identity, result correlation, credential rotation, loss-window expiry, refresh, explicit leave, failure cleanup, size and queue bounds, and reentrant observer/send failures. Server admission, replay, per-character projection and platform access checks remain separate integration gates. These tests do not establish multiplayer acceptance or security isolation.
