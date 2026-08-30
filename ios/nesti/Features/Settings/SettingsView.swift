import SwiftUI
import SwiftData
import UniformTypeIdentifiers

struct SettingsView: View {
    @Environment(\.modelContext) private var context
    @Environment(SyncCoordinator.self) private var syncCoordinator
    @Query(sort: \Room.sortOrder) private var rooms: [Room]
    @Query(sort: \UserProfile.sortOrder) private var profiles: [UserProfile]
    @Query private var syncConflicts: [SyncConflictModel]
    @AppStorage("homeName") private var homeName = "My Home"
    @AppStorage("activeProfileID") private var activeProfileID = ""
    @State private var showingImporter = false
    @State private var showingExporter = false
    @State private var exportDocument: NestiFileDocument?
    @State private var exportError: String?
    @State private var showingSyncConnection = false
    @State private var serverURL = "https://nesti.misavoid.dev"
    @State private var pairingCode = ""
    @State private var replaceLocalData = false
    @State private var syncError: String?
    let onDocumentSelected: (URL) -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    NavigationLink {
                        RoomsManagementView()
                    } label: {
                        Label {
                            LabeledContent("Rooms", value: rooms.count.formatted())
                        } icon: {
                            Image(systemName: "square.grid.2x2")
                        }
                    }
                }
                Section("Home") {
                    TextField("Home name", text: $homeName)
                    if !profiles.isEmpty {
                        Picker("Active profile", selection: $activeProfileID) {
                            ForEach(profiles) { profile in
                                Text(profile.name).tag(profile.id.uuidString)
                            }
                        }
                    }
                    NavigationLink {
                        ProfilesView()
                    } label: {
                        Label("Manage Profiles", systemImage: "person.2")
                    }
                }
                Section("Sync") {
                    LabeledContent("Status", value: syncCoordinator.message)
                    if let serverName = syncCoordinator.serverName {
                        LabeledContent("Server", value: serverName)
                        LabeledContent("Pending", value: syncCoordinator.pendingCount.formatted())
                        if let lastSyncedAt = syncCoordinator.lastSyncedAt {
                            LabeledContent("Last saved", value: lastSyncedAt.formatted(date: .abbreviated, time: .shortened))
                        }
                        Button { Task { try? await syncCoordinator.syncNow() } } label: {
                            Label("Save to Server Now", systemImage: "arrow.triangle.2.circlepath")
                        }
                        Button(role: .destructive) { Task { await syncCoordinator.disconnect() } } label: {
                            Label("Disconnect This Device", systemImage: "link.badge.minus")
                        }
                    } else {
                        Button { showingSyncConnection = true } label: {
                            Label("Connect to Server", systemImage: "server.rack")
                        }
                    }
                }
                if !syncConflicts.isEmpty {
                    Section("Sync Conflicts") {
                        ForEach(syncConflicts) { conflict in
                            VStack(alignment: .leading, spacing: 8) {
                                Text("\(conflict.entityTypeRaw.capitalized) changed in two places")
                                    .font(.subheadline.weight(.semibold))
                                Text(conflict.reason.replacingOccurrences(of: "_", with: " "))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                HStack {
                                    Button("Use Server") { Task { await syncCoordinator.resolve(conflict, keepLocal: false) } }
                                    if conflict.reason != "deleted" {
                                        Button("Keep This Device") { Task { await syncCoordinator.resolve(conflict, keepLocal: true) } }
                                    }
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    }
                }
                Section("Plan files") {
                    Button { showingImporter = true } label: { Label("Import .nesti Plan", systemImage: "square.and.arrow.down") }
                    Button(action: exportAll) { Label("Export Entire Home", systemImage: "square.and.arrow.up") }.disabled(rooms.isEmpty)
                    NavigationLink { RoomExportView(homeName: homeName) } label: { Label("Export a Room", systemImage: "door.left.hand.open") }.disabled(rooms.isEmpty)
                }
                Section("Privacy") {
                    LabeledContent("Storage", value: syncCoordinator.isConnected ? "Device + PostgreSQL" : "On this device")
                    Text(syncCoordinator.isConnected
                         ? "An offline copy stays on this device and is synchronized with your nesti. server database."
                         : "nesti. works offline. Your cleaning plan stays on this device unless you export it or connect a server.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section { LabeledContent("File format", value: ".nesti version 1") }
            }
            .navigationTitle("Settings")
            .onChange(of: homeName) { _, value in SyncOutbox.enqueueHome(name: value, in: context) }
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
            .sheet(isPresented: $showingSyncConnection) {
                NavigationStack {
                    Form {
                        Section("Server") {
                            TextField("https://nesti.example", text: $serverURL)
                                .textInputAutocapitalization(.never)
                                .keyboardType(.URL)
                                .autocorrectionDisabled()
                            SecureField("Pairing code", text: $pairingCode)
                                .textInputAutocapitalization(.characters)
                        }
                        if !rooms.isEmpty {
                            Section {
                                Toggle("Replace local plan if server has data", isOn: $replaceLocalData)
                            } footer: {
                                Text("Export your local plan before replacing it.")
                            }
                        }
                    }
                    .navigationTitle("Connect to Server")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showingSyncConnection = false } }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Connect") { connectToServer() }
                                .disabled(serverURL.trimmed.isEmpty || pairingCode.trimmed.isEmpty || syncCoordinator.phase == .connecting)
                        }
                    }
                }
                .presentationDetents([.medium])
            }
            .alert("Could Not Connect", isPresented: Binding(get: { syncError != nil }, set: { if !$0 { syncError = nil } })) {
                Button("OK", role: .cancel) { syncError = nil }
            } message: { Text(syncError ?? "Unknown error") }
        }
    }

    private func exportAll() {
        exportDocument = NestiFileDocument(document: PlanStore.exportDocument(name: homeName, rooms: rooms))
        showingExporter = true
    }

    private func connectToServer() {
        Task {
            do {
                try await syncCoordinator.connect(serverAddress: serverURL, pairingCode: pairingCode, replaceLocal: replaceLocalData)
                pairingCode = ""
                showingSyncConnection = false
            } catch {
                syncError = error.localizedDescription
            }
        }
    }
}

struct ProfilesView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \UserProfile.sortOrder) private var profiles: [UserProfile]
    @AppStorage("activeProfileID") private var activeProfileID = ""
    @State private var editingProfile: UserProfile?
    @State private var showingNewProfile = false

    var body: some View {
        List {
            ForEach(profiles) { profile in
                Button {
                    activeProfileID = profile.id.uuidString
                } label: {
                    HStack {
                        Circle().fill(profileColor(profile.colorHex)).frame(width: 14, height: 14)
                        Text(profile.name).foregroundStyle(.primary)
                        Spacer()
                        if activeProfileID == profile.id.uuidString { Image(systemName: "checkmark").foregroundStyle(.tint) }
                    }
                }
                .swipeActions {
                    Button("Edit") { editingProfile = profile }.tint(.blue)
                    Button("Delete", role: .destructive) { ProfileStore.delete(profile, in: context) }
                        .disabled(profiles.count <= 1)
                }
            }
        }
        .navigationTitle("Profiles")
        .toolbar { Button { showingNewProfile = true } label: { Label("Add profile", systemImage: "plus") } }
        .sheet(isPresented: $showingNewProfile) { ProfileEditorView() }
        .sheet(item: $editingProfile) { ProfileEditorView(profile: $0) }
    }

    private func profileColor(_ hex: String) -> Color {
        let value = UInt64(hex.dropFirst(), radix: 16) ?? 0x147d64
        return Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
    }
}

private struct ProfileEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    let profile: UserProfile?
    @State private var name: String
    @State private var colorHex: String

    private let colors = ["#147d64", "#357ca5", "#dc664f", "#b27a13", "#8b5fbf", "#d14f86"]

    init(profile: UserProfile? = nil) {
        self.profile = profile
        _name = State(initialValue: profile?.name ?? "")
        _colorHex = State(initialValue: profile?.colorHex ?? "#147d64")
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $name)
                Picker("Color", selection: $colorHex) {
                    ForEach(colors, id: \.self) { value in
                        Circle()
                            .fill(profileColor(value))
                            .frame(width: 22, height: 22)
                            .tag(value)
                            .accessibilityLabel(value)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            .navigationTitle(profile == nil ? "New Profile" : "Edit Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        ProfileStore.save(profile, name: name, colorHex: colorHex, in: context)
                        dismiss()
                    }
                    .disabled(name.trimmed.isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func profileColor(_ hex: String) -> Color {
        let value = UInt64(hex.dropFirst(), radix: 16) ?? 0x147d64
        return Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
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
