import SwiftUI

struct TaskRow: View {
    let task: CleaningTask
    let complete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: complete) {
                Image(systemName: "circle")
                    .font(.title2)
                    .foregroundStyle(task.isOverdue ? .red : Color.accentColor)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Complete \(task.name)")

            VStack(alignment: .leading, spacing: 4) {
                Text(task.name).font(.body.weight(.medium))
                HStack(spacing: 8) {
                    if let due = task.nextDueAt {
                        Label(dueLabel(due), systemImage: task.isOverdue ? "exclamationmark.circle.fill" : "calendar")
                            .foregroundStyle(task.isOverdue ? .red : .secondary)
                    }
                    if let minutes = task.estimatedMinutes {
                        Label("\(minutes) min", systemImage: "clock")
                            .foregroundStyle(.secondary)
                    }
                }
                .font(.caption)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }

    private func dueLabel(_ date: Date) -> String {
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInTomorrow(date) { return "Tomorrow" }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}
