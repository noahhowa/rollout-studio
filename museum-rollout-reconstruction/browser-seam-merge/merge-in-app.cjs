// Run SEAMMERGE.merge in the real app (headless Chromium) on a folder of photos.
// From repo root: node museum-rollout-reconstruction/browser-seam-merge/merge-in-app.cjs test-sets/lacma-168693/photos out.png ['[{},{"cropR":0.92}]']
// Prints placement, per-join seam/overlap/matches/gain and timing; writes the panorama.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "../.."), DIR = path.resolve(process.argv[2]), OUT = process.argv[3], CROPS = process.argv[4] ? JSON.parse(process.argv[4]) : null;
(async () => {
  const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]); const f = path.join(ROOT, u === "/" ? "/index.html" : u);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".html") ? "text/html" : "image/jpeg" }); fs.createReadStream(f).pipe(r); }).listen(0);
  await new Promise((res) => srv.on("listening", res));
  const b = await chromium.launch(), p = await b.newPage(); p.on("pageerror", (e) => console.error("pageerror", e.message));
  await p.route(/googletag|fonts\.g|hf\.space/, (r) => r.abort());
  await p.goto(`http://localhost:${srv.address().port}/`);
  const files = fs.readdirSync(DIR).filter((f) => /\.jpg$/i.test(f)).sort().map((f) => path.join(DIR, f));
  await p.setInputFiles("input[type=file]", files);
  await p.waitForFunction((n) => imgs.length === n && imgs.every((i) => i.b), files.length, { timeout: 90000 });
  const r = await p.evaluate((CROPS) => {
    if (CROPS) CROPS.forEach((c, i) => Object.assign(imgs[i], c));
    rebuildStripCache(); const t0 = performance.now(), m = SEAMMERGE.merge(buildRawStrips()), ms = Math.round(performance.now() - t0);
    if (m.error) return { error: m.error, ms };
    return { ms, size: [m.canvas.width, m.canvas.height], order: m.order, joins: m.joins, poses: m.poses, png: m.canvas.toDataURL("image/png") };
  }, CROPS);
  if (r.png) fs.writeFileSync(OUT, Buffer.from(r.png.split(",")[1], "base64"));
  delete r.png; console.log(JSON.stringify(r));
  await b.close(); srv.close();
})();
