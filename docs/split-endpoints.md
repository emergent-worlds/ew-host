# Split host endpoints

Wave 3 E7 and the permanent files record define two connections per frame. Obtain both in one parent handoff with `framePorts()`. Hand `core` to the worker; call `connectPage(portTransport(page))` in the page. The authoritative worker calls `connectCore`.

The host constructs independent bridges with the fifth constructor argument set to `core` or `page`. Each bridge uses its own pending-request map, so matching numeric IDs on different ports cannot resolve each other's calls. The host stamps its family into the grant, and each new loader rejects a mismatched grant. Family checks run before handlers; manifest ask checks still run afterward.

| Direction | Core | Page |
|---|---|---|
| Folder to host | ready, progress, status, save, model.call, cancel, event, agent.ask, agent.decide, meter, file.read, error, reply | ready, file.pick, file.export, prefs.set, app.open, reply |
| Host to folder | grant, pause, resume, display, save.request, advance, input, state.*, change.*, model.part, quit, reply | grant, corner, display, layout.set, layout.reset, reply |

Existing `connect` and the default `combined` bridge support unchanged local 0.3 consumers while migration is prepared. They are deprecated transitional paths, not valid remote guest endpoints. New App, server, runner and SDK code must explicitly opt into the split. J2 to J4 consumer verification gates removal of combined. No dependency is repinned by this foundation commit.

`quit` is a correlated core request. A core registers `handle('quit', handler)` and returns only after its final save and shutdown preparation succeed; a failure rejects the host request. Receipt of the request alone does not establish completion, and completion of this handler does not prove an operating-system process has exited. The launcher observes process exit separately.

Each connected loader exposes `close()`. It unregisters its message and close listeners, rejects pending requests, clears local handlers, and closes its transport. A missing or mismatched grant uses the same cleanup. Transports that can observe a peer disconnect implement the additive `onClose(listener: (error: Error) => void)` hook; the loader and bridge use it to reject pending work immediately. The bridge also rejects a requested save whose asynchronous commit is still pending when disposal occurs. Adapters without the hook retain local disposal and the host's request timeout, but cannot report a remote disconnect immediately.

Failed replies can also retain explicit code and JSON-object detail through HostRefusal. This additive structure is shared by the privileged endpoint families; it adds no remote guest permission. See [structured refusals](refusals.md) for legacy errors, validation, and model-policy boundaries.

The remote folder RPC connection is separate from either privileged core-host transport. This slice does not implement remote admission, resume, WebSocket transport, signed builds, or migrate consumers. It does not claim multiplayer or native journey acceptance.

NP8 page grants may carry `away: { pace, computeShare }`, with compute share a percentage from 0 through 100 or null when authoritative usage is unavailable. The page opens the App settings with `app.open` value `away`; this protocol support does not itself implement the App screen.
