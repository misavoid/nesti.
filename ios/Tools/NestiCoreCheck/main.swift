import Foundation
import NestiCore

private enum CheckFailure: Error, LocalizedError {
    case failed(String)
    var errorDescription: String? {
        switch self { case let .failed(message): message }
    }
}

private func utcCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    return calendar
}

private func date(_ year: Int, _ month: Int, _ day: Int) -> Date {
    utcCalendar().date(from: DateComponents(year: year, month: month, day: day))!
}

do {
    let interval = RecurrenceCalculator.nextDueDate(
        for: .interval(days: 7, basis: .scheduled),
        after: date(2026, 9, 3),
        lastScheduledDate: date(2026, 8, 20),
        calendar: utcCalendar()
    )
    guard interval == date(2026, 9, 10) else { throw CheckFailure.failed("Fixed interval cadence check failed.") }

    let month = RecurrenceCalculator.nextDueDate(
        for: .monthly(day: 31, intervalMonths: 1, basis: .scheduled),
        after: date(2026, 1, 31),
        calendar: utcCalendar()
    )
    guard month == date(2026, 2, 28) else { throw CheckFailure.failed("Monthly end-of-month check failed.") }

    let halfYear = RecurrenceCalculator.nextDueDate(
        for: .monthly(day: nil, intervalMonths: 6, basis: .completion),
        after: date(2026, 8, 23),
        calendar: utcCalendar()
    )
    guard halfYear == date(2027, 2, 23) else { throw CheckFailure.failed("Monthly interval check failed.") }

    let compactPlan = """
    {"version":1,"name":"Compact","rooms":[{"name":"Hall","tasks":[{"name":"Vacuum"}]}]}
    """
    let decodedCompactPlan = try NestiDocumentCodec.decode(Data(compactPlan.utf8))
    guard decodedCompactPlan.rooms.first?.tasks.first?.name == "Vacuum" else {
        throw CheckFailure.failed("Compact LLM-friendly document check failed.")
    }

    for path in CommandLine.arguments.dropFirst() {
        let document = try NestiDocumentCodec.decode(Data(contentsOf: URL(fileURLWithPath: path)))
        let taskCount = document.rooms.reduce(0) { $0 + $1.tasks.count }
        print("Valid: \(document.name) (\(document.rooms.count) rooms, \(taskCount) tasks)")
    }
    print("NestiCore checks passed.")
} catch {
    FileHandle.standardError.write(Data("Error: \(error.localizedDescription)\n".utf8))
    exit(1)
}
