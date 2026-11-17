#!/usr/bin/env node
/* Run every rim-detection pipeline (eval/pipelines.js) on synthetic cylinders and the real
   test sets, then write eval/out/report.html (visual, self-contained) and eval/out/scores.json.
   Usage: node scripts/eval.js        (needs Playwright + Chromium; real sets need fetch_test_sets.py first) */
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, ".."), OUT = path.join(ROOT, "eval", "out");

const SYNTH = [
  { id: "close-low", texture: "met", dist: 3, elev: 15 },
  { id: "mid-dark", texture: "met", dist: 6, elev: 25, bg: [45, 45, 48] },
  { id: "far-flat", texture: "met", dist: 12, elev: 8 },
  { id: "warm-table", texture: "proc", dist: 4, elev: 30, bg: [205, 185, 150] },
  { id: "eye-level", texture: "proc", dist: 8, elev: 3 },
  { id: "high-angle", texture: "met", dist: 5, elev: 40, bg: [150, 150, 155] },
].map((p) => ({ W: 800, H: 1000, rot: 0, ...p, fov: (2 * Math.atan((1.2 * 2.4) / p.dist) * 180) / Math.PI }));

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".jpg": "image/jpeg", ".css": "text/css" };
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      const f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(r);
    }).listen(0, () => res(s));
  });
}

function realCases() {
  const dir = path.join(ROOT, "test-sets"), cases = [], rollouts = {};
  for (const set of fs.readdirSync(dir)) {
    for (const sub of ["photos", "rollout"]) {
      const p = path.join(dir, set, sub);
      if (!fs.existsSync(p)) continue;
      for (const f of fs.readdirSync(p).filter((f) => /\.jpe?g$/i.test(f)).sort()) {
        const src = `/test-sets/${set}/${sub}/${f}`;
        if (sub === "photos") cases.push({ set, file: f, src });
        else (rollouts[set] = rollouts[set] || []).push(src);
      }
    }
  }
  return { cases, rollouts };
}

const fmt = (v, d = 1) => (v == null ? "–" : v.toFixed(d));
function summarize(cases) {
  const by = {};
  for (const c of cases.filter((c) => c.group === "synthetic"))
    for (const r of c.results) {
      const s = (by[r.name] = by[r.name] || { rimTop: [], rimBot: [], ang: [[], [], []], ms: [] });
      if (r.rim) { s.rimTop.push(r.rim.top); s.rimBot.push(r.rim.bot); }
      if (r.ang) r.ang.forEach((v, i) => v != null && s.ang[i].push(v));
      if (r.ms != null) s.ms.push(r.ms);
    }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const out = {};
  for (const [k, s] of Object.entries(by))
    out[k] = { rimTopPct: mean(s.rimTop), rimBotPct: mean(s.rimBot), angDeg_0_30: mean(s.ang[0]), angDeg_30_60: mean(s.ang[1]), angDeg_60_90: mean(s.ang[2]), ms: mean(s.ms) };
  return out;
}

function report(cases, summary, rollouts) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const sumRows = Object.entries(summary).map(([k, s]) =>
    `<tr><td><span class="sw" style="background:${k === "oracle" ? "#16a34a" : k === "baseline" ? "#f97316" : "#2563eb"}"></span>${esc(k)}</td><td>${fmt(s.rimTopPct)}</td><td>${fmt(s.rimBotPct)}</td><td>${fmt(s.angDeg_0_30)}</td><td>${fmt(s.angDeg_30_60)}</td><td>${fmt(s.angDeg_60_90)}</td><td>${fmt(s.ms, 0)}</td></tr>`).join("");
  const groups = [...new Set(cases.map((c) => c.group))];
  const sections = groups.map((g) => {
    const cs = cases.filter((c) => c.group === g);
    const ro = (rollouts[g] || []).map((d) => `<img class="rollout" src="${d}">`).join("");
    const cards = cs.map((c) => {
      const meta = c.params ? `dist ${c.params.dist}R · elev ${c.params.elev}° · visible ±${fmt(c.visHalfDeg, 0)}°` : "";
      const strips = c.results.map((r) => {
        const m = r.error ? `<span class="err">${esc(r.error)}</span>`
          : (r.rim ? `rim ${fmt(r.rim.top)}% / ${fmt(r.rim.bot)}%` : "") + (r.ang ? ` · angle err ${r.ang.map((v) => fmt(v)).join(" / ")}°` : "");
        return `<div class="strip"><div class="lbl">${esc(r.name)} <span>${m}</span></div>${r.strip ? `<img src="${r.strip}">` : ""}</div>`;
      }).join("");
      return `<div class="case"><div class="ov"><img src="${c.overlay}"><div class="lbl">${esc(c.id)}<br><span>${meta}</span></div></div><div class="strips">${strips}</div></div>`;
    }).join("");
    return `<h2>${esc(g)}</h2>${ro ? `<div class="lbl">Published rollout (ground truth)</div>${ro}` : ""}${cards}`;
  }).join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rollout Eval Report</title><style>
:root{--bg:#fafafa;--fg:#111;--mut:#666;--card:#fff;--bd:#e5e5e5}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--mut:#999;--card:#1e1e1e;--bd:#333}}
body{background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif;margin:0;padding:16px;max-width:1200px;margin:auto}
h1{font-size:20px}h2{font-size:15px;margin-top:32px;border-bottom:1px solid var(--bd);padding-bottom:4px}
table{border-collapse:collapse;font-variant-numeric:tabular-nums;width:100%;max-width:760px}td,th{border-bottom:1px solid var(--bd);padding:4px 8px;text-align:right}td:first-child,th:first-child{text-align:left}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
.case{display:flex;gap:12px;background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:10px;margin:10px 0;flex-wrap:wrap}
.ov img{width:220px;border-radius:4px;display:block}.strips{flex:1;min-width:260px;display:flex;flex-direction:column;gap:8px}
.strip img{max-width:100%;max-height:170px;display:block;border-radius:4px}.lbl{font-size:12px;font-weight:600;margin:4px 0}.lbl span{font-weight:400;color:var(--mut)}
.rollout{max-width:100%;border-radius:4px;margin-bottom:8px}.err{color:#dc2626}.note{color:var(--mut);max-width:760px}
</style></head><body>
<h1>Rollout Studio eval</h1>
<p class="note">Rims: <b style="color:#16a34a">green dashed</b> = truth (synthetic only), <b style="color:#f97316">orange</b> = baseline (auto on upload), <b style="color:#2563eb">blue</b> = baseline + Snap. Strips are each pipeline's unwarp; "oracle" uses perfect rims, so its error is purely the unwarp's flat-projection model.</p>
<h2>Synthetic summary (mean over ${cases.filter((c) => c.group === "synthetic").length} scenes)</h2>
<table><tr><th>pipeline</th><th>top rim err %H</th><th>bottom rim err %H</th><th>angle err 0–30°</th><th>30–60°</th><th>60–90°</th><th>ms</th></tr>${sumRows}</table>
<p class="note">Rim error: mean vertical distance from the true rim, as % of vessel height. Angle error: median degrees between where the unwarp places content and where it truly is on the cylinder, by distance from the facing direction.</p>
${sections}</body></html>`;
}

(async () => {
  const srv = await serve(), base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch(), page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`${base}/eval/harness.html`);
  const { cases: real, rollouts } = realCases();
  const cases = await page.evaluate((job) => runEval(job), { synth: SYNTH, real, metRollout: "/test-sets/met-310364/rollout/02.jpg", metCrop: [0.065, 0.2, 0.935, 0.865] });
  const roData = {};
  for (const [set, srcs] of Object.entries(rollouts))
    roData[set] = await page.evaluate(async (s) => Promise.all(s.map(async (u) => toJpeg(await loadCanvas(u), 1100))), srcs);
  await browser.close(); srv.close();
  const summary = summarize(cases);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "report.html"), report(cases, summary, roData));
  fs.writeFileSync(path.join(OUT, "scores.json"), JSON.stringify({ summary, cases: cases.map(({ overlay, results, ...c }) => ({ ...c, results: results.map(({ strip, ...r }) => r) })) }, null, 1));
  console.table(Object.fromEntries(Object.entries(summary).map(([k, s]) => [k, Object.fromEntries(Object.entries(s).map(([a, v]) => [a, v == null ? null : +v.toFixed(2)]))])));
  console.log("wrote", path.relative(ROOT, path.join(OUT, "report.html")));
})();
