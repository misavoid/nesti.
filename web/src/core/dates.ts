import type { RecurrenceRule, Weekday } from "./types";

const weekdays: Weekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function dateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid calendar date: ${value}`);
  const result = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (dateKey(result) !== value) throw new Error(`Invalid calendar date: ${value}`);
  return result;
}

export function addDays(value: string, amount: number): string {
  const date = parseDateKey(value);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function daysBetween(from: string, to: string): number {
  const start = parseDateKey(from);
  const end = parseDateKey(to);
  return Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86_400_000);
}

function monthlyDate(anchor: string, months: number, requestedDay?: number): string {
  const date = parseDateKey(anchor);
  const targetMonth = date.getMonth() + months;
  const year = date.getFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const day = requestedDay ?? date.getDate();
  const lastDay = new Date(year, month + 1, 0).getDate();
  return dateKey(new Date(year, month, Math.min(day, lastDay)));
}

export function nextDueDate(rule: RecurrenceRule, reference: string, lastScheduledDate?: string): string | undefined {
  if (rule.type === "interval") {
    if (rule.days < 1) return undefined;
    const anchor = rule.basis === "scheduled" ? lastScheduledDate ?? reference : reference;
    if (rule.basis === "completion") return addDays(anchor, rule.days);
    return addDays(anchor, (Math.floor(Math.max(0, daysBetween(anchor, reference)) / rule.days) + 1) * rule.days);
  }

  if (rule.type === "weekdays") {
    if (!rule.days.length) return undefined;
    for (let offset = 1; offset <= 7; offset += 1) {
      const candidate = addDays(reference, offset);
      if (rule.days.includes(weekdays[parseDateKey(candidate).getDay()])) return candidate;
    }
    return undefined;
  }

  if (rule.intervalMonths < 1 || rule.intervalMonths > 120) return undefined;
  if (rule.basis === "completion") return monthlyDate(reference, rule.intervalMonths);
  if (!rule.day || rule.day < 1 || rule.day > 31) return undefined;
  let cursor = lastScheduledDate ? monthlyDate(lastScheduledDate, rule.intervalMonths) : reference;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const candidate = monthlyDate(cursor, 0, rule.day);
    if (candidate > reference) return candidate;
    cursor = monthlyDate(cursor, rule.intervalMonths, 1);
  }
  return undefined;
}

export function initialDueDate(rule: RecurrenceRule | undefined, today = dateKey()): string {
  if (!rule || rule.type === "interval" || (rule.type === "monthly" && rule.basis === "completion")) return today;
  if (rule.type === "weekdays") {
    const current = weekdays[parseDateKey(today).getDay()];
    return rule.days.includes(current) ? today : nextDueDate(rule, today) ?? today;
  }
  const candidate = monthlyDate(today, 0, rule.day);
  return candidate >= today ? candidate : monthlyDate(today, rule.intervalMonths, rule.day);
}

export function dueLabel(value?: string): { label: string; tone: "overdue" | "today" | "upcoming" | "none" } {
  if (!value) return { label: "No due date", tone: "none" };
  const today = dateKey();
  if (value < today) return { label: `Overdue · ${formatDay(value)}`, tone: "overdue" };
  if (value === today) return { label: "Due today", tone: "today" };
  if (value === addDays(today, 1)) return { label: "Tomorrow", tone: "upcoming" };
  return { label: formatDay(value), tone: "upcoming" };
}

export function formatDay(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(parseDateKey(value));
}
