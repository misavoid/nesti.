import Foundation

public enum RecurrenceBasis: String, Codable, CaseIterable, Sendable {
    case completion
    case scheduled
}

public enum Weekday: String, Codable, CaseIterable, Sendable {
    case sunday, monday, tuesday, wednesday, thursday, friday, saturday

    public var calendarValue: Int {
        switch self {
        case .sunday: 1
        case .monday: 2
        case .tuesday: 3
        case .wednesday: 4
        case .thursday: 5
        case .friday: 6
        case .saturday: 7
        }
    }

    public var shortLabel: String {
        String(rawValue.prefix(3)).capitalized
    }
}

public enum RecurrenceRule: Equatable, Sendable {
    case interval(days: Int, basis: RecurrenceBasis)
    case weekdays(Set<Weekday>)
    case monthly(day: Int?, intervalMonths: Int, basis: RecurrenceBasis)
}

extension RecurrenceRule: Codable {
    private enum CodingKeys: String, CodingKey { case type, days, basis, day, intervalMonths }
    private enum RuleType: String, Codable { case interval, weekdays, monthly }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(RuleType.self, forKey: .type) {
        case .interval:
            self = .interval(
                days: try container.decode(Int.self, forKey: .days),
                basis: try container.decodeIfPresent(RecurrenceBasis.self, forKey: .basis) ?? .completion
            )
        case .weekdays:
            self = .weekdays(Set(try container.decode([Weekday].self, forKey: .days)))
        case .monthly:
            let day = try container.decodeIfPresent(Int.self, forKey: .day)
            let basis = try container.decodeIfPresent(RecurrenceBasis.self, forKey: .basis)
                ?? (day == nil ? .completion : .scheduled)
            self = .monthly(
                day: day,
                intervalMonths: try container.decodeIfPresent(Int.self, forKey: .intervalMonths) ?? 1,
                basis: basis
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .interval(days, basis):
            try container.encode(RuleType.interval, forKey: .type)
            try container.encode(days, forKey: .days)
            try container.encode(basis, forKey: .basis)
        case let .weekdays(days):
            try container.encode(RuleType.weekdays, forKey: .type)
            try container.encode(days.sorted { $0.calendarValue < $1.calendarValue }, forKey: .days)
        case let .monthly(day, intervalMonths, basis):
            try container.encode(RuleType.monthly, forKey: .type)
            try container.encodeIfPresent(day, forKey: .day)
            try container.encode(intervalMonths, forKey: .intervalMonths)
            try container.encode(basis, forKey: .basis)
        }
    }
}
