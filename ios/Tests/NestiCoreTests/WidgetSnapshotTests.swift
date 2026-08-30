import XCTest
@testable import NestiCore

final class WidgetSnapshotTests: XCTestCase {
    func testDueTasksIncludeOverdueAndExcludeTasksCompletedToday() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 0))
        let now = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026,
            month: 8,
            day: 24,
            hour: 12
        )))
        let overdueID = UUID()
        let completedID = UUID()
        let upcomingID = UUID()
        let snapshot = NestiWidgetSnapshot(
            updatedAt: now,
            tasks: [
                task(id: overdueID, name: "Overdue", daysFromNow: -2, now: now, calendar: calendar),
                task(id: completedID, name: "Completed", daysFromNow: 0, now: now, calendar: calendar),
                task(id: upcomingID, name: "Upcoming", daysFromNow: 1, now: now, calendar: calendar)
            ],
            completions: [WidgetCompletionSnapshot(
                id: UUID(),
                taskID: completedID,
                completedAt: now,
                scheduledFor: now
            )]
        )

        XCTAssertEqual(snapshot.tasksDueThroughToday(at: now, calendar: calendar).map(\.id), [overdueID])
        XCTAssertEqual(snapshot.completedTaskIDs(at: now, calendar: calendar), [completedID])
    }

    func testCompletionScheduledForFutureDateIsNotCountedToday() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 0))
        let now = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026,
            month: 8,
            day: 24,
            hour: 12
        )))
        let taskID = UUID()
        let tomorrow = try XCTUnwrap(calendar.date(byAdding: .day, value: 1, to: now))
        let snapshot = NestiWidgetSnapshot(
            updatedAt: now,
            tasks: [],
            completions: [WidgetCompletionSnapshot(
                id: UUID(),
                taskID: taskID,
                completedAt: now,
                scheduledFor: tomorrow
            )]
        )

        XCTAssertTrue(snapshot.completedTaskIDs(at: now, calendar: calendar).isEmpty)
    }

    private func task(
        id: UUID,
        name: String,
        daysFromNow: Int,
        now: Date,
        calendar: Calendar
    ) -> WidgetTaskSnapshot {
        WidgetTaskSnapshot(
            id: id,
            name: name,
            roomName: nil,
            roomIcon: nil,
            dueAt: calendar.date(byAdding: .day, value: daysFromNow, to: now)!,
            estimatedMinutes: nil
        )
    }
}
