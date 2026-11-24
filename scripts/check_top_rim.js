#!/usr/bin/env node
/* Regressions for the supplied tilted lip and collapsed curved opening, including upload and Reset rims.
   Visible endpoints are approximately (207,139), (717,164) in the 852×1142 source.
   These broad pixel corridors are separate from the user's hand-labelled benchmark. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const fixtures = [
  {src:'test-sets/top-rim-regression/photos/01.png', ends:[[207,139],[717,164]], middle:150, xTolerance:10, yTolerance:8},
  {src:'test-sets/top-rim-regression/photos/02.png', ends:[[194,180],[700,180]], middle:205, xTolerance:12, yTolerance:10}
];
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(ROOT, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', ({'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png'})[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  let browser;
  function check(bounds, scale, fixture) {
    for (const [end, index] of [[0,0],[1,2]]) {
      const [x,y] = fixture.ends[end];
      assert.ok(Math.abs(bounds.topH[index].x / scale - x) < fixture.xTolerance, JSON.stringify(bounds.topH));
      assert.ok(Math.abs(bounds.topH[index].y / scale - y) < fixture.yTolerance, JSON.stringify(bounds.topH));
    }
    assert.ok(Math.abs(bounds.topH[1].y / scale - fixture.middle) < 8, JSON.stringify(bounds.topH));
  }
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({channel:process.argv.includes("--shell") ? undefined : "chromium", headless:true}); const page = await browser.newPage();
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base + '/eval/harness.html');
    const rows = await page.evaluate(async fixtures => {
      const rows = [];
      for (const fixture of fixtures) {
        const original = await loadCanvas('/' + fixture.src);
        for (const scale of [0.75, 1, 1.5]) {
          const cv = document.createElement('canvas'); cv.width = Math.round(original.width * scale); cv.height = Math.round(original.height * scale);
          cv.getContext('2d').drawImage(original, 0, 0, cv.width, cv.height);
          for (let read = 0; read < 3; read++) rows.push({fixture, scale, read, bounds:RIM2.detect(cv)});
        }
      }
      return rows;
    }, fixtures);
    for (const row of rows) check(row.bounds, row.scale, row.fixture);
    await page.goto(base + '/index.html');
    for (let i = 0; i < fixtures.length; i++) {
      await page.locator('#fi').setInputFiles(path.join(ROOT, fixtures[i].src));
      await page.waitForFunction(count => imgs.length === count, i + 1);
      check(await page.evaluate(i => imgs[i].b, i), 1, fixtures[i]);
    }
    await page.locator('#btnNext').click();
    const detected = await page.evaluate(() => imgs.map(im => JSON.parse(JSON.stringify(im.b))));
    for (let i = 0; i < fixtures.length; i++) {
      await page.evaluate(i => { imgs[i].b.topH.forEach(h => { h.x *= 0.8; h.y = 0; }); }, i);
      await page.locator('.rim-card').nth(i).getByTitle('Reset rims').click();
      // Canvas readback can switch Chrome's sampling backend after the first pass.
      // Require the new detection to meet the same visible-edge corridors.
      const reset = await page.evaluate(i => imgs[i].b, i);
      check(reset, 1, fixtures[i]);
      assert.ok(Math.abs(reset.botH[1].y - detected[i].botH[1].y) < 8);
    }
    fs.mkdirSync(path.join(ROOT, 'eval/out'), {recursive:true});
    await page.screenshot({path:path.join(ROOT, 'eval/out/top-rim-fix.png'),fullPage:true});
    console.log('Both top rims passed at three sizes, repeated reads, upload and Reset rims.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
