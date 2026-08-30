import { dateKey } from "../core/dates";
import type { AppSnapshot } from "../core/types";

export function notifyDueTasks(snapshot: AppSnapshot): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const today = dateKey();
  const now = new Date();
  const due = snapshot.tasks.filter((task) => task.reminder.enabled && task.nextDueDate && task.nextDueDate <= today && (task.reminder.hour < now.getHours() || (task.reminder.hour === now.getHours() && task.reminder.minute <= now.getMinutes())));
  if (!due.length || localStorage.getItem("nesti-reminded") === today) return;
  const body = due.length === 1 ? due[0].name : `${due.length} cleaning tasks are ready.`;
  navigator.serviceWorker?.ready.then((registration) => registration.showNotification("nesti. · Ready when you are", { body, icon: "/icons/icon-192.png", tag: `nesti-${today}` })).catch(() => new Notification("nesti. · Ready when you are", { body, icon: "/icons/icon-192.png" }));
  localStorage.setItem("nesti-reminded", today);
}
