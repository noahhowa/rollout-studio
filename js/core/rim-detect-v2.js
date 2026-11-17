/* Rim detection v2: color-agnostic silhouette + ellipse fitting.
   A circle seen through a camera is an ellipse, so each rim is modelled as an axis-aligned
   ellipse {xc, yc, a, b}. The rim we want is its front (lower) half: y = yc + b*sqrt(1-u^2).
   - silhouette: separate object from background using colours sampled along the image border
   - top ellipse: fitted to the silhouette's top edge (= back half of the top rim)
   - bottom ellipse: fitted to the silhouette's bottom edge (= front half of the bottom rim)
   - whether the camera is above or below the top rim is decided from perspective geometry
   Evaluated against the old red-pixel scan and three variants in eval/ (see ROADMAP.md). */
"use strict";

var RIM2 = (function () {
  var WORK = 400; // working width in px; results are scaled back

  function small(cv) {
    var sc = Math.min(1, WORK / cv.width), c = document.createElement("canvas");
    c.width = Math.round(cv.width * sc); c.height = Math.round(cv.height * sc);
    c.getContext("2d").drawImage(cv, 0, 0, c.width, c.height);
    return { cv: c, sc: sc, W: c.width, H: c.height, d: c.getContext("2d").getImageData(0, 0, c.width, c.height).data };
  }

  // Distance of every pixel to the nearest *nearby* border colour sample. Backdrops are usually
  // gradients, so a pixel is only compared with left/right border samples from similar rows, and
  // with top/bottom border samples if it is close to that edge.
  function bgDistance(S) {
    var W = S.W, H = S.H, d = S.d, m = 3, step = Math.max(3, Math.round((2 * (W + H)) / 160)), side = [], tb = [];
    function px(x, y) { var i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2], x, y]; }
    for (var y = 0; y < H; y += step) { side.push(px(m, y)); side.push(px(W - 1 - m, y)); }
    for (var x = 0; x < W; x += step) { tb.push(px(x, m)); tb.push(px(x, H - 1 - m)); }
    var dist = new Float32Array(W * H), wy = 0.12 * H, edge = 0.25 * H;
    for (y = 0; y < H; y++) {
      var cand = side.filter(function (s) { return Math.abs(s[4] - y) <= wy; });
      if (y < edge || y > H - edge) tb.forEach(function (s) { if (Math.abs(s[4] - y) <= edge) cand.push(s); });
      for (x = 0; x < W; x++) {
        var i = (y * W + x) * 4, best = 1e9;
        for (var k = 0; k < cand.length; k++) {
          var a = cand[k], dr = d[i] - a[0], dg = d[i + 1] - a[1], db = d[i + 2] - a[2], v = dr * dr + dg * dg + db * db;
          if (v < best) best = v;
        }
        dist[y * W + x] = Math.sqrt(best);
      }
    }
    return dist;
  }

  function otsu(v) {
    var max = 0, i; for (i = 0; i < v.length; i++) if (v[i] > max) max = v[i];
    var hist = new Float64Array(256), sc = 255 / (max || 1);
    for (i = 0; i < v.length; i++) hist[Math.min(255, (v[i] * sc) | 0)]++;
    var tot = v.length, sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
    var wB = 0, sB = 0, best = 0, th = 0;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue; var wF = tot - wB; if (!wF) break;
      sB += i * hist[i]; var mB = sB / wB, mF = (sum - sB) / wF, bv = wB * wF * (mB - mF) * (mB - mF);
      if (bv > best) { best = bv; th = i; }
    }
    return (th + 0.5) / sc;
  }

  // Binary object mask: threshold, keep the component nearest the centre, fill holes.
  function silhouette(S) {
    var W = S.W, H = S.H, dist = bgDistance(S), th = Math.max(18, otsu(dist)), m = new Uint8Array(W * H), i;
    for (i = 0; i < W * H; i++) m[i] = dist[i] > th ? 1 : 0;
    // largest component (4-connected), preferring the one covering the image centre
    var lab = new Int32Array(W * H), stack = [], best = -1, bestScore = 0, n = 0;
    for (i = 0; i < W * H; i++) {
      if (!m[i] || lab[i]) continue;
      n++; var size = 0, cxs = 0; stack.push(i); lab[i] = n;
      while (stack.length) {
        var q = stack.pop(), qx = q % W, qy = (q / W) | 0; size++; cxs += Math.abs(qx - W / 2) / W + Math.abs(qy - H / 2) / H;
        if (qx > 0 && m[q - 1] && !lab[q - 1]) { lab[q - 1] = n; stack.push(q - 1); }
        if (qx < W - 1 && m[q + 1] && !lab[q + 1]) { lab[q + 1] = n; stack.push(q + 1); }
        if (qy > 0 && m[q - W] && !lab[q - W]) { lab[q - W] = n; stack.push(q - W); }
        if (qy < H - 1 && m[q + W] && !lab[q + W]) { lab[q + W] = n; stack.push(q + W); }
      }
      var score = size / (1 + cxs / size);
      if (score > bestScore) { bestScore = score; best = n; }
    }
    for (i = 0; i < W * H; i++) m[i] = lab[i] === best ? 1 : 0;
    // fill holes: background = what's reachable from the border through non-object pixels
    var out = new Uint8Array(W * H).fill(1);
    function seed(p) { if (!m[p] && out[p]) { out[p] = 0; stack.push(p); } }
    for (var x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
    for (var y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
    while (stack.length) {
      var p = stack.pop(), px = p % W, py = (p / W) | 0;
      if (px > 0) seed(p - 1); if (px < W - 1) seed(p + 1); if (py > 0) seed(p - W); if (py < H - 1) seed(p + W);
    }
    return out;
  }

  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[s.length >> 1] : 0; }

  // Fit y = yc + sgn*b*sqrt(1-u^2), u=(x-xc)/a, by least squares with two rounds of outlier trimming.
  function fitArc(xs, ys, xc, a, sgn) {
    var idx = xs.map(function (_, i) { return i; }), res = { yc: median(ys), b: 0 };
    for (var it = 0; it < 3; it++) {
      var sT = 0, sY = 0, sTT = 0, sTY = 0, n = idx.length;
      if (n < 5) break;
      idx.forEach(function (i) {
        var u = (xs[i] - xc) / a, t = sgn * Math.sqrt(Math.max(0, 1 - u * u));
        sT += t; sY += ys[i]; sTT += t * t; sTY += t * ys[i];
      });
      var den = n * sTT - sT * sT; if (Math.abs(den) < 1e-9) break;
      res.b = Math.max(0, (n * sTY - sT * sY) / den); res.yc = (sY - res.b * sT) / n;
      var r = idx.map(function (i) { var u = (xs[i] - xc) / a; return Math.abs(ys[i] - (res.yc + sgn * res.b * Math.sqrt(Math.max(0, 1 - u * u)))); });
      var cut = Math.max(1.5, 2.5 * median(r));
      idx = idx.filter(function (_, k) { return r[k] <= cut; });
    }
    return res;
  }

  function rowSpan(mask, W, y) {
    var l = -1, r = -1;
    for (var x = 0; x < W; x++) if (mask[y * W + x]) { if (l < 0) l = x; r = x; }
    return l < 0 ? null : { l: l, r: r };
  }

  // Ellipses for the top and bottom rims from the silhouette.
  function fitFromMask(mask, W, H) {
    var top = [], bot = [], x, y;
    for (x = 0; x < W; x++) {
      var t = -1, b = -1;
      for (y = 0; y < H; y++) if (mask[y * W + x]) { if (t < 0) t = y; b = y; }
      top.push(t); bot.push(b);
    }
    var ys = top.filter(function (v) { return v >= 0; }), yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, bot);
    var hgt = yMax - yMin;
    function one(which) {
      var edge = which === "top" ? top : bot, sgn = which === "top" ? -1 : 1;
      var y0 = which === "top" ? yMin + 0.12 * hgt : yMax - 0.12 * hgt, e = null;
      for (var it = 0; it < 3; it++) {
        var sp = rowSpan(mask, W, Math.max(0, Math.min(H - 1, Math.round(y0))));
        if (!sp) break;
        var xc = (sp.l + sp.r) / 2, a = (sp.r - sp.l) / 2, xs = [], yv = [];
        for (x = Math.ceil(xc - 0.85 * a); x <= xc + 0.85 * a; x++) if (edge[x] >= 0) { xs.push(x); yv.push(edge[x]); }
        var f = fitArc(xs, yv, xc, a, sgn);
        e = { xc: xc, a: a, yc: f.yc, b: f.b };
        y0 = f.yc; // the ellipse is widest at its centre row: re-measure width there
      }
      return e;
    }
    return { top: one("top"), bot: one("bot"), yMin: yMin, yMax: yMax };
  }

  function frontY(e, x) { var u = (x - e.xc) / e.a; return e.yc + (e.s || 1) * e.b * Math.sqrt(Math.max(0, 1 - u * u)); }

  /* Is the camera above the top rim (front arc bows down) or below it (bows up)? The silhouette
     can't tell: in both cases its top edge is an arc of the top ellipse. Use perspective geometry:
     a rim's openness b/a ~ sin(viewing angle onto that rim). The angle between the two rims is
     asin(rb) - asin(rt) if the camera is above both, asin(rb) + asin(rt) if it is between them.
     Together with the rims' vertical separation in the image, each hypothesis implies a lens
     field of view; pick the one closer to a typical ~40 degrees. */
  function cameraAboveTop(top, bot, H) {
    var rt = Math.min(0.99, top.b / top.a), rb = Math.min(0.99, bot.b / bot.a), dy = bot.yc - top.yc;
    if (top.b < 2 || dy <= 0) return true;
    if (rt >= rb) return false; // from above, the lower rim is always seen more openly
    function vfov(dA) { return 2 * Math.atan(H / 2 / (dy / Math.max(1e-3, dA))); }
    var above = vfov(Math.asin(rb) - Math.asin(rt)), below = vfov(Math.asin(rb) + Math.asin(rt)), ref = 0.7;
    return Math.abs(Math.log(above / ref)) < Math.abs(Math.log(below / ref));
  }

  // Ellipse (in full-res px) -> app's 3-handle rim format (front half). The outer control points
  // are chosen by search so the app's curve (evalRimCurve) follows the ellipse as closely as possible.
  function toHandles(e) {
    function y(x) { return frontY(e, x); }
    var xL = e.xc - e.a, xR = e.xc + e.a, s = xR - xL, sg = e.s || 1;
    var h = [{ x: xL, y: y(xL), cp: { x: xL, y: y(xL) } }, { x: e.xc, y: y(e.xc) }, { x: xR, y: y(xR), cp: { x: xR, y: y(xR) } }];
    if (e.b < 0.5) { h[0].cp.x = xL + s * 0.25; h[2].cp.x = xR - s * 0.25; return h; }
    var best = 1e9, bc = null;
    for (var fx = 0; fx <= 0.45; fx += 0.03) for (var fy = 0; fy <= 1.3; fy += 0.05) {
      h[0].cp = { x: xL + s * fx, y: y(xL) + sg * e.b * fy }; h[2].cp = { x: xR - s * fx, y: y(xR) + sg * e.b * fy };
      var err = 0;
      for (var k = 1; k < 20; k++) { var xx = xL + (s * k) / 20; err += Math.abs(evalRimCurve(h, xx) - y(xx)); }
      if (err < best) { best = err; bc = [fx, fy]; }
    }
    h[0].cp = { x: xL + s * bc[0], y: y(xL) + sg * e.b * bc[1] }; h[2].cp = { x: xR - s * bc[0], y: y(xR) + sg * e.b * bc[1] };
    return h;
  }
  function scaleE(e, k) { return { xc: e.xc / k, a: e.a / k, yc: e.yc / k, b: e.b / k, s: e.s || 1 }; }

  function toB(top, bot, yMin, yMax) {
    var xl = Math.min(top.xc - top.a, bot.xc - bot.a), xr = Math.max(top.xc + top.a, bot.xc + bot.a);
    return { cx: (xl + xr) / 2, r: (xr - xl) / 2, yTop: yMin, yBot: yMax, xLeft: xl, xRight: xr,
      topH: toHandles(top), botH: toHandles(bot), topE: top, botE: bot };
  }

  function detect(cv) {
    var S = small(cv), mask = silhouette(S), f = fitFromMask(mask, S.W, S.H), top = f.top, bot = f.bot;
    if (!top || !bot) return null;
    top.s = cameraAboveTop(top, bot, S.H) ? 1 : -1;
    return toB(scaleE(top, S.sc), scaleE(bot, S.sc), f.yMin / S.sc, f.yMax / S.sc);
  }

  return { detect: detect, _silhouette: function (cv) { var S = small(cv); return { mask: silhouette(S), W: S.W, H: S.H }; } };
})();
