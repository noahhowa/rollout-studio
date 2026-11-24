/* Register cylindrical strips using their common painted detail. Rotations are radians,
   relative to the first photo. Each photo has its own camera and image framing. */
"use strict";
var ROLLREGISTER = (function () {
  var TAU = 2 * Math.PI, COLS = 360, ROWS = 48;
  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function median(a) { return a.slice().sort(function (x, y) { return x - y; })[a.length >> 1]; }
  function describe(cv) {
    var small = document.createElement("canvas"); small.width = COLS; small.height = ROWS;
    small.getContext("2d").drawImage(cv, 0, 0, COLS, ROWS);
    var d = small.getContext("2d").getImageData(0, 0, COLS, ROWS).data, columns = [];
    for (var x = 0; x < COLS; x++) {
      var values = [], average = 0, valid = 0;
      for (var y = 4; y < ROWS - 4; y++) {
        var i = 4 * (y * COLS + x), light = (d[i] + 2 * d[i + 1] + d[i + 2]) / 4;
        values.push(light); average += light; if (d[i + 3] > 250) valid++;
      }
      average /= values.length; var length = 0;
      for (var k = 0; k < values.length; k++) { values[k] -= average; length += values[k] * values[k]; }
      length = Math.sqrt(length);
      columns.push(length > 15 && valid >= 0.9 * values.length ? values.map(function (v) { return v / length; }) : null);
    }
    return columns;
  }
  function correlation(a, b) {
    if (!a || !b) return null;
    var value = 0; for (var i = 0; i < a.length; i++) value += a[i] * b[i]; return value;
  }
  function pair(first, second) {
    var scores = [], best = null, limit = Math.round(COLS * 0.36);
    for (var shift = -200; shift <= 200; shift += 2) {
      var total = 0, weight = 0, count = 0;
      for (var x = Math.max(COLS / 2 - limit, shift + COLS / 2 - limit); x < Math.min(COLS / 2 + limit, shift + COLS / 2 + limit); x += 3) {
        var value = correlation(first.columns[x], second.columns[x - shift]);
        if (value === null) continue;
        var theta = (x / (COLS - 1) - 0.5) * Math.PI;
        var other = ((x - shift) / (COLS - 1) - 0.5) * Math.PI;
        var w = Math.cos(theta) * Math.cos(other);
        total += w * value; weight += w; count++;
      }
      var score = count >= 18 && weight > 0 ? total / weight : -1;
      scores.push(score);
      if (!best || score > best.score) best = { score: score, shift: shift, count: count, index: scores.length - 1 };
    }
    var delta = 0, index = best.index;
    if (index > 0 && index < scores.length - 1) {
      var l = scores[index - 1], r = scores[index + 1], curvature = l + r - 2 * best.score;
      if (curvature < -1e-6) delta = Math.max(-1, Math.min(1, (l - r) / curvature));
    }
    return { angle: (best.shift + delta) * Math.PI / (COLS - 1), correlation: best.score,
      weight: Math.max(0, best.score - 0.4) * Math.sqrt(best.count) };
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
      if (!best || best.edge.correlation < 0.65) break;
      rotations[best.j] = wrap(rotations[best.i] + best.sign * best.edge.angle);
      score += best.edge.weight; edges.push(best.edge); used.push(best.j);
    }
    if (used.length < N) return { score: -1000 + used.length, rotations: rotations, connected: false, edges: edges };
    var links = [];
    for (var i = 0; i < N; i++) for (var j = i + 1; j < N; j++) {
      var edge = matches[i][j][choices[i]][choices[j]], residual = Math.abs(wrap(rotations[j] - rotations[i] - edge.angle));
      if (edge.correlation > 0.65) {
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
    return { connected: best.graph.connected, cameras: best.choices.map(function (c, i) { return options[i][c].model; }),
      rotations: best.graph.rotations, confidence: confidence };
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
