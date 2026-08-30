import Foundation

public enum RecurrenceCalculator {
    public static func nextDueDate(
        for rule: RecurrenceRule,
        after reference: Date,
        lastScheduledDate: Date? = nil,
        calendar: Calendar = .current
    ) -> Date? {
        let start = calendar.startOfDay(for: reference)

        switch rule {
        case let .interval(days, basis):
            guard days > 0 else { return nil }
            let anchor = basis == .scheduled ? (lastScheduledDate.map { calendar.startOfDay(for: $0) } ?? start) : start
            if basis == .completion {
                return calendar.date(byAdding: .day, value: days, to: anchor)
            }
            let elapsedDays = max(0, calendar.dateComponents([.day], from: anchor, to: start).day ?? 0)
            let intervalsToAdvance = (elapsedDays / days) + 1
            return calendar.date(byAdding: .day, value: days * intervalsToAdvance, to: anchor)

        case let .weekdays(selectedDays):
            guard !selectedDays.isEmpty else { return nil }
            for offset in 1...7 {
                guard let candidate = calendar.date(byAdding: .day, value: offset, to: start) else { continue }
                let weekday = calendar.component(.weekday, from: candidate)
                if selectedDays.contains(where: { $0.calendarValue == weekday }) {
                    return candidate
                }
            }
            return nil

        case let .monthly(requestedDay, intervalMonths, basis):
            guard (1...120).contains(intervalMonths) else { return nil }
            if basis == .completion {
                return calendar.date(byAdding: .month, value: intervalMonths, to: start)
            }
            guard let requestedDay, (1...31).contains(requestedDay) else { return nil }

            var monthCursor = lastScheduledDate.map { calendar.startOfDay(for: $0) } ?? start
            if lastScheduledDate != nil {
                guard let advanced = calendar.date(byAdding: .month, value: intervalMonths, to: monthCursor) else { return nil }
                monthCursor = advanced
            }
            for _ in 0..<240 {
                guard let candidate = date(on: requestedDay, inMonthContaining: monthCursor, calendar: calendar) else { return nil }
                if candidate > start { return candidate }
                guard let advanced = calendar.date(byAdding: .month, value: intervalMonths, to: monthCursor) else { return nil }
                monthCursor = advanced
            }
            return nil
        }
    }

    public static func initialDueDate(for rule: RecurrenceRule?, from start: Date = Date(), calendar: Calendar = .current) -> Date {
        let today = calendar.startOfDay(for: start)
        guard let rule else { return today }
        switch rule {
        case .interval:
            return today
        case let .weekdays(days):
            let current = calendar.component(.weekday, from: today)
            if days.contains(where: { $0.calendarValue == current }) { return today }
            return nextDueDate(for: rule, after: today, calendar: calendar) ?? today
        case let .monthly(day, intervalMonths, basis):
            if basis == .completion { return today }
            guard let day else { return today }
            if let candidate = date(on: day, inMonthContaining: today, calendar: calendar), candidate >= today {
                return candidate
            }
            guard let futureMonth = calendar.date(byAdding: .month, value: intervalMonths, to: today) else { return today }
            return date(on: day, inMonthContaining: futureMonth, calendar: calendar) ?? today
        }
    }

    private static func date(on requestedDay: Int, inMonthContaining date: Date, calendar: Calendar) -> Date? {
        guard let range = calendar.range(of: .day, in: .month, for: date) else { return nil }
        var components = calendar.dateComponents([.year, .month], from: date)
        components.day = min(requestedDay, range.count)
        return calendar.date(from: components)
    }
}
