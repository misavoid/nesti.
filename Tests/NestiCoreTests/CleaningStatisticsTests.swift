import XCTest
@testable import NestiCore

final class CleaningStatisticsTests: XCTestCase {
    func testReportAggregatesRoomsTimeAndMissedDueDates() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 0))
        let now = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 8, day: 27, hour: 12)))
        let kitchenID = UUID()
        let bathID = UUID()
        let tasks = [
            StatisticsTask(id: kitchenID, name: "Counters", roomName: "Kitchen", roomIcon: "fork.knife", estimatedMinutes: 10, nextDueAt: nil),
            StatisticsTask(id: bathID, name: "Shower", roomName: "Bathroom", roomIcon: "shower", estimatedMinutes: 20, nextDueAt: try XCTUnwrap(calendar.date(byAdding: .day, value: -2, to: now)))
        ]
        let completions = [
            StatisticsCompletion(completedAt: now, scheduledFor: now, taskID: kitchenID),
            StatisticsCompletion(
                completedAt: now,
                scheduledFor: try XCTUnwrap(calendar.date(byAdding: .day, value: -1, to: now)),
                taskID: bathID
            ),
            StatisticsCompletion(completedAt: now, scheduledFor: nil, taskID: kitchenID)
        ]

        let report = CleaningStatistics.calculate(tasks: tasks, completions: completions, from: nil, through: now, calendar: calendar)

        XCTAssertEqual(report.completionCount, 3)
        XCTAssertEqual(report.estimatedMinutes, 40)
        XCTAssertEqual(report.rooms.first?.name, "Kitchen")
        XCTAssertEqual(report.rooms.first?.completions, 2)
        XCTAssertEqual(report.lateCompletionCount, 1)
        XCTAssertEqual(report.currentOverdueCount, 1)
        XCTAssertEqual(report.scheduledOpportunityCount, 3)
        XCTAssertEqual(report.missRate, 2.0 / 3.0)
    }

    func testStreaksUseCalendarDays() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 0))
        let now = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 8, day: 27, hour: 12)))
        let dates = [-1, -2, -4, -5, -6].map {
            StatisticsCompletion(completedAt: calendar.date(byAdding: .day, value: $0, to: now)!, scheduledFor: nil, taskID: nil)
        }

        let report = CleaningStatistics.calculate(tasks: [], completions: dates, from: nil, through: now, calendar: calendar)

        XCTAssertEqual(report.currentStreak, 2)
        XCTAssertEqual(report.bestStreak, 3)
        XCTAssertEqual(report.activeDays, 5)
    }

    func testTimePreferenceAndBatchingUseCompletionTimestamps() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 0))
        func date(day: Int, hour: Int, minute: Int = 0) throws -> Date {
            try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 8, day: day, hour: hour, minute: minute)))
        }
        let completions = [
            StatisticsCompletion(completedAt: try date(day: 25, hour: 9), scheduledFor: nil, taskID: nil),
            StatisticsCompletion(completedAt: try date(day: 25, hour: 9, minute: 30), scheduledFor: nil, taskID: nil),
            StatisticsCompletion(completedAt: try date(day: 26, hour: 8), scheduledFor: nil, taskID: nil),
            StatisticsCompletion(completedAt: try date(day: 26, hour: 18), scheduledFor: nil, taskID: nil),
            StatisticsCompletion(completedAt: try date(day: 27, hour: 23), scheduledFor: nil, taskID: nil)
        ]

        let report = CleaningStatistics.calculate(
            tasks: [],
            completions: completions,
            from: nil,
            through: try date(day: 27, hour: 23, minute: 30),
            calendar: calendar
        )

        XCTAssertEqual(report.timesOfDay.first(where: { $0.label == "Morning" })?.completions, 3)
        XCTAssertEqual(report.timesOfDay.first(where: { $0.label == "Evening" })?.completions, 1)
        XCTAssertEqual(report.timesOfDay.first(where: { $0.label == "Night" })?.completions, 1)
        XCTAssertEqual(report.multiTaskDayCount, 2)
        XCTAssertEqual(report.batchedMultiTaskDayCount, 1)
        XCTAssertEqual(report.batchingRate, 0.5)
    }
}
