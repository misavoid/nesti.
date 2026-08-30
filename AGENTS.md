# nesti. repository guide

## Product constraints

- The product name is always `nesti.` including its lowercase spelling and period.
- The MVP is offline-first. Do not add accounts, analytics, backend services, subscriptions, or network dependencies.
- Import and export are core workflows. Any model change must consider `.nesti` compatibility.
- Prefer native SwiftUI, SwiftData, UserNotifications, and UniformTypeIdentifiers APIs.
- The deployment targets are iOS 17 or newer and macOS 14 or newer through Mac Catalyst.

## Architecture

- `ios/Sources/NestiCore` contains platform-independent recurrence and `.nesti` format logic.
- `ios/nesti/Data` contains SwiftData models and mapping to/from NestiCore values.
- `ios/nesti/Services` owns side effects such as notifications and file import coordination.
- `ios/nesti/Features` contains SwiftUI feature views. Keep business rules out of views.
- Persist recurrence rules as versioned JSON data so new rule variants can be added without a store migration for every schema extension.

## Quality bar

- Use `Calendar` for date arithmetic; never approximate a calendar month with a fixed day count.
- Decode and validate an imported plan before mutating SwiftData.
- Imports append to existing data unless a future flow explicitly offers another behavior.
- Keep stable identifiers from imports/exports and generate UUIDs when older input omits them.
- Add focused `NestiCoreTests` coverage for recurrence or file-format changes.
- Run `swift test --package-path ios` for portable logic and an iOS build/test in Xcode when the iOS SDK is available.

## Editing

- Keep changes scoped and avoid third-party packages unless they remove substantial complexity.
- Use accessible labels for icon-only actions and support Dynamic Type.
- Do not commit signing identities, personal team identifiers, or generated build products.
