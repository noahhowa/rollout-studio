/* Register cylindrical strips using their common painted detail. Rotations are radians,
   relative to the first photo. Each photo has its own camera and image framing. */
"use strict";
var ROLLREGISTER = (function () {
  var TAU = 2 * Math.PI, COLS = 360, ROWS = 48;
  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function median(a) { return a.slice().sort(function (x, y) { return x - y; })[a.length >> 1]; }
  /* Strip descriptor: luminance with the slow shading removed (each photo is lit from its own
     camera, so the same painted spot is shaded differently between photos), normalised per strip.
     Cells without valid surface (alpha) are marked NaN. */
  function describe(cv) {
    var small = document.createElement("canvas"); small.width = COLS; small.height = ROWS;
    var sctx = small.getContext("2d", { willReadFrequently: true }); sctx.drawImage(cv, 0, 0, COLS, ROWS);
    var d = sctx.getImageData(0, 0, COLS, ROWS).data, L = new Float32Array(COLS * ROWS), ok = new Uint8Array(COLS * ROWS);
    for (var i = 0; i < COLS * ROWS; i++) { L[i] = (d[4 * i] + 2 * d[4 * i + 1] + d[4 * i + 2]) / 4; ok[i] = d[4 * i + 3] > 250 ? 1 : 0; }
    function blur(src, r) { // separable box blur over valid cells only
      var tmp = new Float32Array(src.length), out = new Float32Array(src.length);
      for (var y = 0; y < ROWS; y++) for (var x = 0; x < COLS; x++) {
        var s = 0, n = 0; for (var k = -r; k <= r; k++) { var xx = x + k; if (xx >= 0 && xx < COLS && ok[y * COLS + xx]) { s += src[y * COLS + xx]; n++; } }
        tmp[y * COLS + x] = n ? s / n : 0;
      }
      for (var x2 = 0; x2 < COLS; x2++) for (var y2 = 0; y2 < ROWS; y2++) {
        var s2 = 0, n2 = 0; for (var k2 = -r; k2 <= r; k2++) { var yy = y2 + k2; if (yy >= 0 && yy < ROWS && ok[yy * COLS + x2]) { s2 += tmp[yy * COLS + x2]; n2++; } }
        out[y2 * COLS + x2] = n2 ? s2 / n2 : 0;
      }
      return out;
    }
    var base = blur(L, 8), H = new Float32Array(COLS * ROWS), m = 0, n = 0;
    for (i = 0; i < H.length; i++) if (ok[i]) { H[i] = L[i] - base[i]; m += H[i]; n++; }
    m = n ? m / n : 0; var v = 0;
    for (i = 0; i < H.length; i++) if (ok[i]) { H[i] -= m; v += H[i] * H[i]; }
    v = Math.sqrt(v / Math.max(1, n)) || 1;
    for (i = 0; i < H.length; i++) H[i] = ok[i] ? H[i] / v : NaN;
    return H;
  }
  /* Normalised cross-correlation of two strips' overlapping block for a horizontal shift (columns)
     and a small vertical offset (rows), weighted towards each view's face-on centre. */
  function blockScore(A, B, shift, dy, limit) {
    var sab = 0, saa = 0, sbb = 0, sa = 0, sb = 0, sw = 0, cells = 0;
    var x0 = Math.max(COLS / 2 - limit, shift + COLS / 2 - limit), x1 = Math.min(COLS / 2 + limit, shift + COLS / 2 + limit);
    for (var x = Math.ceil(x0); x < x1; x += 2) {
      var xb = x - shift, w = Math.cos((x / (COLS - 1) - 0.5) * Math.PI) * Math.cos((xb / (COLS - 1) - 0.5) * Math.PI);
      for (var y = 4; y < ROWS - 4; y++) {
        var a = A[y * COLS + x], b = B[(y + dy) * COLS + xb];
        if (a !== a || b !== b) continue;
        sab += w * a * b; saa += w * a * a; sbb += w * b * b; sa += w * a; sb += w * b; sw += w; cells++;
      }
    }
    if (cells < 300 || sw <= 0) return { score: -1, cells: cells };
    var cov = sab / sw - (sa / sw) * (sb / sw), va = saa / sw - (sa / sw) * (sa / sw), vb = sbb / sw - (sb / sw) * (sb / sw);
    return { score: va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -1, cells: cells };
  }
  function pair(first, second) {
    var limit = Math.round(COLS * 0.36), coarse = [];
    for (var shift = -200; shift <= 200; shift += 2) coarse.push({ shift: shift, r: blockScore(first.columns, second.columns, shift, 0, limit) });
    var order = coarse.slice().sort(function (p, q) { return q.r.score - p.r.score; }).slice(0, 4), best = null;
    order.forEach(function (c) { // refine around the strongest coarse peaks, with vertical slack
      for (var s = c.shift - 2; s <= c.shift + 2; s++) for (var dy = -3; dy <= 3; dy++) {
        var r = blockScore(first.columns, second.columns, s, dy, limit);
        if (!best || r.score > best.score) best = { score: r.score, shift: s, dy: dy, count: r.cells };
      }
    });
    // sub-column peak by parabola on the refined neighbours
    var l = blockScore(first.columns, second.columns, best.shift - 1, best.dy, limit).score, rr = blockScore(first.columns, second.columns, best.shift + 1, best.dy, limit).score;
    var curvature = l + rr - 2 * best.score, delta = curvature < -1e-6 ? Math.max(-1, Math.min(1, (l - rr) / curvature)) : 0;
    // Distinctiveness: the best peak must clearly beat every shift more than ~8 degrees away from it.
    var rival = -1;
    coarse.forEach(function (c) { if (Math.abs(c.shift - best.shift) > 16 && c.r.score > rival) rival = c.r.score; });
    var margin = best.score - rival, ok = best.score > 0.3 && margin > 0.08;
    return { angle: (best.shift + delta) * Math.PI / (COLS - 1), correlation: best.score, dy: best.dy, margin: margin, ok: ok,
      weight: ok ? (best.score - 0.2 + margin) * Math.sqrt(best.count / 40) : 0 };
  }
  function graph(choices, matches) {
    var N = choices.length, rotations = new Array(N).fill(null), used = [0], edges = [], score = 0;
    rotations[0] = 0;
    while (used.length < N) {
      var best = null;
      used.forEach(function (i) {
        for (var j = 0; j < N; j++) if (rotations[j] === null) {
          var edge = i < j ? matches[i][j][choices[i]][choices[j]] : matches[j][i][choices[j]][choices[i]];
          if (!best || edge.weight > best.edge.weight) best = { i: i, j: j, edge: edge, sign: i < j ? 1 : -1 };
        }
      });
      if (!best || !best.edge.ok) break;
      rotations[best.j] = wrap(rotations[best.i] + best.sign * best.edge.angle);
      score += best.edge.weight; edges.push(best.edge); used.push(best.j);
    }
    if (used.length < N) return { score: -1000 + used.length, rotations: rotations, connected: false, edges: edges };
    var links = [];
    for (var i = 0; i < N; i++) for (var j = i + 1; j < N; j++) {
      var edge = matches[i][j][choices[i]][choices[j]], residual = Math.abs(wrap(rotations[j] - rotations[i] - edge.angle));
      if (edge.ok) {
        score += edge.weight * Math.max(0, 1 - residual / 0.06);
        if (residual < 0.08) links.push({ i: i, j: j, edge: edge });
      }
    }
    // Refine the spanning-tree solution with consistent loop closures, anchored at photo zero.
    for (var iteration = 0; iteration < 8; iteration++) {
      for (var i = 1; i < N; i++) {
        var correction = 0, total = 0;
        links.forEach(function (link) {
          if (link.i !== i && link.j !== i) return;
          var error = wrap(rotations[link.j] - rotations[link.i] - link.edge.angle);
          correction += (link.i === i ? error : -error) * link.edge.weight; total += link.edge.weight;
        });
        if (total) rotations[i] = wrap(rotations[i] + correction / total);
      }
    }
    return { score: score, rotations: rotations, connected: true, edges: edges };
  }
  function estimate(images) {
    if (images.length < 2) return { connected: false, cameras: images.map(function () { return null; }), rotations: [0], confidence: 0 };
    var rawModels = images.map(function (image) { return ROLLCAMERA.candidates(image.cv, image.b); });
    var templates = [];
    [1, -1].forEach(function (direction) {
      var family = rawModels.flat().filter(function (m) { return m.topDirection === direction; });
      if (!family.length) return;
      var template = {};
      ["distance", "height", "elevation", "cameraY"].forEach(function (key) { template[key] = median(family.map(function (m) { return m[key]; })); });
      templates.push(template);
    });
    var options = images.map(function (image, index) {
      var radius = hGeom(image.b).r, models = templates.map(function (template) { return ROLLCAMERA.fitShared(image.cv, image.b, template.height, template); }).filter(Boolean);
      if (!models.length) models = rawModels[index].slice(0, 2);
      models.push(null);
      return models.map(function (model) {
        var strip = ROLLCAMERA.flatten(image.cv, model, radius, { width: 360, height: 120, bounds: image.b });
        return { model: model, columns: describe(strip) };
      });
    });
    var matches = images.map(function () { return []; });
    for (var i = 0; i < images.length; i++) for (var j = i + 1; j < images.length; j++) {
      matches[i][j] = options[i].map(function (first) { return options[j].map(function (second) { return pair(first, second); }); });
    }
    var solutions = [];
    [0, 1, 2].forEach(function (seed) {
      var choices = options.map(function (o) { return Math.min(seed, o.length - 1); });
      var solution = graph(choices, matches);
      for (var pass = 0; pass < 3; pass++) {
        var changed = false;
        for (var i = 0; i < choices.length; i++) {
          var chosen = choices[i];
          for (var candidate = 0; candidate < options[i].length; candidate++) {
            choices[i] = candidate; var trial = graph(choices, matches);
            if (trial.score > solution.score + 1e-6) { chosen = candidate; solution = trial; changed = true; }
          }
          choices[i] = chosen;
        }
        if (!changed) break;
      }
      solutions.push({ choices: choices.slice(), graph: graph(choices, matches) });
    });
    var combinations = options.reduce(function (n, o) { return n * o.length; }, 1);
    if (combinations <= 2048) {
      for (var code = 0; code < combinations; code++) {
        var remaining = code, choices = options.map(function (o) { var choice = remaining % o.length; remaining = Math.floor(remaining / o.length); return choice; });
        solutions.push({ choices: choices, graph: graph(choices, matches) });
      }
    }
    solutions.sort(function (a, b) { return b.graph.score - a.graph.score; });
    var best = solutions[0], confidence = best.graph.edges.length ? median(best.graph.edges.map(function (e) { return e.correlation; })) : 0;
    // Best match per photo pair (any camera hypotheses): explains disconnected graphs.
    var pairs = [];
    for (var a = 0; a < images.length; a++) for (var c2 = a + 1; c2 < images.length; c2++) {
      var top = null; matches[a][c2].forEach(function (row) { row.forEach(function (m) { if (!top || m.correlation > top.correlation) top = m; }); });
      pairs.push({ i: a, j: c2, correlation: top.correlation, margin: top.margin, ok: top.ok, angleDeg: top.angle * 180 / Math.PI });
    }
    return { connected: best.graph.connected, cameras: best.choices.map(function (c, i) { return options[i][c].model; }),
      rotations: best.graph.rotations, confidence: confidence, pairs: pairs };
  }
  function compose(images, registration, strips, opts) {
    opts = opts || {};
    if (!registration.connected || strips.length !== images.length) return null;
    var radius = median(images.map(function (image) { return hGeom(image.b).r; }));
    var coverage = new Array(720).fill(false), limits = images.map(function (image, i) {
      var lo = Math.PI * ((image.cropL == null ? 0.14 : image.cropL) - 0.5);
      var hi = Math.PI * ((image.cropR == null ? 0.86 : image.cropR) - 0.5), camera = registration.cameras[i];
      if (camera) { var visible = Math.acos(1 / camera.distance) - 0.005; lo = Math.max(lo, -visible); hi = Math.min(hi, visible); }
      return { lo: lo, hi: hi };
    });
    for (var x = 0; x < coverage.length; x++) {
      var angle = TAU * (x + 0.5) / coverage.length - Math.PI;
      coverage[x] = images.some(function (_, i) { var local = wrap(angle - registration.rotations[i]); return local > limits[i].lo && local < limits[i].hi; });
    }
    var longest = 0, gapEnd = 0, run = 0;
    for (var x = 0; x < 2 * coverage.length; x++) {
      run = coverage[x % coverage.length] ? 0 : Math.min(coverage.length, run + 1);
      if (run > longest) { longest = run; gapEnd = x; }
    }
    if (longest === coverage.length) return null;
    var full = opts.fullCircle || longest <= 4;
    var start = full ? -Math.PI : TAU * ((gapEnd + 1) % coverage.length) / coverage.length - Math.PI;
    var span = full ? TAU : TAU * (1 - longest / coverage.length);
    var W = opts.width || Math.max(10, Math.round(span * radius));
    var H = opts.height || Math.max(10, Math.round(median(strips.map(function (cv) { return cv.height; }))));
    var output = document.createElement("canvas"); output.width = W; output.height = H;
    var ctx = output.getContext("2d"), result = ctx.createImageData(W, H);
    var source = strips.map(function (cv) { return cv.getContext("2d").getImageData(0, 0, cv.width, cv.height); });
    var count = 0, power = 2 * (opts.feather == null ? 0.12 : opts.feather) / 0.12;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var angle = start + span * (x + 0.5) / W, total = 0, rgb = [0, 0, 0];
      source.forEach(function (im, i) {
        var theta = wrap(angle - registration.rotations[i]), limit = limits[i];
        if (theta <= limit.lo || theta >= limit.hi) return;
        var px = (theta / Math.PI + 0.5) * (im.width - 1), py = (y + 0.5) / H * (im.height - 1);
        var sx = Math.floor(px), sy = Math.floor(py), fx = px - sx, fy = py - sy, j = 4 * (sy * im.width + sx) + 3;
        var alpha = im.data[j] * (1 - fx) * (1 - fy) + im.data[j + 4] * fx * (1 - fy) +
          im.data[j + 4 * im.width] * (1 - fx) * fy + im.data[j + 4 * im.width + 4] * fx * fy;
        if (alpha < 250) return;
        var midpoint = (limit.lo + limit.hi) / 2, half = (limit.hi - limit.lo) / 2;
        var weight = Math.pow(Math.max(0, Math.cos((theta - midpoint) / half * Math.PI / 2)), power);
        var color = bil(im.data, im.width, im.height, px, py);
        for (var channel = 0; channel < 3; channel++) rgb[channel] += weight * color[channel];
        total += weight;
      });
      if (total <= 0) continue;
      count++; var i = 4 * (y * W + x);
      for (var channel = 0; channel < 3; channel++) result.data[i + channel] = rgb[channel] / total;
      result.data[i + 3] = 255;
    }
    ctx.putImageData(result, 0, 0);
    return { canvas: output, coveragePct: 100 * count / (W * H), start: start, span: span };
  }
  return { estimate: estimate, compose: compose, wrap: wrap };
})();
