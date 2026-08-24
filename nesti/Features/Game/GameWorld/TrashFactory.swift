import SceneKit

enum TrashFactory {
    static func make(_ state: GameTrashState) -> SCNNode {
        let root = SCNNode()
        root.name = "trash-\(state.id.uuidString)"
        root.position = SCNVector3(state.x, 0.52, state.z)
        root.eulerAngles.y = state.rotation

        switch state.kind {
        case .can:
            let can = node(SCNCylinder(radius: 0.10, height: 0.28), SceneMaterials.silver)
            can.eulerAngles.z = 0.22
            root.addChildNode(can)
            let stripe = node(SCNCylinder(radius: 0.102, height: 0.075), SceneMaterials.coral)
            stripe.eulerAngles.z = 0.22
            root.addChildNode(stripe)
        case .bottle:
            let body = node(SCNCapsule(capRadius: 0.075, height: 0.31), SceneMaterials.blue)
            body.eulerAngles.z = .pi / 2.5
            root.addChildNode(body)
            let cap = node(SCNCylinder(radius: 0.045, height: 0.07), SceneMaterials.white)
            cap.position = SCNVector3(-0.12, 0.10, 0)
            cap.eulerAngles.z = .pi / 2.5
            root.addChildNode(cap)
        case .paper:
            let paper = SCNBox(width: 0.30, height: 0.018, length: 0.22, chamferRadius: 0.025)
            let paperNode = node(paper, SceneMaterials.paper)
            paperNode.eulerAngles = SCNVector3(0.05, 0.2, 0.09)
            root.addChildNode(paperNode)
        case .bag:
            let bag = node(SCNSphere(radius: 0.16), SceneMaterials.bag)
            bag.scale = SCNVector3(0.85, 1.05, 0.78)
            root.addChildNode(bag)
            let knot = node(SCNCone(topRadius: 0, bottomRadius: 0.065, height: 0.10), SceneMaterials.bag)
            knot.position.y = 0.17
            root.addChildNode(knot)
        case .cardboard:
            let box = node(SCNBox(width: 0.27, height: 0.14, length: 0.22, chamferRadius: 0.018), SceneMaterials.wood)
            box.eulerAngles.z = -0.12
            root.addChildNode(box)
        }
        root.scale = SCNVector3(1.7, 1.7, 1.7)
        return root
    }

    private static func node(_ geometry: SCNGeometry, _ material: SCNMaterial) -> SCNNode {
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }
}
