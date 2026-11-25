/* Seam merge in the browser (opt-in, Adjust checkbox): no ghosting by construction.
   Port of museum-rollout-reconstruction/adjust-hf-test/seam-stitch.py (PR #22).

   Input: the cropped, unfeathered Map strips. They are already flattened, so neighbours differ by
   a horizontal shift plus a small vertical shift and scale (rim/base detection varies per photo):
     x_a = x_b + tx,  y_a = s * y_b + ty
   1. Match every pair at a working resolution: coarse NCC shift, then a grid of small patches.
   2. Fit (tx, s, ty) per pair robustly; keep pairs with enough matches spread over the band.
   3. Place strips with a maximum spanning tree of the strongest pairs (order-free), sort by x.
   4. Resample each strip to a common vertical scale and gain-match it to the composite.
   5. In each overlap cut a minimum-difference seam top to bottom; each pixel comes from one strip,
      with a narrow crossfade at the seam. Paint is never averaged from two misaligned photos.
   Returns { canvas, joins, order } or { error } (the caller then falls back to the server). */
"use strict";
var SEAMMERGE = (function () {
  var WORK_H = 400, MIN_INLIERS = 20, FEATHER = 4;

  function gray(cv, k) { // high-passed luminance at scale k, with a validity mask
    var w = Math.max(8, Math.round(cv.width * k)), h = Math.max(8, Math.round(cv.height * k));
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var x = c.getContext("2d"); x.drawImage(cv, 0, 0, w, h);
    var d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h), m = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) {
      g[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
      m[i] = d[4 * i + 3] > 250 && d[4 * i] + d[4 * i + 1] + d[4 * i + 2] > 12 ? 1 : 0;
    }
    var r = Math.max(2, Math.round(h / 60)), row = new Float32Array(w * h), hp = new Float32Array(w * h);
    for (var y = 0; y < h; y++) for (var xx = 0; xx < w; xx++) {
      var s = 0, n = 0; for (var q = -r; q <= r; q++) { var u = xx + q; if (u >= 0 && u < w) { s += g[y * w + u]; n++; } }
      row[y * w + xx] = s / n;
    }
    for (var y2 = 0; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) {
      var s2 = 0, n2 = 0; for (var q2 = -r; q2 <= r; q2++) { var v = y2 + q2; if (v >= 0 && v < h) { s2 += row[v * w + x2]; n2++; } }
      hp[y2 * w + x2] = g[y2 * w + x2] - s2 / n2;
    }
    return { g: hp, m: m, w: w, h: h };
  }

  // NCC of A(x, y) against B(x - dx, y - dy) over A's region x0..x1, y0..y1.
  function ncc(A, B, dx, dy, step, x0, x1, y0, y1) {
    var n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (var y = y0; y < y1; y += step) {
      var yb = y - dy; if (yb < 0 || yb >= B.h) continue;
      for (var x = x0; x < x1; x += step) {
        var xb = x - dx; if (xb < 0 || xb >= B.w) continue;
        var ia = y * A.w + x, ib = yb * B.w + xb;
        if (!A.m[ia] || !B.m[ib]) continue;
        var a = A.g[ia], b = B.g[ib];
        n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
      }
    }
    if (n < 30) return { r: -1, n: n };
    var va = saa - sa * sa / n, vb = sbb - sb * sb / n;
    return va > 1e-6 && vb > 1e-6 ? { r: (sab - sa * sb / n) / Math.sqrt(va * vb), n: n } : { r: -1, n: n };
  }

  // Candidate shifts of b relative to a (b's point x sits at x + dx in a), at quarter working scale.
  // Returns the strongest few distinct peaks; the patch fit decides between them, because edge
  // overlaps are foreshortened and a single low-resolution NCC peak is often wrong there.
  function coarse(Aq, Bq) {
    var cands = [], ry = Math.ceil(0.05 * Aq.h);
    for (var dx = -Math.round(0.95 * Aq.w); dx <= Math.round(0.95 * Bq.w); dx++) {
      if (Math.abs(dx) < 0.1 * Math.min(Aq.w, Bq.w)) continue;
      var x0 = Math.max(0, dx), x1 = Math.min(Aq.w, Bq.w + dx);
      if (x1 - x0 < 0.06 * Aq.w) continue;
      var best = { r: -1 };
      for (var dy = -ry; dy <= ry; dy++) {
        var c = ncc(Aq, Bq, dx, dy, 1, x0, x1, 0, Aq.h);
        if (c.n > 0.04 * Aq.w * Aq.h && c.r > best.r) best = { r: c.r, dx: dx, dy: dy };
      }
      if (best.r > 0.08) cands.push(best);
    }
    cands.sort(function (p, q) { return q.r - p.r; });
    var peaks = [];
    for (var i = 0; i < cands.length && peaks.length < 4; i++)
      if (peaks.every(function (p) { return Math.abs(p.dx - cands[i].dx) > 0.05 * Aq.w; })) peaks.push(cands[i]);
    return peaks;
  }

  // Patch matches [xa, ya, xb, yb] at working scale around a coarse shift (in working pixels).
  function patches(A, B, dx0, dy0) {
    var R = 6, STEP = 8, SY = Math.ceil(0.06 * A.h), SX = 5, out = [];
    for (var ya = R + 2; ya < A.h - R - 2; ya += STEP) for (var xa = R; xa < A.w - R; xa += STEP) {
      var xb0 = xa - dx0; if (xb0 < R + SX || xb0 >= B.w - R - SX) continue;
      var s = 0, ss = 0, k = 0, ok = true;
      for (var y = ya - R; y <= ya + R && ok; y++) for (var x = xa - R; x <= xa + R; x++) {
        var i = y * A.w + x; if (!A.m[i]) { ok = false; break; } s += A.g[i]; ss += A.g[i] * A.g[i]; k++;
      }
      if (!ok || ss / k - (s / k) * (s / k) < 20) continue;
      var best = -2, bdx = 0, bdy = 0, sc = {};
      for (var ddy = -SY; ddy <= SY; ddy++) for (var ddx = -SX; ddx <= SX; ddx++) {
        var c = ncc(A, B, dx0 + ddx, dy0 + ddy, 1, xa - R, xa + R + 1, ya - R, ya + R + 1);
        if (c.n < 0.9 * k) continue;
        sc[ddx + "," + ddy] = c.r;
        if (c.r > best) { best = c.r; bdx = ddx; bdy = ddy; }
      }
      if (best < 0.7) continue;
      var rival = -2;
      for (var key in sc) { var p = key.split(","); if (Math.abs(+p[1] - bdy) > 2 && sc[key] > rival) rival = sc[key]; }
      if (rival > best - 0.05) continue;
      var up = sc[bdx + "," + (bdy - 1)], dn = sc[bdx + "," + (bdy + 1)], sub = 0;
      if (up != null && dn != null) { var den = up - 2 * best + dn; if (den < 0) sub = Math.max(-0.5, Math.min(0.5, 0.5 * (up - dn) / den)); }
      out.push([xa, ya, xa - dx0 - bdx, ya - dy0 - bdy - sub]);
    }
    return out;
  }
  function med(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s[s.length >> 1]; }

  // Robust (tx, s, ty) from matches; falls back to a pure shift when matches don't span the band.
  function fitPair(m, h) {
    var MIN = MIN_INLIERS;
    var dxs = m.map(function (p) { return p[0] - p[2]; }), mdx = med(dxs);
    m = m.filter(function (p) { return Math.abs(p[0] - p[2] - mdx) <= 2; });
    if (m.length < MIN) return null;
    var bs = 1, bt = med(m.map(function (p) { return p[1] - p[3]; })), bn = -1, seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var it = 0; it < 300; it++) {
      var i = Math.floor(rnd() * m.length), j = Math.floor(rnd() * m.length);
      if (Math.abs(m[i][3] - m[j][3]) < 0.2 * h) continue;
      var s = (m[i][1] - m[j][1]) / (m[i][3] - m[j][3]); if (!(s > 0.85 && s < 1.15)) continue;
      var t = m[i][1] - s * m[i][3], n = 0;
      m.forEach(function (p) { if (Math.abs(s * p[3] + t - p[1]) < 1.5) n++; });
      if (n > bn) { bs = s; bt = t; bn = n; }
    }
    var inl = m.filter(function (p) { return Math.abs(bs * p[3] + bt - p[1]) < 1.5; });
    var ys = inl.map(function (p) { return p[3]; });
    if (inl.length >= MIN && Math.max.apply(null, ys) - Math.min.apply(null, ys) > 0.3 * h) {
      var n2 = inl.length, sx = 0, sy = 0, sxx = 0, sxy = 0; // least-squares refit on inliers
      inl.forEach(function (p) { sx += p[3]; sy += p[1]; sxx += p[3] * p[3]; sxy += p[3] * p[1]; });
      bs = (n2 * sxy - sx * sy) / (n2 * sxx - sx * sx); bt = (sy - bs * sx) / n2;
    } else {
      bs = 1; var dyy = med(m.map(function (p) { return p[1] - p[3]; }));
      inl = m.filter(function (p) { return Math.abs(p[1] - p[3] - dyy) < 2; }); bt = med(inl.map(function (p) { return p[1] - p[3]; }));
      if (inl.length < MIN) return null;
    }
    return { tx: med(inl.map(function (p) { return p[0] - p[2]; })), s: bs, ty: bt, n: inl.length };
  }

  function seamPath(cost, W, H, lo, hi) { // min-cost top-to-bottom path in columns lo..hi-1
    var Wc = hi - lo, acc = new Float64Array(Wc * H), back = new Int8Array(Wc * H);
    for (var x = 0; x < Wc; x++) acc[x] = cost[lo + x];
    for (var y = 1; y < H; y++) for (var x2 = 0; x2 < Wc; x2++) {
      var b = acc[(y - 1) * Wc + x2], k = 0;
      if (x2 > 0 && acc[(y - 1) * Wc + x2 - 1] < b) { b = acc[(y - 1) * Wc + x2 - 1]; k = -1; }
      if (x2 < Wc - 1 && acc[(y - 1) * Wc + x2 + 1] < b) { b = acc[(y - 1) * Wc + x2 + 1]; k = 1; }
      acc[y * Wc + x2] = b + cost[y * W + lo + x2]; back[y * Wc + x2] = k;
    }
    var best = 0; for (var x3 = 1; x3 < Wc; x3++) if (acc[(H - 1) * Wc + x3] < acc[(H - 1) * Wc + best]) best = x3;
    var path = new Int32Array(H);
    for (var y2 = H - 1; y2 >= 0; y2--) { path[y2] = best + lo; best = Math.max(0, Math.min(Wc - 1, best + back[y2 * Wc + best])); }
    return path;
  }

  // Pairwise matching + maximum spanning tree from strip 0 (order-free). pose: x_0 = x_k + X,
  // y_0 = S * y_k + T. Returns { pose, edges, order } (order: left to right) or { error }.
  function place(strips) {
    var n = strips.length;
    if (n < 2) return { error: "fewer than two strips" };
    var H0 = Math.max.apply(null, strips.map(function (s) { return s.height; })), k = Math.min(1, WORK_H / H0);
    var G = strips.map(function (s) { return gray(s, k); }), Q = strips.map(function (s) { return gray(s, k / 4); });
    var edges = [];
    for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
      var f = null;
      coarse(Q[i], Q[j]).forEach(function (c) { // keep the candidate with the most consistent matches
        var g = fitPair(patches(G[i], G[j], Math.round(c.dx * G[i].w / Q[i].w), Math.round(c.dy * G[i].h / Q[i].h)), G[i].h);
        if (g && (!f || g.n > f.n)) f = g;
      });
      if (f) edges.push({ i: i, j: j, tx: f.tx / k, s: f.s, ty: f.ty / k, n: f.n });
    }
    var pose = {}; pose[0] = { X: 0, S: 1, T: 0 };
    for (var placed = 1; placed < n; placed++) {
      var best = null;
      edges.forEach(function (e) { if ((e.i in pose) !== (e.j in pose) && (!best || e.n > best.n)) best = e; });
      if (!best) {
        var missing = []; for (var q = 0; q < n; q++) if (!(q in pose)) missing.push(q + 1);
        return { error: "photo " + missing.join(", ") + " has no reliable overlap" };
      }
      if (best.i in pose) { var P = pose[best.i]; pose[best.j] = { X: P.X + best.tx, S: P.S * best.s, T: P.S * best.ty + P.T }; }
      else { var P2 = pose[best.j]; pose[best.i] = { X: P2.X - best.tx, S: P2.S / best.s, T: P2.T - P2.S * best.ty / best.s }; }
    }
    var order = Object.keys(pose).map(Number).sort(function (a, b) { return pose[a].X - pose[b].X; });
    return { pose: pose, edges: edges, order: order };
  }

  function merge(strips) {
    var n = strips.length, pl = place(strips);
    if (pl.error) return { error: pl.error };
    var pose = pl.pose, edges = pl.edges;
    var order = pl.order;
    var gm = Math.exp(order.reduce(function (a, q) { return a + Math.log(pose[q].S); }, 0) / n); // keep mean height
    var X0 = pose[order[0]].X, placedS = order.map(function (q) {
      var S = pose[q].S / gm, s = strips[q];
      return { q: q, cv: s, w: s.width, h: Math.round(s.height * S), x: Math.round(pose[q].X - X0), y: pose[q].T / gm };
    });
    var ymin = Math.min.apply(null, placedS.map(function (p) { return p.y; }));
    placedS.forEach(function (p) { p.y = Math.round(p.y - ymin); });
    var Wc = Math.max.apply(null, placedS.map(function (p) { return p.x + p.w; })), Hc = Math.max.apply(null, placedS.map(function (p) { return p.y + p.h; }));
    var N = Wc * Hc, out = new Float32Array(3 * N), have = new Uint8Array(N), joins = [];
    var tmp = document.createElement("canvas"); tmp.width = Wc; tmp.height = Hc;
    var tctx = tmp.getContext("2d", { willReadFrequently: true });
    placedS.forEach(function (p, idx) {
      tctx.clearRect(0, 0, Wc, Hc); tctx.drawImage(p.cv, p.x, p.y, p.w, p.h);
      var d = tctx.getImageData(0, 0, Wc, Hc).data, valid = new Uint8Array(N);
      for (var i2 = 0; i2 < N; i2++) valid[i2] = d[4 * i2 + 3] > 250 && d[4 * i2] + d[4 * i2 + 1] + d[4 * i2 + 2] > 6 ? 1 : 0;
      if (idx === 0) {
        for (var i3 = 0; i3 < N; i3++) if (valid[i3]) { have[i3] = 1; out[3 * i3] = d[4 * i3]; out[3 * i3 + 1] = d[4 * i3 + 1]; out[3 * i3 + 2] = d[4 * i3 + 2]; }
        return;
      }
      // gain-match the new strip to the composite in their overlap
      var sa = [0, 0, 0], sb = [0, 0, 0], cnt = 0, a = Wc, b = -1;
      for (var y = 0; y < Hc; y++) for (var x = p.x; x < Math.min(Wc, p.x + p.w); x++) {
        var i4 = y * Wc + x; if (!(have[i4] && valid[i4])) continue;
        cnt++; if (x < a) a = x; if (x > b) b = x;
        for (var ch = 0; ch < 3; ch++) { sa[ch] += out[3 * i4 + ch]; sb[ch] += d[4 * i4 + ch]; }
      }
      if (cnt < Hc || b - a < 10) { joins.push({ join: [order[idx - 1] + 1, p.q + 1], error: "no overlap" }); a = b = -1; }
      var gain = [0, 1, 2].map(function (ch) { return cnt ? Math.max(0.4, Math.min(2.5, sa[ch] / Math.max(1, sb[ch]))) : 1; });
      // seam cost: blurred colour difference; never cut where only one strip has content
      var cost = new Float32Array(N), lo = Math.max(0, Math.round(a + 0.2 * (b - a))), hi = a < 0 ? 0 : Math.max(lo + 2, Math.round(a + 0.8 * (b - a)));
      for (var y2 = 0; y2 < Hc; y2++) for (var x2 = lo; x2 < hi; x2++) {
        var i5 = y2 * Wc + x2;
        if (!(have[i5] && valid[i5])) { cost[i5] = 1e4; continue; }
        cost[i5] = Math.abs(out[3 * i5] - d[4 * i5] * gain[0]) + Math.abs(out[3 * i5 + 1] - d[4 * i5 + 1] * gain[1]) + Math.abs(out[3 * i5 + 2] - d[4 * i5 + 2] * gain[2]);
      }
      var bl = new Float32Array(N); // 5x5 box blur inside the band
      for (var y3 = 0; y3 < Hc; y3++) for (var x3 = lo; x3 < hi; x3++) {
        var s = 0, m = 0;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
          var yy = y3 + dy, xx = x3 + dx; if (yy < 0 || yy >= Hc || xx < lo || xx >= hi) continue; s += cost[yy * Wc + xx]; m++;
        }
        bl[y3 * Wc + x3] = s / m;
      }
      var path = b > a && a >= 0 ? seamPath(bl, Wc, Hc, lo, hi) : null;
      for (var y4 = 0; y4 < Hc; y4++) for (var x4 = p.x; x4 < Math.min(Wc, p.x + p.w); x4++) {
        var i6 = y4 * Wc + x4; if (!valid[i6]) continue;
        var w = !have[i6] ? 1 : path ? Math.max(0, Math.min(1, (x4 - path[y4] + FEATHER) / (2 * FEATHER))) : 0;
        if (w <= 0) continue;
        for (var ch2 = 0; ch2 < 3; ch2++) out[3 * i6 + ch2] = out[3 * i6 + ch2] * (1 - w) + d[4 * i6 + ch2] * gain[ch2] * w;
        have[i6] = 1;
      }
      if (path) {
        var e = edges.filter(function (z) { return (z.i === order[idx - 1] && z.j === p.q) || (z.j === order[idx - 1] && z.i === p.q); })[0];
        joins.push({ join: [order[idx - 1] + 1, p.q + 1], seam: [Math.min.apply(null, path), Math.max.apply(null, path)],
                     overlap: [a, b], direct: !!e, matches: e ? e.n : 0, gain: gain.map(function (g) { return +g.toFixed(3); }) });
      }
    });
    var res = document.createElement("canvas"); res.width = Wc; res.height = Hc;
    var rctx = res.getContext("2d"), img = rctx.createImageData(Wc, Hc);
    for (var i7 = 0; i7 < N; i7++) {
      img.data[4 * i7 + 3] = 255;
      if (have[i7]) for (var ch3 = 0; ch3 < 3; ch3++) img.data[4 * i7 + ch3] = Math.max(0, Math.min(255, Math.round(out[3 * i7 + ch3])));
    }
    rctx.putImageData(img, 0, 0);
    return { canvas: res, joins: joins, order: order.map(function (q) { return q + 1; }),
             poses: placedS.map(function (p) { return { photo: p.q + 1, x: p.x, y: p.y, scale: +(p.h / p.cv.height).toFixed(4) }; }) };
  }

  return { merge: merge, place: place, params: { WORK_H: WORK_H, MIN_INLIERS: MIN_INLIERS, FEATHER: FEATHER },
    _internal: { gray: gray, coarse: coarse, patches: patches, fitPair: fitPair } }; // for tests
})();
