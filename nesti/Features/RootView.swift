import SwiftUI
import SwiftData

struct RootView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var scenePhase
    @Query private var allTasks: [CleaningTask]
    @Query private var completions: [CompletionRecord]
    @State private var selectedTab = 1
    @State private var importDocument: NestiDocument?
    @State private var importError: String?

    var body: some View {
        TabView(selection: $selectedTab) {
            TaskDashboardView()
                .tabItem { Label("Tasks", systemImage: "checkmark.circle") }
                .tag(0)
            RoomsView()
                .tabItem { Label("Rooms", systemImage: "square.grid.2x2") }
                .tag(1)
            CleaningGameView()
                .tabItem { Label("Play", systemImage: "gamecontroller") }
                .tag(2)
            SettingsView(onDocumentSelected: presentImport)
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(3)
        }
        .onOpenURL(perform: handleOpenURL)
        .onChange(of: widgetSnapshotFingerprint, initial: true) {
            WidgetSnapshotPublisher.publish(tasks: allTasks, completions: completions)
        }
        .onChange(of: scenePhase, initial: true) {
            guard scenePhase == .active else { return }
            WidgetSnapshotPublisher.publish(tasks: allTasks, completions: completions)
        }
        .sheet(item: $importDocument) { document in
            ImportPreviewView(document: document) {
                PlanStore.importDocument(document, into: context)
                importDocument = nil
                selectedTab = 0
            }
        }
        .alert("Could Not Import Plan", isPresented: Binding(
            get: { importError != nil },
            set: { if !$0 { importError = nil } }
        )) {
            Button("OK", role: .cancel) { importError = nil }
        } message: {
            Text(importError ?? "Unknown error")
        }
    }

    private func presentImport(_ url: URL) {
        do {
            importDocument = try ImportCoordinator.read(from: url)
        } catch {
            importError = error.localizedDescription
        }
    }

    private var widgetSnapshotFingerprint: Int {
        var hasher = Hasher()
        for task in allTasks.sorted(by: { $0.id.uuidString < $1.id.uuidString }) {
            hasher.combine(task.id)
            hasher.combine(task.name)
            hasher.combine(task.nextDueAt)
            hasher.combine(task.estimatedMinutes)
            hasher.combine(task.room?.name)
            hasher.combine(task.room?.icon)
        }
        for completion in completions.sorted(by: { $0.id.uuidString < $1.id.uuidString }) {
            hasher.combine(completion.id)
            hasher.combine(completion.completedAt)
            hasher.combine(completion.scheduledFor)
            hasher.combine(completion.task?.id)
        }
        return hasher.finalize()
    }

    private func handleOpenURL(_ url: URL) {
        guard url.scheme == "nesti" else {
            presentImport(url)
            return
        }
        switch url.host {
        case "tasks": selectedTab = 0
        case "play": selectedTab = 2
        default: break
        }
    }
}
