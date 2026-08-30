import Foundation

public let nestiSyncProtocolVersion = 1

public enum SyncEntityType: String, Codable, Sendable {
    case home, profile, room, task, completion
}

public enum SyncOperation: String, Codable, Sendable {
    case upsert, delete
}

public struct SyncReminder: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var hour: Int
    public var minute: Int

    public init(enabled: Bool, hour: Int, minute: Int) {
        self.enabled = enabled
        self.hour = hour
        self.minute = minute
    }
}

public struct SyncPayload: Codable, Equatable, Sendable {
    public var name: String?
    public var color: String?
    public var sortOrder: Int?
    public var notes: String?
    public var icon: String?
    public var roomId: UUID?
    public var estimatedMinutes: Int?
    public var schedule: RecurrenceRule?
    public var lastCompletedAt: String?
    public var nextDueDate: String?
    public var reminder: SyncReminder?
    public var metadata: [String: String]?
    public var createdAt: String?
    public var taskId: UUID?
    public var profileId: UUID?
    public var completedAt: String?
    public var scheduledFor: String?

    public init(
        name: String? = nil,
        color: String? = nil,
        sortOrder: Int? = nil,
        notes: String? = nil,
        icon: String? = nil,
        roomId: UUID? = nil,
        estimatedMinutes: Int? = nil,
        schedule: RecurrenceRule? = nil,
        lastCompletedAt: String? = nil,
        nextDueDate: String? = nil,
        reminder: SyncReminder? = nil,
        metadata: [String: String]? = nil,
        createdAt: String? = nil,
        taskId: UUID? = nil,
        profileId: UUID? = nil,
        completedAt: String? = nil,
        scheduledFor: String? = nil
    ) {
        self.name = name
        self.color = color
        self.sortOrder = sortOrder
        self.notes = notes
        self.icon = icon
        self.roomId = roomId
        self.estimatedMinutes = estimatedMinutes
        self.schedule = schedule
        self.lastCompletedAt = lastCompletedAt
        self.nextDueDate = nextDueDate
        self.reminder = reminder
        self.metadata = metadata
        self.createdAt = createdAt
        self.taskId = taskId
        self.profileId = profileId
        self.completedAt = completedAt
        self.scheduledFor = scheduledFor
    }
}

public struct SyncMutation: Codable, Equatable, Sendable {
    public var id: UUID
    public var entityType: SyncEntityType
    public var entityId: UUID
    public var operation: SyncOperation
    public var baseRevision: String
    public var payload: SyncPayload?
}

public struct SyncRequest: Codable, Equatable, Sendable {
    public var protocolVersion = nestiSyncProtocolVersion
    public var cursor: String
    public var mutations: [SyncMutation]

    public init(cursor: String, mutations: [SyncMutation]) {
        self.cursor = cursor
        self.mutations = mutations
    }
}

public func syncMutationApplicationPriority(entityType: SyncEntityType, operation: SyncOperation) -> Int {
    let upsertOrder: [SyncEntityType: Int] = [.home: 0, .profile: 1, .room: 2, .task: 3, .completion: 4]
    let deleteOrder: [SyncEntityType: Int] = [.completion: 5, .task: 6, .room: 7, .profile: 8, .home: 9]
    return operation == .upsert ? upsertOrder[entityType]! : deleteOrder[entityType]!
}

public struct SyncAcknowledgement: Codable, Equatable, Sendable {
    public var mutationId: UUID
    public var entityType: SyncEntityType
    public var entityId: UUID
    public var revision: String
}

public struct SyncConflictValue: Codable, Equatable, Sendable {
    public var mutationId: UUID
    public var entityType: SyncEntityType
    public var entityId: UUID
    public var reason: String
    public var serverRevision: String
    public var serverPayload: SyncPayload?
}

public struct SyncChange: Codable, Equatable, Sendable {
    public var cursor: String
    public var entityType: SyncEntityType
    public var entityId: UUID
    public var operation: SyncOperation
    public var revision: String
    public var payload: SyncPayload?
}

public struct SyncResponse: Codable, Equatable, Sendable {
    public var protocolVersion: Int
    public var cursor: String
    public var hasMore: Bool
    public var acknowledgements: [SyncAcknowledgement]
    public var conflicts: [SyncConflictValue]
    public var changes: [SyncChange]
}

public struct SyncSnapshotRecord: Codable, Equatable, Sendable {
    public var id: UUID
    public var revision: String
    public var payload: SyncPayload
}

public struct SyncSnapshot: Codable, Equatable, Sendable {
    public var protocolVersion: Int
    public var cursor: String
    public var home: SyncSnapshotRecord
    public var profiles: [SyncSnapshotRecord]
    public var rooms: [SyncSnapshotRecord]
    public var tasks: [SyncSnapshotRecord]
    public var completions: [SyncSnapshotRecord]
}

public struct SyncDiscovery: Codable, Equatable, Sendable {
    public var name: String
    public var protocolVersions: [Int]
}

public struct SyncPairResponse: Codable, Equatable, Sendable {
    public var protocolVersion: Int
    public var deviceToken: String
    public var deviceId: UUID
    public var homeId: UUID
    public var snapshot: SyncSnapshot
}
