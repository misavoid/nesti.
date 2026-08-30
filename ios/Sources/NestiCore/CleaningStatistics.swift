import Foundation

public struct StatisticsTask: Sendable {
    public let id: UUID
    public let name: String
    public let roomName: String
    public let roomIcon: String
    public let estimatedMinutes: Int?
    public let nextDueAt: Date?

    public init(
        id: UUID,
        name: String,
        roomName: String,
        roomIcon: String,
        estimatedMinutes: Int?,
        nextDueAt: Date?
    ) {
        self.id = id
        self.name = name
        self.roomName = roomName
        self.roomIcon = roomIcon
        self.estimatedMinutes = estimatedMinutes
        self.nextDueAt = nextDueAt
    }
}

public struct StatisticsCompletion: Sendable {
    public let completedAt: Date
    public let scheduledFor: Date?
    public let taskID: UUID?

    public init(completedAt: Date, scheduledFor: Date?, taskID: UUID?) {
        self.completedAt = completedAt
        self.scheduledFor = scheduledFor
        self.taskID = taskID
    }
}

public struct CleaningStatistics: Sendable {
    public struct RoomMetric: Identifiable, Sendable {
        public var id: String { name }
        public let name: String
        public let icon: String
        public let completions: Int
        public let estimatedMinutes: Int
    }

    public struct TaskMetric: Identifiable, Sendable {
        public let id: UUID
        public let name: String
        public let roomName: String
        public let completions: Int
        public let estimatedMinutes: Int
    }

    public struct DayMetric: Identifiable, Sendable {
        public var id: Date { date }
        public let date: Date
        public let completions: Int
    }

    public struct WeekdayMetric: Identifiable, Sendable {
        public var id: Int { weekday }
        public let weekday: Int
        public let symbol: String
        public let completions: Int
    }

    public struct TimeOfDayMetric: Identifiable, Sendable {
        public var id: String { label }
        public let label: String
        public let completions: Int
    }

    public let completionCount: Int
    public let estimatedMinutes: Int
    public let activeDays: Int
    public let averagePerWeek: Double
    public let currentStreak: Int
    public let bestStreak: Int
    public let lateCompletionCount: Int
    public let currentOverdueCount: Int
    public let scheduledOpportunityCount: Int
    public let rooms: [RoomMetric]
    public let tasks: [TaskMetric]
    public let dailyActivity: [DayMetric]
    public let weekdays: [WeekdayMetric]
    public let timesOfDay: [TimeOfDayMetric]
    public let multiTaskDayCount: Int
    public let batchedMultiTaskDayCount: Int

    public var missedDueDateCount: Int { lateCompletionCount + currentOverdueCount }
    public var missRate: Double? {
        guard scheduledOpportunityCount > 0 else { return nil }
        return Double(missedDueDateCount) / Double(scheduledOpportunityCount)
    }
    public var batchingRate: Double? {
        guard multiTaskDayCount > 0 else { return nil }
        return Double(batchedMultiTaskDayCount) / Double(multiTaskDayCount)
    }

    public static func calculate(
        tasks: [StatisticsTask],
        completions: [StatisticsCompletion],
        from startDate: Date?,
        through endDate: Date = Date(),
        calendar: Calendar = .current
    ) -> CleaningStatistics {
        let end = endDate
        let selected = completions.filter { completion in
            completion.completedAt <= end && (startDate.map { completion.completedAt >= $0 } ?? true)
        }
        let tasksByID = Dictionary(uniqueKeysWithValues: tasks.map { ($0.id, $0) })
        let startOfToday = calendar.startOfDay(for: end)
        let overdueCount = tasks.filter { task in
            guard let due = task.nextDueAt else { return false }
            return due < startOfToday
        }.count
        let lateCount = selected.filter { completion in
            guard let scheduled = completion.scheduledFor,
                  let dayAfterDue = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: scheduled)) else {
                return false
            }
            return completion.completedAt >= dayAfterDue
        }.count
        let scheduledCount = selected.lazy.filter { $0.scheduledFor != nil }.count

        var roomBuckets: [String: (icon: String, completions: Int, minutes: Int)] = [:]
        var taskBuckets: [UUID: (task: StatisticsTask, completions: Int, minutes: Int)] = [:]
        for completion in selected {
            guard let taskID = completion.taskID, let task = tasksByID[taskID] else { continue }
            let minutes = task.estimatedMinutes ?? 0
            let room = roomBuckets[task.roomName] ?? (task.roomIcon, 0, 0)
            roomBuckets[task.roomName] = (room.icon, room.completions + 1, room.minutes + minutes)
            let bucket = taskBuckets[taskID] ?? (task, 0, 0)
            taskBuckets[taskID] = (bucket.task, bucket.completions + 1, bucket.minutes + minutes)
        }

        let completionsByDay = Dictionary(grouping: selected) { calendar.startOfDay(for: $0.completedAt) }
        let completionDays = Set(completionsByDay.keys)
        let multiTaskDays = completionsByDay.values.filter { $0.count > 1 }
        let batchedDays = multiTaskDays.filter { completions in
            guard let first = completions.map(\StatisticsCompletion.completedAt).min(),
                  let last = completions.map(\StatisticsCompletion.completedAt).max() else { return false }
            return last.timeIntervalSince(first) <= 60 * 60
        }
        let firstRelevantDate = startDate ?? selected.map(\StatisticsCompletion.completedAt).min() ?? end
        let daySpan = max(1, (calendar.dateComponents([.day], from: calendar.startOfDay(for: firstRelevantDate), to: startOfToday).day ?? 0) + 1)
        let dailyActivity = activityDays(from: firstRelevantDate, through: end, completions: selected, calendar: calendar)

        return CleaningStatistics(
            completionCount: selected.count,
            estimatedMinutes: selected.reduce(0) { total, completion in
                total + (completion.taskID.flatMap { tasksByID[$0]?.estimatedMinutes } ?? 0)
            },
            activeDays: completionDays.count,
            averagePerWeek: Double(selected.count) / (Double(daySpan) / 7.0),
            currentStreak: currentStreak(in: completionDays, today: startOfToday, calendar: calendar),
            bestStreak: bestStreak(in: completionDays, calendar: calendar),
            lateCompletionCount: lateCount,
            currentOverdueCount: overdueCount,
            scheduledOpportunityCount: scheduledCount + overdueCount,
            rooms: roomBuckets.map { name, value in
                RoomMetric(name: name, icon: value.icon, completions: value.completions, estimatedMinutes: value.minutes)
            }.sorted { $0.completions == $1.completions ? $0.name < $1.name : $0.completions > $1.completions },
            tasks: taskBuckets.map { id, value in
                TaskMetric(
                    id: id,
                    name: value.task.name,
                    roomName: value.task.roomName,
                    completions: value.completions,
                    estimatedMinutes: value.minutes
                )
            }.sorted { $0.completions == $1.completions ? $0.name < $1.name : $0.completions > $1.completions },
            dailyActivity: dailyActivity,
            weekdays: weekdayMetrics(for: selected, calendar: calendar),
            timesOfDay: timeOfDayMetrics(for: selected, calendar: calendar),
            multiTaskDayCount: multiTaskDays.count,
            batchedMultiTaskDayCount: batchedDays.count
        )
    }

    private static func activityDays(
        from start: Date,
        through end: Date,
        completions: [StatisticsCompletion],
        calendar: Calendar
    ) -> [DayMetric] {
        let counts = Dictionary(grouping: completions) { calendar.startOfDay(for: $0.completedAt) }.mapValues(\.count)
        let endDay = calendar.startOfDay(for: end)
        let requestedStart = calendar.startOfDay(for: start)
        let chartStart = calendar.date(byAdding: .day, value: -83, to: endDay) ?? requestedStart
        var day = max(requestedStart, chartStart)
        var result: [DayMetric] = []
        while day <= endDay {
            result.append(DayMetric(date: day, completions: counts[day, default: 0]))
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }
        return result
    }

    private static func weekdayMetrics(
        for completions: [StatisticsCompletion],
        calendar: Calendar
    ) -> [WeekdayMetric] {
        let counts = Dictionary(grouping: completions) { calendar.component(.weekday, from: $0.completedAt) }.mapValues(\.count)
        let symbols = calendar.shortStandaloneWeekdaySymbols
        return (0..<7).map { offset in
            let weekday = ((calendar.firstWeekday - 1 + offset) % 7) + 1
            return WeekdayMetric(weekday: weekday, symbol: symbols[weekday - 1], completions: counts[weekday, default: 0])
        }
    }

    private static func timeOfDayMetrics(
        for completions: [StatisticsCompletion],
        calendar: Calendar
    ) -> [TimeOfDayMetric] {
        let buckets = [
            (label: "Morning", hours: 5..<12),
            (label: "Afternoon", hours: 12..<17),
            (label: "Evening", hours: 17..<22),
            (label: "Night", hours: 22..<24)
        ]
        var counts = Dictionary(uniqueKeysWithValues: buckets.map { ($0.label, 0) })
        counts["Night"] = completions.lazy.filter {
            let hour = calendar.component(.hour, from: $0.completedAt)
            return hour < 5 || hour >= 22
        }.count
        for bucket in buckets.dropLast() {
            counts[bucket.label] = completions.lazy.filter {
                bucket.hours.contains(calendar.component(.hour, from: $0.completedAt))
            }.count
        }
        return buckets.map { TimeOfDayMetric(label: $0.label, completions: counts[$0.label, default: 0]) }
    }

    private static func currentStreak(in days: Set<Date>, today: Date, calendar: Calendar) -> Int {
        var cursor = today
        if !days.contains(cursor) {
            guard let yesterday = calendar.date(byAdding: .day, value: -1, to: cursor), days.contains(yesterday) else { return 0 }
            cursor = yesterday
        }
        var count = 0
        while days.contains(cursor) {
            count += 1
            guard let previous = calendar.date(byAdding: .day, value: -1, to: cursor) else { break }
            cursor = previous
        }
        return count
    }

    private static func bestStreak(in days: Set<Date>, calendar: Calendar) -> Int {
        var best = 0
        var current = 0
        var previous: Date?
        for day in days.sorted() {
            if let previous, calendar.date(byAdding: .day, value: 1, to: previous) == day {
                current += 1
            } else {
                current = 1
            }
            best = max(best, current)
            previous = day
        }
        return best
    }
}
