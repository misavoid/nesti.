# nesti. sync protocol version 1

## Purpose

The sync protocol replicates a home between a self-hosted nesti. server and offline clients. It is not the `.nesti` file format. Sync carries completion history, revisions, tombstones, cursors, and idempotency data; `.nesti` version 1 remains the portable import/export boundary.

All endpoints use HTTPS JSON under `/api/sync/v1`. UUIDs are canonical lowercase strings. Cursors and revisions are non-negative decimal strings because database `bigint` values are not safe JavaScript numbers. Clients ignore unknown response keys but reject unknown protocol versions, entity types, operations, and recurrence variants.

## Discovery

`GET /api/sync/v1/discovery` is unauthenticated and returns the server name, protocol versions, authentication methods, and request limits.

## Pairing

An administrator creates a home and short-lived, one-use pairing code with the server CLI. A client exchanges it at `POST /api/sync/v1/pair`:

```json
{
  "code": "ABCD2345EF",
  "deviceName": "Alice's iPhone"
}
```

The response contains a random bearer token exactly once, the home/device identifiers, and the initial snapshot. Clients store the token in a platform credential store, never in normal application persistence or logs.

## Snapshot

`GET /api/sync/v1/snapshot` requires `Authorization: Bearer <device-token>`. It returns the current non-deleted home, rooms, tasks, and completion records plus their revisions and a cursor. Clients validate the entire response before atomically installing it.

## Incremental sync

`POST /api/sync/v1/sync` requires the device token. A request includes the last committed cursor and at most 500 ordered mutations:

```json
{
  "protocolVersion": 1,
  "cursor": "42",
  "mutations": [
    {
      "id": "87ad8dc0-00a0-4d9e-9a6f-bb19d5f88d15",
      "entityType": "room",
      "entityId": "13a82f7a-2029-4e13-8a5d-40ea958dba88",
      "operation": "upsert",
      "baseRevision": "40",
      "payload": {
        "name": "Bathroom",
        "notes": "",
        "icon": "shower",
        "sortOrder": 0
      }
    }
  ]
}
```

An upsert payload is the complete current entity, not a JSON patch. New entities use base revision `0`. Updates and deletes use the last server revision observed by the client. Mutation UUIDs are idempotency keys and must never be reused for a different operation.

The response contains acknowledgements, explicit conflicts, ordered changes after the supplied cursor, a new cursor, and `hasMore`. The cursor is the last returned change, so a client repeats sync with an empty mutation list while `hasMore` is true. Applying acknowledgements, changes, tombstones, and the new cursor is one local transaction.

Conflicts do not alter the entity. Resolution is submitted as a new mutation UUID against the returned server revision. Deleting a room/task with active children is rejected until the client deletes its children first; this makes every tombstone visible to other clients. New rooms and tasks are rejected with `limit_exceeded` when a home reaches the `.nesti` compatibility limits of 250 rooms or 10,000 tasks.

## Entity payloads

- `home`: `name`.
- `room`: `name`, `notes`, `icon`, and `sortOrder`.
- `task`: `roomId`, task fields matching `.nesti` semantics, `reminder`, and `createdAt`.
- `completion`: `taskId`, `completedAt`, and optional `scheduledFor`.

Dates use ISO-8601 timestamps. `nextDueDate` and `scheduledFor` additionally accept local `YYYY-MM-DD` calendar dates so recurrence does not shift across time zones. Recurrence objects follow `.nesti` version 1.

## Revocation and errors

`DELETE /api/sync/v1/devices/current` revokes the current token without deleting home data. Error bodies use:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "A safe user-facing explanation."
  }
}
```

Clients may retry `429` and `5xx` responses with backoff. They must not retry authentication or validation failures without user action or corrected data.
