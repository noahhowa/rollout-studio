/* Cylindrical unwarp of a single photo into a flat strip, vignette, crop, feather. */
"use strict";
function hGeom(b) {
  var xLt = b.topH[0].x,
    xRt = b.topH[2].x,
    xLb = b.botH[0].x,
    xRb = b.botH[2].x;
  return {
    cxt: (xLt + xRt) / 2,
    rt: (xRt - xLt) / 2,
    cxb: (xLb + xRb) / 2,
    rb: (xRb - xLb) / 2,
    cx: (xLt + xRt + xLb + xRb) / 4,
    r: (xRt - xLt + (xRb - xLb)) / 4,
  };
}
function bil(d, W, H, x, y) {
  var x0 = x | 0,
    y0 = y | 0,
    fx = x - x0,
    fy = y - y0;
  if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) return null;
  var i00 = (y0 * W + x0) * 4,
    i10 = i00 + 4,
    i01 = i00 + W * 4,
    i11 = i01 + 4;
  return [
    d[i00] * (1 - fx) * (1 - fy) + d[i10] * fx * (1 - fy) + d[i01] * (1 - fx) * fy + d[i11] * fx * fy,
    d[i00 + 1] * (1 - fx) * (1 - fy) +
      d[i10 + 1] * fx * (1 - fy) +
      d[i01 + 1] * (1 - fx) * fy +
      d[i11 + 1] * fx * fy,
    d[i00 + 2] * (1 - fx) * (1 - fy) +
      d[i10 + 2] * fx * (1 - fy) +
      d[i01 + 2] * (1 - fx) * fy +
      d[i11 + 2] * fx * fy,
  ];
}
function unwarp(cv, b, tR) {
  var g = hGeom(b),
    rR = tR || g.r,
    sc = rR / g.r;
  var oW = Math.max(10, Math.round(Math.PI * rR));
  var midTopY = evalRimCurve(b.topH, g.cx),
    midBotY = evalRimCurve(b.botH, g.cx);
  var oH = Math.max(10, Math.round((midBotY - midTopY) * sc));
  var out = document.createElement("canvas");
  out.width = oW;
  out.height = oH;
  var oC = out.getContext("2d"),
    oI = oC.createImageData(oW, oH),
    src = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height),
    W = cv.width,
    H = cv.height;
  for (var oy = 0; oy < oH; oy++) {
    var ty = oy / (oH - 1 || 1),
      cx = g.cxt + ty * (g.cxb - g.cxt),
      r = g.rt + ty * (g.rb - g.rt);
    for (var ox = 0; ox < oW; ox++) {
      var th = (ox / (oW - 1 || 1)) * Math.PI - Math.PI / 2,
        sx = cx + r * Math.sin(th);
      var topY = evalRimCurve(b.topH, sx),
        botY = evalRimCurve(b.botH, sx);
      var sy = topY + ty * (botY - topY);
      var c = bil(src.data, W, H, sx, sy);
      if (c) {
        var ii = (oy * oW + ox) * 4;
        oI.data[ii] = c[0];
        oI.data[ii + 1] = c[1];
        oI.data[ii + 2] = c[2];
        oI.data[ii + 3] = 255;
      }
    }
  }
  oC.putImageData(oI, 0, 0);
  return out;
}
function compVig(cv) {
  var ctx = cv.getContext("2d"),
    W = cv.width,
    H = cv.height,
    im = ctx.getImageData(0, 0, W, H),
    d = im.data;
  var cB = new Float64Array(W);
  for (var x = 0; x < W; x++) {
    var s = 0;
    for (var y = 0; y < H; y++) {
      var i = (y * W + x) * 4;
      s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    cB[x] = s / H;
  }
  var k = Math.round(W * 0.18) | 1,
    hf = k >> 1,
    sm = new Float64Array(W);
  for (var x = 0; x < W; x++) {
    var s = 0,
      n = 0;
    for (var j = -hf; j <= hf; j++) {
      var xx = x + j;
      if (xx >= 0 && xx < W) {
        s += cB[xx];
        n++;
      }
    }
    sm[x] = s / n;
  }
  var c0 = Math.round(W * 0.25),
    c1 = Math.round(W * 0.75),
    tg = 0,
    tn = 0;
  for (var x = c0; x < c1; x++) {
    tg += sm[x];
    tn++;
  }
  tg /= tn;
  if (tg < 5) return;
  for (var x = 0; x < W; x++) {
    var gn = sm[x] > 5 ? tg / sm[x] : 1;
    gn = Math.max(0.6, Math.min(2, gn));
    for (var y = 0; y < H; y++) {
      var i = (y * W + x) * 4;
      d[i] = Math.min(255, (d[i] * gn + 0.5) | 0);
      d[i + 1] = Math.min(255, (d[i + 1] * gn + 0.5) | 0);
      d[i + 2] = Math.min(255, (d[i + 2] * gn + 0.5) | 0);
    }
  }
  ctx.putImageData(im, 0, 0);
}
function cropStrip(cv, cL, cR) {
  var sw = cv.width,
    sh = cv.height,
    x0 = Math.round(sw * cL),
    x1 = Math.round(sw * cR),
    nw = Math.max(10, x1 - x0);
  var o = document.createElement("canvas");
  o.width = nw;
  o.height = sh;
  o.getContext("2d").drawImage(cv, x0, 0, nw, sh, 0, 0, nw, sh);
  return o;
}
function featherEdges(cv, ff) {
  if (ff <= 0) return cv;
  var nw = cv.width,
    sh = cv.height,
    o = document.createElement("canvas");
  o.width = nw;
  o.height = sh;
  var ctx = o.getContext("2d");
  ctx.drawImage(cv, 0, 0);
  var img = ctx.getImageData(0, 0, nw, sh),
    d = img.data,
    mr = 0,
    mg = 0,
    mb = 0,
    np = nw * sh;
  for (var i = 0; i < np; i++) {
    mr += d[i * 4];
    mg += d[i * 4 + 1];
    mb += d[i * 4 + 2];
  }
  mr /= np;
  mg /= np;
  mb /= np;
  var fp = Math.max(2, Math.round(nw * ff));
  for (var y = 0; y < sh; y++) {
    for (var x = 0; x < fp; x++) {
      var tt = x / fp;
      tt = tt * tt * (3 - 2 * tt);
      var idx = (y * nw + x) * 4;
      d[idx] = Math.round(d[idx] * tt + mr * (1 - tt));
      d[idx + 1] = Math.round(d[idx + 1] * tt + mg * (1 - tt));
      d[idx + 2] = Math.round(d[idx + 2] * tt + mb * (1 - tt));
    }
    for (var x = nw - fp; x < nw; x++) {
      var tt = (nw - 1 - x) / fp;
      tt = tt * tt * (3 - 2 * tt);
      var idx = (y * nw + x) * 4;
      d[idx] = Math.round(d[idx] * tt + mr * (1 - tt));
      d[idx + 1] = Math.round(d[idx + 1] * tt + mg * (1 - tt));
      d[idx + 2] = Math.round(d[idx + 2] * tt + mb * (1 - tt));
    }
  }
  ctx.putImageData(img, 0, 0);
  return o;
}
function rebuildStripCache() {
  var tR = med(
    imgs.map(function (im) {
      return hGeom(im.b).r;
    }),
  );
  stripCache = imgs.map(function (im) {
    var s = unwarp(im.cv, im.b, tR);
    compVig(s);
    return s;
  });
}
// Opt-in overlap warp (Adjust checkbox): fitted on the full Map strips, then the usual crop and
// feather are applied. Cached until the strips or their order change.
var overlapWarpCache = null;
function warpedStrips() {
  if (!overlapWarpOn || stripCache.length < 2) { overlapWarpReport = null; return stripCache; }
  var c = overlapWarpCache;
  if (c && c.src.length === stripCache.length && c.src.every(function (s, i) { return s === stripCache[i]; })) {
    overlapWarpReport = c.report; return c.out;
  }
  var report;
  try { report = OVERLAPWARP.estimate(stripCache); } catch (e) { report = { declined: e.message }; }
  var out = report.coefficients ? stripCache.map(function (s, i) { return OVERLAPWARP.apply(s, report.coefficients[i]); }) : stripCache;
  overlapWarpCache = { src: stripCache.slice(), out: out, report: report };
  overlapWarpReport = report;
  return out;
}
function buildStrips() {
  if (stripCache.length !== imgs.length) rebuildStripCache();
  var ff = feather / 100, src = warpedStrips();
  return imgs.map(function (im, i) {
    return featherEdges(cropStrip(src[i], im.cropL, im.cropR), ff);
  });
}
