import SwiftUI
import SwiftData

struct RootView: View {
    @Environment(\.modelContext) private var context
    @State private var selectedTab = 0
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
            SettingsView(onDocumentSelected: presentImport)
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(2)
        }
        .onOpenURL(perform: presentImport)
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
}
