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
    /* Profile alignment in image coordinates. Every column of a rollout crosses the same painted
       bands (rim, glyph band, frame lines, base) in the same vertical order. For each narrow slice of
       columns, find the vertical shift d and stretch k that best align its brightness profile with a
       reference profile from the middle of the band, comparing only content pixels (background
       excluded, so the stitched outline and its glow carry no weight). Large shifts are searched so
       a whole stitched piece sitting higher or lower is found; corrections are smoothed over only 3
       slices so real steps between pieces are kept. Lines = the reference band edges mapped through
       each slice's (d, k). */
    function profAbs(c0, c1) { // mean luminance per row over content pixels (NaN where background)
      var out = new Float32Array(H), cnt = new Float32Array(H);
      for (var cc = c0; cc <= c1; cc++) for (var yy = 0; yy < H; yy++) if (!bg[yy * W + cc]) { out[yy] += lum[yy * W + cc]; cnt[yy]++; }
      for (yy = 0; yy < H; yy++) out[yy] = cnt[yy] >= 0.5 * (c1 - c0 + 1) ? out[yy] / cnt[yy] : NaN;
      return out;
    }
    function ncc(pr, ref, d, k, c0r) { // NaN-aware NCC of pr(y) vs ref((y - d - c0r)/k + c0r)
      var sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, nn = 0;
      for (var yy = 0; yy < H; yy += 1) {
        var a = pr[yy]; if (a !== a) continue;
        var yr = (yy - d - c0r) / k + c0r, y0 = Math.floor(yr); if (y0 < 0 || y0 >= H - 1) continue;
        var f = yr - y0, r0 = ref[y0], r1 = ref[y0 + 1]; if (r0 !== r0 || r1 !== r1) continue;
        var bv = r0 * (1 - f) + r1 * f;
        sa += a; sb += bv; saa += a * a; sbb += bv * bv; sab += a * bv; nn++;
      }
      if (nn < 0.3 * typical) return -2;
      var cov = sab / nn - (sa / nn) * (sb / nn), va = saa / nn - (sa / nn) * (sa / nn), vb = sbb / nn - (sb / nn) * (sb / nn);
      return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -2;
    }
    var BW = Math.max(4, Math.round((last - first) / 80)), blocks = [];
    for (var c5 = first; c5 + BW <= last; c5 += BW) blocks.push({ c0: c5, c1: c5 + BW - 1, mid: c5 + BW / 2, d: 0, k: 1, ok: false });
    var midB = blocks.slice(Math.floor(blocks.length * 0.4), Math.ceil(blocks.length * 0.6));
    var refT = median(midB.map(function (bl) { return outT[Math.round(bl.mid)]; })), refB = median(midB.map(function (bl) { return outB[Math.round(bl.mid)]; }));
    var c0r = (refT + refB) / 2, ref = profAbs(midB[0].c0, midB[midB.length - 1].c1);
    var maxD = Math.round(0.3 * typical);
    for (var iter = 0; iter < 2; iter++) {
      blocks.forEach(function (bl) {
        var pr = profAbs(bl.c0, bl.c1), best = -2, bd = 0, bk = 1;
        for (var k5 = 0.8; k5 <= 1.2501; k5 += 0.025) for (var d5 = -maxD; d5 <= maxD; d5 += 1) {
          var v = ncc(pr, ref, d5, k5, c0r); if (v > best) { best = v; bd = d5; bk = k5; }
        }
        // refine: stretch in 0.5% steps, shift in 0.25 px steps (coarse steps made the edges wobble)
        var cd = bd, ck = bk;
        for (var k6 = ck - 0.025; k6 <= ck + 0.0251; k6 += 0.005) for (var d6 = cd - 1.5; d6 <= cd + 1.51; d6 += 0.25) {
          var v2 = ncc(pr, ref, d6, k6, c0r); if (v2 > best) { best = v2; bd = d6; bk = k6; }
        }
        bl.d = bd; bl.k = bk; bl.score = best; bl.ok = best > 0.5;
      });
      // Outliers: a slice far from the median of its wider neighbourhood (+-4 slices) takes that median.
      // A real step between stitched pieces spans many slices, so it survives.
      var med9 = blocks.map(function (bl, i7) {
        var dd = [], kk = [];
        for (var j7 = Math.max(0, i7 - 4); j7 <= Math.min(blocks.length - 1, i7 + 4); j7++) if (blocks[j7].ok) { dd.push(blocks[j7].d); kk.push(blocks[j7].k); }
        return dd.length ? { d: median(dd), k: median(kk) } : null;
      });
      blocks.forEach(function (bl, i7) {
        var m = med9[i7]; if (!m) return;
        // slices that matched poorly, or disagree sharply with their neighbourhood, take its values
        if (!bl.ok || Math.abs(bl.d - m.d) > 0.05 * typical || Math.abs(bl.k - m.k) > 0.05) { bl.d = m.d; bl.k = m.k; bl.ok = true; }
      });
      // Smooth along the band with a triangular moving average (+-4 slices), weighted by match quality.
      // A median let neighbouring slices jump between values, which made the edges ripple.
      var sm = blocks.map(function (bl, i8) {
        var sd = 0, skk = 0, sw = 0;
        for (var j8 = Math.max(0, i8 - 4); j8 <= Math.min(blocks.length - 1, i8 + 4); j8++) {
          if (!blocks[j8].ok) continue;
          var w = (5 - Math.abs(j8 - i8)) * Math.max(0.05, blocks[j8].score || 0.5);
          sd += w * blocks[j8].d; skk += w * blocks[j8].k; sw += w;
        }
        return sw ? { d: sd / sw, k: skk / sw, ok: true } : { d: 0, k: 1, ok: false };
      });
      blocks.forEach(function (bl, i9) { bl.d = sm[i9].d; bl.k = sm[i9].k; bl.ok = sm[i9].ok; });
      if (iter === 0) { // reference = average of aligned good profiles (back-mapped into reference rows)
        var acc = new Float32Array(H), na = new Float32Array(H);
        blocks.forEach(function (bl) {
          if (!bl.ok) return; var pr = profAbs(bl.c0, bl.c1);
          for (var yr = 0; yr < H; yr++) { var yy = Math.round((yr - c0r) * bl.k + c0r + bl.d); if (yy >= 0 && yy < H && pr[yy] === pr[yy]) { acc[yr] += pr[yy]; na[yr]++; } }
        });
        for (var yr2 = 0; yr2 < H; yr2++) ref[yr2] = na[yr2] >= 3 ? acc[yr2] / na[yr2] : NaN;
      }
    }
    var good = blocks.filter(function (bl) { return bl.ok; }).length;
    api.painted = { blocks: blocks.length, aligned: good };
    function corrAt(c6) { var bi = Math.max(0, Math.min(blocks.length - 1, Math.floor((c6 - first) / BW))); return blocks[bi]; }
    var useProfile = !api.outlineOnly && good >= 0.6 * blocks.length, insetR = 0.01 * typical;
    for (var k2 = 0; k2 <= n; k2++) {
      var cx = Math.round(first + (last - first) * k2 / n), t = smooth(tops, cx), b = smooth(bots, cx);
      if (t === null || b === null) continue;
      var ty = t + inset, byy = b - inset;
      if (useProfile) {
        var cr2 = corrAt(cx);
        ty = (refT + insetR - c0r) * cr2.k + c0r + cr2.d;
        byy = (refB - insetR - c0r) * cr2.k + c0r + cr2.d;
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
