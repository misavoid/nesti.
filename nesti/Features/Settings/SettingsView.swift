import SwiftUI
import SwiftData
import UniformTypeIdentifiers

struct SettingsView: View {
    @Query(sort: \Room.sortOrder) private var rooms: [Room]
    @AppStorage("homeName") private var homeName = "My Home"
    @State private var showingImporter = false
    @State private var showingExporter = false
    @State private var exportDocument: NestiFileDocument?
    @State private var exportError: String?
    let onDocumentSelected: (URL) -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Home") { TextField("Home name", text: $homeName) }
                Section("Plan files") {
                    Button { showingImporter = true } label: { Label("Import .nesti Plan", systemImage: "square.and.arrow.down") }
                    Button(action: exportAll) { Label("Export Entire Home", systemImage: "square.and.arrow.up") }.disabled(rooms.isEmpty)
                    NavigationLink { RoomExportView(homeName: homeName) } label: { Label("Export a Room", systemImage: "door.left.hand.open") }.disabled(rooms.isEmpty)
                }
                Section("Privacy") {
                    LabeledContent("Storage", value: "On this iPhone")
                    Text("nesti. works offline. Your cleaning plan stays on your device unless you export it.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section { LabeledContent("File format", value: ".nesti version 1") }
            }
            .navigationTitle("Settings")
            .fileImporter(isPresented: $showingImporter, allowedContentTypes: [.nestiPlan, .json]) { result in
                switch result {
                case let .success(url): onDocumentSelected(url)
                case let .failure(error): exportError = error.localizedDescription
                }
            }
            .fileExporter(
                isPresented: $showingExporter,
                document: exportDocument,
                contentType: .nestiPlan,
                defaultFilename: safeFilename(homeName)
            ) { result in if case let .failure(error) = result { exportError = error.localizedDescription } }
            .alert("File Error", isPresented: Binding(get: { exportError != nil }, set: { if !$0 { exportError = nil } })) {
                Button("OK", role: .cancel) { exportError = nil }
            } message: { Text(exportError ?? "Unknown error") }
        }
    }

    private func exportAll() {
        exportDocument = NestiFileDocument(document: PlanStore.exportDocument(name: homeName, rooms: rooms))
        showingExporter = true
    }
}

struct RoomExportView: View {
    @Query(sort: \Room.sortOrder) private var rooms: [Room]
    let homeName: String
    @State private var exportDocument: NestiFileDocument?
    @State private var filename = "Room"
    @State private var showingExporter = false

    var body: some View {
        List(rooms) { room in
            Button {
                filename = safeFilename(room.name)
                exportDocument = NestiFileDocument(document: PlanStore.exportDocument(name: "\(homeName) - \(room.name)", rooms: [room]))
                showingExporter = true
            } label: {
                Label(room.name, systemImage: room.icon)
            }
            .foregroundStyle(.primary)
        }
        .navigationTitle("Export Room")
        .fileExporter(isPresented: $showingExporter, document: exportDocument, contentType: .nestiPlan, defaultFilename: filename) { _ in }
    }
}

private func safeFilename(_ value: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_ "))
    let cleaned = value.unicodeScalars.map { allowed.contains($0) ? Character(String($0)) : "-" }
    let result = String(cleaned).trimmingCharacters(in: .whitespacesAndNewlines)
    return result.isEmpty ? "nesti-plan" : result
}
