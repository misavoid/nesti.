import SceneKit

enum TrashFactory {
    static func make(_ state: GameTrashState) -> SCNNode {
        let root = SCNNode()
        root.name = "trash-\(state.id.uuidString)"
        root.position = SCNVector3(state.x, 0.52, state.z)
        root.eulerAngles.y = state.rotation

        let materials = [SceneMaterials.bagDark, SceneMaterials.bagBlue, SceneMaterials.bagGreen, SceneMaterials.bagPurple, SceneMaterials.bagBlack]
        let variant = stableVariant(for: state)
        let material = materials[variant % materials.count]

        let body = node(SCNSphere(radius: 0.18), material)
        let scales: [SCNVector3] = [
            SCNVector3(1.08, 1.24, 0.96),
            SCNVector3(0.86, 0.98, 0.82),
            SCNVector3(1.24, 1.05, 0.90),
            SCNVector3(0.72, 0.82, 0.70),
            SCNVector3(1.0, 0.92, 1.08)
        ]
        body.scale = scales[variant % scales.count]
        body.position.y = 0.06
        root.addChildNode(body)

        let neck = node(SCNCylinder(radius: 0.075, height: 0.11), material)
        neck.position.y = 0.25
        neck.scale.x = 0.80
        root.addChildNode(neck)

        let knot = node(SCNSphere(radius: 0.06), material)
        knot.position.y = 0.33
        knot.scale = SCNVector3(1.2, 0.72, 0.86)
        root.addChildNode(knot)

        for side in [-1.0, 1.0] as [Float] {
            let tie = node(SCNCone(topRadius: 0, bottomRadius: 0.045, height: 0.16), material)
            tie.position = SCNVector3(side * 0.07, 0.32, 0)
            tie.eulerAngles.z = side * 0.85
            root.addChildNode(tie)
        }

        let cinch = node(SCNTorus(ringRadius: 0.072, pipeRadius: 0.008), SceneMaterials.cream)
        cinch.position.y = 0.245
        cinch.eulerAngles.x = .pi / 2
        root.addChildNode(cinch)

        let highlight = node(SCNSphere(radius: 0.045), SceneMaterials.white)
        highlight.position = SCNVector3(-0.07, 0.14, 0.13)
        highlight.scale = SCNVector3(1.3, 0.36, 0.24)
        root.addChildNode(highlight)

        let size = 1.15 + Float(variant % 4) * 0.16
        root.scale = SCNVector3(size, size, size)
        root.eulerAngles.x = 0.06 * Float(variant % 3 - 1)
        root.eulerAngles.z = 0.08 * (variant.isMultiple(of: 2) ? -1 : 1)
        return root
    }

    private static func stableVariant(for state: GameTrashState) -> Int {
        let seed = state.taskID.uuidString.utf8.reduce(UInt64(1_469_598_103_934_665_603)) {
            ($0 ^ UInt64($1)) &* 1_099_511_628_211
        }
        return Int(seed % UInt64(Int.max))
    }

    private static func node(_ geometry: SCNGeometry, _ material: SCNMaterial) -> SCNNode {
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }
}
