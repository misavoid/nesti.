import SwiftUI
import SwiftData

struct TaskEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Query(sort: \Room.sortOrder) private var rooms: [Room]

    let task: CleaningTask?
    @State private var name: String
    @State private var notes: String
    @State private var estimatedMinutes: Int?
    @State private var selectedRoomID: UUID?
    @State private var schedule: RecurrenceRule?
    @State private var nextDueAt: Date
    @State private var reminderEnabled: Bool
    @State private var reminderTime: Date
    @State private var showingSchedule = false

    init(task: CleaningTask?, initialRoom: Room?) {
        self.task = task
        _name = State(initialValue: task?.name ?? "")
        _notes = State(initialValue: task?.taskNotes ?? "")
        _estimatedMinutes = State(initialValue: task?.estimatedMinutes)
        _selectedRoomID = State(initialValue: task?.room?.id ?? initialRoom?.id)
        _schedule = State(initialValue: task?.schedule)
        _nextDueAt = State(initialValue: task?.nextDueAt ?? RecurrenceCalculator.initialDueDate(for: task?.schedule))
        _reminderEnabled = State(initialValue: task?.reminderEnabled ?? false)
        var components = DateComponents()
        components.hour = task?.reminderHour ?? 9
        components.minute = task?.reminderMinute ?? 0
        _reminderTime = State(initialValue: Calendar.current.date(from: components) ?? Date())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Task") {
                    TextField("Name", text: $name)
                    Picker("Room", selection: $selectedRoomID) {
                        ForEach(rooms) { Text($0.name).tag(Optional($0.id)) }
                    }
                    TextField("Notes", text: $notes, axis: .vertical).lineLimit(2...5)
                    OptionalMinutesField(minutes: $estimatedMinutes)
                }

                Section("Schedule") {
                    Button { showingSchedule = true } label: {
                        LabeledContent("Repeat", value: schedule?.summary ?? "One-off")
                    }
                    .foregroundStyle(.primary)
                    DatePicker("Next due", selection: $nextDueAt, displayedComponents: .date)
                }

                Section("Reminder") {
                    Toggle("Notify on due date", isOn: $reminderEnabled)
                    if reminderEnabled {
                        DatePicker("Time", selection: $reminderTime, displayedComponents: .hourAndMinute)
                    }
                }

                if let task {
                    Section {
                        Button("Delete Task", role: .destructive) {
                            PlanStore.deleteTask(task, from: context)
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle(task == nil ? "New Task" : "Edit Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save).disabled(!canSave)
                }
            }
            .sheet(isPresented: $showingSchedule) { ScheduleEditorView(schedule: $schedule) }
            .onChange(of: schedule) { previous, current in
                guard previous != current else { return }
                nextDueAt = RecurrenceCalculator.initialDueDate(for: current)
            }
        }
    }

    private var canSave: Bool { !name.trimmed.isEmpty && selectedRoomID != nil }

    private func save() {
        guard let room = rooms.first(where: { $0.id == selectedRoomID }) else { return }
        let time = Calendar.current.dateComponents([.hour, .minute], from: reminderTime)
        PlanStore.saveTask(
            task,
            name: name,
            notes: notes,
            estimatedMinutes: estimatedMinutes,
            room: room,
            schedule: schedule,
            nextDueAt: nextDueAt,
            reminderEnabled: reminderEnabled,
            reminderHour: time.hour ?? 9,
            reminderMinute: time.minute ?? 0,
            in: context
        )
        if reminderEnabled { Task { _ = try? await NotificationScheduler.shared.requestAuthorization() } }
        dismiss()
    }
}

private struct OptionalMinutesField: View {
    @Binding var minutes: Int?
    var body: some View {
        HStack {
            Text("Estimated effort")
            Spacer()
            TextField("Minutes", value: $minutes, format: .number)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
            Text("min").foregroundStyle(.secondary)
        }
    }
}

extension RecurrenceRule {
    var summary: String {
        switch self {
        case let .interval(days, basis):
            return days == 1 ? "Daily" : "Every \(days) days\(basis == .scheduled ? " (fixed)" : "")"
        case let .weekdays(days):
            return days.sorted { $0.calendarValue < $1.calendarValue }.map(\.shortLabel).joined(separator: ", ")
        case let .monthly(day, intervalMonths, basis):
            if basis == .completion {
                return intervalMonths == 1 ? "Monthly after completion" : "Every \(intervalMonths) months"
            }
            let interval = intervalMonths == 1 ? "Monthly" : "Every \(intervalMonths) months"
            return "\(interval) on day \(day ?? 1)"
        }
    }
}
