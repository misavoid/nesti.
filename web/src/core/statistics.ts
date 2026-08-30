import { addDays, dateKey, parseDateKey } from "./dates";
import type { AppSnapshot } from "./types";

export interface Statistics {
  completionCount: number;
  estimatedMinutes: number;
  activeDays: number;
  averagePerWeek: number;
  currentStreak: number;
  bestStreak: number;
  missedDueDateCount: number;
  missRate?: number;
  batchingRate?: number;
  rooms: Array<{ name: string; completions: number; minutes: number }>;
  tasks: Array<{ name: string; room: string; completions: number; minutes: number }>;
  activity: Array<{ date: string; count: number }>;
  weekdays: Array<{ label: string; count: number }>;
  times: Array<{ label: string; count: number }>;
}

export function calculateStatistics(snapshot: AppSnapshot, range: "30" | "90" | "all"): Statistics {
  const now = new Date();
  const today = dateKey(now);
  const start = range === "all" ? undefined : addDays(today, -(Number(range) - 1));
  const selected = snapshot.completions.filter((item) => item.completedAt <= now.toISOString() && (!start || dateKey(new Date(item.completedAt)) >= start));
  const tasksById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const roomsById = new Map(snapshot.rooms.map((room) => [room.id, room]));
  const countsByDay = new Map<string, number>();
  const roomBuckets = new Map<string, { completions: number; minutes: number }>();
  const taskBuckets = new Map<string, { name: string; room: string; completions: number; minutes: number }>();
  const weekdayCounts = Array(7).fill(0) as number[];
  const timeCounts = [0, 0, 0, 0];
  let late = 0;
  let scheduled = 0;
  let estimatedMinutes = 0;

  for (const completion of selected) {
    const day = dateKey(new Date(completion.completedAt));
    countsByDay.set(day, (countsByDay.get(day) ?? 0) + 1);
    const completed = new Date(completion.completedAt);
    weekdayCounts[completed.getDay()] += 1;
    const hour = completed.getHours();
    timeCounts[hour >= 5 && hour < 12 ? 0 : hour < 17 ? 1 : hour < 22 ? 2 : 3] += 1;
    if (completion.scheduledFor) {
      scheduled += 1;
      if (day > completion.scheduledFor) late += 1;
    }
    const task = tasksById.get(completion.taskId);
    if (!task) continue;
    const minutes = task.estimatedMinutes ?? 0;
    estimatedMinutes += minutes;
    const room = roomsById.get(task.roomId);
    const roomName = room?.name ?? "Unknown room";
    const roomBucket = roomBuckets.get(roomName) ?? { completions: 0, minutes: 0 };
    roomBucket.completions += 1;
    roomBucket.minutes += minutes;
    roomBuckets.set(roomName, roomBucket);
    const taskBucket = taskBuckets.get(task.id) ?? { name: task.name, room: roomName, completions: 0, minutes: 0 };
    taskBucket.completions += 1;
    taskBucket.minutes += minutes;
    taskBuckets.set(task.id, taskBucket);
  }

  const overdue = snapshot.tasks.filter((task) => task.nextDueDate && task.nextDueDate < today).length;
  const days = [...countsByDay.keys()].sort();
  let bestStreak = 0;
  let run = 0;
  let previous: string | undefined;
  for (const day of days) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    previous = day;
  }
  let currentStreak = 0;
  let cursor = countsByDay.has(today) ? today : addDays(today, -1);
  while (countsByDay.has(cursor)) {
    currentStreak += 1;
    cursor = addDays(cursor, -1);
  }
  const multiDays = [...countsByDay.entries()].filter(([, count]) => count > 1).map(([day]) => day);
  const batched = multiDays.filter((day) => {
    const times = selected.filter((item) => dateKey(new Date(item.completedAt)) === day).map((item) => new Date(item.completedAt).valueOf());
    return Math.max(...times) - Math.min(...times) <= 3_600_000;
  }).length;
  const chartStart = start ?? (days[0] || addDays(today, -29));
  const visibleStart = chartStart < addDays(today, -83) ? addDays(today, -83) : chartStart;
  const activity: Array<{ date: string; count: number }> = [];
  for (let day = visibleStart; day <= today; day = addDays(day, 1)) activity.push({ date: day, count: countsByDay.get(day) ?? 0 });
  const first = start ?? days[0] ?? today;
  const daySpan = Math.max(1, Math.round((Date.UTC(...toUtcParts(today)) - Date.UTC(...toUtcParts(first))) / 86_400_000) + 1);
  const opportunities = scheduled + overdue;

  return {
    completionCount: selected.length,
    estimatedMinutes,
    activeDays: countsByDay.size,
    averagePerWeek: selected.length / (daySpan / 7),
    currentStreak,
    bestStreak,
    missedDueDateCount: late + overdue,
    missRate: opportunities ? (late + overdue) / opportunities : undefined,
    batchingRate: multiDays.length ? batched / multiDays.length : undefined,
    rooms: [...roomBuckets.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.completions - a.completions || a.name.localeCompare(b.name)),
    tasks: [...taskBuckets.values()].sort((a, b) => b.completions - a.completions || a.name.localeCompare(b.name)),
    activity,
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, index) => ({ label, count: weekdayCounts[index] })),
    times: ["Morning", "Afternoon", "Evening", "Night"].map((label, index) => ({ label, count: timeCounts[index] }))
  };
}

function toUtcParts(value: string): [number, number, number] {
  const date = parseDateKey(value);
  return [date.getFullYear(), date.getMonth(), date.getDate()];
}
