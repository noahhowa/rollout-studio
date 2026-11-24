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
    for (var k2 = 0; k2 <= n; k2++) {
      var cx = Math.round(first + (last - first) * k2 / n), t = smooth(tops, cx), b = smooth(bots, cx);
      if (t === null || b === null) continue;
      top.push({ x: Math.round(cx / sc), y: Math.round((t + inset) / sc) });
      bot.push({ x: Math.round(cx / sc), y: Math.round((b - inset) / sc) });
    }
    // A real band edge moves smoothly. The panorama's ragged ends (corners of tilted pieces) are
    // trimmed; a big jump anywhere in the interior means a bad detection.
    var lim = 0.25 * typical / sc;
    function jump(k) { return Math.abs(top[k].y - top[k - 1].y) > lim || Math.abs(bot[k].y - bot[k - 1].y) > lim; }
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
  var api = { bandLines: bandLines, reason: null };
  return api;
})();
