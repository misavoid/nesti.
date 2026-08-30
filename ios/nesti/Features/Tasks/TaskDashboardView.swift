import SwiftUI
import SwiftData

private enum TaskScope: String, CaseIterable, Identifiable {
    case due = "Due"
    case overdue = "Overdue"
    case upcoming = "Upcoming"
    case done = "Done"
    var id: Self { self }
}

struct TaskDashboardView: View {
    @Environment(\.modelContext) private var context
    @Query private var allTasks: [CleaningTask]
    @Query(sort: \CompletionRecord.completedAt, order: .reverse) private var completions: [CompletionRecord]
    @Query(sort: \Room.sortOrder) private var rooms: [Room]
    @Query(sort: \UserProfile.sortOrder) private var profiles: [UserProfile]
    @AppStorage("activeProfileID") private var activeProfileID = ""
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
            case .done: return false
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

                if scope == .done {
                    doneContent
                } else if displayedTasks.isEmpty {
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
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Picker("Active profile", selection: $activeProfileID) {
                            ForEach(profiles) { profile in Text(profile.name).tag(profile.id.uuidString) }
                        }
                    } label: {
                        Label(activeProfileName, systemImage: "person.crop.circle")
                    }
                    .accessibilityLabel("Active profile, \(activeProfileName)")
                }
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

    private var activeProfileName: String {
        profiles.first(where: { $0.id.uuidString == activeProfileID })?.name ?? profiles.first?.name ?? "Profile"
    }

    private var groupedTasks: [(String, [CleaningTask])] {
        let groups = Dictionary(grouping: displayedTasks) { $0.room?.name ?? "No Room" }
        return groups.sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
    }

    @ViewBuilder
    private var doneContent: some View {
        if completions.isEmpty {
            ContentUnavailableView(
                "Nothing done yet",
                systemImage: "checkmark.circle",
                description: Text("Completed tasks will appear here.")
            )
        } else {
            List {
                ForEach(groupedCompletions, id: \.day) { group in
                    Section(completionDayLabel(group.day)) {
                        ForEach(group.completions) { completion in
                            CompletedTaskRow(completion: completion) {
                                PlanStore.uncomplete(completion, in: context)
                            }
                            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                Button {
                                    PlanStore.uncomplete(completion, in: context)
                                } label: {
                                    Label("Mark as Not Done", systemImage: "arrow.uturn.backward")
                                }
                                .tint(.orange)
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    private var groupedCompletions: [(day: Date, completions: [CompletionRecord])] {
        let calendar = Calendar.current
        return Dictionary(grouping: completions) { calendar.startOfDay(for: $0.completedAt) }
            .map { (day: $0.key, completions: $0.value) }
            .sorted { $0.day > $1.day }
    }

    private func completionDayLabel(_ day: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return "Today" }
        if calendar.isDateInYesterday(day) { return "Yesterday" }
        return day.formatted(.dateTime.weekday(.wide).month(.wide).day())
    }

    private var emptyTitle: String {
        switch scope {
        case .due: "All clear"
        case .overdue: "Nothing overdue"
        case .upcoming: "No upcoming tasks"
        case .done: "Nothing done yet"
        }
    }

    private var emptyDescription: String {
        if rooms.isEmpty { return "Create a room, then add its cleaning tasks." }
        return scope == .due ? "Your next scheduled tasks will appear here." : "Tasks in this view will appear when their due dates match."
    }
}

private struct CompletedTaskRow: View {
    let completion: CompletionRecord
    let uncomplete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: uncomplete) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.green)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Mark \(taskName) as not done")

            VStack(alignment: .leading, spacing: 4) {
                Text(taskName)
                    .font(.body.weight(.medium))

                HStack(spacing: 8) {
                    if let roomName = completion.task?.room?.name {
                        Label(roomName, systemImage: completion.task?.room?.icon ?? "door.left.hand.open")
                    }
                    Label(
                        completion.completedAt.formatted(.dateTime.hour().minute()),
                        systemImage: "clock"
                    )
                    if let profile = completion.profile {
                        Label(profile.name, systemImage: "person")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }

    private var taskName: String {
        completion.task?.name ?? "Deleted task"
    }
}
