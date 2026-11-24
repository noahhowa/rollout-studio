#!/usr/bin/env node
/* Score actual uploads against committed hand labels, in an isolated headless browser.
   Usage: node scripts/check_browser_rims.js [--shell] [--url https://.../] [--sets id,id] [--opts JSON] [--tag name] [--assert-regressions] */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, 'eval/out');
const args = process.argv.slice(2), url = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8765/';
const labels = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-sets/labels.json')));
const available = Object.entries(labels).filter(([key, label]) => !label.unusable && fs.existsSync(path.join(ROOT, 'test-sets', key)));
const sets = args.includes('--sets') ? args[args.indexOf('--sets') + 1].split(',') : null;
const cases = available.filter(([key]) => !sets || sets.includes(key.split('/')[0]));
const opts = args.includes('--opts') ? JSON.parse(args[args.indexOf('--opts') + 1]) : {};
const tag = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : null;
if (tag && !/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a simple output tag.');
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
(async () => {
  const browser = await chromium.launch({headless:true, channel:args.includes('--shell') ? undefined : 'chromium'});
  try {
    const page = await browser.newPage({viewport:{width:1400,height:1000}});
    const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
    await page.goto(url, {waitUntil:'networkidle'});
    await page.addScriptTag({path:path.join(ROOT, 'eval/eval.js')});
    await page.evaluate(opts => { const detect = RIM2.detect; RIM2.detect = cv => detect(cv, opts); }, opts);
    const rows = [], cards = [];
    for (const [key, label] of cases) {
      await page.evaluate(() => { imgs = []; renderUpload(); });
      await page.locator('#fi').setInputFiles([]);
      await page.locator('#fi').setInputFiles(path.join(ROOT, 'test-sets', key));
      await page.waitForFunction(() => imgs.length === 1);
      const row = await page.evaluate(({key, label}) => {
        const im = imgs[0], truth = labelTruth(label, im.cv.width, im.cv.height);
        // Render the app's Map card, then add independently labelled curves and clicks.
        renderMap();
        const cv = document.querySelector('.rim-card canvas'), ctx = cv.getContext('2d'), sc = cv.width / im.cv.width;
        ctx.strokeStyle = '#00ffff'; ctx.fillStyle = '#00ffff'; ctx.lineWidth = 1.5;
        for (const rim of ['top','bot']) {
          ctx.beginPath(); truth[rim].forEach((p,i) => { if(i) ctx.lineTo(p.x*sc,p.y*sc); else ctx.moveTo(p.x*sc,p.y*sc); }); ctx.stroke();
          for (const p of label[rim]) { ctx.beginPath(); ctx.arc(p[0]*cv.width,p[1]*cv.height,2,0,2*Math.PI); ctx.fill(); }
        }
        return {key, width:im.cv.width, height:im.cv.height, rim:rimError(im.b,truth), side:sideError(im.b,truth), bounds:im.b, overlay:cv.toDataURL('image/png')};
      }, {key,label});
      const {overlay, ...score} = row; rows.push(score);
      cards.push(`<article><h3>${escape(key)}</h3><p>rim ${row.rim.top.toFixed(2)} / ${row.rim.bot.toFixed(2)}%H · ends ${row.side.top.toFixed(2)} / ${row.side.bot.toFixed(2)}%W</p><img src="${overlay}"></article>`);
      console.log(key, row.rim.top.toFixed(3), row.rim.bot.toFixed(3), row.side.top.toFixed(3), row.side.bot.toFixed(3));
    }
    const summary = Object.fromEntries(['rim','side'].flatMap(m => ['top','bot'].map(k => [m+'.'+k,rows.reduce((a,r)=>a+r[m][k],0)/rows.length])));
    const result = {url, browserVersion:browser.version(), backend:args.includes('--shell') ? 'headless shell' : 'full Chromium headless', n:rows.length, missing: Object.keys(labels).length - available.length, opts, pageErrors, summary, cases:rows};
    fs.mkdirSync(OUT,{recursive:true});
    const prefix = 'browser-rims-' + (tag || (url.startsWith('http://127.0.0.1') ? 'local' : 'deployed')) + (args.includes('--shell') ? '-shell' : '');
    fs.writeFileSync(path.join(OUT,prefix+'.json'),JSON.stringify(result,null,2));
    fs.writeFileSync(path.join(OUT,prefix+'.html'),`<!doctype html><meta charset="utf-8"><title>Browser rim ground truth</title><style>body{font:14px system-ui;background:#222;color:white;margin:24px}main{display:flex;flex-wrap:wrap;gap:16px}article{background:#333;padding:12px;width:300px}h3{font-size:13px}img{width:280px}p{font-size:12px}</style><h1>Actual browser uploads versus ground truth</h1><p>${escape(url)} · ${escape(result.backend)} · ${rows.length} photos</p><p>Cyan curves and dots = hand labels. Orange = detected top. Blue = detected bottom. Curves use the same axis-aligned label model as the evaluator; dots retain the exact clicks.</p><pre>${escape(JSON.stringify(summary,null,2))}</pre><main>${cards.join('')}</main>`);
    console.log('SUMMARY',JSON.stringify(summary));
    if (pageErrors.length) throw new Error(pageErrors.join('\n'));
    if (args.includes('--assert-regressions')) {
      // These limits use hand labels and catch the large failures fixed in this pass.
      const checks = [
        ...[1,2,3,4].map(i => [`edge-sothebys-2026-stone-floor/photos/0${i}.jpg`,8,2,8]),
        ['lacma-168564/photos/02.jpg',null,2,5], ['lacma-168564/photos/05.jpg',null,2,5],
        ['bottom-rim-regression/photos/01.png',null,2,5],
        ...[1,2,3,4].map(i => [`pca4sale-446/photos/0${i}.jpg`,null,5,5])
      ];
      for (const [key,topEnds,bottom,bottomEnds] of checks) {
        const row = rows.find(r => r.key === key);
        assert.ok(row, 'Fetch and include the required regression case: ' + key);
        assert.ok(row.rim.bot < bottom && row.side.bot < bottomEnds, JSON.stringify(row));
        if (topEnds !== null) assert.ok(row.side.top < topEnds, JSON.stringify(row));
      }
      console.log('All labelled browser regression limits passed.');
    }

  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
