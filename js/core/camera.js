/* Camera calibration from two projected circular rims. Lengths use vessel radius = 1. */
"use strict";
var ROLLCAMERA = (function () {
  function roots(a, b, c) {
    if (Math.abs(a) < 1e-10) return Math.abs(b) > 1e-10 ? [-c / b] : [];
    var discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return [];
    var q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
    return q ? [q / a, c / q] : [-b / (2 * a)];
  }
  function ellipse(handles) {
    var left = handles[0], right = handles[2], middle = handles[1];
    return { xc: (left.x + right.x) / 2, yc: (left.y + right.y) / 2,
      a: (right.x - left.x) / 2, b: middle.y - (left.y + right.y) / 2 };
  }
  function candidates(cv, bounds) {
    var top = ellipse(bounds.topH), bot = ellipse(bounds.botH), models = [];
    if (top.a <= 2 || bot.a <= 2 || Math.abs(bot.b) < 0.5) return models;
    // Near-horizontal rims are ill-conditioned. A small floor prevents division by zero.
    [1, -1].forEach(function (direction) {
      var bt = direction * Math.max(0.5, Math.abs(top.b)), bb = Math.max(0.5, Math.abs(bot.b));
      var qt = bt / (top.a * top.a), qb = bb / (bot.a * bot.a);
      if (qb <= qt) return;
      var at = top.a * top.a / (bt * bt), ab = bot.a * bot.a / (bb * bb);
      var horizons = roots(at - ab, -2 * top.yc * at + 2 * bot.yc * ab,
        top.yc * top.yc * at - bot.yc * bot.yc * ab - top.a * top.a + bot.a * bot.a);
      horizons.forEach(function (horizon) {
        var kt = (top.yc - horizon) / bt, kb = (bot.yc - horizon) / bb;
        if (kt <= 1 || kb <= 1) return;
        var g2 = top.a * top.a * (kt * kt - 1), tiltFocal = (kb - kt) / (qb - qt);
        var focal2 = g2 - tiltFocal * tiltFocal;
        if (focal2 <= 0) return;
        var focal = Math.sqrt(focal2), elev = Math.atan2(tiltFocal, focal);
        var distance = kt - qt * tiltFocal, height = focal * (qb - qt), cameraY = focal * qb;
        var cy = horizon + tiltFocal;
        if (distance < 1.3 || distance > 100 || height < 0.3 || height > 10 || Math.abs(elev) > 1.2) return;
        if (focal < 0.25 * cv.height || focal > 10 * cv.height || cy < -cv.height || cy > 2 * cv.height) return;
        var model = { distance: distance, height: height, elevation: elev, cameraY: cameraY,
          focal: focal, cx: (top.xc + bot.xc) / 2, cy: cy, topDirection: direction };
        model.prior = Math.abs(cy - cv.height / 2) / cv.height + 0.1 * Math.abs(Math.log(focal / cv.height));
        models.push(model);
      });
    });
    return models.sort(function (a, b) { return a.prior - b.prior; });
  }
  function project(model, theta, v) {
    var y = model.height * (1 - v), sin = Math.sin(model.elevation), cos = Math.cos(model.elevation);
    var depth = (model.distance - Math.cos(theta)) * cos + (model.cameraY - y) * sin;
    return { x: model.cx + model.focal * Math.sin(theta) / depth,
      y: model.cy - model.focal * ((y - model.cameraY) * cos + (model.distance - Math.cos(theta)) * sin) / depth };
  }
  function fitShared(cv, bounds, height, template) {
    var top = ellipse(bounds.topH), bot = ellipse(bounds.botH), radius = (top.a + bot.a) / 2;
    if (radius < 3 || height <= 0) return null;
    var d0 = template.distance, e0 = template.elevation, y0 = template.cameraY / template.height * height;
    var z0 = d0 * Math.cos(e0) + (y0 - height / 2) * Math.sin(e0);
    var focal0 = radius * Math.sqrt(Math.max(1, z0 * z0 - Math.cos(e0) * Math.cos(e0)));
    var v0 = (height / 2 - y0) * Math.cos(e0) + d0 * Math.sin(e0);
    var cy0 = (top.yc + bot.yc) / 2 + focal0 * v0 / z0;
    function model(p) {
      return { distance: Math.exp(p[0]), elevation: p[1], focal: Math.exp(p[2]),
        cameraY: p[3] * height, cy: p[4] * cv.height, cx: (top.xc + bot.xc) / 2, height: height };
    }
    function loss(p) {
      var m = model(p), sin = Math.sin(m.elevation), cos = Math.cos(m.elevation);
      if (m.distance < 1.3 || m.distance > 100 || Math.abs(m.elevation) > 1.2 || m.focal < 0.25 * cv.height || m.focal > 10 * cv.height || m.cy < -cv.height || m.cy > 2 * cv.height) return 1e6;
      var error = 0;
      [top, bot].forEach(function (e, i) {
        var y = i === 0 ? height : 0, depth = m.distance * cos + (m.cameraY - y) * sin;
        var vertical = (y - m.cameraY) * cos + m.distance * sin, den = depth * depth - cos * cos;
        if (depth <= cos || den <= 0) { error += 1e6; return; }
        var a = m.focal / Math.sqrt(den), b = m.focal * (m.cameraY - y) / den;
        var yc = m.cy - m.focal * (vertical * depth - sin * cos) / den;
        error += Math.pow((a - e.a) / radius, 2) + Math.pow((Math.abs(b) - Math.abs(e.b)) / radius, 2) + Math.pow((yc - e.yc) / radius, 2);
      });
      return error;
    }
    var start = [Math.log(d0), e0, Math.log(focal0), y0 / height, cy0 / cv.height];
    var steps = [0.1, 0.035, 0.1, 0.08, 0.02], simplex = [start];
    for (var i = 0; i < start.length; i++) { var point = start.slice(); point[i] += steps[i]; simplex.push(point); }
    var vertices = simplex.map(function (p) { return { p: p, error: loss(p) }; });
    for (var iteration = 0; iteration < 180; iteration++) {
      vertices.sort(function (a, b) { return a.error - b.error; });
      var center = start.map(function (_, i) { return vertices.slice(0, 5).reduce(function (sum, v) { return sum + v.p[i]; }, 0) / 5; });
      var worst = vertices[5];
      function trial(factor) { var p = center.map(function (c, i) { return c + factor * (c - worst.p[i]); }); return { p: p, error: loss(p) }; }
      var reflected = trial(1);
      if (reflected.error < vertices[0].error) { var expanded = trial(2); vertices[5] = expanded.error < reflected.error ? expanded : reflected; }
      else if (reflected.error < vertices[4].error) vertices[5] = reflected;
      else {
        var contracted = trial(-0.5);
        if (contracted.error < worst.error) vertices[5] = contracted;
        else for (var i = 1; i < vertices.length; i++) {
          vertices[i].p = vertices[i].p.map(function (v, j) { return (v + vertices[0].p[j]) / 2; }); vertices[i].error = loss(vertices[i].p);
        }
      }
    }
    vertices.sort(function (a, b) { return a.error - b.error; });
    if (vertices[0].error > 0.02) {
      // A crop or a dark band can hide one rim. Transfer the physical pose hypothesis,
      // then recover this photo's own scale and framing from the surviving circle.
      var survivor = Math.abs(bot.b) < 0.01 * bot.a ? top : Math.abs(top.b) < 0.01 * top.a ? bot : null;
      if (!survivor) return null;
      var y = survivor === top ? height : 0, sin = Math.sin(e0), cos = Math.cos(e0);
      var depth = d0 * cos + (y0 - y) * sin, vertical = (y - y0) * cos + d0 * sin;
      var den = depth * depth - cos * cos;
      if (depth <= cos || den <= 0) return null;
      var focal = survivor.a * Math.sqrt(den);
      return { distance: d0, elevation: e0, height: height, cameraY: y0, focal: focal,
        cx: survivor.xc, cy: survivor.yc + focal * (vertical * depth - sin * cos) / den, partial: true };
    }
    var result = model(vertices[0].p); result.residual = Math.sqrt(vertices[0].error / 6);
    result.topDirection = result.cameraY >= height ? 1 : -1; return result;
  }

  function flatten(cv, model, radius, size) {
    if (!model) return unwarp(cv, size.bounds, radius);
    var W = size && size.width || Math.max(10, Math.round(Math.PI * radius));
    var H = size && size.height || Math.max(10, Math.round(model.height * radius));
    var result = document.createElement("canvas"); result.width = W; result.height = H;
    var ctx = result.getContext("2d"), output = ctx.createImageData(W, H);
    // size.input: the photo's pixels, pre-read by callers that flatten the same photo many times
    var input = size && size.input || cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
    var visible = Math.acos(1 / model.distance);
    /* Pre-rectification (size.rectify): keep the camera's horizontal (angle) mapping, but pin each
       column vertically to the *detected* rims, so the top rim is row 0 and the bottom rim the last
       row. A small camera-height error otherwise bends the rims into waves that differ per photo. */
    var pin = null, bounds = size && size.bounds;
    if (size && size.rectify && bounds && bounds.topH && bounds.botH) {
      pin = [];
      for (var cx = 0; cx < W; cx++) {
        var th = (cx / (W - 1) - 0.5) * Math.PI, pt = project(model, th, 0), pb = project(model, th, 1);
        var yT = evalRimCurve(bounds.topH, pt.x), yB = evalRimCurve(bounds.botH, pb.x), span = pb.y - pt.y;
        pin.push(span > 1 ? { top: pt.y, scale: (yB - yT) / span, yT: yT } : null);
      }
    }
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var theta = (x / (W - 1) - 0.5) * Math.PI;
      if (Math.abs(theta) >= visible - 0.005) continue;
      var p = project(model, theta, y / (H - 1));
      if (pin && pin[x]) p = { x: p.x, y: pin[x].yT + (p.y - pin[x].top) * pin[x].scale };
      if (p.x < 0 || p.y < 0 || p.x >= cv.width - 1 || p.y >= cv.height - 1) continue;
      var color = bil(input.data, cv.width, cv.height, p.x, p.y), i = 4 * (y * W + x);
      for (var channel = 0; channel < 3; channel++) output.data[i + channel] = color[channel];
      var sx = Math.floor(p.x), sy = Math.floor(p.y), fx = p.x - sx, fy = p.y - sy;
      var j = 4 * (sy * cv.width + sx) + 3, stride = 4 * cv.width;
      output.data[i + 3] = input.data[j] * (1 - fx) * (1 - fy) + input.data[j + 4] * fx * (1 - fy) +
        input.data[j + stride] * (1 - fx) * fy + input.data[j + stride + 4] * fx * fy;
    }
    ctx.putImageData(output, 0, 0); return result;
  }
  return { candidates: candidates, ellipse: ellipse, project: project, fitShared: fitShared, flatten: flatten };
})();
