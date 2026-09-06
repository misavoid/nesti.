import SceneKit
import UIKit

enum SceneMaterials {
    static let grass = material(0x83D99B, roughness: 0.82)
    static let grassDark = material(0x62BC7A, roughness: 0.9)
    static let sand = material(0xF9DFA2, roughness: 0.9)
    static let earth = material(0xC98B67, roughness: 0.95)
    static let mint = material(0x88D8B0, roughness: 0.72)
    static let mintDark = material(0x429675, roughness: 0.82)
    static let cream = material(0xFFEDC8, roughness: 0.82)
    static let wallShade = material(0xF4D4A4, roughness: 0.86)
    static let coral = material(0xF28C82, roughness: 0.78)
    static let yellow = material(0xFFD66B, roughness: 0.76)
    static let blue = material(0x77BCE8, roughness: 0.7)
    static let navy = material(0x263D4A, roughness: 0.8)
    static let white = material(0xFFFDF7, roughness: 0.7)
    static let wood = material(0x8F5F3D, roughness: 0.92)
    static let door = material(0x8D4F2F, roughness: 0.88)
    static let rock = material(0xBEBEB5, roughness: 0.96)
    static let roof = material(0xC56F34, roughness: 0.78)
    static let roofDark = material(0x8F4A2A, roughness: 0.82)
    static let roofLight = material(0xE39655, roughness: 0.78)
    static let glass = material(0xA8DDF0, roughness: 0.28)
    static let skin = material(0xF5C8A8, roughness: 0.78)
    static let cheek = material(0xF3A7A0, roughness: 0.8)
    static let glove = material(0xFFF2D2, roughness: 0.82)
    static let boot = material(0x20333C, roughness: 0.82)
    static let silver = material(0xB7C9CC, roughness: 0.38, metallic: 0.35)
    static let paper = material(0xF7EBC3, roughness: 0.94)
    static let bag = material(0x77888C, roughness: 0.88)
    static let bagDark = material(0x4D5C60, roughness: 0.9)
    static let bagBlue = material(0x6D8790, roughness: 0.9)
    static let bagGreen = material(0x5F7568, roughness: 0.9)
    static let bagPurple = material(0x746B83, roughness: 0.9)
    static let bagBlack = material(0x2F3A3D, roughness: 0.9)

    static func material(_ hex: UInt32, roughness: CGFloat, metallic: CGFloat = 0) -> SCNMaterial {
        let color = UIColor(
            red: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: 1
        )
        let material = SCNMaterial()
        material.diffuse.contents = color
        material.roughness.contents = roughness
        material.metalness.contents = metallic
        material.emission.contents = color
        material.emission.intensity = 0.05
        material.lightingModel = .blinn
        return material
    }
}
