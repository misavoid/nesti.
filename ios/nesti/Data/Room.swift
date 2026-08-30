import Foundation
import SwiftData

@Model
final class Room {
    @Attribute(.unique) var id: UUID
    var name: String
    var roomNotes: String
    var icon: String
    var sortOrder: Int
    @Relationship(deleteRule: .cascade, inverse: \CleaningTask.room) var tasks: [CleaningTask]

    init(id: UUID = UUID(), name: String, notes: String = "", icon: String = "door.left.hand.open", sortOrder: Int = 0) {
        self.id = id
        self.name = name
        self.roomNotes = notes
        self.icon = icon
        self.sortOrder = sortOrder
        self.tasks = []
    }
}
