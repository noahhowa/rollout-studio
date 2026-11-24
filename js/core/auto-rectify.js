/* Auto-rectification for the Refine step: find the stitched band's top and bottom edges in a
   panorama (e.g. the Hugging Face output: painted band on a black background, pieces at slightly
   different heights or tilts) and return them as polylines for doRectify() to straighten.
   Returns { top: [{x,y}...], bot: [{x,y}...] } in full-resolution pixels, or null. */
"use strict";
var AUTORECT = (function () {
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[s.length >> 1] : 0; }
  // Each rim can drift independently of the silhouette, especially on a flared vessel.
  // Match red–green profiles near each rim: warm paint stands out even when lighting varies.
  function rimOffsets(d, bg, W, H, outT, outB, first, last) {
    const rows = 160, width = Math.max(6, Math.round((last - first + 1) / 50));
    const profiles = [];
    for (let left = first; left <= last; left += width) {
      const right = Math.min(last, left + width - 1);
      const sum = new Float32Array(rows), count = new Uint16Array(rows);
      for (let col = left; col <= right; col++) {
        if (!Number.isFinite(outT[col])) continue;
        const height = outB[col] - outT[col];
        for (let row = 0; row < rows; row++) {
          const y = outT[col] + row / (rows - 1) * height;
          const y0 = Math.floor(y), f = y - y0, pixel = y0 * W + col;
          if (y0 < 0 || y0 >= H - 1 || bg[pixel] || bg[pixel + W]) continue;
          const a = 4 * pixel, b = a + 4 * W;
          sum[row] += (1 - f) * (d[a] - d[a + 1]) + f * (d[b] - d[b + 1]);
          count[row]++;
        }
      }
      profiles.push(sum.map((v, row) => count[row] >= (right - left + 1) / 2 ? v / count[row] : NaN));
    }
    if (profiles.length < 5) return null;
    const reference = profiles[0].map((_, row) => {
      let sum = 0, count = 0;
      for (const profile of profiles) {
        if (!Number.isFinite(profile[row])) continue;
        sum += profile[row];
        count++;
      }
      return count > profiles.length / 2 ? sum / count : NaN;
    });

    const firstRow = Math.round(0.015 * rows), lastRow = Math.round(0.22 * rows);
    const maxShift = Math.round(0.05 * rows), radius = 2;
    const rims = [false, true].map(bottom => {
      const lo = bottom ? rows - 1 - lastRow : firstRow;
      const hi = bottom ? rows - 1 - firstRow : lastRow;
      const matches = profiles.map(profile => {
        let best = 0, shift = 0, confidence = 0;
        for (let offset = -maxShift; offset <= maxShift; offset++) {
          let a = 0, b = 0, aa = 0, bb = 0, ab = 0, count = 0;
          for (let row = lo; row <= hi; row++) {
            const x = profile[row + offset], y = reference[row];
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            a += x; b += y; aa += x * x; bb += y * y; ab += x * y; count++;
          }
          if (count < 0.8 * (hi - lo)) continue;
          const varianceA = aa - a * a / count, varianceB = bb - b * b / count;
          if (varianceA <= 0 || varianceB <= 0) continue;
          const correlation = (ab - a * b / count) / Math.sqrt(varianceA * varianceB);
          // Prefer staying near the outline when several offsets explain the same pattern.
          const score = correlation - 0.15 * (offset / maxShift) ** 2;
          if (score > best) { best = score; shift = offset / rows; confidence = correlation; }
        }
        return { shift, confidence };
      });
      return matches.map((_, i) => {
        let shift = 0, mass = 0, total = 0;
        for (let j = Math.max(0, i - radius); j <= Math.min(matches.length - 1, i + radius); j++) {
          const kernel = radius + 1 - Math.abs(j - i);
          const weight = kernel * matches[j].confidence;
          shift += weight * matches[j].shift;
          mass += weight;
          total += kernel;
        }
        return { shift: mass ? shift / mass : 0, confidence: mass / total };
      });
    });

    return (rim, col, prior) => {
      const offsets = rims[rim];
      const pos = Math.max(0, Math.min(offsets.length - 1, (col - first) / width - 0.5));
      const i = Math.floor(pos), f = pos - i;
      const a = offsets[i], b = offsets[Math.min(offsets.length - 1, i + 1)];
      const shift = a.shift + f * (b.shift - a.shift);
      const confidence = a.confidence + f * (b.confidence - a.confidence);
      // Keep the brightness nudge as the prior where the rim has weak matches or
      // is near the ragged ends, where neighbouring strips can only support one side.
      const endWeight = Math.min(1, Math.min(col - first, last - col) / (0.08 * (last - first)));
      return prior + 0.65 * endWeight * Math.min(1, confidence / 0.7) * (shift - prior);
    };
  }
  function bandLines(cv) {
    api.reason = null;
    var sc = Math.min(1, 800 / cv.width), W = Math.max(10, Math.round(cv.width * sc)), H = Math.max(10, Math.round(cv.height * sc));
    var c = document.createElement("canvas"); c.width = W; c.height = H;
    var x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(cv, 0, 0, W, H);
    var d = x.getImageData(0, 0, W, H).data, lum = new Float32Array(W * H), i, col, y;
    for (i = 0; i < W * H; i++) lum[i] = d[4 * i + 3] < 128 ? 0 : 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
    // Background = dark pixels connected to the image border (flood fill). Dark paint inside the
    // band (rim bands, figures, outlines) is enclosed by the band, so it stays content.
    var P = api.params, bg = new Uint8Array(W * H), stack = [], DARK = P.dark;
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
    function smooth(arr, col0) { // median of valid columns within +-20 (about +-2.5% of width; tuned on the ground truth)
      var vals = []; for (var k = -P.win; k <= P.win; k++) { var cc = col0 + k; if (cc >= 0 && cc < W && arr[cc] >= 0 && bots[cc] - tops[cc] >= 0.6 * typical) vals.push(arr[cc]); }
      return vals.length ? median(vals) : null;
    }
    var first = valid[0], last = valid[valid.length - 1], n = P.samples, inset = 0.01 * typical;
    // Smoothed outline per column (used as the search region for painted lines, and as fallback).
    var outT = new Float32Array(W).fill(NaN), outB = new Float32Array(W).fill(NaN);
    for (col = first; col <= last; col++) { var tt = smooth(tops, col), bb = smooth(bots, col); if (tt !== null && bb !== null) { outT[col] = tt; outB[col] = bb; } }
    // Historical whole-band alignment, used by the opt-in PROFILE=1 benchmark.
    function experimentalProfile() {
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
      if (!blocks.length) return null;
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
      if (good < 0.6 * blocks.length) return null;
      return function (col) {
        var correction = corrAt(col);
        return {
          top: (refT + inset - c0r) * correction.k + c0r + correction.d,
          bot: (refB - inset - c0r) * correction.k + c0r + correction.d
        };
      };
    }
    /* Hybrid nudge (P.nudge): start from the outline lines, then shift/stretch each region slightly
       so the painted bands' brightness profile matches the band-wide reference. Corrections are
       relative to the outline, bounded (+-P.nudge of band height, +-P.nudge stretch) and smoothed
       over ~15% of the width, so a piece whose painting sits a little high or low is corrected but
       a false match cannot throw the line far. */
    var nudge = null;
    if (P.nudge > 0) {
      var NV2 = 100, BW2 = Math.max(6, Math.round((last - first) / 40)), nb = [];
      var profV = function (c0, c1, sh, kk) {
        var o = new Float32Array(NV2), cn = new Float32Array(NV2);
        for (var cc2 = c0; cc2 <= c1; cc2++) {
          if (outT[cc2] !== outT[cc2]) continue;
          var sp = outB[cc2] - outT[cc2];
          for (var iv = 0; iv < NV2; iv++) {
            var vv = (0.02 + 0.96 * iv / (NV2 - 1) - 0.5) * kk + 0.5 + sh, yy2 = Math.round(outT[cc2] + vv * sp);
            if (yy2 < 0 || yy2 >= H || bg[yy2 * W + cc2]) continue;
            o[iv] += lum[yy2 * W + cc2]; cn[iv]++;
          }
        }
        var mm = 0, nn2 = 0; for (iv = 0; iv < NV2; iv++) if (cn[iv]) { o[iv] /= cn[iv]; mm += o[iv]; nn2++; }
        if (nn2 < NV2 * 0.8) return null;
        mm /= nn2; var vs2 = 0; for (iv = 0; iv < NV2; iv++) { o[iv] = cn[iv] ? o[iv] - mm : 0; vs2 += o[iv] * o[iv]; }
        vs2 = Math.sqrt(vs2) || 1; for (iv = 0; iv < NV2; iv++) o[iv] /= vs2;
        return o;
      };
      for (var cb = first; cb + BW2 <= last; cb += BW2) nb.push({ c0: cb, c1: cb + BW2 - 1, sh: 0, k: 1, w: 0 });
      var refP = new Float32Array(NV2), nr = 0;
      nb.forEach(function (bl) { var pr = profV(bl.c0, bl.c1, 0, 1); if (pr) { for (var iv = 0; iv < NV2; iv++) refP[iv] += pr[iv]; nr++; } });
      if (nr >= 5) {
        nb.forEach(function (bl) {
          var best = -2;
          for (var kk2 = 1 - P.nudge; kk2 <= 1 + P.nudge + 1e-6; kk2 += P.nudge / 4) for (var sh2 = -P.nudge; sh2 <= P.nudge + 1e-6; sh2 += P.nudge / 8) {
            var pr = profV(bl.c0, bl.c1, sh2, kk2); if (!pr) continue;
            var c = 0; for (var iv = 0; iv < NV2; iv++) c += pr[iv] * refP[iv];
            if (c > best) { best = c; bl.sh = sh2; bl.k = kk2; }
          }
          bl.w = Math.max(0, best / nr);
        });
        var R = P.nudgeR; // smoothing radius in blocks (block = 1/40 of the band width)
        nudge = nb.map(function (bl, i) {
          var a = 0, b = 0, ww = 0;
          for (var j = Math.max(0, i - R); j <= Math.min(nb.length - 1, i + R); j++) { var w = (R + 1 - Math.abs(j - i)) * nb[j].w; a += w * nb[j].sh; b += w * nb[j].k; ww += w; }
          return ww ? { sh: a / ww, k: b / ww } : { sh: 0, k: 1 };
        });
      }
    }
    function nudgeAt(c7) { if (!nudge) return null; var bi = Math.max(0, Math.min(nudge.length - 1, Math.floor((c7 - first) / Math.max(6, Math.round((last - first) / 40))))); return nudge[bi]; }
    function sampleLines(samples, offsetAt, profileAt) {
      samples = Math.min(samples, last - first);
      var top = [], bot = [];
      for (var i = 0; i <= samples; i++) {
        var col = Math.round(first + (last - first) * i / samples), t = outT[col], b = outB[col];
        if (!Number.isFinite(t) || !Number.isFinite(b)) continue;
        var ng = nudgeAt(col), span = b - t;
        var topShift = ng ? ng.sh - 0.49 * (ng.k - 1) : 0;
        var botShift = ng ? ng.sh + 0.49 * (ng.k - 1) : 0;
        if (offsetAt) {
          topShift = offsetAt(0, col, topShift);
          botShift = offsetAt(1, col, botShift);
        }
        var topY = ng || offsetAt ? t + (0.01 + topShift) * span : t + inset;
        var botY = ng || offsetAt ? t + (0.99 + botShift) * span : b - inset;
        var profile = profileAt && profileAt(col);
        top.push({ x: Math.round(col / sc), y: Math.round((profile ? profile.top : topY) / sc) });
        bot.push({ x: Math.round(col / sc), y: Math.round((profile ? profile.bot : botY) / sc) });
      }
      return { top: top, bot: bot };
    }

    var lim = 0.25 * typical / sc;
    function tilt(first, last) {
      return Math.abs(Math.atan2(last.y - first.y, last.x - first.x)) * 180 / Math.PI;
    }
    function outlineTilt(first, last, outline) {
      var left = Math.round(first.x * sc), right = Math.round(last.x * sc);
      // Stay clear of the one-sided median windows at the ends when measuring the outline slope.
      var margin = Math.min(P.win, Math.floor((right - left) / 4));
      var y0 = outline[left + margin], y1 = outline[right - margin];
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) {
        margin = 0;
        y0 = outline[left];
        y1 = outline[right];
      }
      return tilt({ x: left + margin, y: y0 }, { x: right - margin, y: y1 });
    }
    function declineReason(lines) {
      var top = lines.top, bot = lines.bot;
      // Trim ragged ends. A seam can move both lines together, but a jump in thickness is suspect.
      function jump(k) { return Math.abs((top[k].y - top[k - 1].y) - (bot[k].y - bot[k - 1].y)) > lim; }
      var trimmed = 0;
      while (top.length > 2 && trimmed < 4 && jump(1)) { top.shift(); bot.shift(); trimmed++; }
      while (top.length > 2 && trimmed < 8 && jump(top.length - 1)) { top.pop(); bot.pop(); trimmed++; }
      for (var k = 1; k < top.length; k++) if (jump(k)) return 'jagged at sample ' + k;
      if (last - first < 0.6 * W) return 'band covers only part of the width';
      if (top.length < 2) return 'too few samples';
      var end = top.length - 1;
      var angle = Math.max(tilt(top[0], top[end]), tilt(bot[0], bot[end]),
        outlineTilt(top[0], top[end], outT), outlineTilt(bot[0], bot[end], outB));
      if (angle > 8) return 'band too tilted (' + angle.toFixed(1) + ' deg)';
      return null;
    }

    // A paint match cannot make a failed stitch eligible. Keep the original result if the
    // refined lines introduce a thickness jump or tilt.
    var baseline = sampleLines(n, null);
    api.reason = declineReason(baseline);
    if (api.reason) return null;
    if (api.experimentalProfile) {
      var profileAt = experimentalProfile();
      if (!profileAt) return baseline;
      var historical = sampleLines(n, null, profileAt);
      api.reason = declineReason(historical);
      return api.reason ? null : historical;
    }
    if (P.nudge <= 0) return baseline;
    var offsetAt = rimOffsets(d, bg, W, H, outT, outB, first, last);
    if (!offsetAt) return baseline;
    // Resolve short seams that the coarser eligibility samples can straddle.
    var refined = sampleLines(2 * n, offsetAt);
    return declineReason(refined) ? baseline : refined;
  }
  // Tunable settings, scored with scripts/eval-rectify.js (PARAMS='{"dark":50}' to try others).
  var api = { bandLines: bandLines, reason: null, painted: null, params: { dark: 35, win: 20, samples: 32, nudge: 0.05, nudgeR: 3 } };
  return api;
})();
