import {
  createIcons, Bell, BellOff, CalendarDays, ChartNoAxesColumnIncreasing, Check, ChevronRight, CircleAlert,
  CircleCheck, CircleCheckBig, Clock, Cloud, CloudOff, Database, DoorOpen, Download, FileJson, Flame, Gamepad2, HardDrive, ListTodo,
  MoreHorizontal, Pencil, Plus, RefreshCw, RotateCcw, Settings, ShieldCheck, Sparkles, Timer, Trash2, Unplug, Upload, UserRound, Users, X
} from "lucide";
import { calculateStatistics } from "../core/statistics";
import { dateKey, dueLabel, formatDay, initialDueDate } from "../core/dates";
import { documentSummary } from "../core/codec";
import type { AppSnapshot, NestiDocument, ProfileRecord, RecurrenceBasis, RecurrenceRule, RoomRecord, TaskRecord, Weekday } from "../core/types";
import type { SyncConflict, SyncConnection } from "../core/sync";
import { completeTask, deleteProfile, deleteRoom, deleteTask, importDocument, resetDatabase, resolveConflict, saveProfile, saveRoom, saveSettings, saveTask, selectProfile, snapshot, syncState, undoCompletion } from "../data/db";
import { downloadPlan, readPlan } from "../services/files";
import { notifyDueTasks } from "../services/notifications";
import { cancelPairing, currentSyncStatus, disconnectFromServer, enrollWithServer, finishPairing, hasLocalPlan, observeSyncStatus, scheduleSync, startSyncService, syncNow, uploadBrowserCopy, type RuntimeSyncStatus } from "../services/sync";

const iconSet = { Bell, BellOff, CalendarDays, ChartNoAxesColumnIncreasing, Check, ChevronRight, CircleAlert, CircleCheck, CircleCheckBig, Clock, Cloud, CloudOff, Database, DoorOpen, Download, FileJson, Flame, Gamepad2, HardDrive, ListTodo, MoreHorizontal, Pencil, Plus, RefreshCw, RotateCcw, Settings, ShieldCheck, Sparkles, Timer, Trash2, Unplug, Upload, UserRound, Users, X };
type View = "tasks" | "stats" | "play" | "settings";
let data: AppSnapshot;
let view: View = (location.hash.slice(1) as View) || "tasks";
let taskFilter: "due" | "all" = "due";
let statsRange: "30" | "90" | "all" = "30";
let pendingImport: NestiDocument | undefined;
let gameModule: typeof import("./game") | undefined;
let syncDetails: { connection?: SyncConnection; pending: number; conflicts: SyncConflict[] } = { pending: 0, conflicts: [] };
let syncRuntime: RuntimeSyncStatus = currentSyncStatus();

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
const roomFor = (task: TaskRecord) => data.rooms.find((room) => room.id === task.roomId);
const icons = () => createIcons({ icons: iconSet, attrs: { "aria-hidden": "true" } });

export async function startApp(): Promise<void> {
  if (!(view in { tasks: 1, stats: 1, play: 1, settings: 1 })) view = "tasks";
  [data, syncDetails] = await Promise.all([snapshot(), syncState()]);
  bindEvents();
  observeSyncStatus((status) => {
    syncRuntime = status;
    void syncState().then((state) => { syncDetails = state; updateSyncIndicators(); if (view === "settings") render(); });
  });
  await requestPersistentStorage();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  render();
  notifyDueTasks(data);
  void startSyncService();
  const preload = () => import("./game").then((module) => { gameModule = module; return fetch("/models/FloatingIsland.glb"); }).catch(() => undefined);
  if ("requestIdleCallback" in window) window.requestIdleCallback(preload);
  else setTimeout(preload, 1500);
}

function bindEvents(): void {
  document.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("button, [data-action]");
    if (!button) return;
    const nextView = button.dataset.view as View | undefined;
    if (nextView) { navigate(nextView); return; }
    const action = button.dataset.action;
    const id = button.dataset.id;
    try {
      if (action === "add-room") openRoomDialog();
      if (action === "edit-room" && id) openRoomDialog(data.rooms.find((room) => room.id === id));
      if (action === "delete-room" && id && confirm("Delete this room and all of its tasks and history?")) { await deleteRoom(id); await refresh("Room deleted"); }
      if (action === "add-task") data.rooms.length ? openTaskDialog() : openRoomDialog(undefined, "Add a room before creating its first task.");
      if (action === "edit-task" && id) openTaskDialog(data.tasks.find((task) => task.id === id));
      if (action === "delete-task" && id && confirm("Delete this task and its completion history?")) { await deleteTask(id); await refresh("Task deleted"); }
      if (action === "complete" && id) { await completeTask(id); await refresh("Task completed"); }
      if (action === "undo" && id) { await undoCompletion(id); await refresh("Completion undone"); }
      if (action === "filter") { taskFilter = button.dataset.filter as typeof taskFilter; render(); }
      if (action === "range") { statsRange = button.dataset.range as typeof statsRange; render(); }
      if (action === "import") byId<HTMLInputElement>("file-input").click();
      if (action === "export") downloadPlan(data);
      if (action === "export-room" && id) downloadPlan(data, id);
      if (action === "notifications") await requestNotifications();
      if (action === "sync-connect") await connectToHostedServer();
      if (action === "sync-now") { await syncNow(); await refresh("Saved to server", false); }
      if (action === "sync-upload-browser" && confirm("Upload the complete plan currently shown in this browser to PostgreSQL?")) { await uploadBrowserCopy(); await refresh("Browser copy uploaded to PostgreSQL", false); }
      if (action === "sync-disconnect" && confirm("Disconnect this browser? Local data will remain available.")) { await disconnectFromServer(); await refresh("Browser disconnected", false); }
      if (action === "add-profile") openProfileDialog();
      if (action === "edit-profile" && id) openProfileDialog(data.profiles.find((profile) => profile.id === id));
      if (action === "delete-profile" && id && confirm("Remove this profile? Existing completion records will remain.")) { await deleteProfile(id); await refresh("Profile removed"); }
      if (action === "resolve-server" && id) { await resolveConflict(id, "server"); await syncNow(); await refresh("Server version applied", false); }
      if (action === "resolve-local" && id) { await resolveConflict(id, "local"); await syncNow(); await refresh("Local version saved", false); }
      if (action === "reset" && confirm("Permanently delete all rooms, tasks, and completion history on this device?")) { await resetDatabase(); await refresh("Local data deleted"); }
      if (button.hasAttribute("data-submit-room")) { event.preventDefault(); await submitRoom(); }
      if (button.hasAttribute("data-submit-task")) { event.preventDefault(); await submitTask(); }
      if (button.hasAttribute("data-submit-profile")) { event.preventDefault(); await submitProfile(); }
    } catch (error) { toast(error instanceof Error ? error.message : "Something went wrong.", true); }
  });
  byId<HTMLInputElement>("file-input").addEventListener("change", handleFile);
  byId<HTMLButtonElement>("confirm-import").addEventListener("click", async (event) => {
    event.preventDefault();
    if (!pendingImport) return;
    try { await importDocument(pendingImport); pendingImport = undefined; byId<HTMLDialogElement>("import-dialog").close(); navigate("tasks"); await refresh("Plan imported"); }
    catch (error) { toast(error instanceof Error ? error.message : "Could not import this plan.", true); }
  });
  byId<HTMLSelectElement>("task-form").addEventListener("change", (event) => {
    if ((event.target as HTMLInputElement).name === "scheduleType") renderScheduleFields((event.target as HTMLSelectElement).value);
  });
  window.addEventListener("hashchange", () => { const next = location.hash.slice(1) as View; if (next && next !== view) { view = next; render(); } });
}

function navigate(next: View): void {
  view = next;
  history.replaceState(null, "", `#${next}`);
  render();
  byId("app-content").focus({ preventScroll: true });
}

async function refresh(message?: string, queueSync = true): Promise<void> {
  [data, syncDetails] = await Promise.all([snapshot(), syncState()]);
  render();
  notifyDueTasks(data);
  if (queueSync) scheduleSync();
  if (message) toast(message);
}

function render(): void {
  gameModule?.unmountGame();
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  byId("page-title").textContent = ({ tasks: "Tasks", stats: "Stats", play: "Play", settings: "Settings" })[view];
  byId("home-name").textContent = data.settings.homeName;
  const dueCount = data.tasks.filter((task) => task.nextDueDate && task.nextDueDate <= dateKey()).length;
  const badge = byId("due-badge"); badge.textContent = String(dueCount); badge.hidden = dueCount === 0;
  const activeProfile = data.profiles.find((profile) => profile.id === data.settings.activeProfileId) ?? data.profiles[0];
  const profilePicker = `<label class="profile-picker" title="Active profile"><span style="--profile-color:${escape(activeProfile?.color ?? "#147d64")}"></span><select id="active-profile-select" aria-label="Active profile">${data.profiles.map((profile) => `<option value="${profile.id}" ${profile.id === activeProfile?.id ? "selected" : ""}>${escape(profile.name)}</option>`).join("")}</select></label>`;
  const command = view === "tasks" ? `<button class="button primary" data-action="add-task" aria-label="New task"><i data-lucide="plus"></i><span>New task</span></button>` : view === "settings" ? `<button class="button primary" data-action="add-room" aria-label="New room"><i data-lucide="plus"></i><span>New room</span></button>` : "";
  byId("topbar-actions").innerHTML = `${profilePicker}${command}`;
  if (view === "tasks") renderTasks();
  if (view === "stats") renderStats();
  if (view === "play") renderPlay();
  if (view === "settings") renderSettings();
  icons();
  byId<HTMLSelectElement>("active-profile-select").addEventListener("change", async (event) => {
    await selectProfile((event.target as HTMLSelectElement).value);
    await refresh(undefined, false);
  });
  updateSyncIndicators();
}

function updateSyncIndicators(): void {
  const indicator = document.getElementById("sync-indicator");
  if (!indicator) return;
  const icon = syncRuntime.phase === "synced" ? "database" : syncRuntime.phase === "local" ? "hard-drive" : syncRuntime.phase === "offline" ? "cloud-off" : "cloud";
  indicator.innerHTML = `<i data-lucide="${icon}"></i><span>${escape(syncRuntime.message)}</span>`;
  indicator.className = `privacy-note sync-${syncRuntime.phase}`;
  icons();
}

function renderTasks(): void {
  const today = dateKey();
  const visible = data.tasks.filter((task) => taskFilter === "all" || (task.nextDueDate && task.nextDueDate <= today)).sort((a, b) => (a.nextDueDate ?? "9999").localeCompare(b.nextDueDate ?? "9999") || a.name.localeCompare(b.name));
  if (!data.tasks.length) {
    byId("app-content").innerHTML = emptyState("sparkles", "Build your cleaning rhythm", "Add a room, then create recurring tasks. Changes remain available offline.", "Add a room", "add-room");
    return;
  }
  const groups = new Map<string, TaskRecord[]>();
  for (const task of visible) { const key = task.nextDueDate && task.nextDueDate < today ? "Overdue" : task.nextDueDate === today ? "Today" : "Upcoming"; groups.set(key, [...(groups.get(key) ?? []), task]); }
  byId("app-content").innerHTML = `
    <div class="filter-bar"><div class="segmented" aria-label="Task filter"><button class="${taskFilter === "due" ? "active" : ""}" data-action="filter" data-filter="due">Due now</button><button class="${taskFilter === "all" ? "active" : ""}" data-action="filter" data-filter="all">All tasks</button></div><span class="summary-line">${visible.length} task${visible.length === 1 ? "" : "s"}</span></div>
    ${visible.length ? `<div class="task-groups">${["Overdue", "Today", "Upcoming"].map((name) => groups.has(name) ? taskGroup(name, groups.get(name)!) : "").join("")}</div>` : emptyState("circle-check-big", "You are caught up", "There are no tasks due today. Upcoming work is still available under All tasks.")}`;
}

function taskGroup(name: string, tasks: TaskRecord[]): string {
  const note = name === "Overdue" ? "A gentle nudge, not a verdict." : name === "Today" ? "Small actions make a calmer home." : "Your next tasks.";
  return `<section><div class="section-heading"><div><h2>${name}</h2><p>${note}</p></div></div><div class="task-list">${tasks.map((task) => taskRow(task)).join("")}</div></section>`;
}

function taskRow(task: TaskRecord, completed = false): string {
  const room = roomFor(task);
  const due = dueLabel(task.nextDueDate);
  return `<article class="task-row">
    <button class="complete-button" data-action="complete" data-id="${task.id}" aria-label="Complete ${escape(task.name)}" ${completed ? "disabled" : ""}><i data-lucide="${completed ? "check" : "circle-check"}"></i></button>
    <div class="task-main"><div class="task-name">${escape(task.name)}</div><div class="task-meta"><span><i data-lucide="door-open"></i>${escape(room?.name ?? "No room")}</span>${task.estimatedMinutes ? `<span><i data-lucide="clock"></i>${task.estimatedMinutes} min</span>` : ""}<span class="tone-${due.tone}"><i data-lucide="calendar-days"></i>${escape(due.label)}</span></div></div>
    <div class="row-actions"><button class="icon-button" data-action="edit-task" data-id="${task.id}" aria-label="Edit ${escape(task.name)}"><i data-lucide="pencil"></i></button><button class="icon-button danger" data-action="delete-task" data-id="${task.id}" aria-label="Delete ${escape(task.name)}"><i data-lucide="trash-2"></i></button></div>
  </article>`;
}

function renderStats(): void {
  const profile = data.profiles.find((item) => item.id === data.settings.activeProfileId);
  const profileCompletions = data.completions.filter((completion) => !profile || completion.profileId === profile.id);
  const stats = calculateStatistics({ ...data, completions: profileCompletions }, statsRange);
  if (!profileCompletions.length) { byId("app-content").innerHTML = emptyState("chart-no-axes-column-increasing", "Your patterns will appear here", `Complete a few tasks as ${escape(profile?.name ?? "this profile")} to reveal streaks, timing, rooms, and cleaning momentum.`); return; }
  const maxActivity = Math.max(1, ...stats.activity.map((day) => day.count));
  byId("app-content").innerHTML = `
    <div class="filter-bar"><div class="segmented" aria-label="Statistics range">${(["30", "90", "all"] as const).map((range) => `<button class="${statsRange === range ? "active" : ""}" data-action="range" data-range="${range}">${range === "all" ? "All time" : `${range} days`}</button>`).join("")}</div><span class="summary-line">${escape(profile?.name ?? "Profile")} activity</span></div>
    <div class="metric-grid">
      ${metric("circle-check-big", stats.completionCount, "Tasks completed")}${metric("timer", formatMinutes(stats.estimatedMinutes), "Estimated effort")}${metric("flame", stats.currentStreak, "Current streak")}${metric("circle-alert", stats.missedDueDateCount, "Missed due dates")}
    </div>
    <div class="stats-grid"><div>
      <section class="chart-section"><div class="section-heading"><div><h2>Daily momentum</h2><p>${stats.averagePerWeek.toFixed(1)} tasks per week · ${stats.activeDays} active days</p></div></div><div class="activity-chart" aria-label="Daily completions">${stats.activity.map((day) => `<span class="activity-bar" style="--value:${day.count / maxActivity * 4}" title="${formatDay(day.date)}: ${day.count}"></span>`).join("")}</div></section>
      <section><div class="section-heading"><div><h2>Rooms</h2><p>Where your effort went.</p></div></div><div class="rank-list">${stats.rooms.slice(0, 8).map((room) => `<div class="rank-row"><div><strong>${escape(room.name)}</strong><small>${formatMinutes(room.minutes)}</small></div><span>${room.completions}</span></div>`).join("") || `<p class="summary-line">No room activity in this range.</p>`}</div></section>
    </div><div>
      <section class="chart-section"><div class="section-heading"><div><h2>Weekday rhythm</h2><p>Your most active days.</p></div></div>${miniBars(stats.weekdays)}</section>
      <section class="chart-section"><div class="section-heading"><div><h2>Time of day</h2><p>When cleaning happens.</p></div></div>${miniBars(stats.times)}</section>
      <section><div class="section-heading"><div><h2>Top tasks</h2><p>Most often completed.</p></div></div><div class="rank-list">${stats.tasks.slice(0, 5).map((task) => `<div class="rank-row"><div><strong>${escape(task.name)}</strong><small>${escape(task.room)}</small></div><span>${task.completions}</span></div>`).join("")}</div></section>
    </div></div>`;
}

function renderPlay(): void {
  const today = dateKey();
  const completedToday = data.completions.filter((item) => dateKey(new Date(item.completedAt)) === today);
  const completedIds = new Set(completedToday.map((item) => item.taskId));
  const pending = data.tasks.filter((task) => task.nextDueDate && task.nextDueDate <= today && !completedIds.has(task.id));
  const completedTasks = data.tasks.filter((task) => completedIds.has(task.id));
  const daily = [...pending, ...completedTasks];
  const progress = daily.length ? Math.round(completedTasks.length / daily.length * 100) : 100;
  byId("app-content").innerHTML = `<div class="play-layout"><canvas id="game-canvas" class="game-scene" aria-label="Floating island cleanup, ${completedTasks.length} of ${daily.length} tasks complete"></canvas><div class="game-hud"><div class="game-score"><strong>${completedTasks.length}/${daily.length}</strong><span>${daily.length ? "island tasks complete" : "a clean start"}</span><div class="game-progress"><span style="--progress:${progress}%"></span></div></div></div><section class="game-tasks"><div class="section-heading"><div><h2>${pending.length ? "Today's cleanup" : "Island restored"}</h2><p>${pending.length ? `${pending.length} task${pending.length === 1 ? "" : "s"} left to clear the island.` : "Nothing else is due today."}</p></div></div>${pending.length ? `<div class="task-list">${pending.map((task) => taskRow(task)).join("")}</div>` : ""}${completedToday.length ? `<div class="section-heading" style="margin-top:22px"><div><h2>Completed</h2></div></div><div class="task-list">${completedToday.map((completion) => { const task = data.tasks.find((item) => item.id === completion.taskId); const profile = data.profiles.find((item) => item.id === completion.profileId); return task ? `<article class="task-row"><div class="complete-button"><i data-lucide="check"></i></div><div class="task-main"><div class="task-name">${escape(task.name)}</div><div class="task-meta"><span>${escape(roomFor(task)?.name ?? "")}</span>${profile ? `<span><i data-lucide="user-round"></i>${escape(profile.name)}</span>` : ""}</div></div><button class="button secondary" data-action="undo" data-id="${completion.id}"><i data-lucide="rotate-ccw"></i>Undo</button></article>` : ""; }).join("")}</div>` : ""}</section></div>`;
  const canvas = byId<HTMLCanvasElement>("game-canvas");
  void import("./game").then((module) => {
    gameModule = module;
    if (view === "play" && canvas.isConnected) module.mountGame(canvas, completedTasks.length, daily.length);
  });
}

function renderSettings(): void {
  const notificationState = "Notification" in window ? Notification.permission : "unsupported";
  const connection = syncDetails.connection;
  const syncDescription = connection
    ? `An offline copy is stored in this browser and synchronized to PostgreSQL on ${escape(connection.serverName)}.`
    : "Your plan is stored only in this browser until you connect it to your nesti. server.";
  const lastSync = connection?.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString() : "Not yet";
  byId("app-content").innerHTML = `<div class="settings-layout"><div>
    <section><div class="section-heading"><div><h2>Home</h2><p>Name and organize your local plan.</p></div></div><div class="settings-section"><div class="setting-row"><div><h3>Home name</h3><p>Used when exporting your complete plan.</p></div><input id="home-name-input" value="${escape(data.settings.homeName)}" maxlength="120" aria-label="Home name" /></div></div></section>
    <section style="margin-top:30px"><div class="section-heading"><div><h2>Profiles</h2><p>Choose who is completing tasks.</p></div><button class="button secondary" data-action="add-profile"><i data-lucide="plus"></i>Add profile</button></div><div class="profile-list">${data.profiles.map((profile) => `<article class="profile-row"><span class="profile-swatch" style="--profile-color:${escape(profile.color)}"></span><div><strong>${escape(profile.name)}</strong><small>${profile.id === data.settings.activeProfileId ? "Active profile" : "Shared household member"}</small></div><div class="room-actions"><button class="icon-button" data-action="edit-profile" data-id="${profile.id}" aria-label="Edit ${escape(profile.name)}"><i data-lucide="pencil"></i></button><button class="icon-button danger" data-action="delete-profile" data-id="${profile.id}" aria-label="Remove ${escape(profile.name)}" ${data.profiles.length <= 1 ? "disabled" : ""}><i data-lucide="trash-2"></i></button></div></article>`).join("")}</div></section>
    <section style="margin-top:30px"><div class="section-heading"><div><h2>Rooms</h2><p>${data.rooms.length} room${data.rooms.length === 1 ? "" : "s"}</p></div><button class="button secondary" data-action="add-room"><i data-lucide="plus"></i>Add room</button></div><div class="room-list">${data.rooms.map((room) => { const count = data.tasks.filter((task) => task.roomId === room.id).length; return `<article class="room-row"><span class="room-icon"><i data-lucide="door-open"></i></span><div><strong>${escape(room.name)}</strong><small>${count} task${count === 1 ? "" : "s"}${room.notes ? ` · ${escape(room.notes)}` : ""}</small></div><div class="room-actions"><button class="icon-button" data-action="export-room" data-id="${room.id}" aria-label="Export ${escape(room.name)}"><i data-lucide="download"></i></button><button class="icon-button" data-action="edit-room" data-id="${room.id}" aria-label="Edit ${escape(room.name)}"><i data-lucide="pencil"></i></button><button class="icon-button danger" data-action="delete-room" data-id="${room.id}" aria-label="Delete ${escape(room.name)}"><i data-lucide="trash-2"></i></button></div></article>`; }).join("") || `<p class="summary-line">No rooms yet.</p>`}</div></section>
    <section style="margin-top:30px"><div class="section-heading"><div><h2>Plan files</h2><p>Move plans between nesti. apps.</p></div></div><div class="settings-section"><div class="setting-row"><div><h3>Import .nesti plan</h3><p>Valid plans append after your confirmation.</p></div><button class="button secondary" data-action="import"><i data-lucide="upload"></i>Import</button></div><div class="setting-row"><div><h3>Export entire home</h3><p>Download a portable version 1 plan.</p></div><button class="button secondary" data-action="export" ${data.rooms.length ? "" : "disabled"}><i data-lucide="download"></i>Export</button></div></div></section>
    ${syncDetails.conflicts.length ? `<section style="margin-top:30px"><div class="section-heading"><div><h2>Sync conflicts</h2><p>Choose which version to keep.</p></div></div><div class="settings-section">${syncDetails.conflicts.map((conflict) => `<div class="setting-row"><div><h3>${escape(conflict.entityType)} changed in two places</h3><p>${escape(conflict.reason.replaceAll("_", " "))}</p></div><div class="inline-actions"><button class="button secondary" data-action="resolve-server" data-id="${conflict.id}">Use server</button>${conflict.reason !== "deleted" ? `<button class="button primary" data-action="resolve-local" data-id="${conflict.id}">Keep this device</button>` : ""}</div></div>`).join("")}</div></section>` : ""}
  </div><aside><div class="storage-panel"><i data-lucide="${connection ? "database" : "shield-check"}"></i><h2>${connection ? "Saved to your server" : "Private by design"}</h2><p>${syncDescription}</p><div class="storage-facts"><span>${escape(syncRuntime.message)}</span>${connection ? `<span>Last saved: ${escape(lastSync)}</span><span>${syncDetails.pending} pending change${syncDetails.pending === 1 ? "" : "s"}</span>` : ""}</div>${connection ? `<button class="button secondary" data-action="sync-now"><i data-lucide="refresh-cw"></i>Save now</button><button class="button secondary" data-action="sync-upload-browser"><i data-lucide="upload"></i>Upload this browser copy</button><button class="button secondary" data-action="sync-disconnect"><i data-lucide="unplug"></i>Disconnect</button>` : `<button class="button secondary" data-action="sync-connect"><i data-lucide="cloud"></i>Connect this browser</button>`}<button class="button secondary" data-action="notifications"><i data-lucide="${notificationState === "granted" ? "bell" : "bell-off"}"></i>${notificationState === "granted" ? "Reminders enabled" : notificationState === "unsupported" ? "Reminders unavailable" : "Enable reminders"}</button></div><div class="settings-section" style="margin-top:22px"><div class="setting-row"><div><h3>File format</h3><p>.nesti compatibility</p></div><strong>Version 1</strong></div><div class="setting-row"><div><h3>Delete local data</h3><p>This cannot be undone.</p></div><button class="button danger" data-action="reset">Delete</button></div></div></aside></div>`;
  byId<HTMLInputElement>("home-name-input").addEventListener("change", async (event) => {
    const homeName = (event.target as HTMLInputElement).value.trim() || "My Home";
    await saveSettings({ id: "settings", homeName }); await refresh("Home name saved");
  });
}

function openProfileDialog(profile?: ProfileRecord): void {
  const form = byId<HTMLFormElement>("profile-form");
  form.reset();
  (form.elements.namedItem("id") as HTMLInputElement).value = profile?.id ?? "";
  (form.elements.namedItem("name") as HTMLInputElement).value = profile?.name ?? "";
  (form.elements.namedItem("color") as HTMLInputElement).value = profile?.color ?? "#147d64";
  byId("profile-dialog-title").textContent = profile ? "Edit profile" : "New profile";
  byId<HTMLDialogElement>("profile-dialog").showModal();
  setTimeout(() => (form.elements.namedItem("name") as HTMLInputElement).focus(), 0);
}

async function submitProfile(): Promise<void> {
  const form = byId<HTMLFormElement>("profile-form");
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  const id = String(values.get("id") || crypto.randomUUID());
  const existing = data.profiles.find((profile) => profile.id === id);
  await saveProfile({
    id,
    name: String(values.get("name")).trim(),
    color: String(values.get("color")),
    sortOrder: existing?.sortOrder ?? data.profiles.length
  });
  byId<HTMLDialogElement>("profile-dialog").close();
  await refresh(existing ? "Profile updated" : "Profile added");
}

async function connectToHostedServer(): Promise<void> {
  const session = await enrollWithServer(data.settings.homeName, "Web browser", location.origin);
  try {
    const localHasData = await hasLocalPlan();
    const serverHasData = session.snapshot.rooms.length > 0 || session.snapshot.tasks.length > 0 || session.snapshot.completions.length > 0;
    let mode: "use-local" | "use-server" = localHasData && !serverHasData ? "use-local" : "use-server";
    if (localHasData && serverHasData) {
      const replace = confirm("This browser and the server both contain a plan. Continue to replace this browser's local plan with the server plan? Cancel to keep the local plan unchanged.");
      if (!replace) {
        await cancelPairing(session);
        return;
      }
      mode = "use-server";
    }
    await finishPairing(session, mode);
    await refresh("Connected and saved to PostgreSQL", false);
  } catch (error) {
    await cancelPairing(session);
    throw error;
  }
}

function openRoomDialog(room?: RoomRecord, note?: string): void {
  const form = byId<HTMLFormElement>("room-form");
  form.reset();
  (form.elements.namedItem("id") as HTMLInputElement).value = room?.id ?? "";
  (form.elements.namedItem("name") as HTMLInputElement).value = room?.name ?? "";
  (form.elements.namedItem("icon") as HTMLSelectElement).value = room?.icon ?? "door.left.hand.open";
  (form.elements.namedItem("notes") as HTMLTextAreaElement).value = room?.notes ?? "";
  byId("room-dialog-title").textContent = room ? "Edit room" : "New room";
  if (note) toast(note);
  byId<HTMLDialogElement>("room-dialog").showModal();
  setTimeout(() => (form.elements.namedItem("name") as HTMLInputElement).focus(), 0);
}

async function submitRoom(): Promise<void> {
  const form = byId<HTMLFormElement>("room-form");
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  const id = String(values.get("id") || crypto.randomUUID());
  const existing = data.rooms.find((room) => room.id === id);
  await saveRoom({ id, name: String(values.get("name")).trim(), notes: String(values.get("notes")).trim(), icon: String(values.get("icon")), sortOrder: existing?.sortOrder ?? data.rooms.length });
  byId<HTMLDialogElement>("room-dialog").close(); await refresh(existing ? "Room updated" : "Room added");
}

function openTaskDialog(task?: TaskRecord): void {
  const form = byId<HTMLFormElement>("task-form");
  form.reset();
  (form.elements.namedItem("roomId") as HTMLSelectElement).innerHTML = data.rooms.map((room) => `<option value="${room.id}">${escape(room.name)}</option>`).join("");
  (form.elements.namedItem("id") as HTMLInputElement).value = task?.id ?? "";
  (form.elements.namedItem("name") as HTMLInputElement).value = task?.name ?? "";
  (form.elements.namedItem("roomId") as HTMLSelectElement).value = task?.roomId ?? data.rooms[0]?.id ?? "";
  (form.elements.namedItem("estimatedMinutes") as HTMLInputElement).value = task?.estimatedMinutes?.toString() ?? "";
  (form.elements.namedItem("nextDueDate") as HTMLInputElement).value = task?.nextDueDate ?? dateKey();
  (form.elements.namedItem("notes") as HTMLTextAreaElement).value = task?.notes ?? "";
  (form.elements.namedItem("scheduleType") as HTMLSelectElement).value = task?.schedule?.type ?? "none";
  (form.elements.namedItem("reminderEnabled") as HTMLInputElement).checked = task?.reminder.enabled ?? false;
  (form.elements.namedItem("reminderTime") as HTMLInputElement).value = `${String(task?.reminder.hour ?? 9).padStart(2, "0")}:${String(task?.reminder.minute ?? 0).padStart(2, "0")}`;
  renderScheduleFields(task?.schedule?.type ?? "none", task?.schedule);
  byId("task-dialog-title").textContent = task ? "Edit task" : "New task";
  byId<HTMLDialogElement>("task-dialog").showModal();
  setTimeout(() => (form.elements.namedItem("name") as HTMLInputElement).focus(), 0);
}

function renderScheduleFields(type: string, rule?: RecurrenceRule): void {
  const container = byId("schedule-fields");
  container.hidden = type === "none";
  if (type === "interval") container.innerHTML = `<label>Repeat every<input name="intervalDays" type="number" min="1" max="3650" value="${rule?.type === "interval" ? rule.days : 7}" required /></label><label>Anchor<select name="basis"><option value="completion">Completion date</option><option value="scheduled">Scheduled date</option></select></label>`;
  if (type === "weekdays") { const selected = rule?.type === "weekdays" ? rule.days : ["monday"]; container.innerHTML = `<div class="weekday-picker">${(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as Weekday[]).map((day) => `<label><input type="checkbox" name="weekday" value="${day}" ${selected.includes(day) ? "checked" : ""}/><span>${day.slice(0, 2).toUpperCase()}</span></label>`).join("")}</div>`; }
  if (type === "monthly") container.innerHTML = `<label>Repeat every<input name="intervalMonths" type="number" min="1" max="120" value="${rule?.type === "monthly" ? rule.intervalMonths : 1}" required /></label><label>months</label><label>Calendar day<input name="monthDay" type="number" min="1" max="31" value="${rule?.type === "monthly" && rule.day ? rule.day : ""}" placeholder="From completion" /></label><label>Anchor<select name="basis"><option value="completion">Completion date</option><option value="scheduled">Scheduled date</option></select></label>`;
  const basis = container.querySelector<HTMLSelectElement>("[name=basis]"); if (basis && rule && "basis" in rule) basis.value = rule.basis;
}

async function submitTask(): Promise<void> {
  const form = byId<HTMLFormElement>("task-form");
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  const type = String(values.get("scheduleType"));
  let schedule: RecurrenceRule | undefined;
  const basis = String(values.get("basis") ?? "completion") as RecurrenceBasis;
  if (type === "interval") schedule = { type, days: Number(values.get("intervalDays")), basis };
  if (type === "weekdays") { const days = values.getAll("weekday") as Weekday[]; if (!days.length) { toast("Select at least one weekday.", true); return; } schedule = { type, days }; }
  if (type === "monthly") { const rawDay = String(values.get("monthDay") ?? ""); const day = rawDay ? Number(rawDay) : undefined; if (basis === "scheduled" && !day) { toast("A scheduled monthly task needs a calendar day.", true); return; } schedule = { type, intervalMonths: Number(values.get("intervalMonths")), day, basis }; }
  const id = String(values.get("id") || crypto.randomUUID());
  const existing = data.tasks.find((task) => task.id === id);
  const [hour, minute] = String(values.get("reminderTime") ?? "09:00").split(":").map(Number);
  const task: TaskRecord = {
    id, roomId: String(values.get("roomId")), name: String(values.get("name")).trim(), notes: String(values.get("notes")).trim(),
    estimatedMinutes: values.get("estimatedMinutes") ? Number(values.get("estimatedMinutes")) : undefined,
    sortOrder: existing?.sortOrder ?? data.tasks.filter((item) => item.roomId === values.get("roomId")).length,
    schedule, lastCompletedAt: existing?.lastCompletedAt,
    nextDueDate: String(values.get("nextDueDate")) || initialDueDate(schedule),
    reminder: { enabled: values.get("reminderEnabled") === "on", hour, minute },
    metadata: existing?.metadata, createdAt: existing?.createdAt ?? new Date().toISOString()
  };
  await saveTask(task); byId<HTMLDialogElement>("task-dialog").close(); await refresh(existing ? "Task updated" : "Task added");
}

async function handleFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = ""; if (!file) return;
  try {
    pendingImport = await readPlan(file);
    const summary = documentSummary(pendingImport);
    byId("import-summary").innerHTML = `<p><strong>${escape(pendingImport.name)}</strong></p><div class="import-facts"><div><strong>${summary.rooms}</strong><span>Rooms</span></div><div><strong>${summary.tasks}</strong><span>Tasks</span></div></div><p class="import-note">This plan has been fully validated. Importing appends it to your current rooms and does not replace existing data.</p>`;
    byId<HTMLDialogElement>("import-dialog").showModal(); icons();
  } catch (error) { pendingImport = undefined; toast(error instanceof Error ? error.message : "Could not read this plan.", true); }
}

async function requestNotifications(): Promise<void> {
  if (!("Notification" in window)) { toast("This browser does not support reminders.", true); return; }
  const result = await Notification.requestPermission();
  toast(result === "granted" ? "Reminders are enabled" : "Reminder permission was not granted", result !== "granted");
  render();
}

async function requestPersistentStorage(): Promise<void> { if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false); }

function emptyState(icon: string, title: string, message: string, button?: string, action?: string): string { return `<div class="empty-state"><div><span class="empty-icon"><i data-lucide="${icon}"></i></span><h2>${title}</h2><p>${message}</p>${button ? `<button class="button primary" data-action="${action}"><i data-lucide="plus"></i>${button}</button>` : ""}</div></div>`; }
function metric(icon: string, value: string | number, label: string): string { return `<div class="metric"><i class="metric-icon" data-lucide="${icon}"></i><strong>${value}</strong><span>${label}</span></div>`; }
function miniBars(values: Array<{ label: string; count: number }>): string { const max = Math.max(1, ...values.map((item) => item.count)); return `<div class="mini-bars">${values.map((item) => `<div class="mini-bar"><span>${item.label}</span><div class="mini-bar-track"><div class="mini-bar-fill" style="--value:${item.count / max}"></div></div><b>${item.count}</b></div>`).join("")}</div>`; }
function formatMinutes(value: number): string { if (value < 60) return `${value}m`; const hours = Math.floor(value / 60); const minutes = value % 60; return minutes ? `${hours}h ${minutes}m` : `${hours}h`; }
function toast(message: string, error = false): void { const element = byId("toast"); element.textContent = message; element.classList.toggle("error", error); element.classList.add("show"); window.setTimeout(() => element.classList.remove("show"), 2800); }
