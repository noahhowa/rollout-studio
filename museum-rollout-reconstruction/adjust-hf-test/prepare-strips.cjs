/* Export the production Adjust inputs and optionally apply a vertical-only test warp. */
const { chromium } = require(process.cwd() + "/node_modules/playwright");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const [photos, output, coefficients] = process.argv.slice(2);
const mode = coefficients ? "adjusted" : "baseline";
const crop = Number(process.env.ADJUST_CROP || .14);
const featherPct = Number(process.env.ADJUST_FEATHER || 12);
if (!Number.isFinite(crop) || crop < 0 || crop >= .5) throw Error("Invalid crop");
fs.mkdirSync(path.join(output, mode), { recursive: true });
if (!coefficients) fs.mkdirSync(path.join(output, "full"), { recursive: true });
const ordered = fs.readdirSync(photos).filter(f => /\.jpg$/i.test(f)).sort();
const write = (file, url) => fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const file of ["js/state.js", "js/core/rim-detect.js", "js/core/rim-detect-v2.js", "js/core/unwarp.js"]) {
      await page.addScriptTag({ content: execFileSync("git", ["show", "0bd5465:" + file], { encoding: "utf8" }) });
    }
    const result = await page.evaluate(async ({urls, coefficients, crop, featherPct}) => {
      for (const url of urls) {
        const im = new Image(); im.src = url; await im.decode();
        const sc = Math.min(1, 1200 / im.width), cv = document.createElement("canvas");
        cv.width = Math.round(im.width * sc); cv.height = Math.round(im.height * sc);
        cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
        const b = RIM2.detect(cv);
        if (!b) throw Error("Rim detection failed");
        imgs.push({cv,b,cropL:crop,cropR:1-crop});
      }
      feather = featherPct;
      rebuildStripCache();
      const full = coefficients ? [] : stripCache.map(canvas => canvas.toDataURL("image/png"));
      if (coefficients) {
        stripCache = stripCache.map((src,i) => {
          const W = src.width, H = src.height;
          const [a,b,c,s] = coefficients[i];
          if (!(a || b || c || s)) return src;
          const cv = document.createElement("canvas");
          cv.width = W; cv.height = H;
          const ctx = cv.getContext("2d"), pixels = ctx.createImageData(W,H);
          const input = src.getContext("2d").getImageData(0,0,W,H).data;
          for (let x=0; x<W; x++) {
            const u = (x/(W-1)-.5)/.37;
            for (let y=0; y<H; y++) {
              const v = y/(H-1);
              let lo = 0, hi = 1;
              for (let step=0; step<17; step++) {
                const t = (lo+hi)/2;
                const endWeight = Math.min(1,t/.10,(1-t)/.10);
                const moved = t + endWeight*(a+b*u+c*u*u+s*(t-.5))/540;
                if (moved < v) lo=t; else hi=t;
              }
              const sy = y === 0 || y === H-1 ? y : (lo+hi)/2*(H-1);
              const near = Math.floor(sy), far = Math.min(H-1,near+1), fraction = sy-near;
              for (let ch=0;ch<4;ch++) {
                pixels.data[4*(y*W+x)+ch] =
                  (1-fraction)*input[4*(near*W+x)+ch]+fraction*input[4*(far*W+x)+ch];
              }
            }
          }
          ctx.putImageData(pixels,0,0);
          return cv;
        });
      }
      const output = buildStrips();
      return {full,jpeg:output.map(cv => cv.toDataURL("image/jpeg",.92)),
              sizes:output.map(cv => [cv.width,cv.height])};
    }, {crop, featherPct, urls:ordered.map(f => "data:image/jpeg;base64," + fs.readFileSync(path.join(photos,f)).toString("base64")),
        coefficients:coefficients ? JSON.parse(fs.readFileSync(coefficients)).coefficients : null});
    ordered.forEach((f,i) => {
      if (!coefficients) write(path.join(output,"full",f.slice(0,-4)+".png"),result.full[i]);
      write(path.join(output,mode,"strip_"+i+".jpg"),result.jpeg[i]);
    });
    console.log(mode, JSON.stringify(result.sizes));
  } finally { await browser.close(); }
})().catch(e=>{ console.error(e); process.exitCode=1; });
