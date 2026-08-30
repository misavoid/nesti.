# nesti. self-hosted sync plan (iOS first)

## Status and scope

This is a post-MVP plan for adding an optional, self-hosted nesti. sync service backed by PostgreSQL, then connecting the iOS and Mac Catalyst app to it. It does not change the MVP's offline-first guarantee, make an account mandatory, or turn the static Astro bundle into an application backend. A user who never configures sync must retain the current local-only behavior.

The initial implementation is present: the PostgreSQL/API stack, browser IndexedDB outbox and pairing UI, native SwiftData outbox and Keychain transport, conflict handling, household profiles, and profile-attributed completions. Production release still requires the server-side migration/integration checks, backup restore drill, and two-client convergence exercise described below.

The first client delivery targets one home shared by the user's native devices. The Docker stack, sync API, native client, and web-client sync are separate workstreams using one documented protocol. For a connected home, PostgreSQL is the durable server authority while SwiftData and IndexedDB remain complete offline working copies.

## Goals

- Let a user connect the native app to a nesti. server URL and pair this device with one remote home.
- Add a durable database and sync API to the self-hosted nesti. Docker stack.
- Keep all reads and writes local; synchronize in the background when connectivity is available.
- Preserve stable room, task, and completion identifiers across devices.
- Upload local changes reliably after long offline periods without duplicating mutations.
- Detect concurrent destructive or incompatible edits instead of silently discarding data.
- Keep manual `.nesti` version 1 import and export available before, during, and after a sync connection.
- Store credentials in the Keychain and require transport security outside debug-only local development.

## Non-goals for the first release

- Embedding API or database responsibilities in the static Astro/nginx application container.
- Public account registration, subscriptions, analytics, telemetry, or hosted infrastructure.
- Real-time collaboration, presence, push notifications, or guaranteed background execution.
- Synchronizing app preferences, notification authorization, widget state, or game presentation state.
- Replacing `.nesti` files as the portable backup and interoperability format.

## Required decisions before implementation

The server workstream must publish a versioned protocol specification and reference fixtures before the native client moves beyond a mocked transport. At minimum it must settle:

- How an administrator creates a home and issues a short-lived pairing code or token.
- The sync API implementation language and migration tool after a short operational and dependency review. PostgreSQL and the container boundary are fixed by this plan; the API framework is not.
- Retention and backup policy for change history and deleted-record tombstones.
- Whether a later release needs roles or invitations. The first client should treat every paired device as a full home editor.

The recommended first authentication model is an opaque, revocable per-device bearer token obtained with a one-time pairing code. It avoids embedding a server administrator password in the app and leaves room for accounts later without requiring them now.

## Architecture

### Domain and protocol

Add protocol values and deterministic merge decisions to `ios/Sources/NestiCore`. They must depend only on Foundation and remain independently testable:

- `SyncProtocolVersion`, `SyncMutation`, `SyncChange`, `SyncConflict`, and cursor/snapshot envelopes.
- Entity payloads for home metadata, profiles, rooms, tasks, completion records, and tombstones.
- Strict decoding, size/count limits, and validation before any response reaches SwiftData.
- A reducer that turns the current entity, pending local mutation, and server response into an explicit apply, retry, or conflict result.

The sync wire format is separate from `.nesti` version 1. Sync needs completion history, tombstones, server revisions, and idempotency keys that do not belong in a portable plan file. Reuse `RoomRecord`, `TaskRecord`, recurrence values, identifiers, and date conventions where their meanings match; do not overload `exportedAt` as a revision.

### Docker stack and database

Extend the nesti. Compose stack from one static `app` container to these services:

- `app`: the existing unprivileged nginx container serving the static Astro bundle. It remains stateless and has no database credentials.
- `sync-api`: a separately built, non-root HTTP service implementing discovery, pairing, snapshots, incremental sync, conflict responses, and device revocation.
- `db`: a pinned, supported PostgreSQL major release with a named persistent volume, an internal-only port, a health check, and no Traefik labels or published host port.
- `migrate`: a one-shot container using the same build artifact as `sync-api`; Compose or deployment automation must complete migrations before starting a new API version.

Put `sync-api` and `db` on a private Compose network. Only `app` and `sync-api` join the external Traefik network. Route a versioned path such as `/api/sync/v1` to `sync-api` with higher priority than the static-app route, so browsers and native clients can use the same HTTPS origin without CORS. Direct database access from a browser or native app is forbidden.

PostgreSQL is a good fit because sync acknowledgement, mutation application, revision allocation, change-log insertion, and cursor advancement must commit atomically. Use normalized tables for `homes`, `devices`, `profiles`, `rooms`, `tasks`, and `completion_records`, plus `applied_mutations`, `change_log`, and retained tombstones. Store recurrence and extensible metadata as validated versioned `jsonb`; keep identifiers, ownership, revisions, timestamps, and relationships in typed columns with foreign keys and uniqueness constraints.

Every row is scoped to a home UUID. Use a server-generated monotonic sequence for the change cursor and unique constraints for mutation idempotency. The API must apply a sync request in one database transaction and return only committed revisions. Database constraints enforce structural invariants, while the API and shared compatibility fixtures enforce nesti. domain validation.

Keep database credentials out of images, Compose files, browser assets, and git. Supply them through Docker secrets or deployment-managed environment files. Use a least-privilege runtime database role; reserve schema-owner privileges for `migrate`. Encrypt transport at Traefik, reject untrusted forwarded headers, redact authorization values, and set request/time limits at both proxy and API layers.

A Docker volume is persistence, not a backup. Provide scheduled encrypted `pg_dump` backups to storage outside the Compose volume, define retention, and test restoration into a clean stack before release. Pin the PostgreSQL major version, document minor/major upgrades, and never let `docker compose down` remove the database volume by default.

### Browser storage and product copy

IndexedDB remains the web client's local transactional store and offline outbox; PostgreSQL becomes authoritative only after that browser is paired to a server home. The static app shell must still load offline, and local changes must remain usable while the API or database is unavailable.

Keep the current browser-only privacy copy until web sync is implemented. When web pairing ships, replace it with state-aware wording:

- Disconnected: data is stored only in this browser unless exported or connected to a server.
- Connected: an offline copy is stored in this browser and synchronized with the named nesti. server.
- Sync failure: local editing still works and pending changes remain on this device until synchronization succeeds.

Do not claim that server sync protects against data loss until automated database backups and a restore drill pass the release gate.

### Local data

Introduce a versioned SwiftData schema and migration plan rather than relying on the inferred default schema.

- Add a singleton `HomeState` containing the stable home UUID and home name. Migrate the current `homeName` value from `AppStorage` once and keep `NestiDocument.id` stable on whole-home exports.
- Add `updatedAt` to mutable home, room, and task records. Preserve `CompletionRecord.id`; completion records should be append-only except for an explicit undo/delete.
- Add `SyncConnection` metadata containing the server origin, remote home ID, device ID, last applied cursor, last successful sync date, and protocol version. Do not put the bearer token in SwiftData.
- Add a durable `PendingSyncMutation` outbox with a mutation UUID, entity kind and UUID, operation, payload, base server revision, and creation date.
- Add per-entity server revision metadata and enough tombstone state to reject stale resurrection. Compact acknowledged outbox entries and tombstones only under the server's documented retention rules.

All user mutations must go through a repository that changes domain records and appends the matching outbox mutation in the same `ModelContext` save. Replace swallowed `try? context.save()` failures on these paths with surfaced errors. Views remain unaware of protocol payloads and outbox mechanics.

### Services

Keep side effects under `ios/nesti/Services`:

- `SyncTransport` defines discovery, pairing, snapshot, and sync operations. A `URLSession` implementation is injected behind the protocol for tests.
- `SyncCredentialsStore` reads and writes the per-device token in the Keychain, scoped by canonical server origin and remote home ID.
- `SyncCoordinator` serializes sync runs, observes reachability only as a hint, batches the outbox, validates responses, and applies accepted mutations plus remote changes in one local transaction.
- `SyncScheduler` triggers a debounced attempt after local changes, at launch/foreground, and from a manual action. Add `BGAppRefreshTask` only after foreground sync is reliable; correctness must never depend on it running.

The coordinator should expose a small observable status model: disconnected, connecting, idle, syncing, offline with pending changes, attention required, or failed with a retryable/non-retryable reason.

## Minimum server contract

Use HTTPS JSON endpoints under a versioned API prefix. Exact paths may change with the server specification, but the client needs these semantics:

1. **Discovery:** return server identity, supported sync protocol versions, authentication methods, request limits, and capabilities. Discovery must not require a credential.
2. **Pairing:** exchange a short-lived pairing code for a revocable device token plus remote home and device identifiers. Never return or persist an administrator credential.
3. **Snapshot:** return a fully validated home snapshot and its cursor for first connection or explicit recovery.
4. **Sync:** accept the client's last cursor and an ordered batch of idempotent mutations, then atomically return acknowledgements, conflicts, remote changes, and a new cursor.
5. **Device removal:** revoke the current device token without deleting local plan data.

Each mutation carries a globally unique idempotency key and the entity's base server revision. The server stores an acknowledgement so retrying after a lost response cannot duplicate a completion or reapply an edit. Responses use monotonically advancing opaque cursors; clients must not derive ordering from device clocks.

Enforce bounded request and response sizes, supported protocol versions, canonical UUIDs, valid recurrence rules, and ISO-8601 timestamps. A response is decoded and validated in memory before one atomic local apply. A malformed or partial response leaves local records, cursor, and outbox unchanged.

The API writes accepted mutations, idempotency acknowledgements, entity revisions, tombstones, and change-log entries in one PostgreSQL transaction. A database failure returns no successful acknowledgement. Health endpoints distinguish process liveness from database-backed readiness so Traefik never routes sync traffic to an API that cannot commit data.

## Synchronization behavior

### First connection

The connection flow is `Server URL` -> discovery -> pairing code -> home preview -> confirmation.

- With an empty local home, download and atomically install the remote snapshot.
- With local data and a new empty remote home, upload the local snapshot while retaining all identifiers.
- With data on both sides, do not silently merge or clear either side. Create a local `.nesti` backup, show counts and names from both homes, and require an explicit choice to cancel, replace local data from the server, replace server data from the local home when the authenticated device is allowed to do so, or enter a reviewed merge flow delivered in a later phase.
- Persist the connection and Keychain credential only after bootstrap completes. A failed bootstrap leaves the existing local home untouched and unconnected.

Replacing local data is an exceptional sync bootstrap action, not an import. Normal `.nesti` imports continue to validate and append. Imported rooms and tasks become local mutations and sync after the user confirms the existing import preview.

### Incremental sync

For each run:

1. Read the connection, cursor, and a bounded ordered outbox batch.
2. Send the cursor and mutations with the device credential.
3. Validate the entire response and verify acknowledgements refer to sent mutation IDs.
4. In one local transaction, apply acknowledgements, remote changes, tombstones, entity revisions, and the new cursor.
5. Rebase or flag remaining local mutations whose base revisions changed.
6. Rebuild affected notifications and publish a widget snapshot after the transaction commits.
7. Continue with another bounded batch while work remains and the app has execution time.

Only one sync run may mutate a home at once. Cancellation or process termination before commit must leave the previous cursor and outbox intact so the operation can be retried.

### Conflicts

Independent entity changes can merge automatically. Completion creation is an idempotent append by UUID. Concurrent edits to the same room/task and delete-versus-edit cases require explicit server conflict results based on `baseRevision`, not timestamps.

The first release should pause only the conflicting entity while continuing unrelated changes. Present the local and server values with actions to keep local, accept server, or duplicate the local task/room with a new UUID where that avoids data loss. Record the selected resolution as a new mutation against the latest server revision. Never resolve a conflict by changing identifiers invisibly.

Ordering conflicts should normalize `sortOrder` deterministically after applying all changes. Document the normalization in `NestiCore` and cover it with two-device fixtures.

## User experience

Add a `Sync` section to Settings:

- Disconnected state with `Connect to Server`.
- Connected server name/origin, remote home name, last successful sync, pending-change count, and current status.
- `Sync Now`, `Resolve Conflicts`, and `Disconnect This Device` actions with accessible labels.
- Clear offline and authentication-expired states. Retryable failures must not block local editing.
- Disconnect keeps local data by default, removes the Keychain token, and asks whether to notify the server to revoke the device when reachable.

Validate and canonicalize the server URL. Release builds accept HTTPS only. Debug builds may opt into HTTP for loopback/local-network development, with the exception isolated in configuration rather than a broad App Transport Security exemption. Pairing tokens must use secure text entry and must not appear in logs or persisted error messages.

## Delivery phases

### 1. Protocol and persistence foundation

- Write the server protocol document, JSON schemas/fixtures, error taxonomy, and compatibility policy.
- Add pure `NestiCore` DTO, validation, and reducer tests for bootstrap, retries, conflicts, tombstones, cursor advancement, and unsupported versions.
- Introduce explicit SwiftData schema versions, `HomeState`, connection metadata, revision state, and the outbox with migration tests.
- Refactor mutations behind a repository and prove record-plus-outbox atomicity.

Exit: local behavior is unchanged with sync disabled, migrations retain existing plans, and every local mutation creates exactly one durable operation when connected.

### 2. Server and database foundation

- Add `sync-api`, `db`, and one-shot `migrate` services to the Compose stack while retaining the static `app` service.
- Define reviewed PostgreSQL migrations, constraints, indexes, roles, health checks, named-volume behavior, and local development seed/pairing commands.
- Implement discovery, pairing, snapshot, sync, revocation, transactionally allocated cursors, idempotency retention, and tombstone retention.
- Add database integration and migration tests, including rollback, duplicate mutation, concurrent writers, cursor pagination, and restore from backup.
- Document deployment, secret rotation, backup scheduling, restore, PostgreSQL upgrades, and safe container replacement.

Exit: a clean Compose deployment can migrate, pair two test devices, converge them through the API, survive container recreation, and restore its data from an off-volume backup.

### 3. Connection and mocked transport

- Implement discovery, pairing, Keychain storage, connection state, and Settings UI against an injected mock transport.
- Cover invalid URLs, incompatible servers, expired codes, cancellation, restart during bootstrap, and disconnect behavior.
- Add atomic snapshot installation and a pre-replacement `.nesti` backup flow.

Exit: UI tests exercise the complete lifecycle without a live server, and failures never damage the local plan.

### 4. Native incremental synchronization

- Implement the `URLSession` transport, bounded batching, idempotent retries, remote apply, notification rebuilds, and widget refreshes.
- Add conflict persistence and resolution UI.
- Trigger foreground, launch, debounced post-mutation, and manual synchronization. Defer background refresh until these paths pass soak tests.

Exit: two native clients can edit offline, reconnect in either order, converge, and resolve same-entity conflicts without losing unrelated changes.

### 5. Web client synchronization

- Port the outbox, cursor, tombstone, and conflict behavior to the web data and service layers using the shared protocol fixtures.
- Keep IndexedDB as the offline replica and perform every remote apply plus cursor update in one IndexedDB transaction.
- Add pairing, sync status, disconnect, and conflict resolution to web Settings without making initial page load depend on the API.
- Replace browser-only storage copy with the state-aware wording only when this phase is released.

Exit: a browser and native client converge through the same PostgreSQL-backed API, and the web app continues CRUD and reload behavior while the API is blocked.

### 6. Hardening and optional background refresh

- Add exponential backoff with jitter, cancellation, authentication recovery, cursor-expiry recovery, structured privacy-safe logs, and metrics visible only on-device.
- Add `BGAppRefreshTask` as best effort and document system limitations.
- Exercise schema and protocol upgrades, server restore/cursor invalidation, large homes, long offline queues, revoked devices, and low-storage failures.

Exit: sync remains correct across termination and retry, local-only mode passes its existing regression suite, and a user can recover through export even when the server is unavailable.

## Verification and release gates

- Run `swift test --package-path ios` for protocol, merge, codec, and migration-independent domain coverage.
- Run iOS unit/UI tests with in-memory SwiftData and a custom `URLProtocol`; include forced timeouts and duplicate responses.
- Run Mac Catalyst and iOS builds because Keychain, background scheduling, and Settings presentation differ by platform.
- Run a two-client contract suite against the reference server for pairing, bootstrap, idempotency, cursor ordering, conflicts, tombstones, revocation, and protocol-version rejection.
- Run PostgreSQL migration tests from every supported schema version, concurrent transaction tests, backup/restore drills, and container-recreation tests with the named volume.
- Verify the database has no published host port, the static app has no database secret, and only the API runtime role can modify application tables.
- Run browser/native convergence and web offline-reload tests before changing the website's storage wording.
- Verify airplane-mode CRUD, app relaunch with a pending outbox, termination during response apply, manual `.nesti` import/export while connected, notification rebuilding, and widget freshness.
- Perform a security review for token storage, TLS validation, URL canonicalization, redirect handling, log redaction, response limits, and hostile JSON.
- Confirm with a network blocker that a never-connected installation has no runtime network dependency and retains all current behavior.

## Primary risks

- **Unspecified server semantics:** client code written before a contract will encode accidental assumptions. Freeze fixtures and protocol behavior first.
- **Database loss or migration failure:** a named volume does not cover operator error or host loss. Require off-volume backups, tested restores, transactional migrations, and documented rollback before production sync.
- **Exposed database credentials:** keep PostgreSQL off the proxy and host networks, isolate it on a private network, and give only the API a least-privilege runtime secret.
- **SwiftData atomicity and migration:** record changes, outbox writes, and cursor advancement must commit together. Prove failure behavior with integration tests before enabling sync by default.
- **Clock skew:** device timestamps are useful metadata but unsafe for ordering. Use server revisions and opaque cursors for concurrency decisions.
- **Delete resurrection:** offline edits can revive deleted entities unless tombstones and base revisions are retained long enough.
- **Initial-link data loss:** a remote and local home may both contain valuable data. Keep bootstrap non-destructive by default and require backup plus confirmation for replacement.
- **Background execution limits:** iOS may defer or skip refresh tasks. Foreground sync and a visible pending state are the correctness baseline.
- **Protocol drift:** native, server, and eventual web clients will release independently. Negotiate protocol versions and keep shared fixtures in CI.
