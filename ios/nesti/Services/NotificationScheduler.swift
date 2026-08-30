import Foundation
import SwiftData
import UserNotifications

final class NotificationScheduler: @unchecked Sendable {
    static let shared = NotificationScheduler()
    private let center = UNUserNotificationCenter.current()

    private init() {}

    func requestAuthorization() async throws -> Bool {
        try await center.requestAuthorization(options: [.alert, .badge, .sound])
    }

    func replaceReminder(for task: CleaningTask) {
        remove(for: task.id)
        guard task.reminderEnabled, let dueDate = task.nextDueAt else { return }
        var components = Calendar.current.dateComponents([.year, .month, .day], from: dueDate)
        components.hour = task.reminderHour
        components.minute = task.reminderMinute
        guard let reminderDate = Calendar.current.date(from: components), reminderDate > Date() else { return }

        let content = UNMutableNotificationContent()
        content.title = task.name
        content.body = task.room.map { "Due in \($0.name)" } ?? "Cleaning task due"
        content.sound = .default
        let request = UNNotificationRequest(
            identifier: identifier(for: task.id),
            content: content,
            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        )
        center.add(request)
    }

    func remove(for id: UUID) {
        center.removePendingNotificationRequests(withIdentifiers: [identifier(for: id)])
    }

    @MainActor
    func rebuildAll(in context: ModelContext) {
        let tasks = (try? context.fetch(FetchDescriptor<CleaningTask>())) ?? []
        for task in tasks { replaceReminder(for: task) }
    }

    private func identifier(for id: UUID) -> String { "nesti.task.\(id.uuidString)" }
}
