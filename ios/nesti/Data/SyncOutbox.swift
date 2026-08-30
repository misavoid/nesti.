import Foundation
import SwiftData

@MainActor
enum SyncOutbox {
    static let localChangeNotification = Notification.Name("nesti.local-sync-change")

    static func ensureDefaultProfile(in context: ModelContext) {
        let profiles = (try? context.fetch(FetchDescriptor<UserProfile>())) ?? []
        guard profiles.isEmpty else { return }
        let profile = UserProfile(name: "Me")
        context.insert(profile)
        UserDefaults.standard.set(profile.id.uuidString, forKey: "activeProfileID")
        enqueue(.profile, id: profile.id, operation: .upsert, payload: payload(for: profile), in: context)
        try? context.save()
    }

    static func enqueue(
        _ type: SyncEntityType,
        id: UUID,
        operation: SyncOperation,
        payload: SyncPayload?,
        in context: ModelContext
    ) {
        guard ((try? context.fetchCount(FetchDescriptor<SyncConnectionModel>())) ?? 0) > 0 else { return }
        let key = entityKey(type, id)
        let existingDescriptor = FetchDescriptor<PendingSyncMutation>(predicate: #Predicate { $0.entityKey == key })
        let existing = try? context.fetch(existingDescriptor).first
        let revisionDescriptor = FetchDescriptor<SyncRevisionModel>(predicate: #Predicate { $0.key == key })
        let revision = try? context.fetch(revisionDescriptor).first

        if operation == .delete, existing?.baseRevision == "0" {
            if let existing { context.delete(existing) }
            return
        }
        if let existing { context.delete(existing) }
        let payloadData = payload.flatMap { try? JSONEncoder().encode($0) }
        context.insert(PendingSyncMutation(
            entityKey: key,
            entityType: type,
            entityID: id,
            operation: operation,
            baseRevision: existing?.baseRevision ?? revision?.revision ?? "0",
            payloadData: payloadData
        ))
    }

    static func enqueueHome(name: String, in context: ModelContext) {
        guard let connection = try? context.fetch(FetchDescriptor<SyncConnectionModel>()).first else { return }
        enqueue(.home, id: connection.homeID, operation: .upsert, payload: SyncPayload(name: name.trimmed), in: context)
        try? context.save()
        didSave()
    }

    static func pendingMutations(limit: Int = 500, in context: ModelContext) throws -> [PendingSyncMutation] {
        let conflicts = try context.fetch(FetchDescriptor<SyncConflictModel>())
        var blockedKeys = Set<String>()
        for conflict in conflicts {
            if conflict.reason == "missing_parent" {
                let key = conflict.key
                if let pending = try context.fetch(FetchDescriptor<PendingSyncMutation>(predicate: #Predicate { $0.entityKey == key })).first {
                    pending.id = UUID()
                    pending.baseRevision = conflict.serverRevision
                    pending.createdAt = Date()
                    context.delete(conflict)
                    continue
                }
            }
            blockedKeys.insert(conflict.key)
        }
        try context.save()

        let pending = try context.fetch(FetchDescriptor<PendingSyncMutation>())
            .filter { !blockedKeys.contains($0.entityKey) }
            .sorted { left, right in
                let leftPriority = priority(of: left)
                let rightPriority = priority(of: right)
                if leftPriority != rightPriority { return leftPriority < rightPriority }
                if left.createdAt != right.createdAt { return left.createdAt < right.createdAt }
                return left.id.uuidString < right.id.uuidString
            }
        return Array(pending.prefix(limit))
    }

    static func didSave() {
        NotificationCenter.default.post(name: localChangeNotification, object: nil)
    }

    static func payload(for room: Room) -> SyncPayload {
        SyncPayload(name: room.name, sortOrder: room.sortOrder, notes: room.roomNotes, icon: room.icon)
    }

    static func payload(for profile: UserProfile) -> SyncPayload {
        SyncPayload(name: profile.name, color: profile.colorHex, sortOrder: profile.sortOrder)
    }

    static func payload(for task: CleaningTask) -> SyncPayload {
        SyncPayload(
            name: task.name,
            sortOrder: task.sortOrder,
            notes: task.taskNotes,
            roomId: task.room?.id,
            estimatedMinutes: task.estimatedMinutes,
            schedule: task.schedule,
            lastCompletedAt: task.lastCompletedAt.map(timestamp),
            nextDueDate: task.nextDueAt.map(calendarDate),
            reminder: SyncReminder(enabled: task.reminderEnabled, hour: task.reminderHour, minute: task.reminderMinute),
            createdAt: timestamp(task.createdAt)
        )
    }

    static func payload(for completion: CompletionRecord) -> SyncPayload {
        SyncPayload(
            taskId: completion.task?.id,
            profileId: completion.profile?.id,
            completedAt: timestamp(completion.completedAt),
            scheduledFor: completion.scheduledFor.map(calendarDate)
        )
    }

    static func entityKey(_ type: SyncEntityType, _ id: UUID) -> String {
        "\(type.rawValue):\(id.uuidString.lowercased())"
    }

    static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    static func calendarDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private static func priority(of mutation: PendingSyncMutation) -> Int {
        guard let entityType = SyncEntityType(rawValue: mutation.entityTypeRaw),
              let operation = SyncOperation(rawValue: mutation.operationRaw) else { return Int.max }
        return syncMutationApplicationPriority(entityType: entityType, operation: operation)
    }
}

@MainActor
enum ProfileStore {
    static func save(_ profile: UserProfile?, name: String, colorHex: String, in context: ModelContext) {
        let profiles = (try? context.fetch(FetchDescriptor<UserProfile>())) ?? []
        let model = profile ?? UserProfile(name: name, sortOrder: profiles.count)
        model.name = name.trimmed
        model.colorHex = colorHex.lowercased()
        if profile == nil { context.insert(model) }
        SyncOutbox.enqueue(.profile, id: model.id, operation: .upsert, payload: SyncOutbox.payload(for: model), in: context)
        try? context.save()
        if UserDefaults.standard.string(forKey: "activeProfileID") == nil {
            UserDefaults.standard.set(model.id.uuidString, forKey: "activeProfileID")
        }
        SyncOutbox.didSave()
    }

    static func delete(_ profile: UserProfile, in context: ModelContext) {
        let profiles = (try? context.fetch(FetchDescriptor<UserProfile>())) ?? []
        guard profiles.count > 1 else { return }
        SyncOutbox.enqueue(.profile, id: profile.id, operation: .delete, payload: nil, in: context)
        context.delete(profile)
        if UserDefaults.standard.string(forKey: "activeProfileID") == profile.id.uuidString {
            UserDefaults.standard.set(profiles.first(where: { $0.id != profile.id })?.id.uuidString, forKey: "activeProfileID")
        }
        try? context.save()
        SyncOutbox.didSave()
    }
}
