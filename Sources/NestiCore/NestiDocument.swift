import Foundation

public struct NestiDocument: Codable, Identifiable, Equatable, Sendable {
    public static let currentVersion = 1

    public var version: Int
    public var id: UUID
    public var name: String
    public var exportedAt: Date
    public var metadata: DocumentMetadata?
    public var rooms: [RoomRecord]

    private enum CodingKeys: String, CodingKey { case version, id, name, exportedAt, metadata, rooms }

    public init(
        version: Int = Self.currentVersion,
        id: UUID = UUID(),
        name: String,
        exportedAt: Date = Date(),
        metadata: DocumentMetadata? = nil,
        rooms: [RoomRecord]
    ) {
        self.version = version
        self.id = id
        self.name = name
        self.exportedAt = exportedAt
        self.metadata = metadata
        self.rooms = rooms
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        name = try container.decode(String.self, forKey: .name)
        exportedAt = try container.decodeIfPresent(Date.self, forKey: .exportedAt) ?? Date()
        metadata = try container.decodeIfPresent(DocumentMetadata.self, forKey: .metadata)
        rooms = try container.decode([RoomRecord].self, forKey: .rooms)
    }
}

public struct DocumentMetadata: Codable, Equatable, Sendable {
    public var generator: String?
    public var notes: String?

    public init(generator: String? = nil, notes: String? = nil) {
        self.generator = generator
        self.notes = notes
    }
}

public struct RoomRecord: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var sortOrder: Int
    public var icon: String?
    public var notes: String?
    public var tasks: [TaskRecord]

    private enum CodingKeys: String, CodingKey { case id, name, sortOrder, icon, notes, tasks }

    public init(id: UUID = UUID(), name: String, sortOrder: Int = 0, icon: String? = nil, notes: String? = nil, tasks: [TaskRecord] = []) {
        self.id = id
        self.name = name
        self.sortOrder = sortOrder
        self.icon = icon
        self.notes = notes
        self.tasks = tasks
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        name = try container.decode(String.self, forKey: .name)
        sortOrder = try container.decodeIfPresent(Int.self, forKey: .sortOrder) ?? 0
        icon = try container.decodeIfPresent(String.self, forKey: .icon)
        notes = try container.decodeIfPresent(String.self, forKey: .notes)
        tasks = try container.decodeIfPresent([TaskRecord].self, forKey: .tasks) ?? []
    }
}

public struct TaskRecord: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var notes: String?
    public var estimatedMinutes: Int?
    public var sortOrder: Int
    public var schedule: RecurrenceRule?
    public var lastCompletedAt: Date?
    public var nextDueAt: Date?
    public var reminder: ReminderRecord?
    public var metadata: [String: String]?

    private enum CodingKeys: String, CodingKey {
        case id, name, notes, estimatedMinutes, sortOrder, schedule, lastCompletedAt, nextDueAt, reminder, metadata
    }

    public init(
        id: UUID = UUID(),
        name: String,
        notes: String? = nil,
        estimatedMinutes: Int? = nil,
        sortOrder: Int = 0,
        schedule: RecurrenceRule? = nil,
        lastCompletedAt: Date? = nil,
        nextDueAt: Date? = nil,
        reminder: ReminderRecord? = nil,
        metadata: [String: String]? = nil
    ) {
        self.id = id
        self.name = name
        self.notes = notes
        self.estimatedMinutes = estimatedMinutes
        self.sortOrder = sortOrder
        self.schedule = schedule
        self.lastCompletedAt = lastCompletedAt
        self.nextDueAt = nextDueAt
        self.reminder = reminder
        self.metadata = metadata
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        name = try container.decode(String.self, forKey: .name)
        notes = try container.decodeIfPresent(String.self, forKey: .notes)
        estimatedMinutes = try container.decodeIfPresent(Int.self, forKey: .estimatedMinutes)
        sortOrder = try container.decodeIfPresent(Int.self, forKey: .sortOrder) ?? 0
        schedule = try container.decodeIfPresent(RecurrenceRule.self, forKey: .schedule)
        lastCompletedAt = try container.decodeIfPresent(Date.self, forKey: .lastCompletedAt)
        nextDueAt = try container.decodeIfPresent(Date.self, forKey: .nextDueAt)
        reminder = try container.decodeIfPresent(ReminderRecord.self, forKey: .reminder)
        metadata = try container.decodeIfPresent([String: String].self, forKey: .metadata)
    }
}

public struct ReminderRecord: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var hour: Int
    public var minute: Int

    private enum CodingKeys: String, CodingKey { case enabled, hour, minute }

    public init(enabled: Bool = false, hour: Int = 9, minute: Int = 0) {
        self.enabled = enabled
        self.hour = hour
        self.minute = minute
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        hour = try container.decodeIfPresent(Int.self, forKey: .hour) ?? 9
        minute = try container.decodeIfPresent(Int.self, forKey: .minute) ?? 0
    }
}
