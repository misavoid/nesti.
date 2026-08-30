import Foundation

public enum NestiDocumentError: Error, Equatable, LocalizedError {
    case fileTooLarge
    case malformed(String)
    case unsupportedVersion(Int)
    case validation([String])

    public var errorDescription: String? {
        switch self {
        case .fileTooLarge: "This file is larger than the 5 MB import limit."
        case let .malformed(reason): "The file is not valid nesti. JSON: \(reason)"
        case let .unsupportedVersion(version): "This file uses unsupported format version \(version)."
        case let .validation(issues): issues.joined(separator: "\n")
        }
    }
}

public enum NestiDocumentCodec {
    public static let maximumByteCount = 5 * 1_024 * 1_024

    public static func decode(_ data: Data) throws -> NestiDocument {
        guard data.count <= maximumByteCount else { throw NestiDocumentError.fileTooLarge }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)

            let internetFormatter = ISO8601DateFormatter()
            internetFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = internetFormatter.date(from: value) { return date }
            internetFormatter.formatOptions = [.withInternetDateTime]
            if let date = internetFormatter.date(from: value) { return date }

            if value.count == 10 {
                let dateFormatter = DateFormatter()
                dateFormatter.calendar = Calendar(identifier: .gregorian)
                dateFormatter.locale = Locale(identifier: "en_US_POSIX")
                dateFormatter.timeZone = .current
                dateFormatter.dateFormat = "yyyy-MM-dd"
                dateFormatter.isLenient = false
                if let date = dateFormatter.date(from: value) { return date }
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected an ISO-8601 timestamp or YYYY-MM-DD date."
            )
        }
        let document: NestiDocument
        do {
            document = try decoder.decode(NestiDocument.self, from: data)
        } catch let error as DecodingError {
            throw NestiDocumentError.malformed(decodingMessage(for: error))
        } catch {
            throw NestiDocumentError.malformed(error.localizedDescription)
        }
        guard document.version == NestiDocument.currentVersion else {
            throw NestiDocumentError.unsupportedVersion(document.version)
        }
        let issues = NestiDocumentValidator.issues(in: document)
        guard issues.isEmpty else { throw NestiDocumentError.validation(issues) }
        return document
    }

    public static func encode(_ document: NestiDocument) throws -> Data {
        let issues = NestiDocumentValidator.issues(in: document)
        guard issues.isEmpty else { throw NestiDocumentError.validation(issues) }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(document)
    }

    private static func decodingMessage(for error: DecodingError) -> String {
        switch error {
        case let .keyNotFound(key, context):
            return "Missing required value at \(path(context.codingPath + [key]))."
        case let .typeMismatch(type, context):
            return "Expected \(type) at \(path(context.codingPath))."
        case let .valueNotFound(type, context):
            return "Missing \(type) value at \(path(context.codingPath))."
        case let .dataCorrupted(context):
            return "Invalid value at \(path(context.codingPath)): \(context.debugDescription)"
        @unknown default:
            return error.localizedDescription
        }
    }

    private static func path(_ codingPath: [CodingKey]) -> String {
        codingPath.reduce("$") { result, key in
            if let index = key.intValue { return "\(result)[\(index)]" }
            return "\(result).\(key.stringValue)"
        }
    }
}

public enum NestiDocumentValidator {
    public static func issues(in document: NestiDocument) -> [String] {
        var issues: [String] = []
        if document.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { issues.append("The plan name is empty.") }
        if document.rooms.isEmpty { issues.append("The plan contains no rooms.") }
        if document.rooms.count > 250 { issues.append("The plan exceeds the 250 room limit.") }

        var taskCount = 0
        var identifiers = Set<UUID>()
        if !identifiers.insert(document.id).inserted { issues.append("The plan identifier is duplicated.") }

        for (roomIndex, room) in document.rooms.enumerated() {
            let roomPath = "Room \(roomIndex + 1)"
            if room.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { issues.append("\(roomPath) has an empty name.") }
            if !identifiers.insert(room.id).inserted { issues.append("\(roomPath) has a duplicate identifier.") }
            taskCount += room.tasks.count

            for (taskIndex, task) in room.tasks.enumerated() {
                let path = "\(roomPath), task \(taskIndex + 1)"
                if task.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { issues.append("\(path) has an empty name.") }
                if !identifiers.insert(task.id).inserted { issues.append("\(path) has a duplicate identifier.") }
                if let minutes = task.estimatedMinutes, !(1...1_440).contains(minutes) { issues.append("\(path) has invalid estimated minutes.") }
                if let reminder = task.reminder, !(0...23).contains(reminder.hour) || !(0...59).contains(reminder.minute) { issues.append("\(path) has an invalid reminder time.") }
                if let schedule = task.schedule { validate(schedule, path: path, issues: &issues) }
            }
        }
        if taskCount > 10_000 { issues.append("The plan exceeds the 10,000 task limit.") }
        return issues
    }

    private static func validate(_ rule: RecurrenceRule, path: String, issues: inout [String]) {
        switch rule {
        case let .interval(days, _):
            if !(1...3_650).contains(days) { issues.append("\(path) has an interval outside 1...3650 days.") }
        case let .weekdays(days):
            if days.isEmpty { issues.append("\(path) must select at least one weekday.") }
        case let .monthly(day, intervalMonths, basis):
            if !(1...120).contains(intervalMonths) { issues.append("\(path) has a monthly interval outside 1...120 months.") }
            if basis == .scheduled && day == nil { issues.append("\(path) needs a day for a scheduled monthly rule.") }
            if let day, !(1...31).contains(day) { issues.append("\(path) has a monthly day outside 1...31.") }
        }
    }
}
