import SwiftUI

struct ImportPreviewView: View {
    @Environment(\.dismiss) private var dismiss
    let document: NestiDocument
    let importAction: () -> Void

    private var taskCount: Int { document.rooms.reduce(0) { $0 + $1.tasks.count } }
    private var effort: Int { document.rooms.flatMap(\.tasks).compactMap(\.estimatedMinutes).reduce(0, +) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Plan", value: document.name)
                    LabeledContent("Rooms", value: "\(document.rooms.count)")
                    LabeledContent("Tasks", value: "\(taskCount)")
                    if effort > 0 { LabeledContent("Estimated effort", value: "\(effort) min") }
                }
                Section("Rooms") {
                    ForEach(document.rooms) { room in
                        DisclosureGroup {
                            ForEach(room.tasks) { task in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(task.name)
                                    if let schedule = task.schedule { Text(schedule.summary).font(.caption).foregroundStyle(.secondary) }
                                }
                            }
                        } label: {
                            Label("\(room.name) - \(room.tasks.count)", systemImage: room.icon ?? "door.left.hand.open")
                        }
                    }
                }
                Section { Text("Importing adds this plan to your existing rooms and tasks.").font(.footnote).foregroundStyle(.secondary) }
            }
            .navigationTitle("Import Preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Import", action: importAction) }
            }
        }
    }
}
