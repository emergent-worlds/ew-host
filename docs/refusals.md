# Structured host refusals

Failed privileged host-contract replies retain their existing `error` text and may also include `code` and `detail`. A code is a nonempty string; detail is a JSON object. Older text-only replies and successful replies remain valid. This is the permanent files record's structured-refusal clarification, committed in `b3fd2ad46e` before implementation.

`HostRefusal(code, message, detail?)` extends Error and is exported from the package root and loader. `HostRefusalError` is an alias of the same class. The loader reconstructs this typed error when a reply has code or detail. A legacy text-only reply still rejects with Error and its original message. The host bridge also preserves a folder handler's explicit fields when receiving a refused host request.

The sender extracts only message, code and detail from an exception. It recognizes explicit structural fields, so a host-specific ModelRefusal class does not need to inherit from HostRefusal. Arbitrary exception fields are not serialized. Detail is validated without recursive call-stack traversal and copied as JSON; invalid, cyclic, nonfinite or non-JSON detail is omitted without losing a valid code or text. The generic codec never derives policy from an error message. Cancellation remains a plain cancelled refusal rather than retaining an interrupted budget code.

For E5, model-route hosts may attach the compute-out object plus an explicit `needed` value for the requested job. They derive it from that job's authoritative StoppedJob `{ job, kind, needed }`; this package does not perform the lookup. False, true, missing and a nonboolean value remain distinct. Only an explicit policy value may authorize dropping optional pending work; missing data must be treated as unknown by the engine and runner. Model policy, pause behavior and optional-job removal belong to those consumers.

These fields belong to the privileged core/page host contract. They do not alter the remote player's folder RPC schemas, authorize guest methods, or expose private account state on a player channel.

Nine integration and schema tests cover JSON wire round trips, needed and missing data, legacy errors, structural model-route errors, reverse folder-handler errors, save refusal, malformed/cyclic detail, cancellation, and exclusion of arbitrary exception properties. Seven of these tests fail against the isolated pre-change source because its bridge and loader discard the new fields; the text-only and cancellation tests already pass there.
