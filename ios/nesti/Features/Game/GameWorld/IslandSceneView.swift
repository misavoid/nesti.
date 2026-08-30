import SceneKit
import SwiftUI

struct IslandSceneView: UIViewRepresentable {
    let snapshot: GameWorldSnapshot
    let isActive: Bool

    func makeCoordinator() -> GameCoordinator {
        GameCoordinator()
    }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.scene = context.coordinator.scene
        view.pointOfView = context.coordinator.scene.rootNode.childNode(withName: "game-camera", recursively: true)
        view.backgroundColor = .clear
        view.isPlaying = isActive
        view.preferredFramesPerSecond = 60
        view.antialiasingMode = .multisampling4X
        view.allowsCameraControl = false
        view.rendersContinuously = isActive
        context.coordinator.update(with: snapshot)
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        view.isPlaying = isActive
        view.rendersContinuously = isActive
        context.coordinator.update(with: snapshot)
    }

    static func dismantleUIView(_ view: SCNView, coordinator: GameCoordinator) {
        view.isPlaying = false
        view.scene = nil
    }
}
