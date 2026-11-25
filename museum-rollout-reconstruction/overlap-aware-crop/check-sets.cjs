// Crop check on test sets (headless Chromium): per-join support at the current and fallback crop,
// the suggestion, and a manual-crop case. Run from repo root: node museum-rollout-reconstruction/overlap-aware-crop/check-sets.cjs
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "../..");
const CASES = [["lacma-168693", null, null], ["lacma-168596", null, null], ["met-310364", "01,03,04,05,06,07,08,09,10", [1, 4, 3, 0, 2]], ["met-310364", "01,03,04,05,06,07,08,09,10", [6, 7, 8, 5]]];
(async () => {
  const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]).replace(/^\/$/, "/index.html"));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".html") ? "text/html" : "image/jpeg" }); fs.createReadStream(f).pipe(r); }).listen(0);
  await new Promise((res) => srv.on("listening", res));
  const b = await chromium.launch(), p = await b.newPage();
  p.on("pageerror", (e) => console.error("pageerror", e.message));
  await p.route(/googletag|fonts\.g|hf\.space/, (r) => r.abort());
  await p.goto(`http://localhost:${srv.address().port}/`);
  for (const [set, pick, order] of CASES) {
    const files = pick ? pick.split(",").map((n) => n + ".jpg") : fs.readdirSync(`${ROOT}/test-sets/${set}/photos`).filter((f) => /\.jpg$/.test(f)).sort();
    const r = await p.evaluate(async ({ set, files, order, manual }) => {
      imgs = [];
      for (const f of files) { const im = new Image(); im.src = `/test-sets/${set}/photos/${f}`; await im.decode();
        const sc = Math.min(1, 1200 / im.width), cv = document.createElement("canvas"); cv.width = Math.round(im.width * sc); cv.height = Math.round(im.height * sc);
        cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); imgs.push({ cv, b: RIM2.detect(cv), cropL: .14, cropR: .86 }); }
      rebuildStripCache(); const t0 = performance.now(); const c = CROPCHECK.check(order); const ms = Math.round(performance.now() - t0);
      const f = (s) => s ? `${s.n}m/${s.span.toFixed(2)}span/${s.cols}c${s.weak ? " WEAK" : ""}` : "-";
      const out = { ms, joins: c.joins.map((j) => `${j.a + 1}-${j.b + 1}: cur ${f(j.current)} | fb ${f(j.fallback)}`), suggestion: c.suggestion };
      // manual-crop case: user set photo crops by hand -> no suggestion may touch them
      imgs.forEach((im) => { im.cropL = 0.15; im.cropR = 0.85; });
      out.manual = CROPCHECK.check(order).suggestion;
      return out;
    }, { set, files, order });
    console.log(set, r.ms + "ms\n  " + r.joins.join("\n  ") + "\n  suggestion " + JSON.stringify(r.suggestion) + "\n  manual-crop suggestion " + JSON.stringify(r.manual));
  }
  await b.close(); srv.close();
})();
