import SwiftUI
import UIKit
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

private struct CleanupGameWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NestiWidgetEntry

    private var pending: Int {
        entry.snapshot?.tasksDueThroughToday(at: entry.date).count ?? 0
    }

    private var completed: Int {
        entry.snapshot?.completedTaskIDs(at: entry.date).count ?? 0
    }

    private var total: Int { pending + completed }
    private var progress: Double { total == 0 ? 1 : Double(completed) / Double(total) }

    private var gameImage: UIImage? {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: NestiWidgetSnapshot.appGroupIdentifier
        ) else { return nil }
        return UIImage(contentsOfFile: containerURL
            .appendingPathComponent(NestiWidgetSnapshot.gameImageFilename).path)
    }

    var body: some View {
        if family == .systemSmall {
            compactContent
        } else {
            VStack(alignment: .leading) {
                Label("Island cleanup", systemImage: "gamecontroller.fill")
                    .font(.headline)
                Spacer()
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(statusTitle)
                            .font(.title3.bold())
                        Text(statusDetail)
                            .font(.caption)
                    }
                    Spacer()
                    progressMark
                }
            }
            .foregroundStyle(.white)
            .shadow(color: .black.opacity(0.55), radius: 3, y: 1)
            .gameWidgetBackground(image: gameImage)
            .widgetURL(URL(string: "nesti://play"))
        }
    }

    private var compactContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("nesti.", systemImage: "gamecontroller.fill")
                .font(.headline)
            Spacer(minLength: 0)
            progressMark
            Text(statusTitle)
                .font(.subheadline.bold())
                .lineLimit(1)
            Text(statusDetail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .foregroundStyle(.white)
        .shadow(color: .black.opacity(0.55), radius: 3, y: 1)
        .gameWidgetBackground(image: gameImage)
        .widgetURL(URL(string: "nesti://play"))
    }

    private var progressMark: some View {
        ZStack {
            Circle()
                .stroke(.white.opacity(0.32), lineWidth: 9)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(pending == 0 ? .green : .cyan, style: StrokeStyle(lineWidth: 9, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Image(systemName: pending == 0 ? "sparkles" : "leaf.fill")
                .font(.title2)
                .foregroundStyle(pending == 0 ? .green : .teal)
        }
        .frame(width: 66, height: 66)
        .accessibilityLabel("\(completed) of \(total) cleanup tasks complete")
    }

    private var statusTitle: String {
        if total == 0 { return "A clean start" }
        if pending == 0 { return "Island clear" }
        return "\(pending) left"
    }

    private var statusDetail: String {
        total == 0 ? "Nothing due today" : "\(completed) of \(total) cleaned"
    }
}

private extension View {
    func gameWidgetBackground(image: UIImage?) -> some View {
        containerBackground(for: .widget) {
            ZStack {
                Color(red: 0.20, green: 0.45, blue: 0.52)
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                }
                Color.black.opacity(0.18)
            }
        }
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

struct CleanupGameWidget: Widget {
    let kind = "CleanupGameWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NestiWidgetProvider()) { entry in
            CleanupGameWidgetView(entry: entry)
        }
        .configurationDisplayName("Island cleanup")
        .description("Your daily cleanup progress at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct NestiWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayTodosWidget()
        CleanupGameWidget()
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
