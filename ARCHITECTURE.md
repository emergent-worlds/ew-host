# ew-host

The seams every part shares: the host contract, the manifest and contract schemas, the resolver, the compatibility marks, and the folder client.

This repository is part of build V2 of Emergent Worlds, written new from the design record (the operator's direction of 2026-10-12). It is public, under the Apache License 2.0. The plan that placed it is the cycle's [plan.md](https://github.com/emergent-worlds/command-center/blob/main/operations/founder-product-development/cycles/2026-10-13-build-v2/plan.md), approved on 2026-10-14.

## What it holds

The host contract's message vocabulary (the asks of the files page Section 5) and its transports, the folder-side loader with its journeys hooks, the manifest (`manifest.json`), interface (`interface.json`), and contract (`contract.json`) schemas, the resolver of `uses`, the works / may work / won't work marks, and the folder client that checks out and saves.

## The record it answers to

The files page Sections 3 to 6; the engines matrix Sections 2 and 4; MR2.1, MR3.1, MR5.1, MR5.3. The record is the operator's published pages and canvases, indexed in [the coverage index](https://claude.ai/artifact/VyiizrkJLiAS53ky4TTryN); a copy in a repository is not the record, and where this repository and the record differ, the record holds.

## What it depends on

Nothing; every other part depends on it.

## Layout

`src/` (protocol, loader, port, schemas, resolver, marks, folder client), `schemas/`.

## Technology

TypeScript, Zod, JSON Schema. The reasons are in [`docs/decisions.md`](./docs/decisions.md).

## Status

Wave 0, 2026-10-14: the manifest, interface, and contract schemas (`src/manifest.ts`, `src/interface.ts`, emitted as JSON Schema in `schemas/`), the works / may work / won't work marks (`src/marks.ts`), the version 1 message vocabulary with what each ask permits (`src/protocol.ts`), the host's bridge (`src/bridge.ts`), and the folder's loader (`src/loader.ts`), with tests.

Wave 2, 2026-10-15 (0.2.0): the contract as the wave 2 design settles it (`command-center/.../cycles/2026-10-13-build-v2/wave-2-design.md`). The grant carries the version started from, the folder's tree, the resolved uses as laid out under `/uses/<ref>/`, and the person's preferences for the folder; a save is one act (`save.request` tells the folder why, the folder's `save` carries the reason and the complete tree, the reply is the version); `pause` and `resume` are requests with a reply; `model.call` takes a text or an image request, streams paragraphs as `model.part`, and can be cancelled; the agent's channel has structured queries, `change.forecast`, proposals with a preview in four groups and a forecast or its absence, `change.apply` by the person or by the approved plan, and `layout.set` and `layout.reset`; the folder can read its own files, ask the person for a file, report progress, keep preferences, and answer a decision card; the interface file names the engine's module, parts, state parts, and save format; the contract file names a folder's module, what it recommends, and what it keeps; the slots gain the scene picture and the artifact item; the ask parts gain the agent to read; a Reality takes its entry from the pack it uses; `src/port.ts` is the envelope a folder's page calls its core by. Still to come, in the waves that use them: the folder client that checks out and saves against the platform's folder store, the WebSocket and loopback transports, and the journeys hooks in the loader.
