import Foundation
import XCTest
@testable import NestiCore

final class RecurrenceCalculatorTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private func date(_ year: Int, _ month: Int, _ day: Int) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day))!
    }

    func testCompletionIntervalUsesCompletionDate() {
        let result = RecurrenceCalculator.nextDueDate(
            for: .interval(days: 4, basis: .completion),
            after: date(2026, 8, 23),
            calendar: calendar
        )
        XCTAssertEqual(result, date(2026, 8, 27))
    }

    func testScheduledIntervalPreservesCadence() {
        let result = RecurrenceCalculator.nextDueDate(
            for: .interval(days: 7, basis: .scheduled),
            after: date(2026, 8, 23),
            lastScheduledDate: date(2026, 8, 20),
            calendar: calendar
        )
        XCTAssertEqual(result, date(2026, 8, 27))
    }

    func testScheduledIntervalSkipsMissedOccurrences() {
        let result = RecurrenceCalculator.nextDueDate(
            for: .interval(days: 7, basis: .scheduled),
            after: date(2026, 9, 3),
            lastScheduledDate: date(2026, 8, 20),
            calendar: calendar
        )
        XCTAssertEqual(result, date(2026, 9, 10))
    }

    func testWeekdaysFindsNextSelectedDay() {
        let result = RecurrenceCalculator.nextDueDate(
            for: .weekdays([.monday, .thursday]),
            after: date(2026, 8, 23),
            calendar: calendar
        )
        XCTAssertEqual(result, date(2026, 8, 24))
    }

    func testMonthlyClampsToEndOfShortMonth() {
        let result = RecurrenceCalculator.nextDueDate(
            for: .monthly(day: 31, intervalMonths: 1, basis: .scheduled),
            after: date(2026, 1, 31),
            calendar: calendar
        )
        XCTAssertEqual(result, date(2026, 2, 28))
    }

    func testMonthlyCompletionIntervalAdvancesCalendarMonths() {
        let result = RecurrenceCalculator.nextDueDate(
            for: .monthly(day: nil, intervalMonths: 6, basis: .completion),
            after: date(2026, 8, 23),
            calendar: calendar
        )
        XCTAssertEqual(result, date(2027, 2, 23))
    }

    func testInitialWeekdayCanBeToday() {
        let result = RecurrenceCalculator.initialDueDate(
            for: .weekdays([.sunday]),
            from: date(2026, 8, 23),
            calendar: calendar
        )
        XCTAssertEqual(result, date(2026, 8, 23))
    }
}
