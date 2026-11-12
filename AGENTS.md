# AGENTS.md

Guidance for any coding agent working in `ew-host`. Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) first.

## Orientation

Before actionable company work, read the current published [company entry](https://github.com/emergent-worlds/command-center/blob/main/AGENTS.md),
[system map](https://github.com/emergent-worlds/command-center/blob/main/SYSTEM.md) and [operating manual](https://github.com/emergent-worlds/command-center/blob/main/docs/ticket-and-cycle-conventions.md).
The manual governs automatic ticket/folder registration, maintenance, completion
and authorized parent-goal continuation for all agents, including research,
audits, planning, reviews and delegated tasks. Use its actual ticket and owner
record for the current request, and preserve existing working branches and paths.

For work already registered to Build V2, follow its current owner record and
accepted plan through the manual's preserved-cycle registry. Escalation follows
[the company access and escalation rule](https://github.com/emergent-worlds/command-center/blob/main/docs/escalation-and-access.md).

## The record leads the code

The design record (the vision, the coverage index, the company matrix with its Section 12 policy values, the files page, the engines matrix, the mechanism register, the journeys, the family matrices, and the canvases) is the authority. A change to the design goes into the record first, then into code. Where a screen's matrix row and its canvas board differ, the matrix holds for what the screen does and the canvas for how it looks, with a log line in the matrix when the screen is built; a difference is escalated only when it changes what a screen does. A value (a window, a limit, a rate, a price, a contact) comes from Section 12, never from code alone. Nothing is built that the record does not describe, and nothing is built unused (the tracing rule). The earlier build's repositories (`app`, `platform`, `ui`, `design-system`, `engine`, `pack-narrative-protagonist`, `studio`, `sandbox`) are reference only and shape nothing here.

## Secrets

Secrets live in Google Secret Manager in `emergent-worlds-dev` only, named `ew2-...`. Never write a credential's value to a file, a log, a message, or a page; refer to it by name.

## Writing

Documents and comments are clear and academic: no em dashes and no en dashes, no rhetorical contrasts, no closing aphorisms, and never the word "world" for what the product calls a Reality. Example names are only Salt Harbor, Kestrel Yards, Orrery Nights, Mercer Press, @crowsfeather, @ironwrit, @ashen_quill, @salt_and_ash, @mercerpress.

## Decisions log

Technology and architecture decisions for this repository are appended to [`docs/decisions.md`](./docs/decisions.md), newest at the top, each with **Decision**, **Alternatives**, and **Rationale**.
