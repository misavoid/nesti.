import Foundation
import SwiftData

@Model
final class CompletionRecord {
    @Attribute(.unique) var id: UUID
    var completedAt: Date
    var scheduledFor: Date?
    var task: CleaningTask?

    init(id: UUID = UUID(), completedAt: Date = Date(), scheduledFor: Date? = nil, task: CleaningTask? = nil) {
        self.id = id
        self.completedAt = completedAt
        self.scheduledFor = scheduledFor
        self.task = task
    }
}
