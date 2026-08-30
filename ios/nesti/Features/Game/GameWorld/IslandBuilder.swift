import SceneKit
import UIKit

@MainActor
enum IslandBuilder {
    static func makeScene() -> SCNScene {
        let scene = SCNScene()
        scene.background.contents = UIColor(red: 0.98, green: 0.99, blue: 1.0, alpha: 1)
        scene.rootNode.addChildNode(makeCloud())
        scene.rootNode.addChildNode(makeIsland())
        scene.rootNode.addChildNode(makeHouse())
        addTrees(to: scene.rootNode)
        addRocksAndFlowers(to: scene.rootNode)
        addSteppingStonesAndBench(to: scene.rootNode)
        addPond(to: scene.rootNode)
        addFenceAndShrubs(to: scene.rootNode)
        addLighting(to: scene.rootNode)
        addCamera(to: scene.rootNode)
        return scene
    }

    private static func makeCloud() -> SCNNode {
        let root = SCNNode()
        root.name = "island-cloud"
        let cloudMaterial = SceneMaterials.material(0xF9FCFF, roughness: 0.92)
        let cloudShadeMaterial = SceneMaterials.material(0xEDF6FC, roughness: 0.94)

        let center = SCNSphere(radius: 3.55)
        center.segmentCount = 28
        center.materials = [cloudShadeMaterial]
        let centerNode = SCNNode(geometry: center)
        centerNode.position = SCNVector3(0, -1.10, 0)
        centerNode.scale = SCNVector3(1.14, 0.23, 0.92)
        root.addChildNode(centerNode)

        let puffs: [(Float, Float, Float, Float, Float, Float)] = [
            (-3.25, -1.10, -1.25, 1.05, 1.12, 0.78),
            (-3.55, -1.18, 0.20, 0.92, 1.05, 0.88),
            (-3.05, -0.98, 1.35, 1.12, 1.10, 0.82),
            (-2.35, -0.88, 2.25, 1.06, 1.15, 0.86),
            (-1.25, -1.02, 2.85, 1.18, 1.08, 0.80),
            (0.10, -0.92, 3.10, 1.10, 1.14, 0.88),
            (1.35, -1.08, 2.78, 1.15, 1.06, 0.82),
            (2.45, -0.90, 2.20, 1.00, 1.18, 0.90),
            (3.15, -1.06, 1.30, 1.20, 1.08, 0.80),
            (3.55, -0.95, 0.10, 1.00, 1.12, 0.88),
            (3.20, -1.10, -1.20, 1.15, 1.12, 0.82),
            (2.35, -1.00, -2.15, 1.00, 1.16, 0.88),
            (1.00, -1.10, -2.75, 1.15, 1.08, 0.82),
            (-0.40, -0.98, -3.00, 1.10, 1.15, 0.88),
            (-1.80, -1.10, -2.55, 1.12, 1.08, 0.80),
            (-2.80, -0.98, -1.90, 1.00, 1.18, 0.86),
            (-2.80, -0.62, 2.00, 0.72, 1.05, 0.96),
            (-0.45, -0.65, 3.25, 0.72, 1.10, 0.94),
            (1.85, -0.62, 2.55, 0.75, 1.04, 0.98),
            (3.25, -0.60, 0.85, 0.70, 1.08, 0.96),
            (2.90, -0.70, -1.75, 0.75, 1.12, 0.94),
            (0.20, -0.62, -3.00, 0.68, 1.06, 1.00),
            (-2.35, -0.65, -2.45, 0.72, 1.10, 0.96),
            (-3.45, -0.65, -0.45, 0.70, 1.06, 0.98)
        ]
        for (index, puff) in puffs.enumerated() {
            let sphere = SCNSphere(radius: CGFloat(puff.3))
            sphere.segmentCount = 20
            sphere.materials = [index < 16 ? cloudShadeMaterial : cloudMaterial]
            let node = SCNNode(geometry: sphere)
            node.position = SCNVector3(puff.0, puff.1, puff.2)
            node.scale = SCNVector3(puff.4, puff.5, 1.0)
            root.addChildNode(node)
        }
        return root
    }

    private static func makeIsland() -> SCNNode {
        let root = SCNNode()

        let earth = SCNCylinder(radius: 3.05, height: 0.75)
        earth.radialSegmentCount = 24
        earth.materials = [SceneMaterials.earth]
        let earthNode = SCNNode(geometry: earth)
        earthNode.scale.z = 0.78
        earthNode.position.y = -0.24
        root.addChildNode(earthNode)

        let sand = SCNCylinder(radius: 3.12, height: 0.15)
        sand.radialSegmentCount = 32
        sand.materials = [SceneMaterials.sand]
        let sandNode = SCNNode(geometry: sand)
        sandNode.scale.z = 0.80
        sandNode.position.y = 0.18
        root.addChildNode(sandNode)

        let grass = SCNCylinder(radius: 2.77, height: 0.18)
        grass.radialSegmentCount = 32
        grass.materials = [SceneMaterials.grass]
        let grassNode = SCNNode(geometry: grass)
        grassNode.scale.z = 0.77
        grassNode.position = SCNVector3(-0.04, 0.32, -0.02)
        grassNode.castsShadow = true
        root.addChildNode(grassNode)

        for (x, z, scale) in [(-1.55, -0.90, 0.58), (1.70, 0.72, 0.48)] as [(Float, Float, Float)] {
            let mound = SCNSphere(radius: 0.72)
            mound.segmentCount = 20
            mound.materials = [SceneMaterials.grassDark]
            let moundNode = SCNNode(geometry: mound)
            moundNode.position = SCNVector3(x, 0.28, z)
            moundNode.scale = SCNVector3(scale * 1.45, scale * 0.48, scale)
            root.addChildNode(moundNode)
        }
        return root
    }

    private static func makeHouse() -> SCNNode {
        let root = SCNNode()
        root.position = SCNVector3(-1.30, 0.47, -0.82)

        let body = SCNBox(width: 1.05, height: 0.82, length: 0.84, chamferRadius: 0.09)
        body.materials = [SceneMaterials.cream]
        let bodyNode = SCNNode(geometry: body)
        bodyNode.position.y = 0.41
        root.addChildNode(bodyNode)

        let gablePath = UIBezierPath()
        gablePath.move(to: CGPoint(x: -0.52, y: 0))
        gablePath.addLine(to: CGPoint(x: 0.52, y: 0))
        gablePath.addLine(to: CGPoint(x: 0, y: 0.48))
        gablePath.close()
        let gable = SCNShape(path: gablePath, extrusionDepth: 0.84)
        gable.materials = [SceneMaterials.cream]
        let gableNode = SCNNode(geometry: gable)
        gableNode.position = SCNVector3(0, 0.80, -0.42)
        root.addChildNode(gableNode)

        let roofAngle = atan2(Float(0.50), Float(0.66))
        let roofPanelWidth = CGFloat(hypot(Float(0.66), Float(0.50)))
        for side in [-1.0, 1.0] as [Float] {
            let panel = SCNBox(width: roofPanelWidth, height: 0.10, length: 1.08, chamferRadius: 0.025)
            panel.materials = [SceneMaterials.roof]
            let panelNode = SCNNode(geometry: panel)
            panelNode.position = SCNVector3(side * 0.33, 1.05, 0)
            panelNode.eulerAngles.z = -side * roofAngle
            root.addChildNode(panelNode)
        }

        let door = SCNBox(width: 0.28, height: 0.48, length: 0.035, chamferRadius: 0.055)
        door.materials = [SceneMaterials.mintDark]
        let doorNode = SCNNode(geometry: door)
        doorNode.position = SCNVector3(0.16, 0.25, 0.435)
        root.addChildNode(doorNode)

        for x in [-0.31, 0.38] as [Float] {
            let window = SCNBox(width: 0.23, height: 0.22, length: 0.04, chamferRadius: 0.04)
            window.materials = [SceneMaterials.glass]
            let windowNode = SCNNode(geometry: window)
            windowNode.position = SCNVector3(x, 0.55, 0.44)
            root.addChildNode(windowNode)
        }

        let chimney = SCNBox(width: 0.20, height: 0.48, length: 0.20, chamferRadius: 0.035)
        chimney.materials = [SceneMaterials.wood]
        let chimneyNode = SCNNode(geometry: chimney)
        chimneyNode.position = SCNVector3(-0.34, 1.22, -0.10)
        root.addChildNode(chimneyNode)
        return root
    }

    private static func addTrees(to root: SCNNode) {
        let placements: [(Float, Float, Float)] = [
            (1.65, -0.78, 0.88), (2.10, -0.22, 0.66), (-2.12, 0.65, 0.62)
        ]
        for (x, z, scale) in placements {
            let tree = SCNNode()
            tree.position = SCNVector3(x, 0.43, z)
            tree.scale = SCNVector3(scale, scale, scale)
            let trunk = SCNCylinder(radius: 0.10, height: 0.68)
            trunk.materials = [SceneMaterials.wood]
            let trunkNode = SCNNode(geometry: trunk)
            trunkNode.position.y = 0.34
            tree.addChildNode(trunkNode)

            for (offset, radius) in [(SCNVector3(0, 0.92, 0), 0.43), (SCNVector3(-0.28, 0.82, 0.04), 0.33), (SCNVector3(0.27, 0.82, 0.02), 0.34)] {
                let crown = SCNSphere(radius: radius)
                crown.segmentCount = 18
                crown.materials = [SceneMaterials.grassDark]
                let crownNode = SCNNode(geometry: crown)
                crownNode.position = offset
                crownNode.scale.y = 0.88
                tree.addChildNode(crownNode)
            }
            root.addChildNode(tree)
        }
    }

    private static func addRocksAndFlowers(to root: SCNNode) {
        let rocks: [(Float, Float, Float)] = [(2.42, 0.65, 0.26), (-2.30, -0.48, 0.31), (0.65, -1.72, 0.22)]
        for (index, placement) in rocks.enumerated() {
            let rock = SCNSphere(radius: CGFloat(placement.2))
            rock.segmentCount = 10
            rock.materials = [SceneMaterials.rock]
            let node = SCNNode(geometry: rock)
            node.position = SCNVector3(placement.0, 0.43, placement.1)
            node.scale = SCNVector3(1.25, 0.68, 0.92)
            node.eulerAngles.y = Float(index) * 0.8
            root.addChildNode(node)
        }

        let flowers: [(Float, Float, SCNMaterial)] = [
            (-0.42, -1.62, SceneMaterials.yellow), (-0.12, -1.70, SceneMaterials.coral),
            (-2.08, 1.02, SceneMaterials.white), (-1.88, 1.20, SceneMaterials.coral),
            (1.72, -1.10, SceneMaterials.yellow), (1.96, -0.96, SceneMaterials.white),
            (1.78, 1.20, SceneMaterials.coral), (-2.22, -0.72, SceneMaterials.yellow)
        ]
        for (x, z, material) in flowers {
            root.addChildNode(makeFlower(at: SCNVector3(x, 0.46, z), material: material))
        }

        for (x, z) in [(-1.82, -1.17), (2.12, 0.72)] as [(Float, Float)] {
            let mushroom = SCNNode()
            mushroom.position = SCNVector3(x, 0.44, z)
            let stem = SCNCylinder(radius: 0.035, height: 0.15)
            stem.materials = [SceneMaterials.cream]
            let stemNode = SCNNode(geometry: stem)
            stemNode.position.y = 0.075
            mushroom.addChildNode(stemNode)
            let cap = SCNSphere(radius: 0.09)
            cap.materials = [SceneMaterials.coral]
            let capNode = SCNNode(geometry: cap)
            capNode.scale.y = 0.55
            capNode.position.y = 0.16
            mushroom.addChildNode(capNode)
            root.addChildNode(mushroom)
        }
    }

    private static func addSteppingStonesAndBench(to root: SCNNode) {
        let path: [(Float, Float, Float)] = [
            (-1.14, -0.26, -0.10), (-1.00, 0.06, 0.12), (-0.80, 0.36, -0.08), (-0.55, 0.61, 0.08)
        ]
        for (index, placement) in path.enumerated() {
            let stone = SCNSphere(radius: 0.18)
            stone.segmentCount = 12
            stone.materials = [index.isMultiple(of: 2) ? SceneMaterials.paper : SceneMaterials.sand]
            let node = SCNNode(geometry: stone)
            node.position = SCNVector3(placement.0, 0.45, placement.1)
            node.scale = SCNVector3(1.15, 0.16, 0.82)
            node.eulerAngles.y = placement.2
            root.addChildNode(node)
        }

        let bench = SCNNode()
        bench.position = SCNVector3(-1.35, 0.43, 1.38)
        bench.eulerAngles.y = -0.22
        let seat = SCNBox(width: 0.82, height: 0.10, length: 0.28, chamferRadius: 0.035)
        seat.materials = [SceneMaterials.wood]
        let seatNode = SCNNode(geometry: seat)
        seatNode.position.y = 0.35
        bench.addChildNode(seatNode)
        let back = SCNBox(width: 0.82, height: 0.31, length: 0.08, chamferRadius: 0.025)
        back.materials = [SceneMaterials.wood]
        let backNode = SCNNode(geometry: back)
        backNode.position = SCNVector3(0, 0.56, -0.10)
        backNode.eulerAngles.x = -0.10
        bench.addChildNode(backNode)
        for x in [-0.29, 0.29] as [Float] {
            let leg = SCNCylinder(radius: 0.035, height: 0.34)
            leg.materials = [SceneMaterials.navy]
            let legNode = SCNNode(geometry: leg)
            legNode.position = SCNVector3(x, 0.17, 0)
            bench.addChildNode(legNode)
        }
        root.addChildNode(bench)
    }

    private static func addPond(to root: SCNNode) {
        let center = SCNVector3(0.62, 0.445, 1.42)
        let water = SCNCylinder(radius: 0.43, height: 0.025)
        water.radialSegmentCount = 24
        water.materials = [SceneMaterials.blue]
        let waterNode = SCNNode(geometry: water)
        waterNode.position = center
        waterNode.scale.z = 0.68
        root.addChildNode(waterNode)

        for index in 0..<7 {
            let angle = Float(index) * Float.pi * 2 / 7
            let pebble = SCNSphere(radius: index.isMultiple(of: 2) ? 0.105 : 0.085)
            pebble.segmentCount = 9
            pebble.materials = [SceneMaterials.rock]
            let node = SCNNode(geometry: pebble)
            node.position = SCNVector3(
                center.x + cos(angle) * 0.45,
                0.47,
                center.z + sin(angle) * 0.32
            )
            node.scale.y = 0.56
            root.addChildNode(node)
        }
    }

    private static func addFenceAndShrubs(to root: SCNNode) {
        let fence = SCNNode()
        fence.position = SCNVector3(0.38, 0.43, -1.66)
        for x in [-0.58, 0, 0.58] as [Float] {
            let post = SCNCylinder(radius: 0.045, height: 0.58)
            post.materials = [SceneMaterials.wood]
            let node = SCNNode(geometry: post)
            node.position = SCNVector3(x, 0.29, 0)
            fence.addChildNode(node)
        }
        for y in [0.20, 0.42] as [Float] {
            let rail = SCNBox(width: 1.18, height: 0.07, length: 0.07, chamferRadius: 0.02)
            rail.materials = [SceneMaterials.cream]
            let node = SCNNode(geometry: rail)
            node.position.y = y
            fence.addChildNode(node)
        }
        root.addChildNode(fence)

        let shrubs: [(Float, Float, Float)] = [(-2.06, -1.02, 0.25), (1.38, -1.38, 0.28), (2.20, 0.73, 0.22)]
        for (x, z, scale) in shrubs {
            let shrub = SCNNode()
            shrub.position = SCNVector3(x, 0.48, z)
            for offset in [-0.16, 0, 0.16] as [Float] {
                let blob = SCNSphere(radius: CGFloat(scale))
                blob.segmentCount = 14
                blob.materials = [SceneMaterials.grassDark]
                let node = SCNNode(geometry: blob)
                node.position = SCNVector3(offset, abs(offset) * 0.25, offset * 0.25)
                node.scale.y = 0.78
                shrub.addChildNode(node)
            }
            root.addChildNode(shrub)
        }
    }

    private static func makeFlower(at position: SCNVector3, material: SCNMaterial) -> SCNNode {
        let flower = SCNNode()
        flower.position = position
        for angle in stride(from: Float(0), to: Float.pi * 2, by: Float.pi / 2) {
            let petal = SCNSphere(radius: 0.055)
            petal.materials = [material]
            let node = SCNNode(geometry: petal)
            node.position = SCNVector3(cos(angle) * 0.07, 0.05, sin(angle) * 0.07)
            flower.addChildNode(node)
        }
        let center = SCNSphere(radius: 0.035)
        center.materials = [SceneMaterials.yellow]
        let centerNode = SCNNode(geometry: center)
        centerNode.position.y = 0.07
        flower.addChildNode(centerNode)
        return flower
    }

    private static func addLighting(to root: SCNNode) {
        let key = SCNLight()
        key.type = .directional
        key.color = UIColor(red: 1, green: 0.93, blue: 0.79, alpha: 1)
        key.intensity = 1_000
        key.castsShadow = true
        key.shadowMode = .deferred
        key.shadowRadius = 5
        key.shadowColor = UIColor.black.withAlphaComponent(0.22)
        let keyNode = SCNNode()
        keyNode.light = key
        keyNode.eulerAngles = SCNVector3(-0.9, -0.65, 0)
        root.addChildNode(keyNode)

        let ambient = SCNLight()
        ambient.type = .ambient
        ambient.color = UIColor(red: 1.0, green: 0.97, blue: 0.92, alpha: 1)
        ambient.intensity = 400
        let ambientNode = SCNNode()
        ambientNode.light = ambient
        root.addChildNode(ambientNode)
    }

    private static func addCamera(to root: SCNNode) {
        let camera = SCNCamera()
        camera.fieldOfView = 37
        camera.zNear = 0.1
        camera.zFar = 100
        camera.wantsHDR = false
        let cameraNode = SCNNode()
        cameraNode.name = "game-camera"
        cameraNode.camera = camera
        cameraNode.position = SCNVector3(6.55, 6.25, 7.75)
        let target = SCNNode()
        target.position = SCNVector3(0, 0.25, 0)
        root.addChildNode(target)
        let constraint = SCNLookAtConstraint(target: target)
        constraint.isGimbalLockEnabled = true
        cameraNode.constraints = [constraint]
        root.addChildNode(cameraNode)
    }
}
