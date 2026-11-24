#!/usr/bin/env node
/* Straightness score for auto-rectify.
   Ground truth: test-sets/rectify-labels.json, made with eval/label-lines.html. Each stitched
   panorama has polylines traced along painted lines that should be straight and level.
   For each panorama this runs the app's own auto-detection (AUTORECT.bandLines) and maps every
   labelled line through the same per-column remap doRectify() applies, then reports how far the
   line is from level: RMS and max deviation as % of the rectified band height, before and after.
   Usage: node scripts/eval-rectify.js        (needs Playwright + Chromium)
   PROFILE=1 scores the experimental painted-band alignment instead of the default outline lines. */
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
const labels = JSON.parse(fs.readFileSync(path.join(ROOT, "test-sets/rectify-labels.json"), "utf8"));
const stitched = JSON.parse(fs.readFileSync(path.join(ROOT, "test-sets/stitched.json"), "utf8")).sets;

(async () => {
  const server = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "/index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    const ext = path.extname(f);
    r.writeHead(200, { "Content-Type": ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : ext === ".html" ? "text/html" : "image/jpeg" });
    fs.createReadStream(f).pipe(r);
  }).listen(0);
  const port = await new Promise((res) => server.on("listening", () => res(server.address().port)));
  const browser = await chromium.launch(), page = await browser.newPage();
  await page.route(/googletag|fonts\.g/, (r) => r.abort());
  await page.goto(`http://localhost:${port}/`);
  if (process.env.PROFILE) await page.evaluate(() => { window.PROFILE = true; });
  const rows = [];
  for (const [id, lab] of Object.entries(labels)) {
    const s = stitched.find((x) => x.id === id);
    if (!s || !fs.existsSync(path.join(ROOT, s.file))) { rows.push({ id, missing: true }); continue; }
    rows.push(await page.evaluate(async ({ id, file, lines }) => {
      const im = new Image(); im.src = "/" + file; await im.decode();
      const cv = document.createElement("canvas"); cv.width = im.width; cv.height = im.height; cv.getContext("2d").drawImage(im, 0, 0);
      const W = cv.width, H = cv.height; AUTORECT.experimentalProfile = !!window.PROFILE; const auto = AUTORECT.bandLines(cv);
      // the remap doRectify() applies, inverted for a source point (x, srcY) -> output y
      function mapper(top, bot) {
        const tS = [], bS = [];
        for (let x = 0; x < W; x += Math.max(1, Math.round(W / 200))) { tS.push(interpPolylineX(top, x)); bS.push(interpPolylineX(bot, x)); }
        const fT = med(tS), fB = med(bS), fSpan = Math.max(1, fB - fT);
        return { span: fSpan, map: (x, y) => {
          const cT = interpPolylineX(top, x), cB = interpPolylineX(bot, x), cSpan = Math.max(1, cB - cT);
          if (y <= cT) return y - (cT - fT); if (y >= cB) return y - (cB - fB); return fT + (y - cT) / cSpan * fSpan;
        } };
      }
      const identity = { span: null, map: (x, y) => y };
      function score(m, bandH) {
        return lines.map((ln) => {
          const pts = ln.map((p) => ({ x: p[0] * W, y: p[1] * H })).sort((a, b) => a.x - b.x), ys = [];
          for (let x = pts[0].x; x <= pts[pts.length - 1].x; x += W / 400) ys.push(m.map(x, interpPolylineX(pts, x)));
          const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
          const rms = Math.sqrt(ys.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ys.length), max = Math.max(...ys.map((v) => Math.abs(v - mean)));
          return { rmsPct: 100 * rms / bandH, maxPct: 100 * max / bandH };
        });
      }
      const bandH = auto ? mapper(auto.top, auto.bot).span : H * 0.7;
      return { id, auto: !!auto, reason: AUTORECT.reason, before: score(identity, bandH), after: auto ? score(mapper(auto.top, auto.bot), bandH) : null };
    }, { id, file: s.file, lines: lab.lines }));
  }
  await browser.close(); server.close();
  const fmt = (v) => v == null ? "-" : v.toFixed(2);
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const B = [], A = [];
  console.log("panorama".padEnd(44), "lines", "before rms/max %", "after rms/max %");
  for (const r of rows) {
    if (r.missing) { console.log(r.id.padEnd(44), "missing stitched image"); continue; }
    const b = r.before, a = r.after;
    b.forEach((x) => B.push(x.rmsPct)); if (a) a.forEach((x) => A.push(x.rmsPct));
    console.log(r.id.padEnd(44), String(b.length).padEnd(5),
      (fmt(avg(b.map((x) => x.rmsPct))) + " / " + fmt(avg(b.map((x) => x.maxPct)))).padEnd(16),
      a ? fmt(avg(a.map((x) => x.rmsPct))) + " / " + fmt(avg(a.map((x) => x.maxPct))) : "declined (" + r.reason + ")");
  }
  console.log("\nMean RMS deviation from level, % of band height: before", fmt(avg(B)), "-> after", fmt(avg(A)), `(${A.length} lines)`);
  fs.mkdirSync(path.join(ROOT, "eval/out"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "eval/out/rectify-scores.json"), JSON.stringify(rows, null, 1));
})();
