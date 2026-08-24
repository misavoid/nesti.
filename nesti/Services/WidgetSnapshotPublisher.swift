import Foundation
import SceneKit
import UIKit
import WidgetKit

@MainActor
enum WidgetSnapshotPublisher {
    static func publish(tasks: [CleaningTask], completions: [CompletionRecord], now: Date = Date()) {
        let taskSnapshots = tasks.compactMap { task -> WidgetTaskSnapshot? in
            guard let dueAt = task.nextDueAt else { return nil }
            return WidgetTaskSnapshot(
                id: task.id,
                name: task.name,
                roomName: task.room?.name,
                roomIcon: task.room?.icon,
                dueAt: dueAt,
                estimatedMinutes: task.estimatedMinutes
            )
        }

        let cutoff = Calendar.current.date(byAdding: .day, value: -7, to: now) ?? .distantPast
        let completionSnapshots = completions.compactMap { completion -> WidgetCompletionSnapshot? in
            guard completion.completedAt >= cutoff, let taskID = completion.task?.id else { return nil }
            return WidgetCompletionSnapshot(
                id: completion.id,
                taskID: taskID,
                completedAt: completion.completedAt,
                scheduledFor: completion.scheduledFor
            )
        }

        let snapshot = NestiWidgetSnapshot(
            updatedAt: now,
            tasks: taskSnapshots,
            completions: completionSnapshots
        )
        NestiWidgetSnapshotStore.save(snapshot)
        renderGameImage(for: snapshot, now: now)
        WidgetCenter.shared.reloadAllTimelines()
    }

    private static func renderGameImage(for snapshot: NestiWidgetSnapshot, now: Date) {
        let completedIDs = snapshot.completedTaskIDs(at: now)
        let pendingIDs = Set(snapshot.tasksDueThroughToday(at: now).map(\.id))
        let world = GameWorldState().snapshot(
            taskIDs: pendingIDs.union(completedIDs),
            completedTaskIDs: completedIDs,
            now: now
        )
        guard let image = WidgetGameSnapshotRenderer.render(world),
              let data = image.pngData(),
              let containerURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: NestiWidgetSnapshot.appGroupIdentifier
              ) else { return }
        try? data.write(
            to: containerURL.appendingPathComponent(NestiWidgetSnapshot.gameImageFilename),
            options: .atomic
        )
    }
}

@MainActor
private enum WidgetGameSnapshotRenderer {
    static func render(_ snapshot: GameWorldSnapshot) -> UIImage? {
        let scene = IslandBuilder.makeScene()
        scene.rootNode.addChildNode(CharacterFactory.make().root)
        for trash in snapshot.trash where !trash.isRemoved {
            scene.rootNode.addChildNode(TrashFactory.make(trash))
        }

        let renderer = SCNRenderer(device: nil)
        renderer.scene = scene
        renderer.pointOfView = scene.rootNode.childNode(withName: "game-camera", recursively: true)
        return renderer.snapshot(
            atTime: 0,
            with: CGSize(width: 720, height: 420),
            antialiasingMode: .multisampling4X
        )
    }
}
