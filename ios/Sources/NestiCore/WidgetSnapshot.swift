import Foundation

public struct WidgetTaskSnapshot: Codable, Hashable, Identifiable {
    public let id: UUID
    public let name: String
    public let roomName: String?
    public let roomIcon: String?
    public let dueAt: Date
    public let estimatedMinutes: Int?

    public init(
        id: UUID,
        name: String,
        roomName: String?,
        roomIcon: String?,
        dueAt: Date,
        estimatedMinutes: Int?
    ) {
        self.id = id
        self.name = name
        self.roomName = roomName
        self.roomIcon = roomIcon
        self.dueAt = dueAt
        self.estimatedMinutes = estimatedMinutes
    }
}

public struct WidgetCompletionSnapshot: Codable, Hashable, Identifiable {
    public let id: UUID
    public let taskID: UUID
    public let completedAt: Date
    public let scheduledFor: Date?

    public init(id: UUID, taskID: UUID, completedAt: Date, scheduledFor: Date?) {
        self.id = id
        self.taskID = taskID
        self.completedAt = completedAt
        self.scheduledFor = scheduledFor
    }
}

public struct NestiWidgetSnapshot: Codable, Hashable {
    public static let appGroupIdentifier = "group.app.nesti.shared"
    public static let storageKey = "widgetSnapshot.v1"

    public let updatedAt: Date
    public let tasks: [WidgetTaskSnapshot]
    public let completions: [WidgetCompletionSnapshot]

    public init(
        updatedAt: Date = Date(),
        tasks: [WidgetTaskSnapshot],
        completions: [WidgetCompletionSnapshot]
    ) {
        self.updatedAt = updatedAt
        self.tasks = tasks
        self.completions = completions
    }

    public func tasksDueThroughToday(at date: Date, calendar: Calendar = .current) -> [WidgetTaskSnapshot] {
        let startOfTomorrow = calendar.date(
            byAdding: .day,
            value: 1,
            to: calendar.startOfDay(for: date)
        ) ?? .distantFuture
        let completedIDs = completedTaskIDs(at: date, calendar: calendar)

        return tasks
            .filter { $0.dueAt < startOfTomorrow && !completedIDs.contains($0.id) }
            .sorted {
                if $0.dueAt != $1.dueAt { return $0.dueAt < $1.dueAt }
                return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
    }

    public func completedTaskIDs(at date: Date, calendar: Calendar = .current) -> Set<UUID> {
        let startOfTomorrow = calendar.date(
            byAdding: .day,
            value: 1,
            to: calendar.startOfDay(for: date)
        ) ?? .distantFuture
        return Set<UUID>(completions.compactMap { completion in
            guard calendar.isDate(completion.completedAt, inSameDayAs: date),
                  (completion.scheduledFor ?? completion.completedAt) < startOfTomorrow else { return nil }
            return completion.taskID
        })
    }
}

public enum NestiWidgetSnapshotStore {
    public static func load(defaults: UserDefaults? = nil) -> NestiWidgetSnapshot? {
        let defaults = defaults ?? UserDefaults(suiteName: NestiWidgetSnapshot.appGroupIdentifier)
        guard let data = defaults?.data(forKey: NestiWidgetSnapshot.storageKey) else { return nil }
        return try? JSONDecoder().decode(NestiWidgetSnapshot.self, from: data)
    }

    public static func save(_ snapshot: NestiWidgetSnapshot, defaults: UserDefaults? = nil) {
        let defaults = defaults ?? UserDefaults(suiteName: NestiWidgetSnapshot.appGroupIdentifier)
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults?.set(data, forKey: NestiWidgetSnapshot.storageKey)
    }
}
