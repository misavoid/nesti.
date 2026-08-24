import Foundation

enum GameTrashKind: String, Codable, CaseIterable {
    case can
    case bottle
    case paper
    case bag
    case cardboard
}

struct GameTrashState: Codable, Identifiable, Equatable {
    let id: UUID
    let taskID: UUID
    let kind: GameTrashKind
    let x: Float
    let z: Float
    let rotation: Float
    var isRemoved: Bool
}

struct GameWorldSnapshot: Equatable {
    let day: Date
    let trash: [GameTrashState]

    var remainingCount: Int { trash.filter { !$0.isRemoved }.count }
    var totalCount: Int { trash.count }
}

@MainActor
final class GameWorldState {
    private struct StoredWorld: Codable {
        let day: Date
        var trash: [GameTrashState]
    }

    private let defaults: UserDefaults
    private let storageKey = "gameWorld.dailyState.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func snapshot(taskIDs: Set<UUID>, completedTaskIDs: Set<UUID>, now: Date = Date()) -> GameWorldSnapshot {
        let calendar = Calendar.current
        let day = calendar.startOfDay(for: now)
        var stored = load().flatMap { calendar.isDate($0.day, inSameDayAs: day) ? $0 : nil }
            ?? StoredWorld(day: day, trash: [])

        stored.trash.removeAll { !taskIDs.contains($0.taskID) }
        let knownTaskIDs = Set(stored.trash.map(\.taskID))
        for taskID in taskIDs.subtracting(knownTaskIDs).sorted(by: { $0.uuidString < $1.uuidString }) {
            stored.trash.append(makeTrash(for: taskID, day: day, index: stored.trash.count))
        }
        for index in stored.trash.indices {
            stored.trash[index].isRemoved = completedTaskIDs.contains(stored.trash[index].taskID)
        }
        stored.trash.sort { $0.taskID.uuidString < $1.taskID.uuidString }
        save(stored)
        return GameWorldSnapshot(day: day, trash: stored.trash)
    }

    private func makeTrash(for taskID: UUID, day: Date, index: Int) -> GameTrashState {
        let seed = taskID.uuidString.utf8.reduce(UInt64(1_469_598_103_934_665_603)) {
            ($0 ^ UInt64($1)) &* 1_099_511_628_211
        }
        let goldenAngle = Float.pi * (3 - sqrt(5))
        let ring = min(0.82, 0.28 + sqrt(Float(index + 1)) * 0.14)
        let angle = Float(index) * goldenAngle + unit(seed, shift: 8) * 0.55
        let kinds = GameTrashKind.allCases
        return GameTrashState(
            id: taskID,
            taskID: taskID,
            kind: kinds[Int(seed % UInt64(kinds.count))],
            x: cos(angle) * ring * 2.55,
            z: sin(angle) * ring * 1.85,
            rotation: unit(seed, shift: 24) * Float.pi * 2,
            isRemoved: false
        )
    }

    private func unit(_ seed: UInt64, shift: UInt64) -> Float {
        Float((seed >> shift) & 0xffff) / Float(0xffff)
    }

    private func load() -> StoredWorld? {
        guard let data = defaults.data(forKey: storageKey) else { return nil }
        return try? JSONDecoder().decode(StoredWorld.self, from: data)
    }

    private func save(_ world: StoredWorld) {
        guard let data = try? JSONEncoder().encode(world) else { return }
        defaults.set(data, forKey: storageKey)
    }
}
