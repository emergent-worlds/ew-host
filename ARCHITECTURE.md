# ew-host

The seams every part shares: the host contract, the manifest and contract schemas, the resolver, the compatibility marks, and the folder client.

This repository is part of build V2 of Emergent Worlds, written new from the design record (the operator's direction of 2026-10-12). It is public, under the Apache License 2.0. The plan that placed it is the cycle's [plan.md](https://github.com/emergent-worlds/command-center/blob/main/operations/founder-product-development/cycles/2026-10-13-build-v2/plan.md), approved on 2026-10-14.

## What it holds

The host contract's message vocabulary (the asks of the files page Section 5) and its transports, the folder-side loader with its journeys hooks, the manifest (`manifest.json`), interface (`interface.json`), and contract (`contract.json`) schemas, the resolver of `uses`, the works / may work / won't work marks, and the folder client that checks out and saves.

## The record it answers to

The files page Sections 3 to 6; the engines matrix Sections 2 and 4; MR2.1, MR3.1, MR5.1, MR5.3. The authoritative repository record is indexed in the [product coverage index](../command-center/docs/product/coverage.md). Since the operator's decision of 2026-10-15, the published pages and canvases are its view. Changes are made in those permanent product files first, on review branches; where this repository and the record differ, the record holds.

## What it depends on

Nothing; every other part depends on it.

## Layout

`src/` (protocol, loader, port, schemas, resolver, marks, folder client), `schemas/`.

## Technology

TypeScript, Zod, JSON Schema. The reasons are in [`docs/decisions.md`](./docs/decisions.md).

## Status

Wave 0, 2026-10-14: the manifest, interface, and contract schemas (`src/manifest.ts`, `src/interface.ts`, emitted as JSON Schema in `schemas/`), the works / may work / won't work marks (`src/marks.ts`), the version 1 message vocabulary with what each ask permits (`src/protocol.ts`), the host's bridge (`src/bridge.ts`), and the folder's loader (`src/loader.ts`), with tests.

Wave 2, 2026-10-15 (0.2.0): the contract as the wave 2 design settles it (`command-center/.../cycles/2026-10-13-build-v2/wave-2-design.md`). The grant carries the version started from, the folder's tree, the resolved uses as laid out under `/uses/<ref>/`, and the person's preferences for the folder; a save is one act (`save.request` tells the folder why, the folder's `save` carries the reason and the complete tree, the reply is the version); `pause` and `resume` are requests with a reply; `model.call` takes a text or an image request, streams paragraphs as `model.part`, and can be cancelled; the agent's channel has structured queries, `change.forecast`, proposals with a preview in four groups and a forecast or its absence, `change.apply` by the person or by the approved plan, and `layout.set` and `layout.reset`; the folder can read its own files, ask the person for a file, report progress, keep preferences, and answer a decision card; the interface file names the engine's module, parts, state parts, and save format; the contract file names a folder's module, what it recommends, and what it keeps; the slots gain the scene picture and the artifact item; the ask parts gain the agent to read; a Reality takes its entry from the pack it uses; `src/port.ts` is the envelope a folder's page calls its core by. Still to come, in the waves that use them: the folder client that checks out and saves against the platform's folder store, the WebSocket and loopback transports, and the journeys hooks in the loader.

0.3.3, 2026-10-15: `startCore(url)` starts the core from a classic `blob:` bootstrap that imports it dynamically and holds the page's messages, with their ports, until the core listens (`src/start-core.ts`; the App's request 9), since Chromium refuses a module worker from a `blob:` URL in a sandboxed frame. `scripts/worker-check.mjs` (`pnpm check:worker`) checks it in Chromium, WebKit, and Gecko with Playwright.

Continuation, 2026-10-15: requestSave registers its observer before dispatch, so transports that deliver synchronously return the committed version correctly. Refused or failed sends remove their waiter immediately. All 37 tests, typecheck, and schema build pass on Node 24.22.0; the synchronous-save regression failed before the correction. No public contract shape changed.

Wave 3 foundation, 2026-10-15: the files record's E7 amendment is implemented as explicit `core` and `page` endpoint families on `HostBridge`. The page can pick/export files, keep preferences, and open App surfaces; it cannot save, make model calls, or invoke the agent. The core keeps those authoritative operations and cannot open per-person dialogs. Replies are correlated within each bridge. Both receive display; corner/layout go only to the page, and quit only to the core. `connectCore` and `connectPage` return distinct runtime surfaces; `framePorts` receives both ports in one parent handoff. Existing `connect` and the default `combined` bridge remain deprecated local compatibility paths for unchanged 0.3 consumers. New runner, server, App and SDK consumers must select a family explicitly; combined must never be remotely reachable. The grant identifies the family and may carry mode and player count. This is the first 0.4 foundation slice, not a release or completed Wave 3; existing dependencies remain pinned.

Wave 3 worker transport, 2026-10-15: `workerTransport` adapts Node's worker_threads Worker and Bun's EventTarget Worker to `Transport`, including termination and the optional close lifecycle. It imports no runtime-specific module into the browser package. Early startup messages are retained until a bridge subscribes, with a 1,000-message internal startup guard. Nine tests cover both API shapes and four actual local workers across Node 24.22.0 and Bun 1.4.3. CI installs Bun so the native Bun worker test runs there. This establishes the local transport seam for the server; compiled executable loading, engine WebAssembly, operating-system conformance, and security isolation remain separate gates. Details and runtime references are in `docs/workers.md`.

NP8 continuation: optional away pace/compute-share metadata and the page-local `away` App surface are validated by the protocol. Missing usage is null, never an invented zero. All 69 host tests, typecheck and schema build pass. App screen and platform usage integration remain separate consumer work.
