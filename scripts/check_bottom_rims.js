#!/usr/bin/env node
/* Regression checks for dark-backdrop photos. Needs Playwright + Chromium.
   Add --include-real after fetching lacma-168564 to check the shallow-band regression too. */
const assert = require("node:assert/strict");
const fs = require("node:fs"), http = require("node:http"), path = require("node:path");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");

(async function () {
  const server = http.createServer((request, response) => {
    const file = path.resolve(ROOT, "." + decodeURIComponent(request.url.split("?")[0]));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404); response.end(); return;
    }
    const types = { ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".html": "text/html" };
    response.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(response);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch(); const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/eval/harness.html`);
    const labels = JSON.parse(fs.readFileSync(path.join(ROOT, "test-sets/labels.json"), "utf8"));
    const keys = ["bottom-rim-regression/photos/01.png", "bottom-rim-regression/photos/02.png"];
    if (process.argv.includes("--include-real")) keys.push("lacma-168564/photos/04.jpg");
    for (const key of keys) assert.ok(fs.existsSync(path.join(ROOT, "test-sets", key)), "Fetch the fixture first: " + key);
    const results = await page.evaluate(async ({ labels, keys }) => {
      const rows = [];
      for (const key of keys) {
        const file = key.split("/").pop(), original = await loadCanvas("/test-sets/" + key);
        for (const scale of [0.75, 1, 1.5]) {
          const cv = document.createElement("canvas"); cv.width = Math.round(original.width * scale); cv.height = Math.round(original.height * scale);
          cv.getContext("2d").drawImage(original, 0, 0, cv.width, cv.height);
          const truth = labelTruth(labels[key], cv.width, cv.height);
          // Repeated reads exercise the canvas scaling path used by the preview and re-detection.
          for (let read = 0; read < 3; read++) {
            const bounds = RIM2.detect(cv), h = (labels[key].bot[2][1] - labels[key].top[2][1]) * cv.height;
            rows.push({ file, scale, read, bottomErrorPct: rimError(bounds, truth).bot,
              endErrorPct: sideError(bounds, truth).bot,
              middleErrorPct: 100 * Math.abs(bounds.botH[1].y - labels[key].bot[2][1] * cv.height) / h });
          }
        }
      }
      return rows;
    }, { labels, keys });
    console.table(results);
    for (const result of results) {
      assert.ok(result.bottomErrorPct < 2, JSON.stringify(result));
      assert.ok(result.middleErrorPct < 2, JSON.stringify(result));
      assert.ok(result.endErrorPct < 5, JSON.stringify(result));
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: "domcontentloaded" });
    for (const file of ["01.png", "02.png"]) {
      await page.locator("#fi").setInputFiles(path.join(ROOT, "test-sets/bottom-rim-regression/photos", file));
      await page.waitForFunction(count => imgs.length === count, Number(file.slice(0, 2)));
    }
    assert.equal(await page.locator("#btnNext").isDisabled(), false);
    const uploadResults = await page.evaluate(labels => imgs.map((im, i) => {
      const label = labels["bottom-rim-regression/photos/0" + (i + 1) + ".png"];
      const height = (label.bot[2][1] - label.top[2][1]) * im.cv.height;
      return 100 * Math.abs(im.b.botH[1].y - label.bot[2][1] * im.cv.height) / height;
    }), labels);
    assert.ok(uploadResults.every(error => error < 2), JSON.stringify(uploadResults));
    await page.locator("#btnNext").click();
    assert.equal(await page.evaluate(() => cur), 1);
    fs.mkdirSync(path.join(ROOT, "eval/out"), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, "eval/out/bottom-rim-fix.png"), fullPage: true });
    console.log("Base regressions passed at three image sizes, repeated canvas reads, and Upload → Map Rims.");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
