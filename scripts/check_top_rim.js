#!/usr/bin/env node
/* Regression for the supplied tilted lip, including upload and Reset rims.
   Visible endpoints are approximately (207,139), (717,164) in the 852×1142 source.
   These broad pixel corridors are separate from the user's hand-labelled benchmark. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const fixture = 'test-sets/top-rim-regression/photos/01.png';
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
  function check(bounds, scale) {
    for (const [index, x, y] of [[0,207,139],[2,717,164]]) {
      assert.ok(Math.abs(bounds.topH[index].x / scale - x) < 10, JSON.stringify(bounds.topH));
      assert.ok(Math.abs(bounds.topH[index].y / scale - y) < 8, JSON.stringify(bounds.topH));
    }
  }
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch(); const page = await browser.newPage();
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base + '/eval/harness.html');
    const rows = await page.evaluate(async src => {
      const original = await loadCanvas('/' + src), rows = [];
      for (const scale of [0.75, 1, 1.5]) {
        const cv = document.createElement('canvas'); cv.width = Math.round(original.width * scale); cv.height = Math.round(original.height * scale);
        cv.getContext('2d').drawImage(original, 0, 0, cv.width, cv.height);
        for (let read = 0; read < 3; read++) rows.push({scale, read, bounds:RIM2.detect(cv)});
      }
      return rows;
    }, fixture);
    for (const row of rows) check(row.bounds, row.scale);
    await page.goto(base + '/index.html');
    await page.locator('#fi').setInputFiles(path.join(ROOT, fixture));
    await page.waitForFunction(() => imgs.length === 1);
    check(await page.evaluate(() => imgs[0].b), 1);
    // Supply a second photo so the normal Next action opens Map Rims.
    await page.locator('#fi').setInputFiles(path.join(ROOT, 'test-sets/bottom-rim-regression/photos/02.png'));
    await page.waitForFunction(() => imgs.length === 2);
    await page.locator('#btnNext').click();
    const detected = await page.evaluate(() => JSON.parse(JSON.stringify(imgs[0].b)));
    await page.evaluate(() => { imgs[0].b.topH.forEach(h => { h.x *= 0.8; h.y = 0; }); });
    await page.locator('.rim-card').first().getByTitle('Reset rims').click();
    assert.deepEqual(await page.evaluate(() => imgs[0].b), detected);
    fs.mkdirSync(path.join(ROOT, 'eval/out'), {recursive:true});
    await page.screenshot({path:path.join(ROOT, 'eval/out/top-rim-fix.png'),fullPage:true});
    console.log('Tilted lip passed at three sizes, repeated reads, upload and Reset rims.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
