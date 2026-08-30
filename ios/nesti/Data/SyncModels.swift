import Foundation
import SwiftData

@Model
final class SyncConnectionModel {
    @Attribute(.unique) var key: String
    var serverURL: String
    var serverName: String
    var homeID: UUID
    var deviceID: UUID
    var cursor: String
    var lastSyncedAt: Date?

    init(serverURL: String, serverName: String, homeID: UUID, deviceID: UUID, cursor: String) {
        self.key = "connection"
        self.serverURL = serverURL
        self.serverName = serverName
        self.homeID = homeID
        self.deviceID = deviceID
        self.cursor = cursor
    }
}

@Model
final class PendingSyncMutation {
    @Attribute(.unique) var id: UUID
    var entityKey: String
    var entityTypeRaw: String
    var entityID: UUID
    var operationRaw: String
    var baseRevision: String
    var payloadData: Data?
    var createdAt: Date

    init(id: UUID = UUID(), entityKey: String, entityType: SyncEntityType, entityID: UUID, operation: SyncOperation, baseRevision: String, payloadData: Data?) {
        self.id = id
        self.entityKey = entityKey
        self.entityTypeRaw = entityType.rawValue
        self.entityID = entityID
        self.operationRaw = operation.rawValue
        self.baseRevision = baseRevision
        self.payloadData = payloadData
        self.createdAt = Date()
    }
}

@Model
final class SyncRevisionModel {
    @Attribute(.unique) var key: String
    var revision: String

    init(key: String, revision: String) {
        self.key = key
        self.revision = revision
    }
}

@Model
final class SyncConflictModel {
    @Attribute(.unique) var key: String
    var mutationID: UUID
    var entityTypeRaw: String
    var entityID: UUID
    var reason: String
    var serverRevision: String
    var serverPayloadData: Data?

    init(value: SyncConflictValue) {
        self.key = "\(value.entityType.rawValue):\(value.entityId.uuidString.lowercased())"
        self.mutationID = value.mutationId
        self.entityTypeRaw = value.entityType.rawValue
        self.entityID = value.entityId
        self.reason = value.reason
        self.serverRevision = value.serverRevision
        self.serverPayloadData = value.serverPayload.flatMap { try? JSONEncoder().encode($0) }
    }
}
