// Fit the Adjust overlap warp in the real app on a test set. Usage (from repo root):
//   node museum-rollout-reconstruction/adjust-warp-app/fit-in-app.cjs lacma-168596 [OUT_DIR]
// OUT_DIR gets the Stitch-ready strips. NOWARP=1: warp off. COEF=file.json: apply given coefficients.
// FILES=01.jpg,03.jpg: choose photos.
// usage: node run.cjs SET [OUTDIR]  — fits the overlap warp in the real app and optionally writes strips
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = require("path").resolve(__dirname, "../.."), set = process.argv[2], outDir = process.argv[3];
(async () => {
  const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]).replace(/^\/$/, "/index.html"));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".html") ? "text/html" : "image/jpeg" }); fs.createReadStream(f).pipe(r); }).listen(0);
  await new Promise((res) => srv.on("listening", res));
  const b = await chromium.launch(), p = await b.newPage();
  p.on("pageerror", (e) => console.error("pageerror", e.message));
  await p.route(/googletag|fonts\.g/, (r) => r.abort());
  await p.goto(`http://localhost:${srv.address().port}/`);
  const files = process.env.FILES ? process.env.FILES.split(",") : fs.readdirSync(`${ROOT}/test-sets/${set}/photos`).filter((f) => /\.jpg$/.test(f)).sort();
  if (process.env.COEF) await p.evaluate((c) => { const est = OVERLAPWARP.estimate; OVERLAPWARP.estimate = () => ({ coefficients: c, before: 0, after: 0 }); }, JSON.parse(fs.readFileSync(process.env.COEF)).coefficients);
  if (process.env.NOWARP) await p.evaluate(() => { window.NOWARP = true; });
  const res = await p.evaluate(async ({ set, files, write }) => {
    imgs = [];
    for (const f of files) {
      const im = new Image(); im.src = `/test-sets/${set}/photos/${f}`; await im.decode();
      const sc = Math.min(1, 1200 / im.width), cv = document.createElement("canvas");
      cv.width = Math.round(im.width * sc); cv.height = Math.round(im.height * sc);
      cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
      imgs.push({ cv, b: RIM2.detect(cv), cropL: 0.14, cropR: 0.86 });
    }
    feather = 12; rebuildStripCache(); overlapWarpOn = !window.NOWARP;
    const t0 = performance.now(); const strips = buildStrips(); const ms = performance.now() - t0;
    return { ms: Math.round(ms), report: overlapWarpReport, strips: write ? strips.map((c) => c.toDataURL("image/jpeg", 0.92)) : null };
  }, { set, files, write: !!outDir });
  if (outDir) { fs.mkdirSync(outDir, { recursive: true }); res.strips.forEach((u, i) => fs.writeFileSync(`${outDir}/strip_${i}.jpg`, Buffer.from(u.split(",")[1], "base64"))); }
  const r = res.report || {}; console.log(set, files.join(" "), "ms", res.ms);
  console.log(JSON.stringify({ before: r.before, after: r.after, matches: r.matches, declined: r.declined, pairs: r.pairs, coefficients: r.coefficients && r.coefficients.map((c) => c.map((v) => +v.toFixed(2))) }));
  await b.close(); srv.close();
})();
