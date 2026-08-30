# nesti. web implementation plan

## Implementation status

The planned MVP is implemented on the `docs/web-migration-plan` branch. The Astro app, IndexedDB persistence, `.nesti` import/export, statistics, progressive reminders, Three.js Play view, service worker, Docker delivery files, shared Swift/TypeScript recurrence fixtures, and browser checks are present. The phases below remain the local-only maintenance and release checklist. The optional PostgreSQL-backed server and web/native synchronization follow-up is specified in `docs/IOS_SERVER_SYNC_PLAN.md`.

## Goal

Translate the existing nesti. iOS and Mac Catalyst experience into an installable Astro web app served by Docker. The web app must remain local-only and usable without a connection after its first load. It must read and write `.nesti` version 1 files that round-trip with the native app.

This MVP plan does not introduce a server-side application, user accounts, synchronization, analytics, or cloud storage. Docker serves versioned static assets; the browser owns all user data and application behavior until the optional sync plan is implemented and the browser is explicitly paired.

## Success criteria

- Tasks, rooms, completion history, statistics, settings, and the cleanup game have web equivalents.
- Reloading, closing the browser, or installing a new web build does not lose local data.
- The production app shell and bundled assets work offline after the first successful visit.
- Import validates an entire document before one atomic append transaction changes local data.
- Import and export preserve stable identifiers and conform to `docs/NESTI_FORMAT.md`.
- Recurrence results match `NestiCore` for shared fixtures, including daylight-saving transitions and short months.
- The app is keyboard operable, responsive, screen-reader labelled, and usable at 200% zoom.
- A multi-stage Docker build produces a small, unprivileged static-serving image with a health check.

## Target architecture

### Delivery

- Build Astro in static-output mode. Do not add Astro server rendering or API routes.
- Serve the generated `dist/` directory from an unprivileged static web server in the production image.
- Cache hashed Astro assets for a long duration, but always revalidate HTML, the web manifest, and the service worker so releases can update cleanly.
- Add a web app manifest and service worker. Precache the app shell and all required local assets; do not depend on CDNs, remote fonts, or remote images at runtime.
- Keep the MVP Docker Compose configuration limited to local production-parity serving. The later optional sync stack adds separate API and PostgreSQL containers without changing the static Astro output mode.

### Application layers

Use this directory shape unless an implementation spike demonstrates a concrete reason to adjust it:

```text
web/
  src/
    core/          recurrence, statistics, document codec, validation
    data/          persisted records, IndexedDB repositories, migrations
    services/      import/export, notifications, service-worker bridge
    components/    reusable interactive controls
    features/      tasks, rooms, stats, play, settings
    layouts/       Astro page shells
    pages/         Astro routes
  public/          manifest, icons, and local static assets
  tests/
    fixtures/      shared `.nesti` compatibility cases
    unit/
    browser/
  Dockerfile
  compose.yaml       production app on the shared Traefik network
```

- `core` is framework-independent TypeScript. It is the browser counterpart to `ios/Sources/NestiCore` and must not import DOM, Astro, or IndexedDB APIs.
- `data` owns IndexedDB access and schema migrations. Store rooms, tasks, completions, and settings separately so statistics and ordering do not require embedding or rewriting an entire home document.
- `services` owns browser side effects. Views call service or repository interfaces instead of accessing files, notifications, service workers, or IndexedDB directly.
- Astro owns routing, document metadata, and the static shell. Use small client islands for interactive features; avoid hydrating static content and navigation.
- Prefer native browser APIs. Add a dependency only when it removes substantial lifecycle, accessibility, date, or storage complexity, and record the reason in the pull request.

## Compatibility decisions

The native app remains the behavioral reference until the web parity suite passes.

- Represent identifiers as canonical UUID strings and timestamps as ISO-8601 strings at file boundaries.
- Represent due days as explicit calendar values in the domain layer. Do not derive calendar recurrence by adding fixed millisecond durations.
- Match the device's current calendar-day behavior for recurrence and reminders. Test local midnight across daylight-saving changes.
- Preserve import behavior: ignore unknown object keys, reject unknown recurrence types or unsupported document versions, cap files at 5 MB, accept at most 250 rooms and 10,000 tasks, and append rather than merge.
- Generate UUIDs for omitted identifiers and collisions, then retain the generated values on future exports.
- Accept `nextDueAt`, `dueDate`, and `startDate` when reading and emit only `nextDueDate` when writing.
- Import completion summary fields present in version 1, but do not invent completion-history records that the file format does not carry.
- Treat SF Symbol room names as portable metadata. Map known values to the web icon set and show a deterministic fallback for unknown values without rewriting the imported value.
- Export UTF-8 JSON with the `.nesti` extension and `application/vnd.nesti+json` MIME type. Fall back to a normal browser download where the File System Access API is unavailable.

## Work phases

### 1. Scaffold and delivery baseline

- Initialize a strict TypeScript Astro project in `web/` with package scripts for development, type checking, unit tests, browser tests, production build, and formatting.
- Establish design tokens and a responsive app shell matching the native information architecture: Tasks, Stats, Play, and Settings, with room management under Settings.
- Add the manifest, icons, service-worker registration, offline fallback, and update notification.
- Add a multi-stage Dockerfile, `.dockerignore`, static-server configuration, Compose file, and container health check.
- Verify both `npm run dev` and the production container on desktop and mobile viewport sizes.

Exit: an installable, empty app shell loads from Docker and reloads offline with no console errors or external requests.

### 2. Port and prove the domain core

- Port recurrence rule types, next-date calculation, initial due-date calculation, document decoding/encoding, validation, and cleaning statistics from `NestiCore` to framework-independent TypeScript.
- Create language-neutral JSON fixtures that Swift and TypeScript tests can both consume. Cover interval rules, weekdays, scheduled and completion bases, short months, leap years, DST boundaries, aliases, limits, malformed UUIDs, unknown keys, and unsupported versions.
- Compare normalized TypeScript output with Swift output for every fixture. Keep the fixture suite as the compatibility gate for future format changes.

Exit: unit tests demonstrate recurrence and `.nesti` parity with `NestiCore`; no UI or persistence code is required to run them.

### 3. Local persistence and import/export

- Define a versioned IndexedDB schema for rooms, tasks, completion records, and settings. Include a migration test for each schema version after version 1.
- Implement repository operations for create, edit, delete, reorder, complete, and undo completion. Use transactions for mutations that touch multiple stores.
- Decode and validate imports in memory, present a room/task/error summary, and append only after confirmation in one transaction.
- Export the whole home or a selected room using the canonical codec. Add native-to-web and web-to-native round-trip fixtures.
- Provide a deliberate local-data reset action with destructive confirmation. Do not silently clear data when storage or service-worker versions change.

Exit: the browser retains a working plan across reloads, and valid `.nesti` files round-trip without changing their meaning.

### 4. Core workflow parity

- Implement the due-task dashboard with room grouping, overdue/today/upcoming states, completion, and undo.
- Implement room and task create/edit/delete/reorder flows, recurrence controls, notes, estimates, first due date, and reminders.
- Implement settings for the home name, import preview, whole-home export, room export, storage status, notification permission, and format version.
- Preserve stable layout dimensions for controls and support touch, pointer, and keyboard input. Use semantic HTML and accessible names for every icon-only control.

Exit: a user can create and maintain the same cleaning plan from the web app without using developer tools.

### 5. Statistics, reminders, and play

- Port the 30-day, 90-day, and all-time statistics using the shared domain layer and persisted completion history.
- Add reminders as progressive enhancement using the Notifications API and service worker where the browser supports them. Clearly expose unsupported or denied states; recurrence and task completion must never depend on notification availability.
- Rebuild the cleanup game using a proven browser 3D library and bundled assets. Load it only on the Play route and provide a reduced-motion and non-WebGL fallback.
- Keep game progress derived from the same task and completion repositories rather than introducing separate plan state.

Exit: Stats and Play reflect the same local records as Tasks, and reminders degrade without breaking core workflows.

### 6. Hardening and release

- Add browser tests for first run, CRUD, completion/undo, import confirmation and rejection, exports, persistence after reload, service-worker updates, offline reload, and destructive reset.
- Test current Safari, Chrome, Firefox, and Edge, plus iOS Safari standalone mode. Document feature degradation rather than browser-sniffing.
- Audit keyboard navigation, focus restoration, contrast, screen-reader output, Dynamic Type equivalents, 200% zoom, reduced motion, and narrow screens.
- Run a container vulnerability scan, confirm the runtime user is non-root, set security headers, and verify the image contains no source credentials or development server.
- Document local development, Docker operation, data backup, browser support, and release checks.

Exit: CI can build and test the web app and container from a clean checkout, and the release checklist has been exercised on at least one mobile and one desktop browser.

## Verification commands

The scaffold should expose stable commands with these responsibilities:

```sh
npm --prefix web ci
npm --prefix web run check
npm --prefix web test
npm --prefix web run test:browser
npm --prefix web run build
docker build -t nesti-web ./web
docker run --rm -p 8080:8080 nesti-web
swift test --package-path ios
```

CI should run the portable Swift suite whenever shared compatibility fixtures change, then run web checks, unit tests, a production build, browser smoke tests against the container, and an offline reload test.

## Explicitly deferred

- For this MVP: accounts, authentication, shared homes, synchronization, analytics, telemetry, subscriptions, and a server-side database. Optional self-hosted sync is a separate follow-up plan.
- Automatic transfer of a native app's private SwiftData store into a browser. Users transfer plans through `.nesti` files.
- Guaranteed background notifications on every browser. Browser and operating-system support varies, so reminders remain progressive enhancement.
- Changes to `.nesti` version 1 solely to simplify the TypeScript implementation. Any future schema change must be designed for both native and web readers and covered by compatibility fixtures.

## Primary risks

- **Cross-platform dates:** JavaScript timestamp defaults can shift local due days. Keep calendar-day values explicit and make parity fixtures the release gate.
- **Browser storage eviction:** IndexedDB is durable but not an absolute backup. Make export prominent, request persistent storage when supported, and report storage status honestly.
- **Service-worker staleness:** mismatched HTML and assets can strand an offline client. Version caches, revalidate the service worker, and test upgrades between releases.
- **Notification limits:** background delivery differs substantially by browser. Isolate it behind a capability-aware service and never promise native-equivalent scheduling where unsupported.
- **3D bundle size and capability:** lazy-load the Play implementation, compress local assets, honor reduced motion, and retain a functional non-WebGL state.
