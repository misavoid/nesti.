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
        let kinds = GameTrashKind.allCases
        let position = trashPosition(for: index, seed: seed)
        return GameTrashState(
            id: taskID,
            taskID: taskID,
            kind: kinds[Int(seed % UInt64(kinds.count))],
            x: position.x,
            z: position.z,
            rotation: unit(seed, shift: 24) * Float.pi * 2,
            isRemoved: false
        )
    }

    private func trashPosition(for index: Int, seed: UInt64) -> (x: Float, z: Float) {
        let goldenAngle = Float.pi * (3 - sqrt(5))
        var accepted = -1
        for candidate in 0..<260 {
            let ring = min(0.92, 0.22 + sqrt(Float(candidate + 1)) * 0.115)
            let angle = Float(candidate) * goldenAngle + 0.3 + unit(seed, shift: 8) * 0.08
            let x = cos(angle) * ring * 2.55
            let z = sin(angle) * ring * 1.82
            guard isValidTrashPosition(x: x, z: z) else { continue }
            accepted += 1
            if accepted == index { return (x, z) }
        }
        let angle = Float(index) * goldenAngle
        return (cos(angle) * 1.95, sin(angle) * 1.35)
    }

    private func isValidTrashPosition(x: Float, z: Float) -> Bool {
        let insideHouseBuffer = x > -2.08 && x < -0.42 && z > -1.50 && z < 0.12
        let nearHelper = hypot(x - CharacterFactory.homePosition.x, z - CharacterFactory.homePosition.z) < 0.58
        let likelyHousePath = x < -0.40 && z < 0.18
        let nearPond = hypot(x - 0.65, z - 1.42) < 0.42
        return !insideHouseBuffer && !nearHelper && !likelyHousePath && !nearPond
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
