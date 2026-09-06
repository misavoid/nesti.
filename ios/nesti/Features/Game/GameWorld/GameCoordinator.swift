import SceneKit
import UIKit

@MainActor
final class GameCoordinator: NSObject {
    let scene: SCNScene
    private let worldRoot: SCNNode
    private let characterController: CharacterController
    private var trashNodes: [UUID: SCNNode] = [:]
    private var snapshot: GameWorldSnapshot?

    override init() {
        let scene = IslandBuilder.makeScene()
        let worldRoot = scene.rootNode.childNode(withName: IslandBuilder.worldNodeName, recursively: false) ?? scene.rootNode
        let character = CharacterFactory.make()
        worldRoot.addChildNode(character.root)
        self.scene = scene
        self.worldRoot = worldRoot
        self.characterController = CharacterController(character: character, sceneRoot: worldRoot)
        super.init()
    }

    func update(with newSnapshot: GameWorldSnapshot) {
        guard snapshot != newSnapshot else { return }
        let previousRemaining = Set(snapshot?.trash.filter { !$0.isRemoved }.map(\.taskID) ?? [])
        let currentRemaining = Set(newSnapshot.trash.filter { !$0.isRemoved }.map(\.taskID))
        let newlyCompleted = previousRemaining.subtracting(currentRemaining)
        let shouldAnimate = snapshot?.day == newSnapshot.day

        for state in newSnapshot.trash where !state.isRemoved && trashNodes[state.taskID] == nil {
            let node = TrashFactory.make(state)
            trashNodes[state.taskID] = node
            worldRoot.addChildNode(node)
        }

        let validIDs = Set(newSnapshot.trash.map(\.taskID))
        let invalidIDs = trashNodes.keys.filter { !validIDs.contains($0) }
        for taskID in invalidIDs {
            trashNodes[taskID]?.removeFromParentNode()
            trashNodes[taskID] = nil
        }

        let completedToRemove = newSnapshot.trash.filter(\.isRemoved).map(\.taskID)
        for taskID in completedToRemove {
            guard let node = trashNodes[taskID] else { continue }
            if shouldAnimate && newlyCompleted.contains(taskID) {
                let isFinal = currentRemaining.isEmpty && taskID == newlyCompleted.sorted(by: { $0.uuidString < $1.uuidString }).last
                characterController.enqueuePickup(trash: node, allClear: isFinal) { [weak self] in
                    self?.trashNodes[taskID] = nil
                }
            } else {
                node.removeFromParentNode()
                trashNodes[taskID] = nil
            }
        }
        snapshot = newSnapshot
    }

    @objc func handleWorldRotation(_ recognizer: UIPanGestureRecognizer) {
        guard let view = recognizer.view else { return }
        let buttonMask = recognizer.buttonMask
        if !buttonMask.isEmpty && !buttonMask.contains(.secondary) { return }
        let translation = recognizer.translation(in: view)
        guard translation.x != 0 else { return }
        worldRoot.eulerAngles.y += Float(translation.x) * 0.008
        characterController.updateWorldYaw(worldRoot.eulerAngles.y)
        recognizer.setTranslation(.zero, in: view)
    }
}
