import SwiftUI
import SwiftData

@main
struct NestiApp: App {
    private let container: ModelContainer = {
        do {
            return try ModelContainer(for: Room.self, CleaningTask.self, CompletionRecord.self)
        } catch {
            fatalError("Unable to create nesti. data store: \(error.localizedDescription)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(Color("AccentColor"))
        }
        .modelContainer(container)
    }
}
