import Foundation
import WidgetKit

@MainActor
enum WidgetSnapshotPublisher {
    static func publish(tasks: [CleaningTask], completions: [CompletionRecord], now: Date = Date()) {
        let taskSnapshots = tasks.compactMap { task -> WidgetTaskSnapshot? in
            guard let dueAt = task.nextDueAt else { return nil }
            return WidgetTaskSnapshot(
                id: task.id,
                name: task.name,
                roomName: task.room?.name,
                roomIcon: task.room?.icon,
                dueAt: dueAt,
                estimatedMinutes: task.estimatedMinutes
            )
        }

        let cutoff = Calendar.current.date(byAdding: .day, value: -7, to: now) ?? .distantPast
        let completionSnapshots = completions.compactMap { completion -> WidgetCompletionSnapshot? in
            guard completion.completedAt >= cutoff, let taskID = completion.task?.id else { return nil }
            return WidgetCompletionSnapshot(
                id: completion.id,
                taskID: taskID,
                completedAt: completion.completedAt,
                scheduledFor: completion.scheduledFor
            )
        }

        let snapshot = NestiWidgetSnapshot(
            updatedAt: now,
            tasks: taskSnapshots,
            completions: completionSnapshots
        )
        NestiWidgetSnapshotStore.save(snapshot)
        WidgetCenter.shared.reloadAllTimelines()
    }
}
