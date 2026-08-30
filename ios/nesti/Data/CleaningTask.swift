import Foundation
import SwiftData

@Model
final class CleaningTask {
    @Attribute(.unique) var id: UUID
    var name: String
    var taskNotes: String
    var estimatedMinutes: Int?
    var sortOrder: Int
    var scheduleData: Data?
    var lastCompletedAt: Date?
    var nextDueAt: Date?
    var reminderEnabled: Bool
    var reminderHour: Int
    var reminderMinute: Int
    var createdAt: Date
    var room: Room?
    @Relationship(deleteRule: .cascade, inverse: \CompletionRecord.task) var completions: [CompletionRecord]

    init(
        id: UUID = UUID(),
        name: String,
        notes: String = "",
        estimatedMinutes: Int? = nil,
        sortOrder: Int = 0,
        schedule: RecurrenceRule? = nil,
        lastCompletedAt: Date? = nil,
        nextDueAt: Date? = nil,
        reminderEnabled: Bool = false,
        reminderHour: Int = 9,
        reminderMinute: Int = 0,
        room: Room? = nil
    ) {
        self.id = id
        self.name = name
        self.taskNotes = notes
        self.estimatedMinutes = estimatedMinutes
        self.sortOrder = sortOrder
        self.scheduleData = schedule.flatMap { try? JSONEncoder().encode($0) }
        self.lastCompletedAt = lastCompletedAt
        self.nextDueAt = nextDueAt
        self.reminderEnabled = reminderEnabled
        self.reminderHour = reminderHour
        self.reminderMinute = reminderMinute
        self.createdAt = Date()
        self.room = room
        self.completions = []
    }

    var schedule: RecurrenceRule? {
        get { scheduleData.flatMap { try? JSONDecoder().decode(RecurrenceRule.self, from: $0) } }
        set { scheduleData = newValue.flatMap { try? JSONEncoder().encode($0) } }
    }

    var isOverdue: Bool {
        guard let nextDueAt else { return false }
        return nextDueAt < Calendar.current.startOfDay(for: Date())
    }

    var isDueToday: Bool {
        guard let nextDueAt else { return false }
        return Calendar.current.isDateInToday(nextDueAt)
    }
}
