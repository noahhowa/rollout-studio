/* Whole-circumference yardstick. Known rotations place strips on a fixed 360° grid.
   Surface-coordinate colours are rendered by ray intersection independently of flattening. */
"use strict";
var ROLLOUT = (function () {
  var TAU = 2 * Math.PI, WIDTH = 720, HEIGHT = 240, CROP = 0.14;
  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function percentile(a, q) {
    var sorted = a.slice().sort(function (x, y) { return x - y; });
    return sorted.length ? sorted[Math.floor((sorted.length - 1) * q)] : null;
  }
  function pixels(cv) { return cv.getContext("2d").getImageData(0, 0, cv.width, cv.height); }
  function canvas(data, W, H) {
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    cv.getContext("2d").putImageData(new ImageData(data, W, H), 0, 0); return cv;
  }
  function sample(im, x, y) {
    if (x < 0 || y < 0 || x >= im.width - 1 || y >= im.height - 1) return null;
    var xx = Math.floor(x), yy = Math.floor(y), fx = x - xx, fy = y - yy;
    var i = 4 * (yy * im.width + xx), stride = 4 * im.width, out = [];
    for (var c = 0; c < 4; c++) out.push(im.data[i + c] * (1 - fx) * (1 - fy) + im.data[i + 4 + c] * fx * (1 - fy) + im.data[i + stride + c] * (1 - fx) * fy + im.data[i + stride + 4 + c] * fx * fy);
    return out;
  }
  function project(camera, theta, v) {
    var P = [camera.radius * Math.sin(theta), camera.height * (1 - v), -camera.radius * Math.cos(theta)];
    var delta = P.map(function (p, i) { return p - camera.center[i]; });
    function dot(axis) { return delta.reduce(function (sum, p, i) { return sum + p * axis[i]; }, 0); }
    var depth = dot(camera.forward);
    return [camera.cx + camera.focal * dot(camera.right) / depth, camera.cy - camera.focal * dot(camera.up) / depth];
  }
  function flattenWithCamera(view) {
    var rgb = pixels(view.canvas), uv = pixels(view.coordinates);
    return { rotation: view.rot,
      read: function (theta, v) {
        var pos = project(view.camera, theta, v);
        return { color: sample(rgb, pos[0], pos[1]), uv: sample(uv, pos[0], pos[1]) };
      } };
  }
  function flattenWithApp(view, bounds) {
    // Exercise the production sampler for both the photograph and its independent coordinate map.
    var color = pixels(unwarp(view.canvas, bounds)), uv = null, validity = null;
    if (view.coordinates) {
      uv = pixels(unwarp(view.coordinates, bounds));
      var mask = pixels(view.coordinates);
      for (var i = 0; i < mask.data.length; i += 4) {
        mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = mask.data[i + 3]; mask.data[i + 3] = 255;
      }
      validity = pixels(unwarp(canvas(mask.data, mask.width, mask.height), bounds));
    }
    return { rotation: view.rot,
      image: color,
      read: function (theta, v) {
        var u = theta / Math.PI + 0.5, x = u * (color.width - 1), y = v * (color.height - 1);
        var value = uv && sample(uv, x, y), valid = validity && sample(validity, x, y);
        if (value) value[3] = valid ? valid[0] : 0;
        return { color: sample(color, x, y), uv: value };
      } };
  }
  function compose(strips) {
    var data = new Uint8ClampedArray(WIDTH * HEIGHT * 4), angleErrors = [], heightErrors = [], covered = 0;
    var support = 0, expectedSupport = 0, half = Math.PI * (0.5 - CROP);
    for (var y = 0; y < HEIGHT; y++) for (var x = 0; x < WIDTH; x++) {
      var theta = TAU * (x + 0.5) / WIDTH - Math.PI, v = (y + 0.5) / HEIGHT;
      var rgb = [0, 0, 0], total = 0, error = 0, vertical = 0, known = 0;
      strips.forEach(function (strip) {
        var local = wrap(theta - strip.rotation);
        if (Math.abs(local) >= half) return;
        var weight = Math.pow(Math.cos(local / half * Math.PI / 2), 2);
        var value = strip.read(local, v); expectedSupport += weight;
        if (!value.color || value.color[3] < 250) return;
        if (value.uv) {
          // Score every contributor before blending, so opposite distortions cannot cancel.
          if (value.uv[3] < 250) return;
          var actual = Math.atan2(value.uv[1] - 127.5, value.uv[0] - 127.5);
          error += weight * Math.abs(wrap(actual - theta)) * 180 / Math.PI;
          vertical += weight * Math.abs(value.uv[2] / 255 - v) * 100; known += weight;
        }
        for (var c = 0; c < 3; c++) rgb[c] += weight * value.color[c];
        total += weight;
      });
      if (total <= 0) continue;
      covered++; support += total;
      var i = (y * WIDTH + x) * 4;
      for (var c = 0; c < 3; c++) data[i + c] = rgb[c] / total;
      data[i + 3] = 255;
      if (known > 0) { angleErrors.push(error / known); heightErrors.push(vertical / known); }
    }
    return { canvas: canvas(data, WIDTH, HEIGHT),
      geometry: { angleMAEDeg: mean(angleErrors), angleP95Deg: percentile(angleErrors, 0.95), heightMAEPct: mean(heightErrors), coveragePct: 100 * covered / (WIDTH * HEIGHT), contributionCoveragePct: expectedSupport ? 100 * support / expectedSupport : 0 } };
  }
  function makeTexture() {
    var cv = makeProceduralTexture(1440, 480), im = pixels(cv);
    // Deterministic, non-repeating detail resolves the repeated glyphs in the old test texture.
    function noise(x, y) {
      var n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
    }
    for (var y = 0; y < im.height; y++) for (var x = 0; x < im.width; x++) {
      var gx = x / 12, gy = y / 12, xx = Math.floor(gx), yy = Math.floor(gy), fx = gx - xx, fy = gy - yy;
      var value = (1 - fy) * ((1 - fx) * noise(xx, yy) + fx * noise((xx + 1) % 120, yy)) + fy * ((1 - fx) * noise(xx, yy + 1) + fx * noise((xx + 1) % 120, yy + 1));
      var i = 4 * (y * im.width + x);
      for (var c = 0; c < 3; c++) im.data[i + c] += 70 * (value - 0.5);
    }
    cv.getContext("2d").putImageData(im, 0, 0); return cv;
  }
  function descriptors(cv) {
    // Local RGB contrast descriptors preserve drawing detail while tolerating exposure and vignette.
    var W = 720, H = 48, c = document.createElement("canvas"); c.width = W; c.height = H;
    c.getContext("2d").drawImage(cv, 0, 0, W, H); var im = pixels(c), cols = [];
    for (var x = 0; x < W; x++) {
      var values = [], center = 0;
      for (var y = 2; y < H - 2; y++) {
        var i = 4 * (y * W + x);
        // Vertical detail remains comparable when adjacent columns carry repeated motifs.
        var light = (im.data[i] + 2 * im.data[i + 1] + im.data[i + 2]) / 4;
        values.push(light); center += light;
      }
      center /= values.length; var length = 0;
      values = values.map(function (v) { var a = v - center; length += a * a; return a; });
      length = Math.sqrt(length);
      cols.push(length > 10 ? values.map(function (v) { return v / length; }) : null);
    }
    return cols;
  }
  function correlation(a, b) {
    if (!a || !b) return -1;
    var sum = 0; for (var i = 0; i < a.length; i++) sum += a[i] * b[i]; return sum;
  }
  function flexibleCorrelation(a, b) {
    if (!a || !b) return -1;
    // Published photographs can frame the painted surface at a different vertical position.
    var best = -1;
    for (var shift = -4; shift <= 4; shift++) {
      var ab = 0, aa = 0, bb = 0;
      for (var i = 4; i < a.length - 4; i++) {
        var av = a[i], bv = b[i + shift]; ab += av * bv; aa += av * av; bb += bv * bv;
      }
      if (aa > 0 && bb > 0) best = Math.max(best, ab / Math.sqrt(aa * bb));
    }
    return best;
  }
  function textureScore(output, reference, allowPhase) {
    var compare = allowPhase ? flexibleCorrelation : correlation;
    var a = descriptors(output), b = descriptors(reference), N = a.length, phase = 0;
    if (allowPhase) {
      var best = -Infinity;
      for (var shift = 0; shift < N; shift++) {
        var sum = 0, count = 0;
        for (var x = 0; x < N; x += 4) if (a[x] && b[(x + shift) % N]) { sum += compare(a[x], b[(x + shift) % N]); count++; }
        if (count && sum / count > best) { best = sum / count; phase = shift; }
      }
    }
    var errors = [], similarities = [];
    for (var x = 0; x < N; x++) {
      if (!a[x]) { similarities.push(-1); continue; }
      var target = (x + phase) % N, best = compare(a[x], b[target]), bestX = target;
      for (var dx = -40; dx <= 40; dx++) {
        var xx = (target + dx + N) % N, value = compare(a[x], b[xx]);
        if (value > best + 0.00001) { best = value; bestX = xx; }
      }
      similarities.push(compare(a[x], b[target]));
      if (best >= 0.65) errors.push(Math.abs(wrap(TAU * (bestX - target) / N)) * 180 / Math.PI);
    }
    return { angleMAEDeg: mean(errors), angleP95Deg: percentile(errors, 0.95), matchedColumnsPct: 100 * errors.length / N, meanCorrelation: mean(similarities), wholeRolloutLoss: Math.max(0, (1 - mean(similarities)) / 2), verticalTolerancePct: allowPhase ? 100 * 4 / 48 : 0, phaseDeg: phase * 360 / N, searchLimitDeg: 20 };
  }
  function inferRotation(strip, reference) {
    var cols = descriptors(canvas(strip.image.data, strip.image.width, strip.image.height)), truth = descriptors(reference), best = -Infinity, rotation = 0;
    for (var shift = 0; shift < 720; shift++) {
      var total = 0, n = 0;
      for (var x = 180; x <= 540; x += 12) {
        var angle = (x / 719 - 0.5) * Math.PI;
        var target = ((Math.round(angle / TAU * 720 + 360 + shift) % 720) + 720) % 720;
        if (cols[x] && truth[target]) { total += flexibleCorrelation(cols[x], truth[target]); n++; }
      }
      if (n && total / n > best) { best = total / n; rotation = shift * TAU / 720; }
    }
    strip.rotation = wrap(rotation); return best;
  }
  async function loadReference(item) {
    var source = await loadCanvas("/" + item.file), r = item.crop;
    var c = document.createElement("canvas");
    c.width = Math.round(source.width * (r[2] - r[0])); c.height = Math.round(source.height * (r[3] - r[1]));
    c.getContext("2d").drawImage(source, source.width * r[0], source.height * r[1], c.width, c.height, 0, 0, c.width, c.height);
    return c;
  }
  async function synthetic(texture, textureId, scene, rotations) {
    var views = rotations.map(function (rotation, i) {
      var scale = scene.varyFraming ? [1, 0.82, 1.08, 0.9, 1.04, 0.88][i] : 1;
      var p = { W: 640, H: 800, dist: scene.dist, elev: scene.elev, rot: rotation, trackSurface: true,
        fov: 2 * Math.atan(1.65 / (scene.dist * scale)) * 180 / Math.PI,
        cx: 320 + (scene.varyFraming ? [-25, 20, 0, 32, -18, 10][i] : 0),
        cy: 400 + (scene.varyFraming ? [18, -25, 30, -15, 10, -28][i] : 0) };
      return renderCylinder(texture, p);
    });
    var rows = [];
    for (var pipeline of ["known camera", "true rims + app sampler", "detected rims + app sampler"]) {
      var strips = views.map(function (view) {
        // Isolate detector resizing from earlier pipelines' pixel reads, as in the rim evaluator.
        var input = document.createElement("canvas"); input.width = view.canvas.width; input.height = view.canvas.height;
        input.getContext("2d").drawImage(view.canvas, 0, 0);
        var copy = Object.assign({}, view, { canvas: input });
        if (pipeline === "known camera") return flattenWithCamera(copy);
        return flattenWithApp(copy, pipeline === "true rims + app sampler" ? oracleB(view.truth) : RIM2.detect(input));
      });
      var result = compose(strips);
      rows.push({ id: textureId + "/" + scene.id, pipeline: pipeline, photos: views.length, rotationsDeg: rotations,
        geometry: result.geometry, texture: textureScore(result.canvas, texture, false), image: toJpeg(result.canvas, 1100) });
    }
    var controls = null;
    if (textureId === "procedural" && scene.id === "studio") {
      var wrong = views.map(function (view) {
        var camera = Object.assign({}, view.camera, { focal: view.camera.focal * 1.1 });
        return flattenWithCamera(Object.assign({}, view, { camera: camera }));
      });
      controls = { wrongFocal: compose(wrong).geometry,
        missingViews: compose([flattenWithCamera(views[0])]).geometry };
    }
    return { controls: controls, source: toJpeg(texture, 1100), photos: views.map(function (v) { return toJpeg(v.canvas, 160); }), rows: rows };
  }
  async function published(item, reference, sources) {
    var strips = [], registrations = [];
    for (var src of sources) {
      var cv = await loadCanvas(src), strip = flattenWithApp({ canvas: cv, rot: 0 }, RIM2.detect(cv));
      var similarity = inferRotation(strip, reference);
      registrations.push({ src: src, rotationDeg: strip.rotation * 180 / Math.PI, correlation: similarity }); strips.push(strip);
    }
    if (!strips.length) return { id: item.id, status: "missing photos", reference: toJpeg(reference, 1100), source: item.source };
    var result = compose(strips);
    return { id: item.id, status: "scored", photos: strips.length, source: item.source, registrations: registrations,
      geometry: result.geometry, texture: textureScore(result.canvas, reference, true), reference: toJpeg(reference, 1100), image: toJpeg(result.canvas, 1100) };
  }
  return { makeTexture: makeTexture, synthetic: synthetic, published: published, loadReference: loadReference, textureScore: textureScore, compose: compose };
})();
