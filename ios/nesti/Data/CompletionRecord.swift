import Foundation
import SwiftData

@Model
final class CompletionRecord {
    @Attribute(.unique) var id: UUID
    var completedAt: Date
    var scheduledFor: Date?
    var task: CleaningTask?
    var profile: UserProfile?

    init(id: UUID = UUID(), completedAt: Date = Date(), scheduledFor: Date? = nil, task: CleaningTask? = nil, profile: UserProfile? = nil) {
        self.id = id
        self.completedAt = completedAt
        self.scheduledFor = scheduledFor
        self.task = task
        self.profile = profile
    }
}
