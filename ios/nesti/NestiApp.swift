import SwiftUI
import SwiftData

@main
struct NestiApp: App {
    private let container: ModelContainer
    @State private var syncCoordinator: SyncCoordinator

    init() {
        do {
            let container = try ModelContainer(
                for: Room.self,
                CleaningTask.self,
                CompletionRecord.self,
                UserProfile.self,
                SyncConnectionModel.self,
                PendingSyncMutation.self,
                SyncRevisionModel.self,
                SyncConflictModel.self
            )
            self.container = container
            _syncCoordinator = State(initialValue: SyncCoordinator(container: container))
        } catch {
            fatalError("Unable to create nesti. data store: \(error.localizedDescription)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(Color("AccentColor"))
                .environment(syncCoordinator)
        }
        .modelContainer(container)
    }
}
