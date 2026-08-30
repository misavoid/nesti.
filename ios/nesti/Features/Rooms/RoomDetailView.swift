import SwiftUI
import SwiftData

struct RoomDetailView: View {
    @Environment(\.modelContext) private var context
    let room: Room
    @State private var showingNewTask = false
    @State private var editingTask: CleaningTask?
    @State private var editingRoom = false

    private var tasks: [CleaningTask] { room.tasks.sorted { $0.sortOrder < $1.sortOrder } }

    var body: some View {
        Group {
            if tasks.isEmpty {
                ContentUnavailableView {
                    Label("No tasks", systemImage: room.icon)
                } description: {
                    Text("Add the first cleaning task for \(room.name).")
                } actions: {
                    Button("Add Task") { showingNewTask = true }.buttonStyle(.borderedProminent)
                }
            } else {
                List {
                    if !room.roomNotes.isEmpty { Section { Text(room.roomNotes).foregroundStyle(.secondary) } }
                    Section("Cleaning tasks") {
                        ForEach(tasks) { task in
                            TaskRow(task: task) { PlanStore.complete(task, in: context) }
                                .contentShape(Rectangle())
                                .onTapGesture { editingTask = task }
                                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                    Button { PlanStore.complete(task, in: context) } label: { Label("Complete", systemImage: "checkmark") }.tint(.green)
                                }
                        }
                    }
                }
            }
        }
        .navigationTitle(room.name)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { editingRoom = true } label: { Image(systemName: "pencil") }.accessibilityLabel("Edit room")
                Button { showingNewTask = true } label: { Image(systemName: "plus") }.accessibilityLabel("Add task")
            }
        }
        .sheet(isPresented: $showingNewTask) { TaskEditorView(task: nil, initialRoom: room) }
        .sheet(item: $editingTask) { TaskEditorView(task: $0, initialRoom: room) }
        .sheet(isPresented: $editingRoom) { RoomEditorView(room: room) }
    }
}
