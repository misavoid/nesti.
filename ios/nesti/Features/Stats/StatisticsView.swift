import Charts
import SwiftData
import SwiftUI

private enum StatisticsPeriod: String, CaseIterable, Identifiable {
    case month = "30 Days"
    case quarter = "90 Days"
    case all = "All Time"

    var id: Self { self }

    func startDate(relativeTo now: Date, calendar: Calendar) -> Date? {
        switch self {
        case .month: calendar.date(byAdding: .day, value: -29, to: calendar.startOfDay(for: now))
        case .quarter: calendar.date(byAdding: .day, value: -89, to: calendar.startOfDay(for: now))
        case .all: nil
        }
    }
}

struct StatisticsView: View {
    @Query private var tasks: [CleaningTask]
    @Query private var completions: [CompletionRecord]
    @AppStorage("activeProfileID") private var activeProfileID = ""
    @State private var period: StatisticsPeriod = .month

    private let now = Date()
    private let columns = [GridItem(.adaptive(minimum: 155), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Picker("Time period", selection: $period) {
                        ForEach(StatisticsPeriod.allCases) { period in
                            Text(period.rawValue).tag(period)
                        }
                    }
                    .pickerStyle(.segmented)

                    if report.completionCount == 0 && tasks.isEmpty {
                        ContentUnavailableView(
                            "No activity yet",
                            systemImage: "chart.bar.xaxis",
                            description: Text("Complete tasks to reveal patterns in your home.")
                        )
                        .frame(maxWidth: .infinity, minHeight: 300)
                    } else {
                        insight
                        overview
                        activityChart
                        if !report.rooms.isEmpty {
                            roomRanking
                        }
                        patterns
                        cleaningStyle
                        taskStandouts
                    }
                }
                .padding()
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Stats")
        }
    }

    private var report: CleaningStatistics {
        CleaningStatistics.calculate(
            tasks: tasks.map { task in
                StatisticsTask(
                    id: task.id,
                    name: task.name,
                    roomName: task.room?.name ?? "No Room",
                    roomIcon: task.room?.icon ?? "door.left.hand.open",
                    estimatedMinutes: task.estimatedMinutes,
                    nextDueAt: task.nextDueAt
                )
            },
            completions: completions.filter { activeProfileID.isEmpty || $0.profile?.id.uuidString == activeProfileID }.map {
                StatisticsCompletion(completedAt: $0.completedAt, scheduledFor: $0.scheduledFor, taskID: $0.task?.id)
            },
            from: period.startDate(relativeTo: now, calendar: .current),
            through: now
        )
    }

    private var insight: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "sparkles")
                .font(.title2)
                .foregroundStyle(.yellow)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("Your pattern")
                    .font(.headline)
                Text(insightText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding()
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }

    private var overview: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            MetricCard(
                title: "Tasks finished",
                value: report.completionCount.formatted(),
                detail: String(format: "%.1f/week, %d active days", report.averagePerWeek, report.activeDays),
                icon: "checkmark.circle.fill",
                color: .green
            )
            MetricCard(
                title: "Estimated effort",
                value: duration(report.estimatedMinutes),
                detail: "From task estimates",
                icon: "clock.fill",
                color: .blue
            )
            MetricCard(
                title: "Missed due dates",
                value: report.missRate.map { $0.formatted(.percent.precision(.fractionLength(0))) } ?? "--",
                detail: reliabilityDetail,
                icon: "calendar.badge.exclamationmark",
                color: report.missedDueDateCount == 0 ? .green : .orange
            )
            MetricCard(
                title: "Cleaning streak",
                value: "\(report.currentStreak) days",
                detail: "Best: \(report.bestStreak) days",
                icon: "flame.fill",
                color: .pink
            )
        }
    }

    private var activityChart: some View {
        StatisticsSection(title: "Momentum", subtitle: "Daily completed tasks") {
            Chart(report.dailyActivity) { day in
                BarMark(
                    x: .value("Day", day.date, unit: .day),
                    y: .value("Tasks", day.completions)
                )
                .foregroundStyle(day.completions == 0 ? Color.secondary.opacity(0.2) : Color.accentColor)
                .cornerRadius(2)
            }
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 5)) { value in
                    AxisGridLine()
                    AxisValueLabel(format: .dateTime.month(.abbreviated).day())
                }
            }
            .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) }
            .frame(height: 180)
            .accessibilityLabel("Daily task completion chart")
        }
    }

    private var roomRanking: some View {
        StatisticsSection(title: "Rooms", subtitle: "Where your effort goes") {
            VStack(spacing: 14) {
                ForEach(Array(report.rooms.prefix(6).enumerated()), id: \.element.id) { index, room in
                    HStack(spacing: 12) {
                        Text("\(index + 1)")
                            .font(.caption.monospacedDigit().weight(.semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 18)
                        Image(systemName: room.icon)
                            .foregroundStyle(Color.accentColor)
                            .frame(width: 22)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text(room.name).font(.subheadline.weight(.semibold))
                                Spacer()
                                Text("\(room.completions)").font(.subheadline.monospacedDigit().weight(.semibold))
                            }
                            ProgressView(value: Double(room.completions), total: Double(max(1, report.rooms.first?.completions ?? 1)))
                                .tint(index == 0 ? .green : .accentColor)
                            Text("\(duration(room.estimatedMinutes)) estimated")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private var patterns: some View {
        StatisticsSection(title: "Weekly rhythm", subtitle: "Your most active cleaning days") {
            Chart(report.weekdays) { day in
                BarMark(
                    x: .value("Weekday", day.symbol),
                    y: .value("Tasks", day.completions)
                )
                .foregroundStyle(Color.teal)
                .cornerRadius(3)
                .annotation(position: .top) {
                    if day.completions > 0 {
                        Text(day.completions.formatted()).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            .chartYAxis(.hidden)
            .frame(height: 150)
            .accessibilityLabel("Completed tasks by weekday")
        }
    }

    private var cleaningStyle: some View {
        StatisticsSection(title: "Cleaning style", subtitle: "When and how you get things done") {
            VStack(spacing: 16) {
                Chart(report.timesOfDay) { period in
                    BarMark(
                        x: .value("Tasks", period.completions),
                        y: .value("Time of day", period.label)
                    )
                    .foregroundStyle(period.id == preferredTime?.id ? Color.green : Color.accentColor.opacity(0.55))
                    .cornerRadius(3)
                    .annotation(position: .trailing) {
                        Text(period.completions.formatted())
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
                .chartXAxis(.hidden)
                .chartYAxis {
                    AxisMarks(position: .leading) { _ in AxisValueLabel() }
                }
                .frame(height: 150)
                .accessibilityLabel("Completed tasks by time of day")

                Divider()

                StyleInsightRow(
                    icon: "clock",
                    title: "Favorite time",
                    value: preferredTime.map { "\($0.label) cleaner" } ?? "Still learning",
                    detail: preferredTimeDetail
                )

                Divider()

                StyleInsightRow(
                    icon: "square.stack.3d.up",
                    title: "Routine",
                    value: batchingStyle,
                    detail: batchingDetail
                )
            }
        }
    }

    @ViewBuilder
    private var taskStandouts: some View {
        if let mostFrequent = report.tasks.first {
            StatisticsSection(title: "Task standouts", subtitle: "Repeated work and estimated load") {
                VStack(spacing: 0) {
                    StandoutRow(
                        icon: "repeat",
                        title: "Most repeated",
                        task: mostFrequent.name,
                        room: mostFrequent.roomName,
                        value: "\(mostFrequent.completions)x"
                    )
                    if let heaviest = report.tasks.max(by: { $0.estimatedMinutes < $1.estimatedMinutes }) {
                        Divider().padding(.vertical, 12)
                        StandoutRow(
                            icon: "hourglass",
                            title: "Largest estimated load",
                            task: heaviest.name,
                            room: heaviest.roomName,
                            value: duration(heaviest.estimatedMinutes)
                        )
                    }
                }
            }
        }
    }

    private var insightText: String {
        guard let topRoom = report.rooms.first else { return "Complete a few more tasks to reveal your cleaning pattern." }
        let busiestDay = report.weekdays.max { $0.completions < $1.completions }
        if let busiestDay, busiestDay.completions > 0 {
            return "\(topRoom.name) gets the most attention, and \(busiestDay.symbol) is your busiest cleaning day."
        }
        return "\(topRoom.name) gets the most attention with \(topRoom.completions) completed tasks."
    }

    private var reliabilityDetail: String {
        if report.scheduledOpportunityCount == 0 { return "No scheduled history" }
        if report.currentOverdueCount > 0 { return "\(report.currentOverdueCount) overdue now" }
        return report.lateCompletionCount == 0 ? "Every due date met" : "\(report.lateCompletionCount) completed late"
    }

    private var preferredTime: CleaningStatistics.TimeOfDayMetric? {
        report.timesOfDay.max { $0.completions < $1.completions }
    }

    private var preferredTimeDetail: String {
        guard let preferredTime, preferredTime.completions > 0 else { return "No completion times yet" }
        let share = Double(preferredTime.completions) / Double(report.completionCount)
        return "\(share.formatted(.percent.precision(.fractionLength(0)))) of completions"
    }

    private var batchingStyle: String {
        guard let rate = report.batchingRate else { return "Still learning" }
        if rate >= 0.67 { return "One-burst cleaner" }
        if rate <= 0.33 { return "Spread-out cleaner" }
        return "Flexible cleaner"
    }

    private var batchingDetail: String {
        guard report.multiTaskDayCount > 0 else { return "Complete multiple tasks in a day to compare" }
        return "\(report.batchedMultiTaskDayCount) of \(report.multiTaskDayCount) multi-task days finished within one hour"
    }

    private func duration(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes) min" }
        let hours = minutes / 60
        let remainder = minutes % 60
        return remainder == 0 ? "\(hours) hr" : "\(hours) hr \(remainder) min"
    }
}

private struct MetricCard: View {
    let title: String
    let value: String
    let detail: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(color)
                .accessibilityHidden(true)
            Text(value)
                .font(.title2.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 128, alignment: .topLeading)
        .padding()
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .combine)
    }
}

private struct StatisticsSection<Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.title3.weight(.bold))
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
            content
        }
        .padding()
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct StandoutRow: View {
    let icon: String
    let title: String
    let task: String
    let room: String
    let value: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Color.accentColor)
                .frame(width: 24)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                Text(task).font(.subheadline.weight(.semibold))
                Text(room).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(value).font(.headline.monospacedDigit())
        }
        .accessibilityElement(children: .combine)
    }
}

private struct StyleInsightRow: View {
    let icon: String
    let title: String
    let value: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Color.accentColor)
                .frame(width: 24)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                Text(value).font(.subheadline.weight(.semibold))
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
