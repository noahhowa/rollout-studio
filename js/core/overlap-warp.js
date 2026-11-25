/* Bounded vertical overlap correction for the Adjust step (opt-in, runs before Stitch).
   Port of museum-rollout-reconstruction/adjust-hf-test/fit-adjust.py + prepare-strips.cjs.

   Each Map strip gets a small vertical displacement field, a 4-coefficient model per strip:
     d(u, v) = taper(v) * (a + b*u + c*u^2 + s*(v - 0.5))      (pixels at a 540-px-high strip)
   where u is the horizontal position (0 at the strip centre, +-1 at 37% of its width) and v the
   height fraction. The taper is 0 at the rim and the base, so the edges the Map step found stay put.
   Coefficients are fitted so that matched points in every overlap land at the same height:
     y_i + d_i(p_i) = y_j + d_j(p_j).
   The fit is regularised, robust (IRLS), capped at 3% of the strip height, and must improve a
   spatial 4-fold holdout. Otherwise it is declined and the original strips are used unchanged.
   Matching is block-based NCC (no feature detector in the browser): a coarse shift per pair, then a
   grid of small patches searched vertically. */
"use strict";
var OVERLAPWARP = (function () {
  var W = 650, H = 540, MARGIN_X = 95, MARGIN_TOP = 32, MARGIN_BOT = 28, CAP = 0.03 * H;
  var REG = [5, 10, 14, 17];

  function gray(cv, w, h, marginX) { // luminance, resized, with a mask of non-background pixels
    // marginX: limb margin to ignore, in model pixels (default MARGIN_X; the crop check uses less)
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var x = c.getContext("2d"); x.drawImage(cv, 0, 0, w, h);
    var d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h), m = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) {
      g[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
      m[i] = d[4 * i + 3] > 250 && d[4 * i] + d[4 * i + 1] + d[4 * i + 2] > 12 ? 1 : 0;
    }
    // High-pass (subtract a box blur) so lighting gradients between photos don't drive the NCC, and
    // ignore the stretched limbs at either side of each strip (as the prototype's keypoint mask).
    var r = Math.max(2, Math.round(w / 60)), hp = new Float32Array(w * h), mx = Math.round(w * (marginX == null ? MARGIN_X : marginX) / W);
    var row = new Float32Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var s = 0, n = 0; for (var k = -r; k <= r; k++) { var xx = x + k; if (xx >= 0 && xx < w) { s += g[y * w + xx]; n++; } }
      row[y * w + x] = s / n;
    }
    for (var y2 = 0; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) {
      var s2 = 0, n2 = 0; for (var k2 = -r; k2 <= r; k2++) { var yy = y2 + k2; if (yy >= 0 && yy < h) { s2 += row[yy * w + x2]; n2++; } }
      hp[y2 * w + x2] = g[y2 * w + x2] - s2 / n2;
      if (x2 < mx || x2 >= w - mx) m[y2 * w + x2] = 0;
    }
    return { g: hp, m: m, w: w, h: h };
  }

  // NCC of A against B shifted by (dx, dy): A(x, y) ~ B(x - dx, y - dy). Region limited to x0..x1.
  function ncc(A, B, dx, dy, step, x0, x1, y0, y1) {
    var n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, w = A.w;
    for (var y = y0; y < y1; y += step) {
      var yb = y - dy; if (yb < 0 || yb >= B.h) continue;
      for (var x = x0; x < x1; x += step) {
        var xb = x - dx; if (xb < 0 || xb >= B.w) continue;
        var ia = y * w + x, ib = yb * B.w + xb;
        if (!A.m[ia] || !B.m[ib]) continue;
        var a = A.g[ia], b = B.g[ib];
        n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
      }
    }
    if (n < 30) return { r: -1, n: n };
    var va = saa - sa * sa / n, vb = sbb - sb * sb / n;
    if (va <= 1e-6 || vb <= 1e-6) return { r: -1, n: n };
    return { r: (sab - sa * sb / n) / Math.sqrt(va * vb), n: n };
  }

  // Coarse placement of b relative to a: point (x, y) in b sits at (x + dx, y + dy) in a.
  function coarseShift(A8, B8, A2, B2) {
    var best = { r: -1 }, w = A8.w;
    for (var dx = -Math.round(0.9 * w); dx <= Math.round(0.9 * w); dx++) {
      if (Math.abs(dx) < 0.12 * w) continue;
      for (var dy = -Math.ceil(0.04 * A8.h); dy <= Math.ceil(0.04 * A8.h); dy++) {
        var c = ncc(A8, B8, dx, dy, 1, Math.max(0, dx), Math.min(w, w + dx), 0, A8.h);
        if (c.n > 0.04 * w * A8.h && c.r > best.r) best = { r: c.r, dx: dx, dy: dy };
      }
    }
    if (best.r < 0.2) return null;
    var f = A2.w / w, F = Math.ceil(f), cx = Math.round(best.dx * f), cy = Math.round(best.dy * A2.h / A8.h), ref = { r: -1 };
    for (var dx2 = cx - F; dx2 <= cx + F; dx2++) // refine at half resolution
      for (var dy2 = cy - F; dy2 <= cy + F; dy2++) {
        var c2 = ncc(A2, B2, dx2, dy2, 2, Math.max(0, dx2), Math.min(A2.w, A2.w + dx2), 0, A2.h);
        if (c2.r > ref.r) ref = { r: c2.r, dx: dx2, dy: dy2 };
      }
    return { dx: ref.dx * W / A2.w, dy: ref.dy * H / A2.h, r: ref.r };
  }

  // Patch matches in the overlap at full model resolution. Returns arrays of [xa, ya, xb, yb].
  function patchMatches(A, B, shift, marginX) {
    var R = 7, STEP = 18, SY = Math.ceil(CAP) + 4, SX = 2, out = [], MX = marginX == null ? MARGIN_X : marginX;
    var dx0 = Math.round(shift.dx), dy0 = Math.round(shift.dy);
    var XSTEP = W - 2 * MX - Math.abs(dx0) < 150 ? 9 : STEP; // denser columns in a narrow overlap
    for (var ya = MARGIN_TOP + R + 2; ya < H - MARGIN_BOT - R - 2; ya += STEP) {
      for (var xa = MX + R; xa < W - MX - R; xa += XSTEP) {
        var xb0 = xa - dx0; if (xb0 < MX + R || xb0 >= W - MX - R) continue;
        // texture check on A's patch
        var s = 0, ss = 0, k = 0, ok = true;
        for (var y = ya - R; y <= ya + R && ok; y++) for (var x = xa - R; x <= xa + R; x++) {
          var i = y * W + x; if (!A.m[i]) { ok = false; break; } s += A.g[i]; ss += A.g[i] * A.g[i]; k++;
        }
        if (!ok || ss / k - (s / k) * (s / k) < 20) continue;
        var best = -2, second = -2, bdy = 0, bdx = 0, scores = {};
        for (var ddy = -SY; ddy <= SY; ddy++) for (var ddx = -SX; ddx <= SX; ddx++) {
          var c = ncc(A, B, dx0 + ddx, dy0 + ddy, 1, xa - R, xa + R + 1, ya - R, ya + R + 1);
          if (c.n < k * 0.9) continue;
          scores[ddx + "," + ddy] = c.r;
          if (c.r > best) { best = c.r; bdy = ddy; bdx = ddx; }
        }
        if (best < 0.7) continue;
        for (var key in scores) { // distinct peak: no rival more than 2 rows away
          var p = key.split(","); if (Math.abs(+p[1] - bdy) > 2 && scores[key] > second) second = scores[key];
        }
        if (second > best - 0.05) continue;
        var up = scores[bdx + "," + (bdy - 1)], dn = scores[bdx + "," + (bdy + 1)], sub = 0;
        if (up != null && dn != null) { var den = up - 2 * best + dn; if (den < 0) sub = 0.5 * (up - dn) / den; }
        var dyTot = dy0 + bdy + Math.max(-0.5, Math.min(0.5, sub));
        out.push([xa, ya, xa - (dx0 + bdx), ya - dyTot]);
      }
    }
    return out;
  }

  function design(x, y) {
    var u = (x - W / 2) / (W * 0.37), v = y / H, taper = Math.min(1, Math.min(v, 1 - v) / 0.1);
    return [taper, u * taper, u * u * taper, (v - 0.5) * taper];
  }

  function solve(M, rhs) { // Gaussian elimination with partial pivoting
    var n = rhs.length;
    for (var c = 0; c < n; c++) {
      var p = c; for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var t = M[c]; M[c] = M[p]; M[p] = t; var tr = rhs[c]; rhs[c] = rhs[p]; rhs[p] = tr;
      for (var r2 = c + 1; r2 < n; r2++) {
        var f = M[r2][c] / M[c][c]; if (!f) continue;
        for (var k = c; k < n; k++) M[r2][k] -= f * M[c][k];
        rhs[r2] -= f * rhs[c];
      }
    }
    var x = new Array(n);
    for (var i = n - 1; i >= 0; i--) { var s = rhs[i]; for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    return x;
  }

  // rows: {i, j, da (4), db (4), b}; returns coefficients [n][4], capped
  function fit(rows, n) {
    var P = 4 * n, w = rows.map(function () { return 1; }), beta;
    for (var it = 0; it < 4; it++) {
      var M = [], rhs = new Array(P).fill(0);
      for (var a = 0; a < P; a++) { M.push(new Array(P).fill(0)); M[a][a] = REG[a % 4] * REG[a % 4]; }
      rows.forEach(function (r, q) {
        var idx = [], val = [], ww = w[q] * w[q];
        for (var k = 0; k < 4; k++) { idx.push(4 * r.i + k, 4 * r.j + k); val.push(r.da[k], -r.db[k]); }
        for (var s = 0; s < 8; s++) { rhs[idx[s]] += ww * val[s] * r.b; for (var t = 0; t < 8; t++) M[idx[s]][idx[t]] += ww * val[s] * val[t]; }
      });
      beta = solve(M, rhs);
      w = rows.map(function (r) { return Math.sqrt(Math.min(1, 5 / Math.max(1, Math.abs(r.b - predict(beta, r))))); });
    }
    var umax = 0.5 / 0.37, out = [];
    for (var i = 0; i < n; i++) {
      var c = beta.slice(4 * i, 4 * i + 4);
      var cap = Math.abs(c[0]) + Math.abs(c[1]) * umax + Math.abs(c[2]) * umax * umax + Math.abs(c[3]) * 0.5;
      var f = Math.min(1, CAP / Math.max(1, cap));
      out.push(c.map(function (v) { return v * f; }));
    }
    return out;
  }
  function predict(beta, r) {
    var s = 0;
    for (var k = 0; k < 4; k++) s += beta[4 * r.i + k] * r.da[k] - beta[4 * r.j + k] * r.db[k];
    return s;
  }
  function medAbs(a) { var s = a.map(Math.abs).sort(function (x, y) { return x - y; }); return s.length ? s[s.length >> 1] : 0; }

  /* strips: full Map strips (canvases, before crop). Returns {coefficients, before, after, pairs}
     or {declined: reason}. Percentages are of strip height (median |vertical mismatch|). */
  function estimate(strips) {
    var n = strips.length;
    if (n < 2) return { declined: "fewer than two strips" };
    var full = strips.map(function (s) { return gray(s, W, H); });
    var half = strips.map(function (s) { return gray(s, W >> 1, H >> 1); });
    var eighth = strips.map(function (s) { return gray(s, Math.round(W / 4), Math.round(H / 4)); });
    var rows = [], pairs = [], linked = [0];
    for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
      var sh = coarseShift(eighth[i], eighth[j], half[i], half[j]);
      if (!sh || Math.abs(sh.dy) > 0.055 * H) continue;
      var m = patchMatches(full[i], full[j], sh);
      if (m.length < 18) continue;
      var ys = m.map(function (p) { return p[1]; });
      if (Math.max.apply(null, ys) - Math.min.apply(null, ys) < 130) continue; // must span the band
      m.forEach(function (p) {
        rows.push({ i: i, j: j, da: design(p[0], p[1]), db: design(p[2], p[3]), b: p[3] - p[1],
                    fold: ((Math.floor(p[0] / 38) + 2 * Math.floor(p[1] / 52)) % 4 + 4) % 4 });
      });
      pairs.push({ views: [i + 1, j + 1], matches: m.length, dx: Math.round(sh.dx) });
    }
    for (var pass = 0; pass < n; pass++) pairs.forEach(function (p) {
      var a = p.views[0] - 1, b = p.views[1] - 1;
      if ((linked.indexOf(a) >= 0) !== (linked.indexOf(b) >= 0)) linked.push(linked.indexOf(a) >= 0 ? b : a);
    });
    if (linked.length < n) return { declined: "photo " + (n > linked.length ? (function () { for (var k = 0; k < n; k++) if (linked.indexOf(k) < 0) return k + 1; })() : "?") + " has no reliable overlap", pairs: pairs };
    var before = medAbs(rows.map(function (r) { return r.b; })), resid = [];
    for (var f = 0; f < 4; f++) {
      var train = rows.filter(function (r) { return r.fold !== f; }), held = rows.filter(function (r) { return r.fold === f; });
      if (!held.length) continue;
      var flat = [].concat.apply([], fit(train, n));
      held.forEach(function (r) { resid.push(r.b - predict(flat, r)); });
    }
    var after = medAbs(resid);
    var rep = { before: 100 * before / H, after: 100 * after / H, matches: rows.length, pairs: pairs };
    if (!(after < before)) { rep.declined = "holdout did not improve"; return rep; }
    rep.coefficients = fit(rows, n);
    return rep;
  }

  // Inverse remap: output row v takes the source row t with t + d(t) = v (bisection, as prepared).
  function apply(src, coef) {
    var a = coef[0], b = coef[1], c = coef[2], s = coef[3];
    if (!(a || b || c || s)) return src;
    var w = src.width, h = src.height, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d"), out = ctx.createImageData(w, h);
    var inp = src.getContext("2d").getImageData(0, 0, w, h).data, o = out.data;
    for (var x = 0; x < w; x++) {
      var u = (x / (w - 1) - 0.5) / 0.37, base = a + b * u + c * u * u;
      for (var y = 0; y < h; y++) {
        var v = y / (h - 1), lo = 0, hi = 1;
        for (var step = 0; step < 17; step++) {
          var tt = (lo + hi) / 2, tw = Math.min(1, tt / 0.1, (1 - tt) / 0.1);
          if (tt + tw * (base + s * (tt - 0.5)) / H < v) lo = tt; else hi = tt;
        }
        var sy = y === 0 || y === h - 1 ? y : (lo + hi) / 2 * (h - 1);
        var y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fr = sy - y0;
        for (var ch = 0; ch < 4; ch++) o[4 * (y * w + x) + ch] = (1 - fr) * inp[4 * (y0 * w + x) + ch] + fr * inp[4 * (y1 * w + x) + ch];
      }
    }
    ctx.putImageData(out, 0, 0);
    return cv;
  }

  return { estimate: estimate, apply: apply, params: { W: W, H: H },
    _internal: { gray: gray, coarseShift: coarseShift, patchMatches: patchMatches } }; // also used by CROPCHECK
})();
