import SwiftUI

private enum ScheduleKind: String, CaseIterable, Identifiable {
    case none = "One-off"
    case interval = "Every X days"
    case weekdays = "Weekdays"
    case monthly = "Monthly"
    var id: Self { self }
}

struct ScheduleEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var schedule: RecurrenceRule?
    @State private var kind: ScheduleKind
    @State private var intervalDays = 7
    @State private var basis: RecurrenceBasis = .completion
    @State private var weekdays: Set<Weekday> = []
    @State private var monthlyDay = 1
    @State private var monthlyInterval = 1
    @State private var monthlyBasis: RecurrenceBasis = .scheduled

    init(schedule: Binding<RecurrenceRule?>) {
        _schedule = schedule
        switch schedule.wrappedValue {
        case let .interval(days, basis):
            _kind = State(initialValue: .interval); _intervalDays = State(initialValue: days); _basis = State(initialValue: basis)
        case let .weekdays(days):
            _kind = State(initialValue: .weekdays); _weekdays = State(initialValue: days)
        case let .monthly(day, intervalMonths, basis):
            _kind = State(initialValue: .monthly)
            _monthlyDay = State(initialValue: day ?? 1)
            _monthlyInterval = State(initialValue: intervalMonths)
            _monthlyBasis = State(initialValue: basis)
        case nil:
            _kind = State(initialValue: .none)
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section { Picker("Repeat", selection: $kind) { ForEach(ScheduleKind.allCases) { Text($0.rawValue).tag($0) } } }
                switch kind {
                case .none: EmptyView()
                case .interval:
                    Section("Interval") {
                        Stepper("Every \(intervalDays) day\(intervalDays == 1 ? "" : "s")", value: $intervalDays, in: 1...3650)
                        Picker("Count from", selection: $basis) {
                            Text("Last completion").tag(RecurrenceBasis.completion)
                            Text("Scheduled date").tag(RecurrenceBasis.scheduled)
                        }
                    }
                case .weekdays:
                    Section("On these days") {
                        ForEach(Weekday.allCases, id: \.self) { day in
                            Toggle(day.rawValue.capitalized, isOn: Binding(
                                get: { weekdays.contains(day) },
                                set: { isSelected in
                                    if isSelected { weekdays.insert(day) }
                                    else { weekdays.remove(day) }
                                }
                            ))
                        }
                    }
                case .monthly:
                    Section("Monthly interval") {
                        Stepper("Every \(monthlyInterval) month\(monthlyInterval == 1 ? "" : "s")", value: $monthlyInterval, in: 1...120)
                        Picker("Count from", selection: $monthlyBasis) {
                            Text("Last completion").tag(RecurrenceBasis.completion)
                            Text("Scheduled date").tag(RecurrenceBasis.scheduled)
                        }
                    }
                    if monthlyBasis == .scheduled {
                        Section("Day of month") { Stepper("Day \(monthlyDay)", value: $monthlyDay, in: 1...31) }
                        Section { Text("For shorter months, day 31 becomes the last day of that month.").font(.footnote).foregroundStyle(.secondary) }
                    }
                }
            }
            .navigationTitle("Schedule")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Done", action: apply).disabled(kind == .weekdays && weekdays.isEmpty) }
            }
        }
    }

    private func apply() {
        switch kind {
        case .none: schedule = nil
        case .interval: schedule = .interval(days: intervalDays, basis: basis)
        case .weekdays: schedule = .weekdays(weekdays)
        case .monthly:
            schedule = .monthly(
                day: monthlyBasis == .scheduled ? monthlyDay : nil,
                intervalMonths: monthlyInterval,
                basis: monthlyBasis
            )
        }
        dismiss()
    }
}
