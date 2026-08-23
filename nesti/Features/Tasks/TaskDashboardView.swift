import SwiftUI
import SwiftData

private enum TaskScope: String, CaseIterable, Identifiable {
    case due = "Due"
    case overdue = "Overdue"
    case upcoming = "Upcoming"
    var id: Self { self }
}

struct TaskDashboardView: View {
    @Environment(\.modelContext) private var context
    @Query private var allTasks: [CleaningTask]
    @Query(sort: \Room.sortOrder) private var rooms: [Room]
    @State private var scope: TaskScope = .due
    @State private var editingTask: CleaningTask?
    @State private var showingNewTask = false

    private var displayedTasks: [CleaningTask] {
        let today = Calendar.current.startOfDay(for: Date())
        return allTasks.filter { task in
            guard let due = task.nextDueAt else { return false }
            switch scope {
            case .due: return due < Calendar.current.date(byAdding: .day, value: 1, to: today)!
            case .overdue: return due < today
            case .upcoming: return due >= Calendar.current.date(byAdding: .day, value: 1, to: today)!
            }
        }.sorted { ($0.nextDueAt ?? .distantFuture) < ($1.nextDueAt ?? .distantFuture) }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Task view", selection: $scope) {
                    ForEach(TaskScope.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding()

                if displayedTasks.isEmpty {
                    ContentUnavailableView(
                        emptyTitle,
                        systemImage: scope == .overdue ? "checkmark.seal" : "sparkles",
                        description: Text(emptyDescription)
                    )
                } else {
                    List {
                        ForEach(groupedTasks, id: \.0) { section, tasks in
                            Section(section) {
                                ForEach(tasks) { task in
                                    TaskRow(task: task) { PlanStore.complete(task, in: context) }
                                        .contentShape(Rectangle())
                                        .onTapGesture { editingTask = task }
                                        .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                            Button { PlanStore.complete(task, in: context) } label: {
                                                Label("Complete", systemImage: "checkmark")
                                            }
                                            .tint(.green)
                                        }
                                        .swipeActions(edge: .trailing) {
                                            Button(role: .destructive) { PlanStore.deleteTask(task, from: context) } label: {
                                                Label("Delete", systemImage: "trash")
                                            }
                                        }
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("nesti.")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingNewTask = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Add task")
                        .disabled(rooms.isEmpty)
                }
            }
            .sheet(isPresented: $showingNewTask) { TaskEditorView(task: nil, initialRoom: rooms.first) }
            .sheet(item: $editingTask) { TaskEditorView(task: $0, initialRoom: $0.room) }
        }
    }

    private var groupedTasks: [(String, [CleaningTask])] {
        let groups = Dictionary(grouping: displayedTasks) { $0.room?.name ?? "No Room" }
        return groups.sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
    }

    private var emptyTitle: String {
        switch scope { case .due: "All clear"; case .overdue: "Nothing overdue"; case .upcoming: "No upcoming tasks" }
    }

    private var emptyDescription: String {
        if rooms.isEmpty { return "Create a room, then add its cleaning tasks." }
        return scope == .due ? "Your next scheduled tasks will appear here." : "Tasks in this view will appear when their due dates match."
    }
}
