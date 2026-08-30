// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NestiCore",
    platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "NestiCore", targets: ["NestiCore"])],
    targets: [
        .target(name: "NestiCore"),
        .executableTarget(name: "NestiCoreCheck", dependencies: ["NestiCore"], path: "Tools/NestiCoreCheck"),
        .testTarget(name: "NestiCoreTests", dependencies: ["NestiCore"])
    ]
)
