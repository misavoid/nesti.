import SwiftUI
import SwiftData

struct CleaningGameView: View {
    @Environment(\.modelContext) private var context
    @Query private var allTasks: [CleaningTask]
    @Query(sort: \CompletionRecord.completedAt, order: .reverse) private var completions: [CompletionRecord]
    @State private var worldState = GameWorldState()
    @State private var isSceneActive = false

    private var completedTodayTasks: [CleaningTask] {
        let calendar = Calendar.current
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: Date())) ?? .distantFuture
        var seen = Set<UUID>()
        return completions.compactMap { completion in
            guard calendar.isDateInToday(completion.completedAt),
                  (completion.scheduledFor ?? completion.completedAt) < tomorrow,
                  let task = completion.task,
                  seen.insert(task.id).inserted else { return nil }
            return task
        }
    }

    private var completedIDs: Set<UUID> { Set(completedTodayTasks.map(\.id)) }

    private var pendingTasks: [CleaningTask] {
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: Date()))!
        return allTasks.filter { task in
            guard let dueDate = task.nextDueAt else { return false }
            return dueDate < tomorrow && !completedIDs.contains(task.id)
        }.sorted(by: taskSort)
    }

    private var completedTasks: [CleaningTask] { completedTodayTasks.sorted(by: taskSort) }
    private var dailyTasks: [CleaningTask] {
        var byID = Dictionary(uniqueKeysWithValues: pendingTasks.map { ($0.id, $0) })
        for task in completedTasks { byID[task.id] = task }
        return byID.values.sorted(by: taskSort)
    }

    private var snapshot: GameWorldSnapshot {
        worldState.snapshot(
            taskIDs: Set(dailyTasks.map(\.id)),
            completedTaskIDs: completedIDs
        )
    }

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                VStack(spacing: 0) {
                    IslandSceneView(snapshot: snapshot, isActive: isSceneActive)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Island cleanup, \(completedTasks.count) of \(dailyTasks.count) tasks complete")
                    .frame(maxWidth: .infinity)
                    .frame(height: proxy.size.height * 0.66)
                    .clipped()

                    Divider()

                    if dailyTasks.isEmpty {
                        ContentUnavailableView(
                            "A clean start",
                            systemImage: "sparkles",
                            description: Text("Tasks due today will appear here.")
                        )
                    } else {
                        List {
                            if !pendingTasks.isEmpty {
                                Section("Today") {
                                    ForEach(pendingTasks) { task in
                                        GameTaskRow(task: task, isCompleted: false) {
                                            PlanStore.complete(task, in: context)
                                        }
                                    }
                                }
                            }
                            if !completedTasks.isEmpty {
                                Section("Completed") {
                                    ForEach(completedTasks) { task in
                                        GameTaskRow(task: task, isCompleted: true, complete: {})
                                    }
                                }
                            }
                        }
                        .listStyle(.plain)
                    }
                }
            }
            .navigationTitle("Play")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { isSceneActive = true }
            .onDisappear { isSceneActive = false }
        }
    }

    private func taskSort(_ lhs: CleaningTask, _ rhs: CleaningTask) -> Bool {
        let roomComparison = (lhs.room?.name ?? "").localizedCaseInsensitiveCompare(rhs.room?.name ?? "")
        if roomComparison != .orderedSame { return roomComparison == .orderedAscending }
        return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
    }
}

private struct GameTaskRow: View {
    let task: CleaningTask
    let isCompleted: Bool
    let complete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: complete) {
                Image(systemName: isCompleted ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(isCompleted ? .green : Color.accentColor)
            }
            .buttonStyle(.plain)
            .disabled(isCompleted)
            .accessibilityLabel(isCompleted ? "Completed \(task.name)" : "Complete \(task.name)")

            VStack(alignment: .leading, spacing: 3) {
                Text(task.name)
                    .font(.body.weight(.medium))
                    .foregroundStyle(isCompleted ? .secondary : .primary)
                    .strikethrough(isCompleted)
                HStack(spacing: 8) {
                    if let roomName = task.room?.name {
                        Label(roomName, systemImage: task.room?.icon ?? "door.left.hand.open")
                    }
                    if let minutes = task.estimatedMinutes {
                        Label("\(minutes) min", systemImage: "clock")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }
}
