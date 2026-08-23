import SwiftUI

struct RoomEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    let room: Room?
    @State private var name: String
    @State private var notes: String
    @State private var icon: String

    private let icons = ["door.left.hand.open", "sofa", "bed.double", "shower", "fork.knife", "washer", "desktopcomputer", "leaf"]

    init(room: Room?) {
        self.room = room
        _name = State(initialValue: room?.name ?? "")
        _notes = State(initialValue: room?.roomNotes ?? "")
        _icon = State(initialValue: room?.icon ?? "door.left.hand.open")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Room") {
                    TextField("Name", text: $name)
                    TextField("Notes", text: $notes, axis: .vertical).lineLimit(2...4)
                }
                Section("Icon") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 4), spacing: 12) {
                        ForEach(icons, id: \.self) { symbol in
                            Button { icon = symbol } label: {
                                Image(systemName: symbol)
                                    .font(.title2)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                                    .background(icon == symbol ? Color.accentColor.opacity(0.16) : Color.clear)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(symbol)
                        }
                    }
                }
            }
            .navigationTitle(room == nil ? "New Room" : "Edit Room")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save).disabled(name.trimmed.isEmpty) }
            }
        }
    }

    private func save() {
        if let room { PlanStore.updateRoom(room, name: name, notes: notes, icon: icon, in: context) }
        else { PlanStore.addRoom(name: name, notes: notes, icon: icon, to: context) }
        dismiss()
    }
}
