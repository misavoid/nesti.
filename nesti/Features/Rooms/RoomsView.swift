import SwiftUI
import SwiftData

struct RoomsView: View {
    var body: some View {
        NavigationStack {
            RoomsManagementView()
        }
    }
}

struct RoomsManagementView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Room.sortOrder) private var rooms: [Room]
    @State private var showingNewRoom = false
    @State private var editingRoom: Room?

    var body: some View {
        Group {
            if rooms.isEmpty {
                ContentUnavailableView {
                    Label("No rooms yet", systemImage: "square.grid.2x2")
                } description: {
                    Text("Add the spaces you want to keep clean.")
                } actions: {
                    Button("Add Room") { showingNewRoom = true }.buttonStyle(.borderedProminent)
                }
            } else {
                List {
                    ForEach(rooms) { room in
                        NavigationLink(value: room) {
                            Label {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(room.name).font(.body.weight(.medium))
                                    Text("\(room.tasks.count) task\(room.tasks.count == 1 ? "" : "s")").font(.caption).foregroundStyle(.secondary)
                                }
                            } icon: {
                                Image(systemName: room.icon).foregroundStyle(Color.accentColor)
                            }
                        }
                        .swipeActions {
                            Button(role: .destructive) { PlanStore.deleteRoom(room, from: context) } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button { editingRoom = room } label: { Label("Edit", systemImage: "pencil") }.tint(.orange)
                        }
                    }
                    .onMove { PlanStore.moveRooms(rooms, from: $0, to: $1, in: context) }
                }
            }
        }
        .navigationTitle("Rooms")
        .navigationDestination(for: Room.self) { RoomDetailView(room: $0) }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { if !rooms.isEmpty { EditButton() } }
            ToolbarItem(placement: .primaryAction) {
                Button { showingNewRoom = true } label: { Image(systemName: "plus") }.accessibilityLabel("Add room")
            }
        }
        .sheet(isPresented: $showingNewRoom) { RoomEditorView(room: nil) }
        .sheet(item: $editingRoom) { RoomEditorView(room: $0) }
    }
}
