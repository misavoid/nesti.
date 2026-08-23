# nesti.

`nesti.` is an offline-first iPhone, iPad, and Mac cleaning routine app built with SwiftUI and SwiftData. It organizes recurring cleaning tasks by room, highlights what is due, sends local reminders, and treats import/export as a first-class workflow.

## Requirements

- Xcode 16 or newer
- iOS 17 or newer
- macOS 14 or newer for the Mac Catalyst build
- A development team selected in Xcode for device deployment

## Run

1. Open `nesti.xcodeproj` in Xcode.
2. Select the `nesti` scheme.
3. Choose an iOS simulator or `My Mac (Mac Catalyst)` as the run destination.
4. Build and run.

The portable schedule and file-format tests can also run without Xcode:

```sh
swift test
```

## Structure

- `Sources/NestiCore`: recurrence engine, versioned document schema, and validation
- `nesti/Data`: SwiftData models and document mapping
- `nesti/Services`: notifications and import/export support
- `nesti/Features`: SwiftUI screens grouped by workflow
- `Tests/NestiCoreTests`: portable unit tests
- `docs`: architecture and `.nesti` format specification

See `docs/ARCHITECTURE.md` and `docs/NESTI_FORMAT.md` for design details.
