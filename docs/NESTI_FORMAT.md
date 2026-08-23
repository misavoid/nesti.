# `.nesti` format version 1

A `.nesti` file is UTF-8 JSON with the Uniform Type Identifier `app.nesti.plan` and MIME type `application/vnd.nesti+json`. Version 1 represents a complete home or one exported room.

## Top-level object

```json
{
  "version": 1,
  "id": "421C47D7-91A1-4EA9-A70B-7DBE85ED149E",
  "name": "My Home",
  "exportedAt": "2026-08-23T12:00:00Z",
  "metadata": {
    "generator": "nesti. 1.0",
    "notes": "Optional document notes"
  },
  "rooms": []
}
```

Unknown JSON keys must be ignored. Identifiers and `exportedAt` may be omitted by hand-authored or LLM-generated input; nesti. generates them during decoding and includes them on export. Importers reject unsupported top-level versions, malformed provided identifiers, empty required names, invalid schedules, and documents with no rooms. Input is limited to 5 MB, 250 rooms, and 10,000 tasks.

## Room

Each room has `id`, `name`, `sortOrder`, optional `icon`, optional `notes`, and `tasks`. `icon` is an SF Symbols name and may be ignored by non-Apple importers.

## Task

Each task contains:

- `id`: UUID string
- `name`: non-empty string
- `notes`: optional string
- `estimatedMinutes`: optional integer from 1 through 1,440
- `sortOrder`: integer
- `schedule`: optional recurrence object
- `lastCompletedAt`: optional ISO-8601 timestamp
- `nextDueDate`: optional ISO-8601 timestamp or local `YYYY-MM-DD` date for the task's first due date
- `reminder`: optional object with `enabled`, `hour` (0-23), and `minute` (0-59)
- `metadata`: optional free-form string map for forward-compatible producer data

When `nextDueDate` is omitted, nesti. derives the initial due date from the recurrence rule. Set it on each task to distribute a newly imported plan over time:

```json
{
  "name": "Clean shower",
  "nextDueDate": "2026-08-26",
  "schedule": { "type": "interval", "days": 7 }
}
```

Writers should emit `nextDueDate`. For backward compatibility, readers also accept `nextDueAt`, `dueDate`, and `startDate` as aliases. Exports always normalize these aliases back to `nextDueDate`.

## Recurrence

Recurrence objects use a discriminator named `type`.

Every X days, optionally based on the actual last completion:

```json
{ "type": "interval", "days": 4, "basis": "completion" }
```

Selected weekdays, using lowercase English weekday names:

```json
{ "type": "weekdays", "days": ["monday", "thursday"] }
```

Monthly on a fixed calendar day. If a month is shorter, the last day of that month is used:

```json
{ "type": "monthly", "day": 31, "intervalMonths": 1, "basis": "scheduled" }
```

Every X calendar months after completion. This compact form is useful for tasks such as cleaning a radiator twice per year:

```json
{ "type": "monthly", "intervalMonths": 6 }
```

Supported `basis` values are `completion` and `scheduled`. Interval days range from 1 through 3,650. Monthly days range from 1 through 31, and month intervals range from 1 through 120. A monthly rule without `day` defaults to completion-based; a monthly rule with `day` defaults to scheduled.

## Compatibility contract

Writers emit version 1 and stable UUIDs. Readers ignore unknown keys but not unknown recurrence types. A future incompatible schema increments `version`; additive optional fields can remain in version 1.
