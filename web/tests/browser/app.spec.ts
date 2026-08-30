import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("nesti"));
  await page.reload();
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
