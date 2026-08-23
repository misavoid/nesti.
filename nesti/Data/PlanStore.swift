import Foundation
import SwiftData

@MainActor
enum PlanStore {
    static func addRoom(name: String, notes: String, icon: String, to context: ModelContext) {
        let rooms = (try? context.fetch(FetchDescriptor<Room>())) ?? []
        context.insert(Room(name: name.trimmed, notes: notes.trimmed, icon: icon, sortOrder: rooms.count))
        try? context.save()
    }

    static func updateRoom(_ room: Room, name: String, notes: String, icon: String, in context: ModelContext) {
        room.name = name.trimmed
        room.roomNotes = notes.trimmed
        room.icon = icon
        try? context.save()
    }

    static func moveRooms(_ rooms: [Room], from offsets: IndexSet, to destination: Int, in context: ModelContext) {
        var reordered = rooms
        reordered.move(fromOffsets: offsets, toOffset: destination)
        for (index, room) in reordered.enumerated() { room.sortOrder = index }
        try? context.save()
    }

    static func deleteRoom(_ room: Room, from context: ModelContext) {
        for task in room.tasks { NotificationScheduler.shared.remove(for: task.id) }
        context.delete(room)
        try? context.save()
    }

    static func saveTask(
        _ task: CleaningTask?,
        name: String,
        notes: String,
        estimatedMinutes: Int?,
        room: Room,
        schedule: RecurrenceRule?,
        nextDueAt: Date,
        reminderEnabled: Bool,
        reminderHour: Int,
        reminderMinute: Int,
        in context: ModelContext
    ) {
        let model = task ?? CleaningTask(name: name, sortOrder: room.tasks.count, room: room)
        model.name = name.trimmed
        model.taskNotes = notes.trimmed
        model.estimatedMinutes = estimatedMinutes
        model.room = room
        model.schedule = schedule
        model.reminderEnabled = reminderEnabled
        model.reminderHour = reminderHour
        model.reminderMinute = reminderMinute
        model.nextDueAt = Calendar.current.startOfDay(for: nextDueAt)
        if task == nil { context.insert(model) }
        try? context.save()
        NotificationScheduler.shared.replaceReminder(for: model)
    }

    static func complete(_ task: CleaningTask, at date: Date = Date(), in context: ModelContext) {
        let scheduledFor = task.nextDueAt
        context.insert(CompletionRecord(completedAt: date, scheduledFor: scheduledFor, task: task))
        task.lastCompletedAt = date
        if let schedule = task.schedule {
            task.nextDueAt = RecurrenceCalculator.nextDueDate(
                for: schedule,
                after: date,
                lastScheduledDate: scheduledFor
            )
        } else {
            task.nextDueAt = nil
        }
        try? context.save()
        NotificationScheduler.shared.replaceReminder(for: task)
    }

    static func deleteTask(_ task: CleaningTask, from context: ModelContext) {
        NotificationScheduler.shared.remove(for: task.id)
        context.delete(task)
        try? context.save()
    }

    @discardableResult
    static func importDocument(_ document: NestiDocument, into context: ModelContext) -> Int {
        var importedTasks = 0
        let existingRooms = (try? context.fetch(FetchDescriptor<Room>())) ?? []
        for (roomOffset, record) in document.rooms.sorted(by: { $0.sortOrder < $1.sortOrder }).enumerated() {
            let room = Room(
                id: uniqueRoomID(record.id, context: context),
                name: record.name.trimmed,
                notes: record.notes ?? "",
                icon: record.icon ?? "door.left.hand.open",
                sortOrder: existingRooms.count + roomOffset
            )
            context.insert(room)
            for taskRecord in record.tasks.sorted(by: { $0.sortOrder < $1.sortOrder }) {
                let task = CleaningTask(
                    id: uniqueTaskID(taskRecord.id, context: context),
                    name: taskRecord.name.trimmed,
                    notes: taskRecord.notes ?? "",
                    estimatedMinutes: taskRecord.estimatedMinutes,
                    sortOrder: taskRecord.sortOrder,
                    schedule: taskRecord.schedule,
                    lastCompletedAt: taskRecord.lastCompletedAt,
                    nextDueAt: taskRecord.nextDueDate ?? RecurrenceCalculator.initialDueDate(for: taskRecord.schedule),
                    reminderEnabled: taskRecord.reminder?.enabled ?? false,
                    reminderHour: taskRecord.reminder?.hour ?? 9,
                    reminderMinute: taskRecord.reminder?.minute ?? 0,
                    room: room
                )
                context.insert(task)
                importedTasks += 1
            }
        }
        try? context.save()
        NotificationScheduler.shared.rebuildAll(in: context)
        return importedTasks
    }

    static func exportDocument(name: String, rooms: [Room]) -> NestiDocument {
        NestiDocument(
            name: name.trimmed.isEmpty ? "My Home" : name.trimmed,
            metadata: DocumentMetadata(generator: "nesti. 1.0"),
            rooms: rooms.sorted(by: { $0.sortOrder < $1.sortOrder }).map { room in
                RoomRecord(
                    id: room.id,
                    name: room.name,
                    sortOrder: room.sortOrder,
                    icon: room.icon,
                    notes: room.roomNotes.nilIfEmpty,
                    tasks: room.tasks.sorted(by: { $0.sortOrder < $1.sortOrder }).map { task in
                        TaskRecord(
                            id: task.id,
                            name: task.name,
                            notes: task.taskNotes.nilIfEmpty,
                            estimatedMinutes: task.estimatedMinutes,
                            sortOrder: task.sortOrder,
                            schedule: task.schedule,
                            lastCompletedAt: task.lastCompletedAt,
                            nextDueDate: task.nextDueAt,
                            reminder: ReminderRecord(enabled: task.reminderEnabled, hour: task.reminderHour, minute: task.reminderMinute)
                        )
                    }
                )
            }
        )
    }

    private static func uniqueRoomID(_ proposed: UUID, context: ModelContext) -> UUID {
        let id = proposed
        let descriptor = FetchDescriptor<Room>(predicate: #Predicate { $0.id == id })
        return ((try? context.fetchCount(descriptor)) ?? 0) == 0 ? proposed : UUID()
    }

    private static func uniqueTaskID(_ proposed: UUID, context: ModelContext) -> UUID {
        let id = proposed
        let descriptor = FetchDescriptor<CleaningTask>(predicate: #Predicate { $0.id == id })
        return ((try? context.fetchCount(descriptor)) ?? 0) == 0 ? proposed : UUID()
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
    var nilIfEmpty: String? { trimmed.isEmpty ? nil : self }
}
