/*
 * End-to-end check against the REAL running backend + frontend (no mocks).
 *
 *   1. start the API:      uvicorn backend.app.main:app --port 8000
 *   2. start the frontend: (cd frontend && npm run dev)
 *   3. run:                node tests/e2e/e2e.cjs
 *
 * Point at a deployment with E2E_APP_URL / E2E_API_URL.
 * Requires Playwright (`npm i -g playwright && npx playwright install chromium`,
 * or set NODE_PATH to a folder that contains it).
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const APP = process.env.E2E_APP_URL || "http://localhost:5173";
const API = process.env.E2E_API_URL || "http://localhost:8000";
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log("PASS", name);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
    console.log("FAIL", name, "\n   ", e.message.split("\n")[0]);
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  const info = await (await fetch(`${API}/model-info`)).json();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fraudlens-e2e-"));

  await step("landing loads with real figures and no auth pages", async () => {
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: /catch more fraud/i }).waitFor();
    const net = Math.round(info.test_metrics.net_benefit).toLocaleString("en-US");
    await page.getByText(`€${net}`).first().waitFor();
    assert.equal(await page.getByText(/sign in|log in|sign up|password/i).count(), 0);
  });

  await step("dashboard threshold slider changes real metrics", async () => {
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    const kpi = page.getByTestId("kpi-net");
    await page.waitForFunction(() => /€\d/.test(document.querySelector('[data-testid="kpi-net"]')?.textContent || ""));
    const before = await kpi.textContent();
    const box = page.getByLabel("Threshold value");
    await box.fill("0.90");
    await box.press("Enter");
    const expected = await (await fetch(`${API}/analytics/threshold?threshold=0.9`)).json();
    await page.waitForFunction((v) => document.querySelector('[data-testid="kpi-net"]').textContent.includes(v), expected.net_benefit.toLocaleString("en-US", { minimumFractionDigits: 2 }));
    assert.notEqual(await kpi.textContent(), before);
    await page.getByRole("button", { name: /use recommended/i }).click();
    await page.getByRole("table", { name: /confusion matrix/i }).waitFor();
  });

  await step("check page scores the fraud sample with SHAP and money impact", async () => {
    await page.goto(`${APP}/check`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^fraud$/i }).click();
    await page.getByRole("button", { name: /check transaction/i }).click();
    await page.getByText("Why this decision?").waitFor();
    await page.locator(".badge-block").first().waitFor();
    await page.getByText(/estimated financial impact/i).waitFor();
    await page.locator(".history-item").first().waitFor();
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: /download report/i }).click();
    const file = path.join(tmp, "report.html");
    await (await dl).saveAs(file);
    assert.match(fs.readFileSync(file, "utf8"), /FraudLens transaction report/);
  });

  await step("legitimate sample is approved", async () => {
    await page.getByRole("button", { name: /^legitimate$/i }).click();
    await page.getByRole("button", { name: /check transaction/i }).click();
    await page.locator(".dial .badge-approve").waitFor();
  });

  await step("invalid input is rejected in the browser", async () => {
    await page.getByLabel("Amount (€)").fill("-5");
    await page.getByRole("button", { name: /check transaction/i }).click();
    await page.getByText(/use 0 to 100,000/i).waitFor();
  });

  await step("batch CSV upload scores rows and downloads results", async () => {
    await page.goto(`${APP}/batch`, { waitUntil: "networkidle" });
    const csv = await (await fetch(`${API}/samples/batch.csv`)).text();
    const file = path.join(tmp, "batch.csv");
    fs.writeFileSync(file, csv);
    await page.setInputFiles('input[type="file"]', file);
    await page.getByText(/20 valid transactions ready/i).waitFor();
    await page.getByRole("button", { name: /score batch/i }).click();
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: /download results csv/i }).click();
    const out = path.join(tmp, "results.csv");
    await (await dl).saveAs(out);
    const lines = fs.readFileSync(out, "utf8").trim().split("\n");
    assert.equal(lines.length, 21);
    assert.ok(lines.filter((l) => l.includes(",Block,")).length >= 1);
  });

  await step("model page shows dataset and comparison", async () => {
    await page.goto(`${APP}/model`, { waitUntil: "networkidle" });
    await page.getByText(/model comparison/i).waitFor();
    await page.getByText(/Database Contents License/).waitFor();
  });

  await step("mobile layout has no horizontal overflow", async () => {
    const m = await browser.newPage({ viewport: { width: 375, height: 800 } });
    for (const p of ["/", "/dashboard", "/check", "/batch", "/model"]) {
      await m.goto(`${APP}${p}`, { waitUntil: "networkidle" });
      const sw = await m.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(sw <= 375, `${p} scrollWidth ${sw}`);
    }
    await m.close();
  });

  await step("no console errors", async () => assert.deepEqual(consoleErrors, []));

  await browser.close();
  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log(`\n${results.length - failed}/${results.length} E2E checks passed`);
  process.exit(failed ? 1 : 0);
})();
