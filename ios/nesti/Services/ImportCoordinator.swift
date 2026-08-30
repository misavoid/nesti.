import Foundation

enum ImportCoordinator {
    static func read(from url: URL) throws -> NestiDocument {
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true else { throw NestiDocumentError.malformed("The selected item is not a file.") }
        if let size = values.fileSize, size > NestiDocumentCodec.maximumByteCount { throw NestiDocumentError.fileTooLarge }
        return try NestiDocumentCodec.decode(Data(contentsOf: url, options: .mappedIfSafe))
    }
}
