# Architecture

## Product decisions

- One local home is displayed at a time. A document name describes the exported setup rather than introducing a separate persisted household entity.
- Imports append rooms and tasks. Duplicate names are allowed because silently merging schedules is destructive and ambiguous.
- Completing a task records a completion entry and recalculates its next due date. Day and month intervals can anchor to completion, while fixed weekday and calendar-day rules advance from the scheduled occurrence.
- Notifications are rebuilt after task, room, or reminder-setting changes. Only the next pending reminder per enabled task is scheduled to stay within iOS limits.
- Tasks without a schedule are supported as one-off tasks and remain due until completed.
- The Mac app is built with Mac Catalyst from the same target. It uses the dedicated `app.nesti.mac` bundle identifier while sharing source, schema, and file-format behavior with iOS.

## Layers

### NestiCore

A pure Swift module with no UI or persistence dependency. `RecurrenceCalculator` is the canonical date engine. `NestiDocument` is the transport schema and `NestiDocumentValidator` performs semantic validation after JSON decoding.

### Data

SwiftData models own rooms, tasks, and completion history. Recurrence is encoded into a `Data` property using the same `RecurrenceRule` used in import files. `PlanStore` handles model mutations and mapping so views do not know the transport format.

### Services

`NotificationScheduler` owns authorization and pending notification replacement. `ImportCoordinator` reads a security-scoped URL, caps input size, decodes JSON, and produces a preview without changing the store.

### Optional sync server

`server` contains the separately deployed sync API and PostgreSQL migrations. The static web container never receives database credentials. PostgreSQL is authoritative for a paired home, while SwiftData and IndexedDB remain complete offline replicas. `docs/SYNC_PROTOCOL.md` defines the client/server boundary; it is intentionally separate from `.nesti` import/export.

### Features

The root uses three native tabs: Tasks, Rooms, and Settings. Sheets own creation/editing. The import preview is a distinct confirmation boundary between validation and persistence.

## Future extension points

- iCloud: replace the local-only model container configuration with CloudKit-compatible SwiftData configuration after auditing unique constraints and migrations.
- Widgets: expose due-task snapshots from `PlanStore` through an App Group.
- Shared homes: add a stable household identifier already represented by `NestiDocument.id`.
- Self-hosted sync: follow `docs/IOS_SERVER_SYNC_PLAN.md`; keep it optional, preserve local-first writes, and use a protocol distinct from `.nesti` file import/export.
- Statistics: completion history is normalized rather than stored only as a last-completed field.
- File versions: dispatch decoding by top-level `version`, migrating older documents into the current in-memory schema.
