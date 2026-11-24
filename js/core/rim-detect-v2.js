/* Rim detection v2: color-agnostic silhouette + ellipse fitting.
   A circle seen through a camera is an ellipse, so each rim is modelled as an axis-aligned
   ellipse {xc, yc, a, b}. The rim we want is its front (lower) half: y = yc + b*sqrt(1-u^2).
   - silhouette: separate object from background using colours sampled along the image border
   - top ellipse: seeded from the silhouette's back arc, then checked against the visible front lip
   - bottom ellipse: fitted to the silhouette's bottom edge (= front half of the bottom rim)
   - the camera is assumed to be above the top rim (front arc bows down)
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
    return cleanMask(m, W, H);
  }

  /* A vessel is a solid of revolution, so its silhouette is symmetric about a vertical axis. Repair
     the mask row by row: gaps inside a row are filled; a row missing one side (dark paint matching
     the backdrop) is mirrored from the other side; empty rows get their half-width interpolated
     from the nearest rows above and below. */
  function revolve(m, W, H) {
    var L = new Int32Array(H).fill(-1), R = new Int32Array(H).fill(-1), y, x, mids = [];
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (m[y * W + x]) { if (L[y] < 0) L[y] = x; R[y] = x; }
    for (y = 0; y < H; y++) if (L[y] >= 0 && R[y] - L[y] > 4) mids.push((L[y] + R[y]) / 2);
    if (mids.length < 5) return m;
    var xc = median(mids), hw = new Float32Array(H).fill(-1), y0 = -1, y1 = -1;
    for (y = 0; y < H; y++) if (L[y] >= 0) { hw[y] = Math.max(xc - L[y], R[y] - xc); if (y0 < 0) y0 = y; y1 = y; }
    for (y = y0; y <= y1; y++) if (hw[y] < 0) {
      var a = y - 1, b = y + 1; while (hw[a] < 0) a--; while (b <= y1 && hw[b] < 0) b++;
      hw[y] = hw[a] + ((hw[b] - hw[a]) * (y - a)) / (b - a);
    }
    var out = new Uint8Array(W * H);
    for (y = y0; y <= y1; y++) {
      var lo, hi;
      // intact rows keep their own span; empty rows or rows with one side missing use the symmetric span
      if (L[y] >= 0 && (R[y] - L[y]) / 2 >= 0.85 * hw[y]) { lo = L[y]; hi = R[y]; }
      else { lo = Math.ceil(xc - hw[y]); hi = Math.floor(xc + hw[y]); }
      for (x = Math.max(0, lo); x <= Math.min(W - 1, hi); x++) out[y * W + x] = 1;
    }
    return out;
  }

  // A contact shadow can re-expand below a rounded base and survive component merging.
  // Stop at a sudden shelf after the silhouette has already tapered toward its centre.
  function trimShadowShelf(mask, W, H) {
    var spans = [], widths = [], first = -1, last = -1;
    for (var y = 0; y < H; y++) {
      var span = rowSpan(mask, W, y); spans.push(span);
      if (span) { if (first < 0) first = y; last = y; }
    }
    if (last - first < 20) return mask;
    var height = last - first;
    for (y = Math.round(first + 0.25 * height); y <= first + 0.7 * height; y++) {
      if (spans[y]) widths.push(spans[y].r - spans[y].l + 1);
    }
    var bodyWidth = median(widths), lookback = Math.max(2, Math.round(0.008 * height));
    if (bodyWidth < 10) return mask;
    for (y = Math.round(first + 0.7 * height); y <= last; y++) {
      var before = spans[y - lookback], now = spans[y];
      if (!before || !now) continue;
      var oldWidth = before.r - before.l + 1, newWidth = now.r - now.l + 1;
      if (oldWidth < 0.75 * bodyWidth && newWidth > 0.95 * bodyWidth && newWidth - oldWidth > 0.25 * bodyWidth) {
        mask.fill(0, y * W); break;
      }
    }
    return mask;
  }

  // Keep the component nearest the centre (weighted by size), plus aligned fragments; fill holes.
  function cleanMask(m, W, H, gapFraction) {
    var i;
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
    // Also keep fragments stacked under/over the main one (a dark-painted band can split the vessel,
    // e.g. the red base separated from the body by black rows): within the main component's width
    // and a vertical gap under 25% of its height (75% while recovering a truncated base).
    var bx = [1e9, -1, 1e9, -1, 0], boxes = {};
    for (i = 0; i < W * H; i++) if (lab[i]) {
      var bb = boxes[lab[i]] || (boxes[lab[i]] = [1e9, -1, 1e9, -1, 0]), px = i % W, py = (i / W) | 0;
      if (px < bb[0]) bb[0] = px; if (px > bb[1]) bb[1] = px; if (py < bb[2]) bb[2] = py; if (py > bb[3]) bb[3] = py; bb[4]++;
    }
    bx = boxes[best]; var keep = {}; keep[best] = 1;
    for (var changed = true; changed; ) {
      changed = false;
      for (var id in boxes) {
        if (keep[id]) continue; var c = boxes[id];
        if (c[4] < 0.002 * W * H) continue;
        var ov = Math.min(c[1], bx[1]) - Math.max(c[0], bx[0]), gap = Math.max(c[2] - bx[3], bx[2] - c[3]);
        var slack = 0.05 * (boxes[best][1] - boxes[best][0]);
        // must fit within the vessel's width (shadows are wider) and sit close above/below it
        if (ov > 0 && c[0] >= boxes[best][0] - slack && c[1] <= boxes[best][1] + slack && gap < (gapFraction || 0.25) * (bx[3] - bx[2])) {
          keep[id] = 1; changed = true;
          bx = [Math.min(bx[0], c[0]), Math.max(bx[1], c[1]), Math.min(bx[2], c[2]), Math.max(bx[3], c[3]), bx[4] + c[4]];
        }
      }
    }
    for (i = 0; i < W * H; i++) m[i] = keep[lab[i]] ? 1 : 0;
    m = revolve(m, W, H);
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

  /* Two-class refinement (GrabCut-style): learn the vessel's own colours from the first mask, then
     re-classify pixels around it. A pixel is vessel only if it is closer to a vessel colour than to
     the local background or a darkened copy of it (a shadow: 35-100% of the background's brightness).
     This removes contact shadows and recovers dark bases that merely resemble the backdrop. */
  function refineMask(S, mask, recoverBase) {
    var W = S.W, H = S.H, d = S.d, i, x, y, obj = [], x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (mask[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0) return mask;
    // vessel colour samples: a grid over the mask, skipping its outer 3 px (edges mix with background)
    var step = Math.max(2, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / 600)));
    for (y = y0 + 3; y <= y1 - 3; y += step) for (x = x0 + 3; x <= x1 - 3; x += step) {
      if (mask[y * W + x] && mask[y * W + x - 3] && mask[y * W + x + 3] && mask[(y - 3) * W + x] && mask[(y + 3) * W + x]) {
        i = (y * W + x) * 4; obj.push([d[i], d[i + 1], d[i + 2]]);
      }
    }
    if (obj.length < 20) return mask;
    var m = 3, bs = Math.max(3, Math.round((2 * (W + H)) / 160)), side = [], tb = [];
    function px(xx, yy) { var j = (yy * W + xx) * 4; return [d[j], d[j + 1], d[j + 2], xx, yy]; }
    for (y = 0; y < H; y += bs) { side.push(px(m, y)); side.push(px(W - 1 - m, y)); }
    for (x = 0; x < W; x += bs) { tb.push(px(x, m)); tb.push(px(x, H - 1 - m)); }
    var out = new Uint8Array(mask), wy = 0.12 * H, edge = 0.25 * H;
    var rx0 = Math.max(0, x0 - Math.round(0.1 * (x1 - x0))), rx1 = Math.min(W - 1, x1 + Math.round(0.1 * (x1 - x0)));
    var ry0 = Math.max(0, y0 - 2), ry1 = recoverBase ? H - 1 : Math.min(H - 1, y1 + Math.round(0.15 * (y1 - y0)));
    for (y = ry0; y <= ry1; y++) {
      var cand = side.filter(function (s) { return Math.abs(s[4] - y) <= wy; });
      if (y < edge || y > H - edge) tb.forEach(function (s) { if (Math.abs(s[4] - y) <= edge) cand.push(s); });
      for (x = rx0; x <= rx1; x++) {
        i = (y * W + x) * 4;
        var r = d[i], g = d[i + 1], b = d[i + 2], dB = 1e9, dO = 1e9, k, a, v;
        for (k = 0; k < cand.length; k++) {
          a = cand[k];
          var t = (r * a[0] + g * a[1] + b * a[2]) / (a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + 1);
          t = t > 1 ? 1 : t < 0.35 ? 0.35 : t; // allow the background to be darkened (shadow), not brightened
          var er = r - t * a[0], eg = g - t * a[1], eb = b - t * a[2];
          v = er * er + eg * eg + eb * eb; if (v < dB) dB = v;
        }
        for (k = 0; k < obj.length && dO > 0; k++) {
          a = obj[k]; var or = r - a[0], og = g - a[1], ob = b - a[2];
          v = or * or + og * og + ob * ob; if (v < dO) dO = v;
        }
        out[y * W + x] = dO < dB ? 1 : 0;
      }
    }
    return cleanMask(out, W, H, recoverBase ? 0.75 : 0.25);
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

  function recoverFlatRimWidth(e, mask, W, height) {
    if (e.b >= 0.07 * e.a) return;
    // A nearly flat rim can cross a row where the mask clips a pale or thin lip.
    // Use several rows just inside the body to recover the ends, with a bounded expansion.
    var left = [], right = [];
    for (var i = 0; i < 7; i++) {
      var span = rowSpan(mask, W, Math.round(e.yc + height * (0.012 + 0.004 * i)));
      if (span) { left.push(span.l); right.push(span.r); }
    }
    if (left.length < 5) return;
    var xl = Math.max(e.xc - 1.2 * e.a, Math.min(e.xc - e.a, median(left)));
    var xr = Math.min(e.xc + 1.2 * e.a, Math.max(e.xc + e.a, median(right)));
    e.xc = (xl + xr) / 2;
    e.a = (xr - xl) / 2;
  }

  // Find a nearby vertical colour transition at one column of the original image.
  function edgeY(im, x, y, reach, blur) {
    x = Math.floor(x);
    if (x < 0 || x >= im.width) return null;
    var lo = Math.max(blur, Math.ceil(y - reach - 0.5));
    var hi = Math.min(im.height - blur - 1, Math.floor(y + reach - 0.5));
    var stride = 4 * im.width, d = im.data, pos = -1, strength = 0, best = 0;
    function contrast(p) {
      var i = (p - blur) * stride + 4 * x, j = i + 2 * blur * stride;
      return Math.hypot(d[i] - d[j], d[i + 1] - d[j + 1], d[i + 2] - d[j + 2]);
    }
    for (var p = lo; p <= hi; p++) {
      var c = contrast(p), score = c / (1 + Math.abs(p + 0.5 - y) / reach);
      if (score > best) { best = score; pos = p; strength = c; }
    }
    if (strength < 12) return null;
    // Interpolate the gradient peak between pixel centres.
    var delta = 0;
    if (pos > lo && pos < hi) {
      var l = contrast(pos - 1), r = contrast(pos + 1), curvature = l + r - 2 * strength;
      if (curvature < 0) delta = Math.max(-0.5, Math.min(0.5, (l - r) / (2 * curvature)));
    }
    return pos + 0.5 + delta;
  }

  function refineFrontRim(cv, e, height) {
    if (e.a < 5) return;
    var blur = Math.max(1, Math.round(cv.width / WORK));
    var reach = Math.max(3 * blur, 0.028 * height), pad = reach + blur + 1;
    // The sampled middle 80% reaches from yc + 0.6*b to yc + b.
    // Keep edge centres below yc so a shallow rim cannot snap to its exposed back edge.
    var y0 = Math.max(0, Math.ceil(e.yc) - blur, Math.floor(e.yc + 0.6 * e.b - pad));
    var y1 = Math.min(cv.height, Math.ceil(e.yc + e.b + pad));
    if (y1 <= y0) return;
    var im = cv.getContext("2d").getImageData(0, y0, cv.width, y1 - y0), xs = [], ys = [];
    for (var i = -12; i <= 12; i++) {
      var x = e.xc + e.a * i / 15;
      var edge = edgeY(im, x, frontY(e, x) - y0, reach, blur);
      if (edge !== null) { xs.push(Math.floor(x) + 0.5); ys.push(edge + y0); }
    }
    if (xs.length < 18) return;
    var fit = fitArc(xs, ys, e.xc, e.a, 1);
    var residuals = xs.map(function (x, i) {
      var u = (x - e.xc) / e.a;
      return Math.abs(ys[i] - fit.yc - fit.b * Math.sqrt(Math.max(0, 1 - u * u)));
    });
    if (median(residuals) > Math.max(1.5 * blur, 0.004 * height)) return;
    if (Math.abs(fit.yc - e.yc) > reach || Math.abs(fit.b - e.b) > reach) return;
    // Keep the silhouette as an anchor: painted lines can run parallel to the lip.
    e.yc = (e.yc + fit.yc) / 2;
    e.b = (e.b + fit.b) / 2;
  }

  function detect(cv, opts) {
    opts = opts || {};
    var S = small(cv), mask = silhouette(S), initial = fitFromMask(mask, S.W, S.H);
    // A flat cut well above the image bottom can be a dark painted band that split the mask.
    // Search the remaining rows rather than stopping 15% below that incomplete component.
    var fixBase = opts.twoClass !== false && opts.trimShadows !== false;
    var recoverBase = fixBase && initial.bot && initial.bot.b < 2 && initial.yMax < 0.85 * S.H;
    if (opts.twoClass !== false) mask = refineMask(S, mask, recoverBase);
    if (fixBase) mask = trimShadowShelf(mask, S.W, S.H);
    var f = fitFromMask(mask, S.W, S.H), top = f.top, bot = f.bot;
    // Preserve a similarly wide, rounded base when refinement grows far into the floor below it.
    if (fixBase && initial.bot && bot && initial.bot.b > 3 && initial.bot.a >= 0.85 * bot.a &&
        f.yMax - initial.yMax > 0.06 * (initial.yMax - initial.yMin)) {
      bot = initial.bot; f.yMax = initial.yMax;
    }
    if (!top || !bot) return null;
    // Front arc of the top rim bows down (camera above the rim), as in museum/product photos.
    // A perspective-based above/below guess was tried and lost on hand-labelled photos (3.9% vs 1.1%).
    top.s = opts.topDir || 1;
    var refine = opts.twoClass !== false && opts.refineRims !== false;
    var height = f.yMax - f.yMin;
    if (refine) recoverFlatRimWidth(top, mask, S.W, height);
    top = scaleE(top, S.sc);
    if (refine && top.s === 1) refineFrontRim(cv, top, height / S.sc);
    return toB(top, scaleE(bot, S.sc), f.yMin / S.sc, f.yMax / S.sc);
  }

  return { detect: detect, toHandles: toHandles, fitArc: fitArc, _silhouette: function (cv) { var S = small(cv); return { mask: silhouette(S), W: S.W, H: S.H }; } };
})();
