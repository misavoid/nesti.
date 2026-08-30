import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("creates a room and recurring task, then completes it", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Build your cleaning rhythm" })).toBeVisible();
  await page.getByRole("button", { name: "Add a room" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Kitchen");
  await page.getByRole("button", { name: "Save room" }).click();
  await page.getByRole("button", { name: "New task" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Wipe counters");
  await dialog.getByLabel("Estimate (minutes)").fill("10");
  await dialog.getByLabel("Schedule").selectOption("interval");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByText("Wipe counters", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Complete Wipe counters" }).click();
  await expect(page.getByRole("heading", { name: "You are caught up" })).toBeVisible();
});

test("renders the full navigation at a mobile viewport", async ({ page }) => {
  for (const label of ["Tasks", "Stats", "Play", "Settings"]) await expect(page.getByRole("button", { name: label }).last()).toBeVisible();
});

test("creates and selects a household profile", async ({ page }) => {
  await page.getByRole("button", { name: "Settings" }).last().click();
  await expect(page.getByText("Your plan is stored only in this browser until you connect it to your nesti. server.")).toBeVisible();
  await page.getByRole("button", { name: "Add profile" }).click();
  const dialog = page.getByRole("dialog", { name: "New profile" });
  await dialog.getByLabel("Name").fill("Alex");
  await dialog.getByRole("button", { name: "Save profile" }).click();
  await page.getByLabel("Active profile").selectOption({ label: "Alex" });
  await page.reload();
  await expect(page.getByLabel("Active profile")).toHaveValue(await page.evaluate(async () => {
    const request = indexedDB.open("nesti", 2);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction("profiles", "readonly");
    const all = tx.objectStore("profiles").getAll();
    return new Promise<string>((resolve) => { all.onsuccess = () => resolve((all.result as Array<{ id: string; name: string }>).find((profile) => profile.name === "Alex")!.id); });
  }));
});

test("shows when browser data is committed to PostgreSQL", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Playwright WebKit cannot reliably route service-worker API requests to a mocked sync server.");
  const homeId = "421c47d7-91a1-4ea9-a70b-7dbe85ed149e";
  const profileId = "13a82f7a-2029-4e13-8a5d-40ea958dba88";
  await page.evaluate(async () => { for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister(); });
  await page.reload();
  await page.route("**/api/sync/v1/discovery", (route) => route.fulfill({ json: { name: "Home Server", protocolVersions: [1], authenticationMethods: ["pairing_code"], limits: {} } }));
  await page.route("**/api/sync/v1/enroll", (route) => route.fulfill({ status: 201, json: {
    protocolVersion: 1, deviceToken: "a".repeat(43), deviceId: "c86c28e1-f104-49a0-b780-5daec591b794", homeId,
    snapshot: { protocolVersion: 1, cursor: "2", home: { id: homeId, revision: "1", payload: { name: "Synced Home" } }, profiles: [{ id: profileId, revision: "2", payload: { name: "Alex", color: "#147d64", sortOrder: 0 } }], rooms: [], tasks: [], completions: [] }
  } }));
  let remoteProfileChanged = false;
  await page.route("**/api/sync/v1/sync", (route) => {
    const cursor = (route.request().postDataJSON() as { cursor: string }).cursor;
    const changes = remoteProfileChanged && cursor === "2" ? [{
      cursor: "3", entityType: "profile", entityId: profileId, operation: "upsert", revision: "3",
      payload: { name: "Sam", color: "#147d64", sortOrder: 0 }
    }] : [];
    return route.fulfill({ json: { protocolVersion: 1, cursor: changes.length ? "3" : cursor, hasMore: false, acknowledgements: [], conflicts: [], changes } });
  });
  await page.getByRole("button", { name: "Settings" }).last().click();
  await expect(page.getByRole("heading", { name: "PostgreSQL home" })).toBeVisible();
  await expect(page.locator("#sync-indicator").getByText(/Loaded from PostgreSQL on Home Server/)).toBeVisible();
  remoteProfileChanged = true;
  await expect(page.getByLabel("Active profile")).toContainText("Sam", { timeout: 10_000 });
});

test("connects another browser without a pairing code", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Playwright WebKit cannot reliably route service-worker API requests to a mocked sync server.");
  const homeId = "421c47d7-91a1-4ea9-a70b-7dbe85ed149e";
  await page.evaluate(async () => { for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister(); });
  await page.reload();
  await page.route("**/api/sync/v1/discovery", (route) => route.fulfill({ json: { name: "Home Server", protocolVersions: [1], authenticationMethods: ["pairing_code"], limits: {} } }));
  await page.route("**/api/sync/v1/enroll", (route) => route.fulfill({ status: 201, json: {
    protocolVersion: 1, deviceToken: "b".repeat(43), deviceId: "c86c28e1-f104-49a0-b780-5daec591b794", homeId,
    snapshot: { protocolVersion: 1, cursor: "1", home: { id: homeId, revision: "1", payload: { name: "My Home" } }, profiles: [], rooms: [], tasks: [], completions: [] }
  } }));
  await page.route("**/api/sync/v1/sync", (route) => route.fulfill({ json: { protocolVersion: 1, cursor: "1", hasMore: false, acknowledgements: [], conflicts: [], changes: [] } }));
  await page.getByRole("button", { name: "Settings" }).last().click();
  await expect(page.getByRole("heading", { name: "PostgreSQL home" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("open-enrollment.png"), fullPage: true });
});

test("previews, appends, and exports a .nesti plan", async ({ page }) => {
  await page.locator("#file-input").setInputFiles({
    name: "home.nesti",
    mimeType: "application/vnd.nesti+json",
    buffer: Buffer.from(JSON.stringify({ version: 1, name: "Imported Home", rooms: [{ name: "Hall", tasks: [{ name: "Sweep floor" }] }] }))
  });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Import plan" })).toBeVisible();
  await expect(dialog.getByText("1", { exact: true })).toHaveCount(2);
  await dialog.getByRole("button", { name: "Append plan" }).click();
  await expect(page.getByText("Sweep floor", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).last().click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect((await download).suggestedFilename()).toMatch(/\.nesti$/);
});

test("renders a framed, nonblank interactive 3D scene", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Play" }).last().click();
  const canvas = page.getByLabel(/Floating island cleanup/);
  await expect(canvas).toBeVisible();
  await expect.poll(async () => canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    return target.width > 300 && target.height > 250;
  })).toBe(true);
  await page.waitForTimeout(1000);
  const pixels = await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext("webgl2") ?? target.getContext("webgl");
    if (!context) return { nonzero: 0, colors: 0 };
    const width = target.width;
    const height = target.height;
    const buffer = new Uint8Array(width * height * 4);
    context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, buffer);
    const colors = new Set<string>();
    let nonzero = 0;
    for (let index = 0; index < buffer.length; index += 160) {
      if (buffer[index + 3]) nonzero += 1;
      colors.add(`${buffer[index]}-${buffer[index + 1]}-${buffer[index + 2]}`);
    }
    return { nonzero, colors: colors.size };
  });
  expect(pixels.nonzero).toBeGreaterThan(100);
  expect(pixels.colors).toBeGreaterThan(2);
  await page.screenshot({ path: testInfo.outputPath("play.png"), fullPage: true });
});

test("reloads the app shell while offline", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Playwright WebKit cannot emulate an offline service-worker reload reliably.");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole("heading", { name: "Build your cleaning rhythm" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
