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
  function refinePeak(first, second, shift0, limit) {
    var best = null;
    for (var s = shift0 - 2; s <= shift0 + 2; s++) for (var dy = -3; dy <= 3; dy++) {
      var r = blockScore(first.columns, second.columns, s, dy, limit);
      if (!best || r.score > best.score) best = { score: r.score, shift: s, dy: dy, count: r.cells };
    }
    var l = blockScore(first.columns, second.columns, best.shift - 1, best.dy, limit).score, rr = blockScore(first.columns, second.columns, best.shift + 1, best.dy, limit).score;
    var curvature = l + rr - 2 * best.score;
    best.delta = curvature < -1e-6 ? Math.max(-1, Math.min(1, (l - rr) / curvature)) : 0; // sub-column peak
    return best;
  }
  /* Match two strips. Returns the best peak (angle, correlation, margin, ok, weight) plus up to three
     distinct candidate peaks (`peaks`), since on repeated motifs the true shift is not always first. */
  function pair(first, second) {
    var limit = Math.round(COLS * 0.36), coarse = [];
    for (var shift = -200; shift <= 200; shift += 2) coarse.push({ shift: shift, score: blockScore(first.columns, second.columns, shift, 0, limit).score });
    var sorted = coarse.slice().sort(function (p, q) { return q.score - p.score; }), seeds = [];
    for (var k = 0; k < sorted.length && seeds.length < 3; k++) {
      if (sorted[k].score <= 0.2) break;
      if (seeds.every(function (s) { return Math.abs(s.shift - sorted[k].shift) > 16; })) seeds.push(sorted[k]);
    }
    if (!seeds.length) seeds.push(sorted[0]);
    var peaks = seeds.map(function (c) {
      var b = refinePeak(first, second, c.shift, limit), rival = -1;
      // Distinctiveness: how clearly this peak beats every shift more than ~8 degrees away from it.
      coarse.forEach(function (q) { if (Math.abs(q.shift - b.shift) > 16 && q.score > rival) rival = q.score; });
      var margin = b.score - rival, ok = b.score > 0.3 && margin > 0.08;
      return { angle: (b.shift + b.delta) * Math.PI / (COLS - 1), correlation: b.score, dy: b.dy, margin: margin, ok: ok, count: b.count,
        weight: (b.score > 0.3 ? b.score - 0.2 + Math.max(0, margin) : 0) * Math.sqrt(b.count / 40) };
    }).sort(function (p, q) { return q.correlation - p.correlation; });
    var top = peaks[0];
    return { angle: top.angle, correlation: top.correlation, dy: top.dy, margin: top.margin, ok: top.ok,
      weight: top.ok ? top.weight : 0, peaks: peaks };
  }
  function edgeOf(matches, choices, i, j) { return i < j ? matches[i][j][choices[i]][choices[j]] : matches[j][i][choices[j]][choices[i]]; }
  // Greedy maximum spanning tree grown from one root photo; rotations relative to the root.
  function tree(choices, matches, root) {
    var N = choices.length, rotations = new Array(N).fill(null), used = [root], edges = [];
    rotations[root] = 0;
    while (used.length < N) {
      var best = null;
      used.forEach(function (i) {
        for (var j = 0; j < N; j++) if (rotations[j] === null) {
          var edge = edgeOf(matches, choices, i, j);
          if (!best || edge.weight > best.edge.weight) best = { i: i, j: j, edge: edge, sign: i < j ? 1 : -1 };
        }
      });
      if (!best || !best.edge.ok) break;
      rotations[best.j] = wrap(rotations[best.i] + best.sign * best.edge.angle);
      edges.push(best.edge); used.push(best.j);
    }
    return { rotations: rotations, edges: edges, connected: used.length === N, size: used.length };
  }
  /* Rotations from the pairwise matches. A single false match (repeated motifs) can mislead a tree
     grown greedily from one photo, so trees are grown from every root and the solution is scored by
     loop consistency: accepted pairs it agrees with count for it, accepted pairs it contradicts count
     against it. Then consistent pairs refine the angles. Photo zero is the angular origin. */
  function graph(choices, matches) {
    var N = choices.length, bestT = null, bestScore = -Infinity;
    for (var root = 0; root < N; root++) {
      var t = tree(choices, matches, root);
      if (!t.connected) { if (!bestT && -1000 + t.size > bestScore) { bestScore = -1000 + t.size; bestT = t; } continue; }
      var sc = 0;
      for (var i = 0; i < N; i++) for (var j = i + 1; j < N; j++) {
        var edge = matches[i][j][choices[i]][choices[j]]; if (!edge.ok) continue;
        var residual = Math.abs(wrap(t.rotations[j] - t.rotations[i] - edge.angle));
        if (residual < 0.06) sc += edge.weight * (1 - residual / 0.06);
      }
      if (sc > bestScore) { bestScore = sc; bestT = t; }
    }
    if (!bestT.connected) return { score: bestScore, rotations: bestT.rotations, connected: false, edges: bestT.edges };
    var r0 = bestT.rotations[0], rotations = bestT.rotations.map(function (r) { return wrap(r - r0); }), links = [];
    for (var i2 = 0; i2 < N; i2++) for (var j2 = i2 + 1; j2 < N; j2++) {
      var e = matches[i2][j2][choices[i2]][choices[j2]];
      if (e.ok && Math.abs(wrap(rotations[j2] - rotations[i2] - e.angle)) < 0.08) links.push({ i: i2, j: j2, edge: e });
    }
    for (var iteration = 0; iteration < 8; iteration++) {
      for (var k = 1; k < N; k++) {
        var correction = 0, total = 0;
        links.forEach(function (link) {
          if (link.i !== k && link.j !== k) return;
          var error = wrap(rotations[link.j] - rotations[link.i] - link.edge.angle);
          correction += (link.i === k ? error : -error) * link.edge.weight; total += link.edge.weight;
        });
        if (total) rotations[k] = wrap(rotations[k] + correction / total);
      }
    }
    closeLoop(rotations, choices, matches);
    return { score: bestScore, rotations: rotations, connected: true, edges: bestT.edges };
  }
  /* Loop closure: when the photos go all the way round and every neighbouring pair (in angle order,
     including last -> first) has an accepted match, the measured steps must sum to 360 degrees.
     Rescale the steps to do so; this removes the steady drift caused by a slightly wrong camera
     distance (each step a little too long or short). Skipped if the loop is incomplete or the sum
     is implausible (more than 15% off). */
  function closeLoop(rotations, choices, matches) {
    var N = rotations.length; if (N < 3) return;
    var order = rotations.map(function (r, i) { return { i: i, r: ((r % TAU) + TAU) % TAU }; }).sort(function (a, b) { return a.r - b.r; });
    var steps = [];
    for (var k = 0; k < N; k++) {
      var a = order[k].i, b = order[(k + 1) % N].i, e = edgeOf(matches, choices, a, b);
      if (!e.ok) return;
      var step = a < b ? e.angle : -e.angle; // measured angle from a to b
      step = ((step % TAU) + TAU) % TAU;
      if (step <= 0 || step > Math.PI) return;
      steps.push(step);
    }
    var total = steps.reduce(function (x, y) { return x + y; }, 0), scale = TAU / total;
    if (Math.abs(scale - 1) > 0.15) return;
    var start = order[0].r, acc = 0, placed = new Array(N);
    placed[order[0].i] = start;
    for (var m = 1; m < N; m++) { acc += steps[m - 1] * scale; placed[order[m].i] = start + acc; }
    var shift = placed[0];
    for (var q = 0; q < N; q++) rotations[q] = wrap(placed[q] - shift);
  }
  /* Sequence prior: museum sets are photographed in order while the vessel turns, so photo i and
     i+1 are angular neighbours and every step turns the same way. For each turning direction, chain
     the photos in order using, for each neighbouring pair, the strongest candidate peak that turns
     that way by a plausible step (15-150 degrees); close the loop when the last photo matches back to
     the first. Returns null when no complete chain exists (e.g. shuffled photos). */
  function sequenceSolve(choices, matches, N) {
    var MIN = 15 * Math.PI / 180, MAX = 150 * Math.PI / 180, best = null;
    function stepPeak(a, b, dir) { // best peak giving a turn from a to b in direction dir
      var e = a < b ? matches[a][b][choices[a]][choices[b]] : matches[b][a][choices[b]][choices[a]], sign = a < b ? 1 : -1, pick = null;
      (e.peaks || [e]).forEach(function (p) {
        var step = dir * sign * p.angle;
        if (p.correlation > 0.3 && step >= MIN && step <= MAX && (!pick || p.correlation > pick.p.correlation)) pick = { p: p, step: step };
      });
      return pick;
    }
    [1, -1].forEach(function (dir) {
      var steps = [], score = 0, missing = -1;
      for (var i = 0; i < N - 1; i++) {
        var sp = stepPeak(i, i + 1, dir);
        if (!sp) { if (missing >= 0) return; missing = i; steps.push(0); continue; } // allow one gap
        steps.push(sp.step); score += sp.p.correlation;
      }
      var close = N >= 3 ? stepPeak(N - 1, 0, dir) : null, total = steps.reduce(function (x, y) { return x + y; }, 0);
      if (missing >= 0) {
        // One neighbouring pair barely overlaps (wide step): if the loop closes, that step is what's left of 360.
        if (!close) return;
        var rest = TAU - total - close.step;
        if (rest < MIN || rest > Math.PI) return;
        steps[missing] = rest; score += close.p.correlation;
      } else if (close) {
        var sum = total + close.step, scale = TAU / sum;
        if (Math.abs(scale - 1) <= 0.2) { steps = steps.map(function (x) { return x * scale; }); score += close.p.correlation; }
      } else if (total >= TAU) return; // an open chain cannot wrap past a full turn
      var rotations = [0];
      for (var k = 0; k < steps.length; k++) rotations.push(wrap(rotations[k] + dir * steps[k]));
      if (!best || score > best.score) best = { score: score, rotations: rotations, dir: dir, closed: !!close };
    });
    return best;
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
        var strip = ROLLCAMERA.flatten(image.cv, model, radius, { width: 360, height: 120, bounds: image.b, rectify: true });
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
    // Prefer the photo-order chain when one exists (see sequenceSolve); keep the graph solve otherwise.
    var seq = sequenceSolve(best.choices, matches, images.length), method = "graph";
    if (seq) { best = { choices: best.choices, graph: { connected: true, rotations: seq.rotations, edges: best.graph.edges } }; method = seq.closed ? "sequence (closed loop)" : "sequence"; }
    // Best match per photo pair (any camera hypotheses): explains disconnected graphs.
    var pairs = [];
    for (var a = 0; a < images.length; a++) for (var c2 = a + 1; c2 < images.length; c2++) {
      var top = null; matches[a][c2].forEach(function (row) { row.forEach(function (m) { if (!top || m.correlation > top.correlation) top = m; }); });
      pairs.push({ i: a, j: c2, correlation: top.correlation, margin: top.margin, ok: top.ok, angleDeg: top.angle * 180 / Math.PI });
    }
    return { connected: best.graph.connected, cameras: best.choices.map(function (c, i) { return options[i][c].model; }),
      rotations: best.graph.rotations, confidence: confidence, pairs: pairs, method: method };
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
