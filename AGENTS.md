# nesti. repository guide

## Product constraints

- The product name is always `nesti.` including its lowercase spelling and period.
- The MVP is offline-first. Do not add accounts, analytics, backend services, subscriptions, or network dependencies.
- Import and export are core workflows. Any model change must consider `.nesti` compatibility.
- The web app is also offline-first. Its production bundle must not require accounts, APIs, CDNs, remote fonts, or other runtime network services.
- Prefer native SwiftUI, SwiftData, UserNotifications, and UniformTypeIdentifiers APIs.
- The deployment targets are iOS 17 or newer and macOS 14 or newer through Mac Catalyst.

## Architecture

- `ios/Sources/NestiCore` contains platform-independent recurrence and `.nesti` format logic.
- `ios/nesti/Data` contains SwiftData models and mapping to/from NestiCore values.
- `ios/nesti/Services` owns side effects such as notifications and file import coordination.
- `ios/nesti/Features` contains SwiftUI feature views. Keep business rules out of views.
- `web/src/core` contains framework-independent TypeScript ports of recurrence, statistics, and `.nesti` format behavior.
- `web/src/data` owns versioned IndexedDB persistence and migrations; `web/src/services` owns browser side effects.
- `web/src/features` contains interactive feature UI. Astro pages and components must not own business rules.
- The web production build is static. Docker serves built assets and must not become an application backend.
- Persist recurrence rules as versioned JSON data so new rule variants can be added without a store migration for every schema extension.

## Quality bar

- Use `Calendar` for date arithmetic; never approximate a calendar month with a fixed day count.
- Decode and validate an imported plan before mutating SwiftData.
- Imports append to existing data unless a future flow explicitly offers another behavior.
- Keep stable identifiers from imports/exports and generate UUIDs when older input omits them.
- Add focused `NestiCoreTests` coverage for recurrence or file-format changes.
- Keep shared compatibility fixtures for Swift and TypeScript. A web port must match `NestiCore` for recurrence and `.nesti` behavior before replacing fixture expectations.
- Use calendar-aware date operations in TypeScript; never approximate days or months with millisecond constants.
- Use transactional IndexedDB writes. Validate a full import before atomically appending it, and never clear local data during an application update.
- Treat notifications as progressive enhancement on the web. Core task behavior must work when notification or persistent-storage APIs are unavailable.
- Run `swift test --package-path ios` for portable logic and an iOS build/test in Xcode when the iOS SDK is available.
- For web changes, run the check, unit-test, production-build, and relevant browser-test scripts defined by `web/package.json`; verify Docker and offline reload when delivery files change.

## Editing

- Keep changes scoped and avoid third-party packages unless they remove substantial complexity.
- Use accessible labels for icon-only actions and support Dynamic Type.
- Use semantic HTML, keyboard-visible focus, accessible names, responsive layouts, reduced-motion support, and 200% zoom compatibility on the web.
- Bundle required web assets locally and lazy-load expensive feature code such as the cleanup game.
- Do not commit signing identities, personal team identifiers, or generated build products.
- Do not commit `web/node_modules`, Astro build output, browser-test artifacts, local IndexedDB data, or container exports.

## Web implementation

- Follow `web/PLAN.md` for the target architecture, compatibility rules, implementation phases, and release gates.
- Keep `.nesti` version 1 as the native/web interoperability boundary. Preserve identifiers and import append semantics across both implementations.
