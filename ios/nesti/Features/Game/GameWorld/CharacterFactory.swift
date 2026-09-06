import SceneKit

struct GameCharacter {
    let root: SCNNode
    let body: SCNNode
    let head: SCNNode
    let leftArm: SCNNode
    let rightArm: SCNNode
    let leftLeg: SCNNode
    let rightLeg: SCNNode
    let idleYaw: Float
}

enum CharacterFactory {
    static let homePosition = SCNVector3(0.55, 0.45, 0.45)
    private static let cameraPosition = SCNVector3(6.55, 6.25, 7.75)

    static func make() -> GameCharacter {
        let root = SCNNode()
        root.name = "nesti-helper"
        root.position = homePosition
        let idleYaw = atan2(cameraPosition.x - homePosition.x, cameraPosition.z - homePosition.z)
        root.eulerAngles.y = idleYaw

        let body = node(SCNCapsule(capRadius: 0.21, height: 0.58), SceneMaterials.mint)
        body.position.y = 0.58
        body.scale = SCNVector3(1.0, 1.05, 0.82)
        root.addChildNode(body)

        let shirt = node(SCNCapsule(capRadius: 0.23, height: 0.38), SceneMaterials.cream)
        shirt.position.y = 0.74
        shirt.scale = SCNVector3(1.02, 0.72, 0.84)
        root.addChildNode(shirt)

        for x in [-0.10, 0.10] as [Float] {
            let strap = node(SCNBox(width: 0.055, height: 0.32, length: 0.035, chamferRadius: 0.012), SceneMaterials.roofDark)
            strap.position = SCNVector3(x, 0.73, 0.18)
            strap.eulerAngles.z = -x * 0.55
            root.addChildNode(strap)
        }

        let head = node(SCNSphere(radius: 0.34), SceneMaterials.skin)
        head.position.y = 1.08
        head.scale = SCNVector3(1.04, 1.0, 0.96)
        root.addChildNode(head)

        addHair(to: root)
        addFace(to: root)
        addLimbs(to: root)

        root.scale = SCNVector3(1.05, 1.05, 1.05)
        return GameCharacter(
            root: root,
            body: body,
            head: head,
            leftArm: root.childNode(withName: "left-arm", recursively: false) ?? SCNNode(),
            rightArm: root.childNode(withName: "right-arm", recursively: false) ?? SCNNode(),
            leftLeg: root.childNode(withName: "left-leg", recursively: false) ?? SCNNode(),
            rightLeg: root.childNode(withName: "right-leg", recursively: false) ?? SCNNode(),
            idleYaw: idleYaw
        )
    }

    private static func addHair(to root: SCNNode) {
        let cap = node(SCNSphere(radius: 0.36), SceneMaterials.wood)
        cap.position = SCNVector3(0, 1.19, -0.01)
        cap.scale = SCNVector3(1.05, 0.64, 1.0)
        root.addChildNode(cap)

        let fringeBand = node(SCNSphere(radius: 0.28), SceneMaterials.wood)
        fringeBand.position = SCNVector3(0, 1.12, 0.20)
        fringeBand.scale = SCNVector3(1.15, 0.34, 0.42)
        root.addChildNode(fringeBand)

        let back = node(SCNSphere(radius: 0.32), SceneMaterials.wood)
        back.position = SCNVector3(0, 1.04, -0.18)
        back.scale = SCNVector3(1.04, 0.82, 0.66)
        root.addChildNode(back)

        for (x, z, scale) in [(-0.18, 0.10, 0.82), (0, 0.14, 1.0), (0.18, 0.10, 0.82)] as [(Float, Float, Float)] {
            let lock = node(SCNSphere(radius: 0.09), SceneMaterials.wood)
            lock.position = SCNVector3(x, 1.13, z)
            lock.scale = SCNVector3(scale, 0.72, 0.62)
            root.addChildNode(lock)
        }

        for (x, rotation) in [(-0.12, 0.36), (0, 0), (0.12, -0.36)] as [(Float, Float)] {
            let bang = node(SCNCone(topRadius: 0, bottomRadius: 0.08, height: 0.18), SceneMaterials.wood)
            bang.position = SCNVector3(x, 1.12, 0.28)
            bang.eulerAngles = SCNVector3(.pi, 0, rotation)
            root.addChildNode(bang)
        }

        for x in [-0.30, 0.30] as [Float] {
            let bun = node(SCNSphere(radius: 0.11), SceneMaterials.wood)
            bun.position = SCNVector3(x, 1.16, -0.08)
            bun.scale = SCNVector3(0.86, 0.82, 0.78)
            root.addChildNode(bun)
        }
    }

    private static func addFace(to root: SCNNode) {
        for x in [-0.11, 0.11] as [Float] {
            let eye = node(SCNSphere(radius: 0.035), SceneMaterials.navy)
            eye.position = SCNVector3(x, 1.08, 0.31)
            eye.scale = SCNVector3(1, 1.15, 0.45)
            root.addChildNode(eye)
        }

        for x in [-0.17, 0.17] as [Float] {
            let cheek = node(SCNSphere(radius: 0.038), SceneMaterials.cheek)
            cheek.position = SCNVector3(x, 1.00, 0.31)
            cheek.scale = SCNVector3(1.25, 0.62, 0.28)
            root.addChildNode(cheek)
        }

        let smile = SCNTorus(ringRadius: 0.07, pipeRadius: 0.007)
        smile.ringSegmentCount = 18
        smile.pipeSegmentCount = 5
        smile.materials = [SceneMaterials.navy]
        let smileNode = SCNNode(geometry: smile)
        smileNode.position = SCNVector3(0, 0.995, 0.322)
        smileNode.scale.y = 0.58
        smileNode.eulerAngles.z = .pi
        root.addChildNode(smileNode)
    }

    private static func addLimbs(to root: SCNNode) {
        for (x, rotation) in [(-0.26, 0.28), (0.26, -0.28)] as [(Float, Float)] {
            let sleeve = node(SCNCapsule(capRadius: 0.065, height: 0.25), SceneMaterials.cream)
            sleeve.position = SCNVector3(x, 0.73, 0.08)
            sleeve.eulerAngles.z = rotation
            root.addChildNode(sleeve)
        }

        let leftArm = limb(name: "left-arm", at: SCNVector3(-0.31, 0.58, 0.09), material: SceneMaterials.skin, height: 0.24)
        leftArm.eulerAngles.z = 0.18
        let rightArm = limb(name: "right-arm", at: SCNVector3(0.31, 0.58, 0.09), material: SceneMaterials.skin, height: 0.24)
        rightArm.eulerAngles.z = -0.18
        root.addChildNode(leftArm)
        root.addChildNode(rightArm)

        let leftLeg = limb(name: "left-leg", at: SCNVector3(-0.10, 0.26, 0), material: SceneMaterials.navy, height: 0.30)
        leftLeg.eulerAngles.z = 0.08
        let rightLeg = limb(name: "right-leg", at: SCNVector3(0.10, 0.26, 0), material: SceneMaterials.navy, height: 0.30)
        rightLeg.eulerAngles.z = -0.08
        root.addChildNode(leftLeg)
        root.addChildNode(rightLeg)

        for x in [-0.13, 0.13] as [Float] {
            let boot = node(SCNCapsule(capRadius: 0.055, height: 0.12), SceneMaterials.boot)
            boot.position = SCNVector3(x, 0.08, 0.035)
            boot.eulerAngles.x = .pi / 2
            boot.scale = SCNVector3(1.35, 0.8, 0.8)
            root.addChildNode(boot)
        }

        for x in [-0.33, 0.33] as [Float] {
            let hand = node(SCNSphere(radius: 0.055), SceneMaterials.glove)
            hand.position = SCNVector3(x, 0.43, 0.10)
            root.addChildNode(hand)
        }

        let picker = node(SCNCylinder(radius: 0.012, height: 0.58), SceneMaterials.wood)
        picker.position = SCNVector3(0.42, 0.44, 0.12)
        picker.eulerAngles = SCNVector3(0.25, 0, -0.28)
        root.addChildNode(picker)

        let pickerTip = node(SCNCone(topRadius: 0, bottomRadius: 0.035, height: 0.08), SceneMaterials.silver)
        pickerTip.position = SCNVector3(0.50, 0.20, 0.17)
        pickerTip.eulerAngles.z = -0.28
        root.addChildNode(pickerTip)
    }

    private static func limb(name: String, at position: SCNVector3, material: SCNMaterial, height: CGFloat) -> SCNNode {
        let limb = node(SCNCapsule(capRadius: 0.045, height: height), material)
        limb.name = name
        limb.position = position
        return limb
    }

    private static func node(_ geometry: SCNGeometry, _ material: SCNMaterial) -> SCNNode {
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }
}
