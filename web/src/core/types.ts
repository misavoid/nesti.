export type RecurrenceBasis = "completion" | "scheduled";
export type Weekday = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

export type RecurrenceRule =
  | { type: "interval"; days: number; basis: RecurrenceBasis }
  | { type: "weekdays"; days: Weekday[] }
  | { type: "monthly"; day?: number; intervalMonths: number; basis: RecurrenceBasis };

export interface ReminderRecord {
  enabled: boolean;
  hour: number;
  minute: number;
}

export interface TaskRecord {
  id: string;
  roomId: string;
  name: string;
  notes: string;
  estimatedMinutes?: number;
  sortOrder: number;
  schedule?: RecurrenceRule;
  lastCompletedAt?: string;
  nextDueDate?: string;
  reminder: ReminderRecord;
  metadata?: Record<string, string>;
  createdAt: string;
}

export interface RoomRecord {
  id: string;
  name: string;
  notes: string;
  icon: string;
  sortOrder: number;
}

export interface CompletionRecord {
  id: string;
  taskId: string;
  completedAt: string;
  scheduledFor?: string;
}

export interface SettingsRecord {
  id: "settings";
  homeName: string;
}

export interface AppSnapshot {
  rooms: RoomRecord[];
  tasks: TaskRecord[];
  completions: CompletionRecord[];
  settings: SettingsRecord;
}

export interface NestiTask {
  id: string;
  name: string;
  notes?: string;
  estimatedMinutes?: number;
  sortOrder: number;
  schedule?: RecurrenceRule;
  lastCompletedAt?: string;
  nextDueDate?: string;
  reminder?: ReminderRecord;
  metadata?: Record<string, string>;
}

export interface NestiRoom {
  id: string;
  name: string;
  sortOrder: number;
  icon?: string;
  notes?: string;
  tasks: NestiTask[];
}

export interface NestiDocument {
  version: 1;
  id: string;
  name: string;
  exportedAt: string;
  metadata?: { generator?: string; notes?: string };
  rooms: NestiRoom[];
}
