/* Overlap-aware crop check for the Adjust step (suggestion only; Stitch is unchanged).
   The default crop keeps the middle 72% of each Map strip. On some photo sets that leaves too little
   overlap between neighbours for the Hugging Face stitcher (LACMA 168693 fails at 14%, works at 8%).
   This measures each ordered join once on the full Map strips, then counts which geometrically
   consistent matches survive a given crop. A join is weak when too few survive or they don't spread
   over the band. For weak joins it proposes widening only the facing sides of the two photos, and
   only for photos whose crop is still the default; it never changes crops by itself. */
"use strict";
var CROPCHECK = (function () {
  var DEFAULT = 0.14, FALLBACK = 0.08, MIN_MATCHES = 35, MIN_SPAN = 0.3, MIN_COLS = 5;
  var I = OVERLAPWARP._internal, P = OVERLAPWARP.params, W = P.W, H = P.H, MARGIN = Math.round(0.05 * W);

  // Evidence for join a -> b: consistent matches [xa, ya, xb, yb] in model pixels (W x H).
  function evidence(A, B) {
    var sh = I.coarseShift(A.q0, B.q0, A.h0, B.h0); // coarse shift away from the stretched limbs
    if (!sh) return { matches: [], dx: null };
    var m = I.patchMatches(A.f, B.f, sh, MARGIN);
    if (m.length < 6) return { matches: [], dx: sh.dx };
    var mdx = med(m.map(function (p) { return p[0] - p[2]; })), mdy = med(m.map(function (p) { return p[1] - p[3]; }));
    var inl = m.filter(function (p) { return Math.abs(p[0] - p[2] - mdx) <= 4 && Math.abs(p[1] - p[3] - mdy) <= 8; });
    return { matches: inl, dx: mdx };
  }
  function med(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s[s.length >> 1]; }

  // How much of a join's evidence survives crops ca = [L, R] and cb = [L, R] (fractions of width).
  function support(ev, ca, cb) {
    var keep = ev.matches.filter(function (p) {
      return p[0] >= ca[0] * W && p[0] <= ca[1] * W && p[2] >= cb[0] * W && p[2] <= cb[1] * W;
    });
    if (!keep.length) return { n: 0, span: 0, cols: 0, weak: true };
    var ys = keep.map(function (p) { return p[1]; }), xs = keep.map(function (p) { return p[0]; });
    var span = (Math.max.apply(null, ys) - Math.min.apply(null, ys)) / H;
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), cols = {};
    keep.forEach(function (p) { cols[Math.floor(p[0] / 18)] = 1; }); // distinct match columns
    var nc = Object.keys(cols).length;
    return { n: keep.length, span: span, cols: nc, width: x1 - x0, weak: keep.length < MIN_MATCHES || span < MIN_SPAN || nc < MIN_COLS };
  }

  /* order: indices into imgs in the order sent to Stitch. Returns {joins: [...], suggestion|null}.
     Each join: {a, b, current, fallback|null, widen: {a, b: "L"|"R"|null}, manual: bool}. */
  function check(order) {
    if (stripCache.length !== imgs.length) rebuildStripCache();
    order = order || imgs.map(function (_, i) { return i; });
    var g = {};
    function grays(i) {
      if (!g[i]) { var s = stripCache[i]; g[i] = { f: I.gray(s, W, H, MARGIN), h0: I.gray(s, W >> 1, H >> 1), q0: I.gray(s, Math.round(W / 4), Math.round(H / 4)) }; }
      return g[i];
    }
    var joins = [], changes = {};
    for (var k = 0; k + 1 < order.length; k++) {
      var a = order[k], b = order[k + 1], ev = evidence(grays(a), grays(b));
      var ca = [imgs[a].cropL, imgs[a].cropR], cb = [imgs[b].cropL, imgs[b].cropR];
      var cur = support(ev, ca, cb), j = { a: a, b: b, current: cur, fallback: null, widen: null };
      if (cur.weak && ev.dx != null) {
        // b's content sits at x + dx in a: dx > 0 means b overlaps a's right side and its own left.
        var sa = ev.dx > 0 ? "R" : "L", sb = ev.dx > 0 ? "L" : "R";
        var fa = widen(imgs[a], sa), fb = widen(imgs[b], sb);
        j.manual = !fa || !fb; // a facing edge was cropped by hand: leave it alone
        if (fa || fb) {
          var fb2 = support(ev, fa || ca, fb || cb);
          j.fallback = fb2; j.widen = { a: fa ? sa : null, b: fb ? sb : null };
          if (!fb2.weak && fb2.n > cur.n) {
            if (fa) changes[a] = merge(changes[a], fa, sa);
            if (fb) changes[b] = merge(changes[b], fb, sb);
          }
        }
      }
      joins.push(j);
    }
    var keys = Object.keys(changes);
    return { joins: joins, suggestion: keys.length ? keys.map(function (i) { return { i: +i, cropL: changes[i].cropL, cropR: changes[i].cropR }; }) : null };
  }
  // Widen one side to the fallback crop, but only if that side is still at the default (not manual).
  function widen(im, side) {
    if (side === "L" && Math.abs(im.cropL - DEFAULT) < 1e-3) return [FALLBACK, im.cropR];
    if (side === "R" && Math.abs(im.cropR - (1 - DEFAULT)) < 1e-3) return [im.cropL, 1 - FALLBACK];
    return null;
  }
  function merge(prev, crop, side) {
    var c = prev || {};
    if (side === "L") c.cropL = crop[0]; else c.cropR = crop[1];
    return c;
  }

  return { check: check, params: { DEFAULT: DEFAULT, FALLBACK: FALLBACK, MIN_MATCHES: MIN_MATCHES, MIN_SPAN: MIN_SPAN, MIN_COLS: MIN_COLS } };
})();
