/* Scoring + report rendering, run inside the harness page (see scripts/eval.js). */
"use strict";
function curveAt(pts, x) {
  if (x <= pts[0].x) return pts[0].y;
  for (var i = 1; i < pts.length; i++) if (pts[i].x >= x) {
    var a = pts[i - 1], b = pts[i], t = (x - a.x) / (b.x - a.x || 1);
    return a.y + t * (b.y - a.y);
  }
  return pts[pts.length - 1].y;
}
// Rims in the app's own 3-handle format, taken from the true curves ("perfect detection").
function oracleB(truth) {
  function h(pts) {
    var xL = pts[0].x, xR = pts[pts.length - 1].x, cx = (xL + xR) / 2, s = xR - xL;
    return [
      { x: xL, y: curveAt(pts, xL), cp: { x: xL + s * 0.25, y: curveAt(pts, xL + s * 0.25) } },
      { x: cx, y: curveAt(pts, cx) },
      { x: xR, y: curveAt(pts, xR), cp: { x: xR - s * 0.25, y: curveAt(pts, xR - s * 0.25) } },
    ];
  }
  var t = h(truth.top), bo = h(truth.bot);
  return { topH: t, botH: bo, cx: t[1].x, r: (t[2].x - t[0].x) / 2, xLeft: t[0].x, xRight: t[2].x, yTop: t[1].y, yBot: bo[1].y };
}
// Mean |error| of a pipeline's rims vs truth, in % of vessel height, over the middle 90% of the width.
function ellH(e) { return { e: e }; } // marker: evaluate the ellipse itself, not its 3-handle approximation
function rimAt(h, x) {
  if (h.e) { var u = (x - h.e.xc) / h.e.a; return h.e.yc + (h.e.s || 1) * h.e.b * Math.sqrt(Math.max(0, 1 - u * u)); }
  return evalRimCurve(h, x);
}
function rimError(b, truth) {
  var hgt = curveAt(truth.bot, truth.bot[truth.bot.length >> 1].x) - curveAt(truth.top, truth.top[truth.top.length >> 1].x);
  function one(h, pts) {
    var x0 = pts[0].x, x1 = pts[pts.length - 1].x, s = 0, n = 0;
    for (var i = 0; i <= 50; i++) { var x = x0 + (x1 - x0) * (0.05 + 0.9 * i / 50); s += Math.abs(rimAt(h, x) - curveAt(pts, x)); n++; }
    return (100 * s) / n / hgt;
  }
  return { top: one(b.topH, truth.top), bot: one(b.botH, truth.bot) };
}
function grayCols(cv, cols, rows) {
  var c = document.createElement("canvas"); c.width = cols; c.height = rows;
  var x = c.getContext("2d"); x.drawImage(cv, 0, 0, cols, rows);
  var d = x.getImageData(0, 0, cols, rows).data, out = [];
  for (var i = 0; i < cols; i++) {
    var v = new Float32Array(rows), m = 0, s = 0;
    for (var j = 0; j < rows; j++) { var k = (j * cols + i) * 4; v[j] = d[k] + d[k + 1] + d[k + 2]; m += v[j]; }
    m /= rows; for (j = 0; j < rows; j++) { v[j] -= m; s += v[j] * v[j]; }
    s = Math.sqrt(s) || 1; for (j = 0; j < rows; j++) v[j] /= s;
    out.push(v);
  }
  return out;
}
/* Depth-distortion score: for each column of the unwarped strip, find where that content really
   sits on the cylinder (by matching against the true texture) and compare with where the app put it.
   Returns median |angle error| in degrees per band of |angle| from the facing direction. */
function angularError(strip, tex, rot) {
  var SC = 180, TC = 720, ROWS = 40, s = grayCols(strip, SC, ROWS), t = grayCols(tex, TC, ROWS);
  var bands = [[0, 30], [30, 60], [60, 90]], errs = [[], [], []];
  for (var i = 0; i < SC; i++) {
    var th = (i / (SC - 1)) * 180 - 90, best = -2, bestTh = 0;
    for (var dth = -30; dth <= 30; dth += 0.5) {
      var tt = th + dth, tu = ((((tt * Math.PI) / 180 + rot) / (2 * Math.PI) + 0.5) % 1 + 1) % 1;
      var col = t[Math.floor(tu * TC) % TC], c = 0;
      for (var j = 0; j < ROWS; j++) c += s[i][j] * col[j];
      if (c > best) { best = c; bestTh = tt; }
    }
    if (best < 0.5) continue; // featureless column: no reliable match
    var e = Math.abs(bestTh - th), a = Math.abs(th);
    for (var k = 0; k < 3; k++) if (a >= bands[k][0] && a < bands[k][1] + (k === 2 ? 1 : 0)) errs[k].push(e);
  }
  return errs.map(function (a) { return a.length ? med(a) : null; });
}
var COLORS = { truth: "#16a34a", baseline: "#f97316", "baseline+snap": "#2563eb", oracle: "#16a34a",
  "A silhouette": "#db2777", "A+snap": "#7c3aed", "A2 two-class": "#ca8a04", "C silh+edges": "#0891b2", "D silh+sides": "#ca8a04", "E silh+sym": "#dc2626" };
var PALETTE = ["#f97316", "#2563eb", "#db2777", "#7c3aed", "#0891b2"];
function colorFor(name, i) { return COLORS[name] || PALETTE[i % PALETTE.length]; }
function toJpeg(cv, w) {
  var sc = Math.min(1, w / cv.width), c = document.createElement("canvas");
  c.width = Math.round(cv.width * sc); c.height = Math.round(cv.height * sc);
  c.getContext("2d").drawImage(cv, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}
function overlay(cv, results, truth) {
  var c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height;
  var x = c.getContext("2d"), lw = Math.max(2, cv.width / 250); x.drawImage(cv, 0, 0); x.lineWidth = lw * 1.5;
  function poly(pts, col, dash) { x.strokeStyle = col; x.setLineDash(dash || []); x.beginPath(); pts.forEach(function (p, i) { i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y); }); x.stroke(); }
  if (truth) { poly(truth.top, COLORS.truth, [lw * 3, lw * 2]); poly(truth.bot, COLORS.truth, [lw * 3, lw * 2]); }
  results.forEach(function (r, i) {
    if (!r.b) return;
    ["topH", "botH"].forEach(function (k) {
      var h = r.b[k], pts = [];
      for (var j = 0; j <= 60; j++) { var xx = h[0].x + (h[2].x - h[0].x) * j / 60; pts.push({ x: xx, y: evalRimCurve(h, xx) }); }
      poly(pts, colorFor(r.name, i));
    });
  });
  return c;
}
function loadCanvas(src) {
  return new Promise(function (res, rej) {
    var im = new Image();
    im.onload = function () {
      var sc = Math.min(1, 1200 / im.width), c = document.createElement("canvas"); // same scaling as the app
      c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); res(c);
    };
    im.onerror = rej; im.src = src;
  });
}
var ONLY = null;
function runPipelines(cv, truth, extra) {
  var out = [];
  Object.keys(PIPELINES).filter(function (n) { return !ONLY || ONLY.indexOf(n) >= 0; }).forEach(function (name) {
    var r = { name: name };
    try {
      var t0 = performance.now(); r.b = PIPELINES[name](cv); r.ms = Math.round(performance.now() - t0);
      r.strip = toJpeg(unwarp(cv, r.b), 500);
      if (truth) {
        r.rim = rimError(r.b, truth); r.ang = angularError(unwarp(cv, r.b), extra.tex, extra.rot);
        if (r.b.topE) r.rimEllipse = rimError({ topH: ellH(r.b.topE), botH: ellH(r.b.botE) }, truth, true);
      }
    } catch (e) { r.error = String(e); }
    out.push(r);
  });
  if (truth) { // the unwarp's own error, with perfect rims: isolates the depth/perspective problem
    var ob = oracleB(truth), ocv = unwarp(cv, ob);
    out.push({ name: "oracle", b: ob, strip: toJpeg(ocv, 500), rim: { top: 0, bot: 0 }, ang: angularError(ocv, extra.tex, extra.rot) });
  }
  return out;
}
window.runEval = async function (job) {
  var cases = []; ONLY = job.only || null;
  var met = null;
  try { // the published rollout has a grey margin around the vessel: crop to the painted surface
    var full = await loadCanvas(job.metRollout), cr = job.metCrop;
    met = document.createElement("canvas");
    met.width = Math.round(full.width * (cr[2] - cr[0])); met.height = Math.round(full.height * (cr[3] - cr[1]));
    met.getContext("2d").drawImage(full, full.width * cr[0], full.height * cr[1], met.width, met.height, 0, 0, met.width, met.height);
  } catch (e) {}
  for (var i = 0; i < job.synth.length; i++) {
    var p = job.synth[i], tex = p.texture === "met" && met ? met : makeProceduralTexture(1440, 560);
    var s = renderCylinder(tex, p), res = runPipelines(s.canvas, s.truth, s);
    cases.push({ group: "synthetic", id: p.id, params: p, visHalfDeg: s.truth.visHalfDeg, overlay: toJpeg(overlay(s.canvas, res, s.truth), 420), results: res.map(strip0) });
  }
  for (var k = 0; k < job.real.length; k++) {
    var rc = job.real[k], cv = await loadCanvas(rc.src), rr = runPipelines(cv, null);
    cases.push({ group: rc.set, id: rc.file, overlay: toJpeg(overlay(cv, rr, null), 420), results: rr.map(strip0) });
  }
  return cases;
  function strip0(r) { var o = Object.assign({}, r); delete o.b; return o; }
};
