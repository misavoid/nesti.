import {
  createIcons, Award, Bell, BellOff, CalendarDays, ChartNoAxesColumnIncreasing, Check, ChevronRight, CircleAlert,
  CircleCheck, CircleCheckBig, Clock, Cloud, CloudOff, Database, DoorOpen, Download, FileJson, Flame, Gamepad2, Gift, HardDrive, ListTodo,
  MoreHorizontal, Pencil, Plus, RefreshCw, RotateCcw, Settings, ShieldCheck, Sparkles, Timer, Trash2, Unplug, Upload, UserRound, Users, X, Zap
} from "lucide";
import { calculateStatistics } from "../core/statistics";
import { dateKey, dueLabel, formatDay, initialDueDate } from "../core/dates";
import { documentSummary } from "../core/codec";
import type { AppSnapshot, NestiDocument, ProfileRecord, RecurrenceBasis, RecurrenceRule, RoomRecord, TaskRecord, Weekday } from "../core/types";
import type { SyncConflict, SyncConnection } from "../core/sync";
import { completeTask, deleteProfile, deleteRoom, deleteTask, importDocument, resetDatabase, resolveConflict, saveProfile, saveRoom, saveSettings, saveTask, selectProfile, snapshot, syncState, undoCompletion } from "../data/db";
import { downloadPlan, readPlan } from "../services/files";
import { notifyDueTasks } from "../services/notifications";
import { currentSyncStatus, disconnectFromServer, observeSyncedData, observeSyncStatus, reconcileHostedCopy, scheduleSync, startSyncService, syncNow, type RuntimeSyncStatus } from "../services/sync";

const iconSet = { Award, Bell, BellOff, CalendarDays, ChartNoAxesColumnIncreasing, Check, ChevronRight, CircleAlert, CircleCheck, CircleCheckBig, Clock, Cloud, CloudOff, Database, DoorOpen, Download, FileJson, Flame, Gamepad2, Gift, HardDrive, ListTodo, MoreHorizontal, Pencil, Plus, RefreshCw, RotateCcw, Settings, ShieldCheck, Sparkles, Timer, Trash2, Unplug, Upload, UserRound, Users, X, Zap };
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
  observeSyncedData(() => { void refresh(undefined, false); });
  await requestPersistentStorage();
  await startSyncService(data.settings.homeName);
  [data, syncDetails] = await Promise.all([snapshot(), syncState()]);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  render();
  notifyDueTasks(data);
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
      if (action === "jump-tasks") document.querySelector(".task-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (action === "range") { statsRange = button.dataset.range as typeof statsRange; render(); }
      if (action === "import") byId<HTMLInputElement>("file-input").click();
      if (action === "export") downloadPlan(data);
      if (action === "export-room" && id) downloadPlan(data, id);
      if (action === "notifications") await requestNotifications();
      if (action === "sync-connect") { await reconcileHostedCopy(data.settings.homeName); await refresh("Loaded from PostgreSQL", false); }
      if (action === "sync-now") { await syncNow(); await refresh("Saved to server", false); }
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
  window.addEventListener("hashchange", () => { const next = location.hash.slice(1) as View; if (next && next !== view) { view = next; render(); window.scrollTo({ top: 0, behavior: "instant" }); byId("app-content").focus({ preventScroll: true }); } });
}

function navigate(next: View): void {
  view = next;
  history.replaceState(null, "", `#${next}`);
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
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
  byId("page-title").textContent = ({ tasks: "Dashboard", stats: "Stats", play: "Play", settings: "Settings" })[view];
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
  const activeProfile = data.profiles.find((profile) => profile.id === data.settings.activeProfileId) ?? data.profiles[0];
  const completions = data.completions.filter((completion) => !activeProfile || completion.profileId === activeProfile.id);
  const stats = calculateStatistics({ ...data, completions }, "30");
  const completedToday = completions.filter((completion) => dateKey(new Date(completion.completedAt)) === today);
  const effortToday = completedToday.reduce((total, completion) => total + (data.tasks.find((task) => task.id === completion.taskId)?.estimatedMinutes ?? 0), 0);
  const overdue = data.tasks.filter((task) => task.nextDueDate && task.nextDueDate < today).length;
  const xp = completions.length * 25;
  const level = Math.floor(xp / 200) + 1;
  const levelProgress = xp % 200;
  const completedDates = new Set(completions.map((completion) => dateKey(new Date(completion.completedAt))));
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - 3 + index); return date; });
  byId("app-content").innerHTML = `
    <section class="streak-hero">
      <div class="hero-illustration" aria-hidden="true"><span class="illustration-halo"></span><span class="illustration-bowl"></span><span class="illustration-leaf leaf-one"></span><span class="illustration-leaf leaf-two"></span><i data-lucide="sparkles"></i></div>
      <div class="hero-copy"><span class="hero-kicker"><i data-lucide="sparkles"></i> ${stats.currentStreak ? "Momentum is building" : "Your week at a glance"}</span><h2>${stats.currentStreak ? "You’re on a roll." : data.tasks.length ? "Ready when you are." : "Build a lighter routine."}</h2><p>${stats.currentStreak} day streak · ${visible.length ? `${visible.length} task${visible.length === 1 ? "" : "s"} ready` : data.tasks.length ? "everything is in its place" : "start with one room"}</p>
        <div class="week-track" aria-label="Recent daily activity">${days.map((day) => { const key = dateKey(day); const done = completedDates.has(key); const isToday = key === today; return `<span class="day-dot ${done ? "done" : ""} ${isToday ? "today" : ""}"><b>${done ? "✓" : day.toLocaleDateString(undefined, { weekday: "narrow" })}</b><small>${day.toLocaleDateString(undefined, { weekday: "short" })}</small></span>`; }).join("")}</div>
      </div><div class="hero-action"><span><i data-lucide="flame"></i><strong>${stats.currentStreak}</strong><small>day streak</small></span><button data-action="${data.tasks.length ? "jump-tasks" : "add-room"}">${data.tasks.length ? "View today’s tasks" : "Add a room"}<i data-lucide="chevron-right"></i></button></div>
    </section>
    <div class="metric-grid dashboard-metrics">
      ${metric("circle-check-big", stats.completionCount, "Done in 30 days", "mint")}${metric("flame", stats.currentStreak, "Day streak", "yellow")}${metric("zap", formatMinutes(effortToday), "Effort today", "blue")}${metric("circle-alert", overdue, "Missed dates", "coral")}
    </div>
    <div class="dashboard-grid">
      <section class="dashboard-panel task-panel"><div class="section-heading"><div><p class="section-kicker">On deck</p><h2>Upcoming tasks</h2></div><div class="segmented" aria-label="Task filter"><button class="${taskFilter === "due" ? "active" : ""}" data-action="filter" data-filter="due">Due now</button><button class="${taskFilter === "all" ? "active" : ""}" data-action="filter" data-filter="all">All</button></div></div>
        ${visible.length ? `<div class="task-list">${visible.map((task) => taskRow(task)).join("")}</div>` : `<div class="compact-empty"><i data-lucide="circle-check-big"></i><div><h3>You are caught up</h3><p>Switch to All to see what is coming next.</p></div></div>`}
        <button class="add-row" data-action="add-task" aria-label="Add task"><i data-lucide="plus"></i>Add new task</button>
      </section>
      <div class="dashboard-side">
        <section class="dashboard-panel room-progress"><div class="section-heading"><div><p class="section-kicker">By space</p><h2>Room progress</h2></div><span class="count-badge">${data.rooms.length}</span></div>${data.rooms.map((room, index) => roomProgress(room, index, completedDates)).join("") || `<p class="summary-line">Add a room to start shaping your home.</p>`}</section>
        <section class="xp-panel"><div class="xp-badge"><i data-lucide="award"></i></div><div class="xp-copy"><p>Level ${level}</p><h2>${level < 3 ? "Fresh Starter" : level < 6 ? "Tidy Explorer" : "Home Hero"}</h2><div class="xp-track"><span style="--progress:${levelProgress / 2}%"></span></div><small>${levelProgress} / 200 XP to level ${level + 1}</small></div><div class="xp-reward" title="Next reward"><i data-lucide="gift"></i></div></section>
      </div>
    </div>`;
}

function taskRow(task: TaskRecord, completed = false): string {
  const room = roomFor(task);
  const due = dueLabel(task.nextDueDate);
  const roomIndex = Math.max(0, data.rooms.findIndex((item) => item.id === room?.id));
  return `<article class="task-row">
    <button class="complete-button" data-action="complete" data-id="${task.id}" aria-label="Complete ${escape(task.name)}" ${completed ? "disabled" : ""}><i data-lucide="${completed ? "check" : "circle-check"}"></i></button>
    <div class="task-main"><div class="task-name">${escape(task.name)}</div><div class="task-meta">${task.estimatedMinutes ? `<span><i data-lucide="clock"></i>${task.estimatedMinutes} min</span>` : ""}<span class="tone-${due.tone}"><i data-lucide="calendar-days"></i>${escape(due.label)}</span><span class="room-pill room-tone-${roomIndex % 5}">${escape(room?.name ?? "No room")}</span></div></div>
    <details class="action-menu"><summary class="icon-button" aria-label="Actions for ${escape(task.name)}"><i data-lucide="more-horizontal"></i></summary><div class="action-popover"><button data-action="edit-task" data-id="${task.id}"><i data-lucide="pencil"></i>Edit</button><button class="danger" data-action="delete-task" data-id="${task.id}"><i data-lucide="trash-2"></i>Delete</button></div></details>
  </article>`;
}

function roomProgress(room: RoomRecord, index: number, completedDates: Set<string>): string {
  const tasks = data.tasks.filter((task) => task.roomId === room.id);
  const completed = new Set(data.completions.filter((completion) => completedDates.has(dateKey(new Date(completion.completedAt)))).map((completion) => completion.taskId));
  const done = tasks.filter((task) => completed.has(task.id)).length;
  const progress = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  return `<div class="room-progress-row"><span class="room-mark room-tone-${index % 5}">${escape(room.name.slice(0, 1).toUpperCase())}</span><div><strong>${escape(room.name)}</strong><div class="progress-track"><span class="room-tone-${index % 5}" style="--progress:${progress}%"></span></div></div><small>${done} / ${tasks.length}</small></div>`;
}

function renderStats(): void {
  const profile = data.profiles.find((item) => item.id === data.settings.activeProfileId);
  const profileCompletions = data.completions.filter((completion) => !profile || completion.profileId === profile.id);
  const stats = calculateStatistics({ ...data, completions: profileCompletions }, statsRange);
  const maxActivity = Math.max(1, ...stats.activity.map((day) => day.count));
  const bestWeekday = [...stats.weekdays].sort((a, b) => b.count - a.count)[0];
  byId("app-content").innerHTML = `
    <div class="filter-bar stats-filter"><div><p class="section-kicker">Your rhythm</p><h2 class="view-intro">Progress, with personality.</h2></div><div class="segmented" aria-label="Statistics range">${(["30", "90", "all"] as const).map((range) => `<button class="${statsRange === range ? "active" : ""}" data-action="range" data-range="${range}">${range === "all" ? "All time" : `${range} days`}</button>`).join("")}</div></div>
    <div class="metric-grid stats-metrics">
      ${metric("circle-check-big", stats.completionCount, "Tasks completed", "mint")}${metric("timer", formatMinutes(stats.estimatedMinutes), "Time invested", "blue")}${metric("flame", stats.currentStreak, "Current streak", "yellow")}${metric("award", bestWeekday?.count ? bestWeekday.label : "–", "Favorite day", "lavender")}
    </div>
    <div class="stats-layout">
      <section class="dashboard-panel activity-panel"><div class="section-heading"><div><p class="section-kicker">Daily pulse</p><h2>Momentum</h2><p>${stats.averagePerWeek.toFixed(1)} tasks per week · ${stats.activeDays} active days</p></div><span class="chart-total">${stats.completionCount}</span></div><div class="activity-chart" aria-label="Daily completions">${stats.activity.map((day, index) => `<span class="activity-bar tone-${index % 5}" style="--value:${day.count / maxActivity}" title="${formatDay(day.date)}: ${day.count}"><b>${day.count || ""}</b></span>`).join("")}</div></section>
      <section class="dashboard-panel rhythm-panel"><div class="section-heading"><div><p class="section-kicker">Weekly shape</p><h2>Weekday rhythm</h2></div></div>${bubbleBars(stats.weekdays)}</section>
      <section class="room-breakdown"><div class="section-heading"><div><p class="section-kicker">Where it happened</p><h2>Rooms in motion</h2></div></div><div class="room-rank-grid">${stats.rooms.slice(0, 8).map((room, index) => `<article class="room-rank room-tone-${index % 5}"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escape(room.name)}</strong><small>${formatMinutes(room.minutes)} invested</small></div><b>${room.completions}</b></article>`).join("") || `<p class="summary-line">No room activity in this range.</p>`}</div></section>
      <section class="dashboard-panel time-panel"><div class="section-heading"><div><p class="section-kicker">Your tempo</p><h2>Time of day</h2></div></div>${miniBars(stats.times)}</section>
      <section class="dashboard-panel top-task-panel"><div class="section-heading"><div><p class="section-kicker">Repeat favorites</p><h2>Top tasks</h2></div></div><div class="rank-list">${stats.tasks.slice(0, 5).map((task, index) => `<div class="rank-row"><span class="rank-number">${index + 1}</span><div><strong>${escape(task.name)}</strong><small>${escape(task.room)}</small></div><b>${task.completions}</b></div>`).join("") || `<p class="summary-line">Complete a task to start your ranking.</p>`}</div></section>
    </div>`;
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
  byId("app-content").innerHTML = `<div class="settings-layout"><div class="settings-main">
    <section class="settings-block home-settings"><div class="section-heading"><div><p class="section-kicker">Foundation</p><h2>Home</h2><p>Name and organize your local plan.</p></div></div><div class="home-name-setting"><div><h3>Home name</h3><p>Used when exporting your complete plan.</p></div><input id="home-name-input" value="${escape(data.settings.homeName)}" maxlength="120" aria-label="Home name" /></div></section>
    <section class="settings-block"><div class="section-heading"><div><p class="section-kicker">People</p><h2>Profiles</h2><p>Choose who is completing tasks.</p></div><button class="button secondary" data-action="add-profile"><i data-lucide="plus"></i>Add profile</button></div><div class="profile-list">${data.profiles.map((profile) => `<article class="profile-row"><span class="profile-avatar" style="--profile-color:${escape(profile.color)}">${escape(profile.name.slice(0, 1).toUpperCase())}</span><div><strong>${escape(profile.name)}</strong><small>${profile.id === data.settings.activeProfileId ? "Active profile" : "Household member"}</small></div><details class="action-menu"><summary class="icon-button" aria-label="Actions for ${escape(profile.name)}"><i data-lucide="more-horizontal"></i></summary><div class="action-popover"><button data-action="edit-profile" data-id="${profile.id}"><i data-lucide="pencil"></i>Edit</button><button class="danger" data-action="delete-profile" data-id="${profile.id}" ${data.profiles.length <= 1 ? "disabled" : ""}><i data-lucide="trash-2"></i>Remove</button></div></details></article>`).join("")}</div></section>
    <section class="settings-block"><div class="section-heading"><div><p class="section-kicker">Spaces</p><h2>Rooms</h2><p>${data.rooms.length} room${data.rooms.length === 1 ? "" : "s"} in your routine.</p></div><button class="button secondary" data-action="add-room"><i data-lucide="plus"></i>Add room</button></div><div class="room-list">${data.rooms.map((room, index) => { const count = data.tasks.filter((task) => task.roomId === room.id).length; return `<article class="room-row room-tone-${index % 5}"><span class="room-icon"><i data-lucide="door-open"></i></span><div><strong>${escape(room.name)}</strong><small>${count} task${count === 1 ? "" : "s"}${room.notes ? ` · ${escape(room.notes)}` : ""}</small></div><details class="action-menu"><summary class="icon-button" aria-label="Actions for ${escape(room.name)}"><i data-lucide="more-horizontal"></i></summary><div class="action-popover"><button data-action="export-room" data-id="${room.id}"><i data-lucide="download"></i>Export room</button><button data-action="edit-room" data-id="${room.id}"><i data-lucide="pencil"></i>Edit</button><button class="danger" data-action="delete-room" data-id="${room.id}"><i data-lucide="trash-2"></i>Delete</button></div></details></article>`; }).join("") || `<p class="summary-line">No rooms yet.</p>`}</div></section>
    <section class="settings-block"><div class="section-heading"><div><p class="section-kicker">Portable by design</p><h2>Plan files</h2><p>Move plans between nesti. apps.</p></div></div><div class="file-actions"><article><span class="file-action-icon mint"><i data-lucide="upload"></i></span><div><h3>Import .nesti plan</h3><p>Validate and append a compatible plan.</p></div><button class="button secondary" data-action="import">Import</button></article><article><span class="file-action-icon yellow"><i data-lucide="download"></i></span><div><h3>Export entire home</h3><p>Download a portable version 1 plan.</p></div><button class="button secondary" data-action="export" ${data.rooms.length ? "" : "disabled"}>Export</button></article></div></section>
    ${syncDetails.conflicts.length ? `<section class="settings-block"><div class="section-heading"><div><p class="section-kicker">Needs attention</p><h2>Sync conflicts</h2></div></div><div class="settings-section">${syncDetails.conflicts.map((conflict) => `<div class="setting-row"><div><h3>${escape(conflict.entityType)} changed in two places</h3><p>${escape(conflict.reason.replaceAll("_", " "))}</p></div><div class="inline-actions"><button class="button secondary" data-action="resolve-server" data-id="${conflict.id}">Use server</button>${conflict.reason !== "deleted" ? `<button class="button primary" data-action="resolve-local" data-id="${conflict.id}">Keep this device</button>` : ""}</div></div>`).join("")}</div></section>` : ""}
  </div><aside class="settings-aside"><div class="storage-panel"><span class="storage-icon"><i data-lucide="${connection ? "database" : "cloud-off"}"></i></span><p class="section-kicker">Storage</p><h2>${connection ? "PostgreSQL home" : "Server unavailable"}</h2><p>${syncDescription}</p><div class="storage-facts"><span>${escape(syncRuntime.message)}</span>${connection ? `<span>Last saved: ${escape(lastSync)}</span><span>${syncDetails.pending} pending change${syncDetails.pending === 1 ? "" : "s"}</span>` : ""}</div>${connection ? `<button class="button secondary" data-action="sync-now"><i data-lucide="refresh-cw"></i>Save now</button>` : `<button class="button secondary" data-action="sync-connect"><i data-lucide="refresh-cw"></i>Retry server</button>`}<button class="button secondary" data-action="notifications"><i data-lucide="${notificationState === "granted" ? "bell" : "bell-off"}"></i>${notificationState === "granted" ? "Reminders enabled" : notificationState === "unsupported" ? "Reminders unavailable" : "Enable reminders"}</button></div><section class="utility-panel"><div><span>File format</span><strong>.nesti version 1</strong></div><div><span>Local data</span><button class="button danger" data-action="reset">Delete</button></div></section></aside></div>`;
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

function metric(icon: string, value: string | number, label: string, tone = "mint"): string { return `<div class="metric ${tone}"><i class="metric-icon" data-lucide="${icon}"></i><strong>${value}</strong><span>${label}</span></div>`; }
function miniBars(values: Array<{ label: string; count: number }>): string { const max = Math.max(1, ...values.map((item) => item.count)); return `<div class="mini-bars">${values.map((item) => `<div class="mini-bar"><span>${item.label}</span><div class="mini-bar-track"><div class="mini-bar-fill" style="--value:${item.count / max}"></div></div><b>${item.count}</b></div>`).join("")}</div>`; }
function bubbleBars(values: Array<{ label: string; count: number }>): string { const max = Math.max(1, ...values.map((item) => item.count)); return `<div class="bubble-bars">${values.map((item) => `<div class="bubble-bar" style="--value:${item.count / max}"><i>${item.count}</i><span>${escape(item.label.slice(0, 3))}</span></div>`).join("")}</div>`; }
function formatMinutes(value: number): string { if (value < 60) return `${value}m`; const hours = Math.floor(value / 60); const minutes = value % 60; return minutes ? `${hours}h ${minutes}m` : `${hours}h`; }
function toast(message: string, error = false): void { const element = byId("toast"); element.textContent = message; element.classList.toggle("error", error); element.classList.add("show"); window.setTimeout(() => element.classList.remove("show"), 2800); }
