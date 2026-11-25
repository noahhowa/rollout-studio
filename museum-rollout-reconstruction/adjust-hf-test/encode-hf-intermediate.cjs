/* Repeat loadResult → canvas → cvToBlob's JPEG encode before the next Space batch. */
const { chromium } = require(process.cwd()+"/node_modules/playwright");
const fs = require("node:fs");
const [input,output] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL });
  try {
    const page = await browser.newPage();
    const b64 = fs.readFileSync(input).toString("base64");
    const jpeg = await page.evaluate(async data => {
      const time = new Image(); time.src = "data:image/png;base64," + data; await time.decode();
      const canvas = document.createElement("canvas");
      canvas.width=time.width; canvas.height=time.height;
      canvas.getContext("2d").drawImage(time,0,0);
      return canvas.toDataURL("image/jpeg",.92).split(",")[1];
    },b64);
    fs.writeFileSync(output,Buffer.from(jpeg,"base64"));
  } finally { await browser.close(); }
})().catch(e=>{ console.error(e); process.exitCode=1; });
