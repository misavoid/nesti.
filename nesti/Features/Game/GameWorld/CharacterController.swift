import SceneKit

@MainActor
final class CharacterController {
    enum State {
        case idle
        case wander
        case walkingToTrash
        case pickingUp
        case celebrating
    }

    private struct Pickup {
        let trash: SCNNode
        let allClear: Bool
        let completion: () -> Void
    }

    private let character: GameCharacter
    private weak var sceneRoot: SCNNode?
    private var pickups: [Pickup] = []
    private(set) var state: State = .idle

    init(character: GameCharacter, sceneRoot: SCNNode) {
        self.character = character
        self.sceneRoot = sceneRoot
        startIdleAnimation()
        startWandering()
    }

    func enqueuePickup(trash: SCNNode, allClear: Bool, completion: @escaping () -> Void) {
        pickups.append(Pickup(trash: trash, allClear: allClear, completion: completion))
        runNextPickupIfNeeded()
    }

    private func startIdleAnimation() {
        let breathe = SCNAction.sequence([
            .scale(to: 1.025, duration: 0.85),
            .scale(to: 1.0, duration: 0.85)
        ])
        breathe.timingMode = .easeInEaseOut
        character.body.runAction(.repeatForever(breathe), forKey: "breathe")

        let look = SCNAction.sequence([
            .rotateBy(x: 0, y: 0.12, z: 0.03, duration: 1.2),
            .wait(duration: 0.8),
            .rotateBy(x: 0, y: -0.24, z: -0.06, duration: 1.6),
            .wait(duration: 0.7),
            .rotateBy(x: 0, y: 0.12, z: 0.03, duration: 1.2)
        ])
        character.head.runAction(.repeatForever(look), forKey: "look")
    }

    private func startWandering() {
        guard pickups.isEmpty else { return }
        state = .wander
        let destinations = [
            SCNVector3(0.62, 0.45, 0.48),
            SCNVector3(0.98, 0.45, -0.15),
            SCNVector3(0.18, 0.45, -0.48),
            SCNVector3(-0.15, 0.45, 0.35)
        ]
        var actions: [SCNAction] = []
        var previous = character.root.position
        for destination in destinations {
            actions.append(faceAction(from: previous, to: destination))
            actions.append(walkAction(to: destination, duration: 1.65))
            actions.append(.wait(duration: 0.9))
            previous = destination
        }
        character.root.runAction(.repeatForever(.sequence(actions)), forKey: "wander")
    }

    private func runNextPickupIfNeeded() {
        guard state != .walkingToTrash, state != .pickingUp, state != .celebrating,
              let pickup = pickups.first else { return }
        pickups.removeFirst()
        character.root.removeAction(forKey: "wander")
        stopWalkingLimbs()
        state = .walkingToTrash

        let destination = SCNVector3(pickup.trash.position.x, 0.45, pickup.trash.position.z + 0.30)
        let face = faceAction(from: character.root.position, to: destination)
        startWalkingLimbs()
        character.root.runAction(.sequence([
            face,
            walkAction(to: destination, duration: 0.95),
            .run { [weak self] _ in
                Task { @MainActor in
                    self?.stopWalkingLimbs()
                    self?.performPickup(pickup)
                }
            }
        ]), forKey: "pickup-walk")
    }

    private func performPickup(_ pickup: Pickup) {
        state = .pickingUp
        let bend = SCNAction.moveBy(x: 0, y: -0.20, z: 0, duration: 0.18)
        bend.timingMode = .easeInEaseOut
        let rise = bend.reversed()
        let reach = SCNAction.rotateTo(x: -0.72, y: 0, z: -0.22, duration: 0.18, usesShortestUnitArc: true)
        let unreach = SCNAction.rotateTo(x: 0, y: 0, z: 0, duration: 0.18, usesShortestUnitArc: true)

        character.rightArm.runAction(.sequence([reach, .wait(duration: 0.12), unreach]))
        pickup.trash.runAction(.sequence([
            .wait(duration: 0.18),
            .group([.scale(to: 0.01, duration: 0.25), .fadeOut(duration: 0.25)]),
            .run { [weak self] node in
                let position = node.position
                Task { @MainActor in self?.showSparkles(at: position) }
            },
            .removeFromParentNode()
        ]))
        character.root.runAction(.sequence([
            bend,
            .wait(duration: 0.18),
            rise,
            .run { [weak self] _ in
                Task { @MainActor in
                    pickup.completion()
                    guard let self else { return }
                    if pickup.allClear {
                        self.celebrate()
                    } else {
                        self.state = .idle
                        self.runNextPickupIfNeeded()
                        if self.pickups.isEmpty { self.startWandering() }
                    }
                }
            }
        ]), forKey: "pickup")
    }

    private func celebrate() {
        state = .celebrating
        let jump = SCNAction.sequence([
            .moveBy(x: 0, y: 0.48, z: 0, duration: 0.22),
            .moveBy(x: 0, y: -0.48, z: 0, duration: 0.28)
        ])
        jump.timingMode = .easeInEaseOut
        character.root.runAction(.sequence([
            .group([jump, .rotateBy(x: 0, y: .pi * 2, z: 0, duration: 0.5)]),
            .wait(duration: 0.25),
            .run { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.state = .idle
                    self.runNextPickupIfNeeded()
                    if self.pickups.isEmpty { self.startWandering() }
                }
            }
        ]), forKey: "celebrate")
    }

    private func startWalkingLimbs() {
        let forward = SCNAction.rotateTo(x: 0.48, y: 0, z: 0, duration: 0.18, usesShortestUnitArc: true)
        let backward = SCNAction.rotateTo(x: -0.48, y: 0, z: 0, duration: 0.18, usesShortestUnitArc: true)
        character.leftLeg.runAction(.repeatForever(.sequence([forward, backward])), forKey: "step")
        character.rightLeg.runAction(.repeatForever(.sequence([backward, forward])), forKey: "step")
        character.leftArm.runAction(.repeatForever(.sequence([backward, forward])), forKey: "swing")
        character.rightArm.runAction(.repeatForever(.sequence([forward, backward])), forKey: "swing")
    }

    private func stopWalkingLimbs() {
        for node in [character.leftLeg, character.rightLeg] { node.removeAction(forKey: "step") }
        for node in [character.leftArm, character.rightArm] { node.removeAction(forKey: "swing") }
        for node in [character.leftLeg, character.rightLeg, character.leftArm, character.rightArm] {
            node.runAction(.rotateTo(x: 0, y: 0, z: 0, duration: 0.12, usesShortestUnitArc: true))
        }
    }

    private func walkAction(to destination: SCNVector3, duration: TimeInterval) -> SCNAction {
        let move = SCNAction.move(to: destination, duration: duration)
        move.timingMode = .easeInEaseOut
        let bob = SCNAction.sequence([
            .moveBy(x: 0, y: 0.045, z: 0, duration: 0.12),
            .moveBy(x: 0, y: -0.045, z: 0, duration: 0.12)
        ])
        return .group([move, .repeat(bob, count: max(1, Int(duration / 0.24)))])
    }

    private func faceAction(from: SCNVector3, to: SCNVector3) -> SCNAction {
        let angle = atan2(to.x - from.x, to.z - from.z)
        let action = SCNAction.rotateTo(x: 0, y: CGFloat(angle), z: 0, duration: 0.18, usesShortestUnitArc: true)
        action.timingMode = .easeInEaseOut
        return action
    }

    private func showSparkles(at position: SCNVector3) {
        guard let sceneRoot else { return }
        for index in 0..<7 {
            let geometry = SCNSphere(radius: 0.035)
            geometry.materials = [index.isMultiple(of: 2) ? SceneMaterials.yellow : SceneMaterials.white]
            let sparkle = SCNNode(geometry: geometry)
            sparkle.position = position
            sceneRoot.addChildNode(sparkle)
            let angle = Float(index) * Float.pi * 2 / 7
            let x = CGFloat(cos(angle) * 0.35)
            let y = CGFloat(0.18 + Float(index % 2) * 0.10)
            let z = CGFloat(sin(angle) * 0.35)
            let move = SCNAction.moveBy(x: x, y: y, z: z, duration: 0.42)
            let burst = SCNAction.group([move, .fadeOut(duration: 0.42)])
            sparkle.runAction(.sequence([burst, .removeFromParentNode()]))
        }
    }
}
