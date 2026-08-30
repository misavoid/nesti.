import Foundation
import Observation
import SwiftData
import UIKit

@MainActor
@Observable
final class SyncCoordinator {
    enum Phase: String {
        case local, connecting, syncing, synced, pending, attention, offline, error
    }

    private(set) var phase: Phase = .local
    private(set) var message = "Saved on this device"
    private(set) var pendingCount = 0
    private(set) var conflictCount = 0
    private(set) var serverName: String?
    private(set) var lastSyncedAt: Date?

    private let container: ModelContainer
    private let transport: SyncTransport
    private var observer: NSObjectProtocol?
    private var scheduledTask: Task<Void, Never>?
    private var isRunning = false

    init(container: ModelContainer, transport: SyncTransport = SyncTransport()) {
        self.container = container
        self.transport = transport
        observer = NotificationCenter.default.addObserver(forName: SyncOutbox.localChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.scheduleSync() }
        }
        refreshStatus()
    }

    var isConnected: Bool { serverName != nil }

    func refreshStatus() {
        let context = container.mainContext
        let connection = try? context.fetch(FetchDescriptor<SyncConnectionModel>()).first
        pendingCount = (try? context.fetchCount(FetchDescriptor<PendingSyncMutation>())) ?? 0
        conflictCount = (try? context.fetchCount(FetchDescriptor<SyncConflictModel>())) ?? 0
        serverName = connection?.serverName
        lastSyncedAt = connection?.lastSyncedAt
        if connection == nil {
            phase = .local
            message = "Saved on this device"
        } else if conflictCount > 0 {
            phase = .attention
            message = "\(conflictCount) sync conflict\(conflictCount == 1 ? "" : "s")"
        } else if pendingCount > 0 {
            phase = .pending
            message = "\(pendingCount) change\(pendingCount == 1 ? "" : "s") waiting for server"
        } else {
            phase = .synced
            message = "Saved to PostgreSQL on \(connection?.serverName ?? "server")"
        }
    }

    func connect(serverAddress: String, replaceLocal: Bool = false) async throws {
        phase = .connecting
        message = "Connecting to server"
        let serverURL = try validatedServerURL(serverAddress)
        let discovery = try await transport.discovery(serverURL: serverURL)
        guard discovery.protocolVersions.contains(nestiSyncProtocolVersion) else {
            throw SyncError.unsupportedProtocol
        }
        let homeName = UserDefaults.standard.string(forKey: "homeName") ?? "My Home"
        let paired = try await transport.enroll(serverURL: serverURL, homeName: homeName, deviceName: UIDevice.current.name)
        let context = container.mainContext
        let localRooms = (try? context.fetch(FetchDescriptor<Room>())) ?? []
        let localHasData = !localRooms.isEmpty
        let remoteHasData = !paired.snapshot.rooms.isEmpty || !paired.snapshot.tasks.isEmpty || !paired.snapshot.completions.isEmpty
        guard replaceLocal || !(localHasData && remoteHasData) else {
            try? await transport.revoke(serverURL: serverURL, token: paired.deviceToken)
            throw SyncError.bothHomesContainData
        }

        try SyncCredentialsStore.save(token: paired.deviceToken, serverURL: serverURL.absoluteString, homeID: paired.homeId)
        do {
            for model in (try? context.fetch(FetchDescriptor<SyncConnectionModel>())) ?? [] { context.delete(model) }
            for model in (try? context.fetch(FetchDescriptor<PendingSyncMutation>())) ?? [] { context.delete(model) }
            for model in (try? context.fetch(FetchDescriptor<SyncRevisionModel>())) ?? [] { context.delete(model) }
            for model in (try? context.fetch(FetchDescriptor<SyncConflictModel>())) ?? [] { context.delete(model) }
            let connection = SyncConnectionModel(
                serverURL: serverURL.absoluteString,
                serverName: discovery.name,
                homeID: paired.homeId,
                deviceID: paired.deviceId,
                cursor: paired.snapshot.cursor
            )
            context.insert(connection)
            setRevision(type: .home, id: paired.homeId, revision: paired.snapshot.home.revision, in: context)
            for record in paired.snapshot.profiles { setRevision(type: .profile, id: record.id, revision: record.revision, in: context) }
            for record in paired.snapshot.rooms { setRevision(type: .room, id: record.id, revision: record.revision, in: context) }
            for record in paired.snapshot.tasks { setRevision(type: .task, id: record.id, revision: record.revision, in: context) }
            for record in paired.snapshot.completions { setRevision(type: .completion, id: record.id, revision: record.revision, in: context) }

            if localHasData && !remoteHasData {
                SyncOutbox.enqueue(.home, id: paired.homeId, operation: .upsert, payload: SyncPayload(name: homeName), in: context)
                for profile in (try? context.fetch(FetchDescriptor<UserProfile>())) ?? [] {
                    SyncOutbox.enqueue(.profile, id: profile.id, operation: .upsert, payload: SyncOutbox.payload(for: profile), in: context)
                }
                for room in localRooms {
                    SyncOutbox.enqueue(.room, id: room.id, operation: .upsert, payload: SyncOutbox.payload(for: room), in: context)
                    for task in room.tasks {
                        SyncOutbox.enqueue(.task, id: task.id, operation: .upsert, payload: SyncOutbox.payload(for: task), in: context)
                        for completion in task.completions {
                            SyncOutbox.enqueue(.completion, id: completion.id, operation: .upsert, payload: SyncOutbox.payload(for: completion), in: context)
                        }
                    }
                }
            } else {
                try install(snapshot: paired.snapshot, in: context)
            }
            SyncOutbox.ensureDefaultProfile(in: context)
            try context.save()
        } catch {
            context.rollback()
            SyncCredentialsStore.delete(serverURL: serverURL.absoluteString, homeID: paired.homeId)
            throw error
        }
        refreshStatus()
        try await syncNow()
    }

    func syncNow() async throws {
        guard !isRunning else { return }
        let context = container.mainContext
        guard let connection = try context.fetch(FetchDescriptor<SyncConnectionModel>()).first else {
            refreshStatus()
            return
        }
        isRunning = true
        phase = .syncing
        message = "Saving to PostgreSQL"
        defer { isRunning = false }
        do {
            let serverURL = try validatedServerURL(connection.serverURL)
            let token = try SyncCredentialsStore.token(serverURL: connection.serverURL, homeID: connection.homeID)
            var hasMore = true
            var passes = 0
            while hasMore, passes < 50 {
                try resolveStoredConflicts(in: context)
                let pending = try SyncOutbox.pendingMutations(in: context)
                let mutations = pending.compactMap(syncMutation)
                let response = try await transport.sync(serverURL: serverURL, token: token, request: SyncRequest(cursor: connection.cursor, mutations: mutations))
                try apply(response: response, connection: connection, in: context)
                hasMore = response.hasMore || pending.count == 500 || !response.conflicts.isEmpty
                passes += 1
            }
            NotificationScheduler.shared.rebuildAll(in: context)
            refreshStatus()
        } catch {
            phase = .error
            message = error.localizedDescription
            throw error
        }
    }

    func disconnect() async {
        let context = container.mainContext
        guard let connection = try? context.fetch(FetchDescriptor<SyncConnectionModel>()).first else { return }
        if let serverURL = URL(string: connection.serverURL), let token = try? SyncCredentialsStore.token(serverURL: connection.serverURL, homeID: connection.homeID) {
            try? await transport.revoke(serverURL: serverURL, token: token)
        }
        SyncCredentialsStore.delete(serverURL: connection.serverURL, homeID: connection.homeID)
        for model in (try? context.fetch(FetchDescriptor<SyncConnectionModel>())) ?? [] { context.delete(model) }
        for model in (try? context.fetch(FetchDescriptor<PendingSyncMutation>())) ?? [] { context.delete(model) }
        for model in (try? context.fetch(FetchDescriptor<SyncRevisionModel>())) ?? [] { context.delete(model) }
        for model in (try? context.fetch(FetchDescriptor<SyncConflictModel>())) ?? [] { context.delete(model) }
        try? context.save()
        refreshStatus()
    }

    func resolve(_ conflict: SyncConflictModel, keepLocal: Bool) async {
        let context = container.mainContext
        let key = conflict.key
        let pending = try? context.fetch(FetchDescriptor<PendingSyncMutation>(predicate: #Predicate { $0.entityKey == key })).first
        if keepLocal, conflict.reason != "deleted", let pending {
            pending.id = UUID()
            pending.baseRevision = conflict.serverRevision
            pending.createdAt = Date()
        } else {
            if let pending { context.delete(pending) }
            let type = SyncEntityType(rawValue: conflict.entityTypeRaw)
            let payload = conflict.serverPayloadData.flatMap { try? JSONDecoder().decode(SyncPayload.self, from: $0) }
            if let type {
                try? apply(change: SyncChange(
                    cursor: conflict.serverRevision,
                    entityType: type,
                    entityId: conflict.entityID,
                    operation: payload == nil ? .delete : .upsert,
                    revision: conflict.serverRevision,
                    payload: payload
                ), in: context)
            }
        }
        context.delete(conflict)
        try? context.save()
        refreshStatus()
        try? await syncNow()
    }

    func scheduleSync() {
        refreshStatus()
        scheduledTask?.cancel()
        scheduledTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            try? await self?.syncNow()
        }
    }

    private func syncMutation(_ model: PendingSyncMutation) -> SyncMutation? {
        guard let entityType = SyncEntityType(rawValue: model.entityTypeRaw),
              let operation = SyncOperation(rawValue: model.operationRaw) else { return nil }
        let payload = model.payloadData.flatMap { try? JSONDecoder().decode(SyncPayload.self, from: $0) }
        return SyncMutation(id: model.id, entityType: entityType, entityId: model.entityID, operation: operation, baseRevision: model.baseRevision, payload: payload)
    }

    private func apply(response: SyncResponse, connection: SyncConnectionModel, in context: ModelContext) throws {
        var blockedKeys = Set(try context.fetch(FetchDescriptor<SyncConflictModel>()).map(\.key))
        blockedKeys.formUnion(response.conflicts.map { SyncOutbox.entityKey($0.entityType, $0.entityId) })
        for acknowledgement in response.acknowledgements {
            let mutationID = acknowledgement.mutationId
            if let pending = try context.fetch(FetchDescriptor<PendingSyncMutation>(predicate: #Predicate { $0.id == mutationID })).first {
                context.delete(pending)
            }
            setRevision(type: acknowledgement.entityType, id: acknowledgement.entityId, revision: acknowledgement.revision, in: context)
        }
        for value in response.conflicts {
            let key = SyncOutbox.entityKey(value.entityType, value.entityId)
            if let existing = try context.fetch(FetchDescriptor<SyncConflictModel>(predicate: #Predicate { $0.key == key })).first { context.delete(existing) }
            let mutationID = value.mutationId
            if (value.reason == "missing_parent" || value.reason == "deleted"),
               let pending = try context.fetch(FetchDescriptor<PendingSyncMutation>(predicate: #Predicate { $0.id == mutationID })).first {
                pending.id = UUID()
                pending.baseRevision = value.serverRevision
                pending.createdAt = Date()
                blockedKeys.remove(key)
                continue
            }
            if let pending = try context.fetch(FetchDescriptor<PendingSyncMutation>(predicate: #Predicate { $0.id == mutationID })).first { context.delete(pending) }
            try apply(change: SyncChange(
                cursor: value.serverRevision,
                entityType: value.entityType,
                entityId: value.entityId,
                operation: value.serverPayload == nil ? .delete : .upsert,
                revision: value.serverRevision,
                payload: value.serverPayload
            ), in: context)
            blockedKeys.remove(key)
        }
        for change in response.changes where !blockedKeys.contains(SyncOutbox.entityKey(change.entityType, change.entityId)) {
            try apply(change: change, in: context)
        }
        connection.cursor = response.cursor
        connection.lastSyncedAt = Date()
        try context.save()
    }

    private func resolveStoredConflicts(in context: ModelContext) throws {
        for conflict in try context.fetch(FetchDescriptor<SyncConflictModel>()) where conflict.reason != "missing_parent" && conflict.reason != "deleted" {
            let key = conflict.key
            if let pending = try context.fetch(FetchDescriptor<PendingSyncMutation>(predicate: #Predicate { $0.entityKey == key })).first {
                context.delete(pending)
            }
            let type = SyncEntityType(rawValue: conflict.entityTypeRaw)
            let payload = conflict.serverPayloadData.flatMap { try? JSONDecoder().decode(SyncPayload.self, from: $0) }
            if let type {
                try apply(change: SyncChange(
                    cursor: conflict.serverRevision,
                    entityType: type,
                    entityId: conflict.entityID,
                    operation: payload == nil ? .delete : .upsert,
                    revision: conflict.serverRevision,
                    payload: payload
                ), in: context)
            }
            context.delete(conflict)
        }
        try context.save()
    }

    private func install(snapshot: SyncSnapshot, in context: ModelContext) throws {
        try validate(snapshot: snapshot)
        UserDefaults.standard.set(snapshot.home.payload.name ?? "My Home", forKey: "homeName")
        setRevision(type: .home, id: snapshot.home.id, revision: snapshot.home.revision, in: context)
        for record in snapshot.profiles { try applySnapshot(record, type: .profile, in: context) }
        for record in snapshot.rooms { try applySnapshot(record, type: .room, in: context) }
        for record in snapshot.tasks { try applySnapshot(record, type: .task, in: context) }
        for record in snapshot.completions { try applySnapshot(record, type: .completion, in: context) }

        let remoteCompletionIDs = Set(snapshot.completions.map(\.id))
        let remoteTaskIDs = Set(snapshot.tasks.map(\.id))
        let remoteRoomIDs = Set(snapshot.rooms.map(\.id))
        let remoteProfileIDs = Set(snapshot.profiles.map(\.id))
        for completion in try context.fetch(FetchDescriptor<CompletionRecord>()) where !remoteCompletionIDs.contains(completion.id) { context.delete(completion) }
        for task in try context.fetch(FetchDescriptor<CleaningTask>()) where !remoteTaskIDs.contains(task.id) { context.delete(task) }
        for room in try context.fetch(FetchDescriptor<Room>()) where !remoteRoomIDs.contains(room.id) { context.delete(room) }
        for profile in try context.fetch(FetchDescriptor<UserProfile>()) where !remoteProfileIDs.contains(profile.id) { context.delete(profile) }
        if let first = snapshot.profiles.first { UserDefaults.standard.set(first.id.uuidString, forKey: "activeProfileID") }
    }

    private func validate(snapshot: SyncSnapshot) throws {
        let profileIDs = Set(snapshot.profiles.map(\.id))
        let roomIDs = Set(snapshot.rooms.map(\.id))
        let taskIDs = Set(snapshot.tasks.map(\.id))
        guard profileIDs.count == snapshot.profiles.count,
              roomIDs.count == snapshot.rooms.count,
              taskIDs.count == snapshot.tasks.count,
              Set(snapshot.completions.map(\.id)).count == snapshot.completions.count else {
            throw SyncError.malformedPayload
        }
        for task in snapshot.tasks {
            guard let roomID = task.payload.roomId, roomIDs.contains(roomID) else { throw SyncError.malformedPayload }
        }
        for completion in snapshot.completions {
            guard let taskID = completion.payload.taskId, taskIDs.contains(taskID) else { throw SyncError.malformedPayload }
            if let profileID = completion.payload.profileId, !profileIDs.contains(profileID) { throw SyncError.malformedPayload }
        }
    }

    private func applySnapshot(_ record: SyncSnapshotRecord, type: SyncEntityType, in context: ModelContext) throws {
        try apply(change: SyncChange(cursor: record.revision, entityType: type, entityId: record.id, operation: .upsert, revision: record.revision, payload: record.payload), in: context)
    }

    private func apply(change: SyncChange, in context: ModelContext) throws {
        setRevision(type: change.entityType, id: change.entityId, revision: change.revision, in: context)
        if change.entityType == .home {
            if let name = change.payload?.name { UserDefaults.standard.set(name, forKey: "homeName") }
            return
        }
        if change.operation == .delete {
            try deleteEntity(type: change.entityType, id: change.entityId, in: context)
            return
        }
        guard let payload = change.payload else { throw SyncError.malformedPayload }
        switch change.entityType {
        case .profile:
            let id = change.entityId
            let profile = try context.fetch(FetchDescriptor<UserProfile>(predicate: #Predicate { $0.id == id })).first ?? UserProfile(id: id, name: payload.name ?? "Profile")
            profile.name = payload.name ?? profile.name
            profile.colorHex = payload.color ?? profile.colorHex
            profile.sortOrder = payload.sortOrder ?? profile.sortOrder
            if profile.modelContext == nil { context.insert(profile) }
        case .room:
            let id = change.entityId
            let room = try context.fetch(FetchDescriptor<Room>(predicate: #Predicate { $0.id == id })).first ?? Room(id: id, name: payload.name ?? "Room")
            room.name = payload.name ?? room.name
            room.roomNotes = payload.notes ?? ""
            room.icon = payload.icon ?? "door.left.hand.open"
            room.sortOrder = payload.sortOrder ?? 0
            if room.modelContext == nil { context.insert(room) }
        case .task:
            guard let roomID = payload.roomId,
                  let room = try context.fetch(FetchDescriptor<Room>(predicate: #Predicate { $0.id == roomID })).first else { throw SyncError.malformedPayload }
            let id = change.entityId
            let task = try context.fetch(FetchDescriptor<CleaningTask>(predicate: #Predicate { $0.id == id })).first ?? CleaningTask(id: id, name: payload.name ?? "Task")
            task.name = payload.name ?? task.name
            task.taskNotes = payload.notes ?? ""
            task.estimatedMinutes = payload.estimatedMinutes
            task.sortOrder = payload.sortOrder ?? 0
            task.schedule = payload.schedule
            task.lastCompletedAt = payload.lastCompletedAt.flatMap(parseDate)
            task.nextDueAt = payload.nextDueDate.flatMap(parseDate)
            task.reminderEnabled = payload.reminder?.enabled ?? false
            task.reminderHour = payload.reminder?.hour ?? 9
            task.reminderMinute = payload.reminder?.minute ?? 0
            task.createdAt = payload.createdAt.flatMap(parseDate) ?? task.createdAt
            task.room = room
            if task.modelContext == nil { context.insert(task) }
        case .completion:
            guard let taskID = payload.taskId,
                  let completedAt = payload.completedAt.flatMap(parseDate),
                  let task = try context.fetch(FetchDescriptor<CleaningTask>(predicate: #Predicate { $0.id == taskID })).first else { throw SyncError.malformedPayload }
            let id = change.entityId
            let completion = try context.fetch(FetchDescriptor<CompletionRecord>(predicate: #Predicate { $0.id == id })).first ?? CompletionRecord(id: id)
            completion.completedAt = completedAt
            completion.scheduledFor = payload.scheduledFor.flatMap(parseDate)
            completion.task = task
            if let profileID = payload.profileId {
                completion.profile = try context.fetch(FetchDescriptor<UserProfile>(predicate: #Predicate { $0.id == profileID })).first
            } else {
                completion.profile = nil
            }
            if completion.modelContext == nil { context.insert(completion) }
        case .home: break
        }
    }

    private func deleteEntity(type: SyncEntityType, id: UUID, in context: ModelContext) throws {
        switch type {
        case .profile:
            if let value = try context.fetch(FetchDescriptor<UserProfile>(predicate: #Predicate { $0.id == id })).first { context.delete(value) }
        case .room:
            if let value = try context.fetch(FetchDescriptor<Room>(predicate: #Predicate { $0.id == id })).first { context.delete(value) }
        case .task:
            if let value = try context.fetch(FetchDescriptor<CleaningTask>(predicate: #Predicate { $0.id == id })).first { context.delete(value) }
        case .completion:
            if let value = try context.fetch(FetchDescriptor<CompletionRecord>(predicate: #Predicate { $0.id == id })).first { context.delete(value) }
        case .home: break
        }
    }

    private func setRevision(type: SyncEntityType, id: UUID, revision: String, in context: ModelContext) {
        let key = SyncOutbox.entityKey(type, id)
        if let existing = try? context.fetch(FetchDescriptor<SyncRevisionModel>(predicate: #Predicate { $0.key == key })).first {
            existing.revision = revision
        } else {
            context.insert(SyncRevisionModel(key: key, revision: revision))
        }
    }

    private func parseDate(_ value: String) -> Date? {
        let internet = ISO8601DateFormatter()
        internet.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = internet.date(from: value) { return date }
        internet.formatOptions = [.withInternetDateTime]
        if let date = internet.date(from: value) { return date }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: value)
    }

    private func validatedServerURL(_ value: String) throws -> URL {
        guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)), let scheme = url.scheme?.lowercased(), url.host != nil else {
            throw SyncError.invalidServerURL
        }
        #if DEBUG
        guard scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1"].contains(url.host!)) else { throw SyncError.invalidServerURL }
        #else
        guard scheme == "https" else { throw SyncError.invalidServerURL }
        #endif
        return url
    }

    enum SyncError: LocalizedError {
        case invalidServerURL, unsupportedProtocol, bothHomesContainData, malformedPayload
        var errorDescription: String? {
            switch self {
            case .invalidServerURL: "Enter a valid HTTPS nesti. server URL."
            case .unsupportedProtocol: "This server does not support this version of nesti. sync."
            case .bothHomesContainData: "This device and the server both contain a plan. Export this device first, then reconnect and choose to replace local data."
            case .malformedPayload: "The server returned an invalid sync record."
            }
        }
    }
}
