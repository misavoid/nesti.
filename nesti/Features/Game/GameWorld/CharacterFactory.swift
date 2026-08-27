import SceneKit

struct GameCharacter {
    let root: SCNNode
    let body: SCNNode
    let head: SCNNode
    let leftArm: SCNNode
    let rightArm: SCNNode
    let leftLeg: SCNNode
    let rightLeg: SCNNode
}

enum CharacterFactory {
    static func make() -> GameCharacter {
        let root = SCNNode()
        root.name = "nesti-helper"
        root.position = SCNVector3(0.55, 0.45, 0.45)

        let body = node(SCNCapsule(capRadius: 0.25, height: 0.72), SceneMaterials.mint)
        body.position.y = 0.58
        root.addChildNode(body)

        let head = node(SCNSphere(radius: 0.32), SceneMaterials.cream)
        head.position.y = 1.05
        root.addChildNode(head)

        for x in [-0.12, 0.12] as [Float] {
            let eye = node(SCNSphere(radius: 0.036), SceneMaterials.navy)
            eye.position = SCNVector3(x, 1.10, 0.29)
            root.addChildNode(eye)
        }

        let smile = SCNTorus(ringRadius: 0.075, pipeRadius: 0.012)
        smile.ringSegmentCount = 18
        smile.pipeSegmentCount = 6
        smile.materials = [SceneMaterials.navy]
        let smileNode = SCNNode(geometry: smile)
        smileNode.position = SCNVector3(0, 1.00, 0.30)
        smileNode.scale.y = 0.52
        smileNode.eulerAngles.z = .pi
        root.addChildNode(smileNode)

        let leftArm = limb(at: SCNVector3(-0.31, 0.66, 0), material: SceneMaterials.mintDark)
        let rightArm = limb(at: SCNVector3(0.31, 0.66, 0), material: SceneMaterials.mintDark)
        root.addChildNode(leftArm)
        root.addChildNode(rightArm)

        let leftLeg = limb(at: SCNVector3(-0.13, 0.25, 0), material: SceneMaterials.mintDark, height: 0.34)
        let rightLeg = limb(at: SCNVector3(0.13, 0.25, 0), material: SceneMaterials.mintDark, height: 0.34)
        root.addChildNode(leftLeg)
        root.addChildNode(rightLeg)

        let stem = node(SCNCylinder(radius: 0.025, height: 0.20), SceneMaterials.mintDark)
        stem.position = SCNVector3(0, 1.39, 0)
        stem.eulerAngles.z = -0.20
        root.addChildNode(stem)
        let leaf = node(SCNSphere(radius: 0.09), SceneMaterials.grassDark)
        leaf.position = SCNVector3(0.08, 1.49, 0)
        leaf.scale = SCNVector3(1.35, 0.48, 0.75)
        leaf.eulerAngles.z = -0.35
        root.addChildNode(leaf)

        return GameCharacter(root: root, body: body, head: head, leftArm: leftArm, rightArm: rightArm, leftLeg: leftLeg, rightLeg: rightLeg)
    }

    private static func limb(at position: SCNVector3, material: SCNMaterial, height: CGFloat = 0.38) -> SCNNode {
        let limb = node(SCNCapsule(capRadius: 0.055, height: height), material)
        limb.position = position
        return limb
    }

    private static func node(_ geometry: SCNGeometry, _ material: SCNMaterial) -> SCNNode {
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }
}
