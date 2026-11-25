// End-to-end Adjust UI test: upload, Check overlaps, apply the suggestion, re-check, manual crop, order kept.
// Run from repo root: node museum-rollout-reconstruction/overlap-aware-crop/check-ui.cjs
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "../..");
(async () => {
  const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]).replace(/^\/$/, "/index.html"));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".html") ? "text/html" : "image/jpeg" }); fs.createReadStream(f).pipe(r); }).listen(0);
  await new Promise((res) => srv.on("listening", res));
  const b = await chromium.launch(), errs = [];
  for (const [set, manual] of [["lacma-168693", false], ["lacma-168693", true], ["lacma-168596", false]]) {
    const p = await b.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.route(/googletag|fonts\.g|hf\.space/, (r) => r.abort());
    await p.goto(`http://localhost:${srv.address().port}/`);
    await p.setInputFiles("input[type=file]", ["01", "02", "03", "04"].map((n) => `${ROOT}/test-sets/${set}/photos/${n}.jpg`));
    await p.waitForFunction(() => imgs.length === 4 && imgs.every((i) => i.b), null, { timeout: 60000 });
    const seqBefore = await p.evaluate(() => imgs.map((i) => i.seq));
    if (manual) await p.evaluate(() => { imgs[2].cropL = 0.2; }); // user dragged photo 3's left handle
    await p.evaluate(() => { rebuildStripCache(); renderAdjust(); });
    await p.click("text=Check overlaps");
    await p.waitForFunction(() => !/Checking/.test(document.getElementById("cropNote").textContent), null, { timeout: 60000 });
    const note = await p.textContent("#cropNote"), hasApply = await p.$("text=Use wider crop on those edges");
    let after = null, recheck = null;
    if (hasApply) {
      await hasApply.click();
      after = await p.evaluate(() => imgs.map((i) => [+i.cropL.toFixed(2), +i.cropR.toFixed(2)]));
      await p.click("text=Check overlaps");
      await p.waitForFunction(() => !/Checking|Wider/.test(document.getElementById("cropNote").textContent), null, { timeout: 60000 });
      recheck = await p.textContent("#cropNote");
    }
    const seqAfter = await p.evaluate(() => imgs.map((i) => i.seq));
    console.log(`\n${set}${manual ? " (photo 3 left crop set by hand)" : ""}\n  note: ${note}\n  crops after apply: ${JSON.stringify(after)}\n  recheck: ${recheck}\n  order unchanged: ${JSON.stringify(seqBefore) === JSON.stringify(seqAfter)}`);
    await p.close();
  }
  console.log("page errors:", errs);
  await b.close(); srv.close();
})();
