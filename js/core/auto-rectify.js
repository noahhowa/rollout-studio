/* Auto-rectification for the Refine step: find the stitched band's top and bottom edges in a
   panorama (e.g. the Hugging Face output: painted band on a black background, pieces at slightly
   different heights or tilts) and return them as polylines for doRectify() to straighten.
   Returns { top: [{x,y}...], bot: [{x,y}...] } in full-resolution pixels, or null. */
"use strict";
var AUTORECT = (function () {
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[s.length >> 1] : 0; }
  function bandLines(cv) {
    var sc = Math.min(1, 800 / cv.width), W = Math.max(10, Math.round(cv.width * sc)), H = Math.max(10, Math.round(cv.height * sc));
    var c = document.createElement("canvas"); c.width = W; c.height = H;
    var x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(cv, 0, 0, W, H);
    var d = x.getImageData(0, 0, W, H).data, lum = new Float32Array(W * H), i, col, y;
    for (i = 0; i < W * H; i++) lum[i] = d[4 * i + 3] < 128 ? 0 : 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
    // Background = dark pixels connected to the image border (flood fill). Dark paint inside the
    // band (rim bands, figures, outlines) is enclosed by the band, so it stays content.
    var bg = new Uint8Array(W * H), stack = [], DARK = 35;
    function seed(p) { if (!bg[p] && lum[p] < DARK) { bg[p] = 1; stack.push(p); } }
    for (col = 0; col < W; col++) { seed(col); seed((H - 1) * W + col); }
    for (y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
    while (stack.length) {
      var q = stack.pop(), qx = q % W, qy = (q / W) | 0;
      if (qx > 0) seed(q - 1); if (qx < W - 1) seed(q + 1); if (qy > 0) seed(q - W); if (qy < H - 1) seed(q + W);
    }
    // Per column: first and last content row.
    var tops = new Array(W).fill(-1), bots = new Array(W).fill(-1), lens = [];
    for (col = 0; col < W; col++) {
      for (y = 0; y < H; y++) if (!bg[y * W + col]) { tops[col] = y; break; }
      for (y = H - 1; y >= 0; y--) if (!bg[y * W + col]) { bots[col] = y; break; }
      if (tops[col] >= 0) lens.push(bots[col] - tops[col] + 1);
    }
    var typical = median(lens); if (!typical) { api.reason = 'no content'; return null; }
    var valid = []; for (col = 0; col < W; col++) if (tops[col] >= 0 && bots[col] - tops[col] >= 0.6 * typical) valid.push(col);
    if (valid.length < W * 0.3) { api.reason = 'too few full-height columns: ' + valid.length + '/' + W + ', typical ' + typical; return null; }
    function smooth(arr, col0) { // median of valid columns within +-6
      var vals = []; for (var k = -6; k <= 6; k++) { var cc = col0 + k; if (cc >= 0 && cc < W && arr[cc] >= 0 && bots[cc] - tops[cc] >= 0.6 * typical) vals.push(arr[cc]); }
      return vals.length ? median(vals) : null;
    }
    var first = valid[0], last = valid[valid.length - 1], n = 32, top = [], bot = [], inset = 0.01 * typical;
    // Smoothed outline per column (used as the search region for painted lines, and as fallback).
    var outT = new Float32Array(W).fill(NaN), outB = new Float32Array(W).fill(NaN);
    for (col = first; col <= last; col++) { var tt = smooth(tops, col), bb = smooth(bots, col); if (tt !== null && bb !== null) { outT[col] = tt; outB[col] = bb; } }
    /* Profile alignment: every column of a rollout crosses the same painted bands (rim, glyph band,
       frame lines, base) in the same vertical order. Each slice of columns gets the vertical shift and
       stretch (in band-relative coordinates v) that best aligns its brightness profile with a
       reference profile; corrections are smoothed along the band and the reference re-estimated
       once. The lines then follow the painted structure instead of the stitched outline, which steps
       between pieces. Falls back to the outline where a slice has too little structure. */
    var NV = 120, V0 = -0.06, V1 = 1.06;
    function prof(c0, c1, sh, k) { // mean high-passed luminance at band-relative v, columns c0..c1
      var out = new Float32Array(NV), cnt = new Float32Array(NV);
      for (var cc = c0; cc <= c1; cc++) {
        if (outT[cc] !== outT[cc]) continue;
        var t0 = outT[cc], span = outB[cc] - outT[cc];
        for (var i6 = 0; i6 < NV; i6++) {
          var v = V0 + (V1 - V0) * i6 / (NV - 1), vv = (v - 0.5) * k + 0.5 + sh, yy = Math.round(t0 + vv * span);
          if (yy < 1 || yy >= H - 1) continue;
          out[i6] += lum[yy * W + cc]; cnt[i6]++;
        }
      }
      var m = 0, nn = 0; for (i6 = 0; i6 < NV; i6++) if (cnt[i6]) { out[i6] /= cnt[i6]; m += out[i6]; nn++; } else out[i6] = NaN;
      m = nn ? m / nn : 0; var vs = 0;
      for (i6 = 0; i6 < NV; i6++) if (out[i6] === out[i6]) { out[i6] -= m; vs += out[i6] * out[i6]; }
      vs = Math.sqrt(vs) || 1; for (i6 = 0; i6 < NV; i6++) out[i6] = out[i6] === out[i6] ? out[i6] / vs : 0;
      return { p: out, ok: nn > NV * 0.8 };
    }
    function corr(x1, x2) { var sum = 0; for (var i7 = 0; i7 < NV; i7++) sum += x1[i7] * x2[i7]; return sum; }
    var BW = Math.max(6, Math.round((last - first) / 40)), blocks = [];
    for (var c5 = first; c5 + BW <= last; c5 += BW) blocks.push({ c0: c5, c1: c5 + BW - 1, mid: c5 + BW / 2, sh: 0, k: 1, ok: false });
    var ref = prof(first, last, 0, 1).p;
    for (var iter = 0; iter < 2; iter++) {
      blocks.forEach(function (bl) {
        var best = -2, bs = 0, bk = 1;
        for (var k5 = 0.8; k5 <= 1.2501; k5 += 0.025) for (var s5 = -0.16; s5 <= 0.1601; s5 += 0.005) {
          var pr = prof(bl.c0, bl.c1, s5, k5); if (!pr.ok) continue;
          var cr = corr(pr.p, ref); if (cr > best) { best = cr; bs = s5; bk = k5; }
        }
        bl.sh = bs; bl.k = bk; bl.ok = best > 0.5; bl.score = best;
      });
      // smooth corrections along the band (median of 5 neighbouring blocks, good blocks only)
      var sm = blocks.map(function (bl, i8) {
        var ss = [], kk = [];
        for (var j8 = Math.max(0, i8 - 2); j8 <= Math.min(blocks.length - 1, i8 + 2); j8++) if (blocks[j8].ok) { ss.push(blocks[j8].sh); kk.push(blocks[j8].k); }
        return ss.length ? { sh: median(ss), k: median(kk), ok: true } : { sh: 0, k: 1, ok: false };
      });
      blocks.forEach(function (bl, i9) { bl.sh = sm[i9].sh; bl.k = sm[i9].k; bl.ok = sm[i9].ok; });
      // re-estimate the reference from aligned good blocks
      var acc = new Float32Array(NV), na = 0;
      blocks.forEach(function (bl) { if (!bl.ok) return; var pr = prof(bl.c0, bl.c1, bl.sh, bl.k).p; for (var i10 = 0; i10 < NV; i10++) acc[i10] += pr[i10]; na++; });
      if (na) ref = acc;
    }
    var good = blocks.filter(function (bl) { return bl.ok; }).length;
    api.painted = { blocks: blocks.length, aligned: good };
    function corrAt(c6) { // interpolated correction at column c6
      var bi = Math.max(0, Math.min(blocks.length - 1, Math.round((c6 - first - BW / 2) / BW)));
      return blocks[bi] || { sh: 0, k: 1, ok: false };
    }
    var useProfile = good >= 0.6 * blocks.length, VT = 0.03, VB = 0.97;
    for (var k2 = 0; k2 <= n; k2++) {
      var cx = Math.round(first + (last - first) * k2 / n), t = smooth(tops, cx), b = smooth(bots, cx);
      if (t === null || b === null) continue;
      var ty = t + inset, byy = b - inset;
      if (useProfile && outT[cx] === outT[cx]) {
        var cr2 = corrAt(cx), span2 = outB[cx] - outT[cx];
        ty = outT[cx] + ((VT - 0.5) * cr2.k + 0.5 + cr2.sh) * span2;
        byy = outT[cx] + ((VB - 0.5) * cr2.k + 0.5 + cr2.sh) * span2;
      }
      top.push({ x: Math.round(cx / sc), y: Math.round(ty / sc) });
      bot.push({ x: Math.round(cx / sc), y: Math.round(byy / sc) });
    }
    // A real band edge moves smoothly. The panorama's ragged ends (corners of tilted pieces) are
    // trimmed; a big jump anywhere in the interior means a bad detection.
    var lim = 0.25 * typical / sc;
    // A stitched piece sitting higher or lower moves both lines together, which is real and must be
    // followed; only a sudden change in band thickness (the two lines jumping differently) is bad.
    function jump(k) { return Math.abs((top[k].y - top[k - 1].y) - (bot[k].y - bot[k - 1].y)) > lim; }
    var trimmed = 0;
    while (top.length > 2 && trimmed < 4 && jump(1)) { top.shift(); bot.shift(); trimmed++; }
    while (top.length > 2 && trimmed < 8 && jump(top.length - 1)) { top.pop(); bot.pop(); trimmed++; }
    for (var k3 = 1; k3 < top.length; k3++) if (jump(k3)) { api.reason = 'jagged at sample ' + k3; return null; }
    // Only a roughly horizontal band is straightened. A strongly tilted or fragmented stitch (e.g. a
    // failed one) is left to the user rather than traced along its diagonal edges.
    function tilt(pts) { return Math.abs(Math.atan2(pts[pts.length - 1].y - pts[0].y, pts[pts.length - 1].x - pts[0].x)) * 180 / Math.PI; }
    if (top.length >= 2 && (tilt(top) > 8 || tilt(bot) > 8)) { api.reason = "band too tilted (" + Math.round(Math.max(tilt(top), tilt(bot))) + " deg)"; return null; }
    if (last - first < 0.6 * W) { api.reason = "band covers only part of the width"; return null; }
    return top.length >= 2 ? { top: top, bot: bot } : null;
  }
  var api = { bandLines: bandLines, reason: null, painted: null };
  return api;
})();
