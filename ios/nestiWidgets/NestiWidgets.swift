import SwiftUI
import WidgetKit

private struct NestiWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: NestiWidgetSnapshot?
}

private struct NestiWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> NestiWidgetEntry {
        NestiWidgetEntry(date: Date(), snapshot: .preview)
    }

    func getSnapshot(in context: Context, completion: @escaping (NestiWidgetEntry) -> Void) {
        completion(NestiWidgetEntry(
            date: Date(),
            snapshot: context.isPreview ? .preview : NestiWidgetSnapshotStore.load()
        ))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NestiWidgetEntry>) -> Void) {
        let now = Date()
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 30, to: now) ?? now.addingTimeInterval(1_800)
        completion(Timeline(
            entries: [NestiWidgetEntry(date: now, snapshot: NestiWidgetSnapshotStore.load())],
            policy: .after(nextRefresh)
        ))
    }
}

private struct TodayTodosWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NestiWidgetEntry

    private var tasks: [WidgetTaskSnapshot] {
        entry.snapshot?.tasksDueThroughToday(at: entry.date) ?? []
    }

    private var visibleLimit: Int { family == .systemLarge ? 7 : 3 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Today", systemImage: "checkmark.circle")
                    .font(.headline)
                    .foregroundStyle(.primary)
                Spacer()
                Text(tasks.count, format: .number)
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
            }

            if tasks.isEmpty {
                Spacer()
                Label("All clear", systemImage: "sparkles")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.green)
                Text("No tasks due today")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(tasks.prefix(visibleLimit)) { task in
                        HStack(spacing: 8) {
                            Image(systemName: "circle")
                                .foregroundStyle(task.dueAt < Calendar.current.startOfDay(for: entry.date) ? .red : .teal)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(task.name)
                                    .font(.subheadline.weight(.medium))
                                    .lineLimit(1)
                                if let roomName = task.roomName {
                                    Text(roomName)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                    }
                }
                Spacer(minLength: 0)
                if tasks.count > visibleLimit {
                    Text("+\(tasks.count - visibleLimit) more")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .containerBackground(.background, for: .widget)
        .widgetURL(URL(string: "nesti://tasks"))
    }
}

struct TodayTodosWidget: Widget {
    let kind = "TodayTodosWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NestiWidgetProvider()) { entry in
            TodayTodosWidgetView(entry: entry)
        }
        .configurationDisplayName("Today's tasks")
        .description("Tasks due today and anything still overdue.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

@main
struct NestiWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayTodosWidget()
    }
}

private extension NestiWidgetSnapshot {
    static let preview = NestiWidgetSnapshot(
        tasks: [
            WidgetTaskSnapshot(
                id: UUID(),
                name: "Wipe kitchen counters",
                roomName: "Kitchen",
                roomIcon: "fork.knife",
                dueAt: Date(),
                estimatedMinutes: 10
            ),
            WidgetTaskSnapshot(
                id: UUID(),
                name: "Clean the shower",
                roomName: "Bathroom",
                roomIcon: "shower",
                dueAt: Date(),
                estimatedMinutes: 15
            )
        ],
        completions: []
    )
}
