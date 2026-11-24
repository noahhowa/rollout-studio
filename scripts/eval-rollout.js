#!/usr/bin/env node
/* Multi-view rollout yardstick. Run after scripts/fetch_rollout_references.py. */
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, ".."), OUT = path.join(ROOT, "eval/out");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "eval/rollout-cases.json"), "utf8"));
const esc = text => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const number = value => value == null ? "unavailable" : value.toFixed(3);

function report(result) {
  const synthetic = result.synthetic.map(group => `<section><h2>${esc(group.rows[0].id)}</h2><div class="photos">${group.photos.map(src => `<img src="${src}">`).join("")}</div><h3>Source texture</h3><img class="rollout" src="${group.source}">${group.rows.map(row => `<h3>${esc(row.pipeline)}</h3><p>Angular MAE ${number(row.geometry.angleMAEDeg)}° · p95 ${number(row.geometry.angleP95Deg)}° · coverage ${number(row.geometry.coveragePct)}% · texture correlation ${number(row.texture.meanCorrelation)}</p><img class="rollout" src="${row.image}">`).join("")}</section>`).join("");
  const real = result.published.map(row => `<section><h2>${esc(row.id)}</h2><p>${esc(row.status)} · <a href="${esc(row.source)}">Published source</a></p><img class="rollout" src="${row.reference}">${row.image ? `<p>Image-based angular MAE ${number(row.texture.angleMAEDeg)}° · matched columns ${number(row.texture.matchedColumnsPct)}% · circumference coverage ${number(row.geometry.coveragePct)}%</p><img class="rollout" src="${row.image}">` : ""}</section>`).join("");
  return `<!DOCTYPE html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whole-rollout yardstick</title><style>body{font:15px system-ui;max-width:1100px;margin:30px auto;padding:0 20px;color:#222}section{border-top:1px solid #ccc;padding:20px 0}.photos{display:flex;gap:6px;flex-wrap:wrap}.photos img{width:140px}.rollout{width:100%;height:auto}h1{font-size:26px}h2{font-size:21px}h3{font-size:16px}</style><h1>Whole-rollout yardstick</h1><p>Known-camera check ${result.check.passed ? "passed" : "FAILED"}. Every synthetic photo has a known rotation. Angular error measures independently rendered surface coordinates over the complete circumference, before contributors blend. All compositions use the same 14% side crop and cosine weights. The geometric score is independent of texture matching.</p><p>Real-photo rotations are registered to the reference with one circular shift per photo. Their image-based scores include matching coverage and have no geometric ground truth. Missing fixtures are reported explicitly.</p>${synthetic}<h1>Published rollout comparisons</h1>${real}</html>`;
}

async function main() {
  const server = http.createServer((request, response) => {
    const file = path.resolve(ROOT, "." + decodeURIComponent(request.url.split("?")[0]));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
    const type = path.extname(file) === ".js" ? "text/javascript" : path.extname(file) === ".html" ? "text/html" : "image/jpeg";
    response.setHeader("Content-Type", type); fs.createReadStream(file).pipe(response);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch(); const page = await browser.newPage();
    page.on("pageerror", error => console.error(error));
    await page.goto(`http://127.0.0.1:${server.address().port}/eval/rollout.html`);
    const result = { synthetic: [], published: [], missingReferences: [], config, check: null };
    const textures = [{ id: "procedural" }].concat(config.references);
    for (const texture of textures) {
      if (texture.file && !fs.existsSync(path.join(ROOT, texture.file))) { result.missingReferences.push(texture.id); continue; }
      await page.evaluate(async texture => { window.rolloutTexture = texture.file ? await ROLLOUT.loadReference(texture) : ROLLOUT.makeTexture(); }, texture);
      for (const scene of config.scenes) {
        const group = await page.evaluate(async job => ROLLOUT.synthetic(window.rolloutTexture, job.id, job.scene, job.rotations), { id: texture.id, scene, rotations: config.rotations });
        result.synthetic.push(group);
        console.log(group.rows[0].id, group.rows.map(row => `${row.pipeline} ${number(row.geometry.angleMAEDeg)}°`).join(" | "));
      }
      if (texture.file) {
        const folder = path.join(ROOT, "test-sets", texture.id, "photos");
        const sources = fs.existsSync(folder) ? fs.readdirSync(folder).filter(file => /\.jpe?g$/i.test(file)).sort().map(file => `/test-sets/${texture.id}/photos/${file}`) : [];
        result.published.push(await page.evaluate(async job => ROLLOUT.published(job.texture, window.rolloutTexture, job.sources), { texture, sources }));
      }
    }
    const oracles = result.synthetic.flatMap(group => group.rows.filter(row => row.pipeline === "known camera"));
    const controls = result.synthetic.find(group => group.controls).controls;
    const negativeControlsPassed = controls.wrongFocal.angleMAEDeg > 0.5 && controls.missingViews.coveragePct < 50;
    const oraclePassed = row => {
      const geometry = row.geometry, texture = row.texture;
      return Number.isFinite(geometry.angleMAEDeg) && geometry.angleMAEDeg <= 0.5 &&
        Number.isFinite(geometry.angleP95Deg) && geometry.angleP95Deg <= 0.5 &&
        geometry.coveragePct >= 99 && geometry.contributionCoveragePct >= 99 &&
        Number.isFinite(texture.angleMAEDeg) && texture.angleMAEDeg <= 0.5 &&
        texture.matchedColumnsPct >= 95;
    };
    result.check = {
      negativeControls: controls,
      negativeControlsPassed,
      thresholdDeg: 0.5,
      minimumCoveragePct: 99,
      passed: negativeControlsPassed && oracles.length === textures.length * config.scenes.length && oracles.every(oraclePassed),
      maxAngleMAEDeg: Math.max(...oracles.map(row => row.geometry.angleMAEDeg)),
      maxAngleP95Deg: Math.max(...oracles.map(row => row.geometry.angleP95Deg)),
      maxTextureAngleMAEDeg: Math.max(...oracles.map(row => row.texture.angleMAEDeg))
    };
    result.runtime = { browser: await browser.version(), node: process.version };

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "rollout-report.html"), report(result));
    const scores = { ...result, synthetic: result.synthetic.map(({ source, photos, rows, controls }) => ({ controls, rows: rows.map(({ image, ...row }) => row) })), published: result.published.map(({ reference, image, ...row }) => row) };
    fs.writeFileSync(path.join(OUT, "rollout-scores.json"), JSON.stringify(scores, null, 2) + "\n");
    console.table(result.synthetic.flatMap(group => group.rows.map(row => ({ scene: row.id, pipeline: row.pipeline, angleMAEDeg: +number(row.geometry.angleMAEDeg), p95Deg: +number(row.geometry.angleP95Deg), coveragePct: +number(row.geometry.coveragePct), textureMAEDeg: row.texture.angleMAEDeg, matchedColumnsPct: row.texture.matchedColumnsPct }))));
    console.log("Known-camera check", result.check);
    console.log("Published comparisons", scores.published);
    console.log("Wrote eval/out/rollout-scores.json and eval/out/rollout-report.html");
    if (!result.check.passed) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
