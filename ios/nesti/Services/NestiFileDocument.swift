import SwiftUI
import UniformTypeIdentifiers

extension UTType {
    static let nestiPlan = UTType(exportedAs: "app.nesti.plan", conformingTo: .json)
}

struct NestiFileDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.nestiPlan] }
    var document: NestiDocument

    init(document: NestiDocument) { self.document = document }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw NestiDocumentError.malformed("The selected file has no contents.")
        }
        document = try NestiDocumentCodec.decode(data)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: try NestiDocumentCodec.encode(document))
    }
}
