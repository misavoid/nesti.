import Foundation
import Testing
@testable import NestiCore

struct SharedRecurrenceFixtureTests {
    private struct Fixture: Decodable {
        let name: String
        let rule: RecurrenceRule
        let reference: String
        let lastScheduled: String?
        let expected: String
    }

    @Test func webAndSwiftRecurrenceFixturesMatch() throws {
        let fixtureURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("docs/fixtures/recurrence-v1.json")
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: fixtureURL))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false

        for fixture in fixtures {
            let reference = try #require(formatter.date(from: fixture.reference), "Invalid reference in \(fixture.name)")
            let lastScheduled = fixture.lastScheduled.flatMap(formatter.date(from:))
            let result = RecurrenceCalculator.nextDueDate(
                for: fixture.rule,
                after: reference,
                lastScheduledDate: lastScheduled,
                calendar: calendar
            )
            #expect(result.map(formatter.string(from:)) == fixture.expected, "Fixture failed: \(fixture.name)")
        }
    }
}
