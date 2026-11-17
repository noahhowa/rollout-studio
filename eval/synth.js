/* Synthetic test images: a textured cylinder ray-traced through a pinhole camera.
   Because the scene is known, the true rim curves and true surface texture are exact. */
"use strict";
function makeProceduralTexture(w, h) {
  var c = document.createElement("canvas"); c.width = w; c.height = h;
  var x = c.getContext("2d");
  x.fillStyle = "#d9b48a"; x.fillRect(0, 0, w, h);
  x.fillStyle = "#8a2a12"; x.fillRect(0, 0, w, h * 0.07); x.fillRect(0, h * 0.95, w, h * 0.05);
  for (var i = 0; i < 24; i++) { // distinct glyph-like marks so column matching is unambiguous
    x.fillStyle = "hsl(" + ((i * 47) % 360) + ",45%,30%)";
    var gx = (i / 24) * w, gy = h * (0.15 + 0.6 * ((i * 7) % 11) / 11);
    x.fillRect(gx + 4, gy, w / 60 + (i % 3) * 6, h * (0.1 + (i % 4) * 0.05));
    x.beginPath(); x.arc(gx + w / 48, h * 0.5 + ((i * 13) % 9) * 6, 8 + (i % 5) * 3, 0, 7); x.fill();
  }
  return c;
}

/* p: {W,H, dist (camera distance / radius), elev (deg), fov (deg), rot (deg), bg, rimColor} */
function renderCylinder(tex, p) {
  var W = p.W, H = p.H, R = 1, Hc = (2 * Math.PI * R * tex.height) / tex.width;
  var td = tex.getContext("2d").getImageData(0, 0, tex.width, tex.height).data, TW = tex.width, TH = tex.height;
  var el = (p.elev * Math.PI) / 180, T = [0, Hc / 2, 0];
  var C = [0, T[1] + p.dist * Math.sin(el), -p.dist * Math.cos(el)];
  var f = [0, -Math.sin(el), Math.cos(el)], r = [1, 0, 0], u = [0, Math.cos(el), Math.sin(el)];
  var F = H / 2 / Math.tan((p.fov * Math.PI) / 360), rot = ((p.rot || 0) * Math.PI) / 180;
  var out = document.createElement("canvas"); out.width = W; out.height = H;
  var ctx = out.getContext("2d"), img = ctx.createImageData(W, H), d = img.data;
  var bg = p.bg || [235, 235, 235];
  function texAt(th, y, shade, k) {
    var tu = (((th + rot) / (2 * Math.PI) + 0.5) % 1 + 1) % 1, tv = 1 - y / Hc;
    var ti = ((Math.min(TH - 1, Math.max(0, (tv * TH) | 0)) * TW) + ((tu * TW) | 0)) * 4;
    d[k] = td[ti] * shade; d[k + 1] = td[ti + 1] * shade; d[k + 2] = td[ti + 2] * shade;
  }
  for (var py = 0; py < H; py++) for (var px = 0; px < W; px++) {
    var a = (px - W / 2) / F, b2 = -(py - H / 2) / F;
    var dx = f[0] + a * r[0] + b2 * u[0], dy = f[1] + a * r[1] + b2 * u[1], dz = f[2] + a * r[2] + b2 * u[2];
    var k = (py * W + px) * 4; d[k + 3] = 255;
    var A = dx * dx + dz * dz, B = 2 * (C[0] * dx + C[2] * dz), Cc = C[0] * C[0] + C[2] * C[2] - R * R;
    var disc = B * B - 4 * A * Cc, hit = false;
    if (disc > 0) {
      var sq = Math.sqrt(disc), t1 = (-B - sq) / (2 * A), t2 = (-B + sq) / (2 * A);
      var y1 = C[1] + t1 * dy;
      if (t1 > 0 && y1 >= 0 && y1 <= Hc) { // outer wall
        var hx = C[0] + t1 * dx, hz = C[2] + t1 * dz, th = Math.atan2(hx, -hz);
        var shade = 0.45 + 0.55 * Math.max(0, -(hx * dx + hz * dz) / Math.sqrt(dx * dx + dy * dy + dz * dz));
        texAt(th, y1, shade, k); hit = true;
      } else if (y1 > Hc) { // through the opening onto the inner far wall
        var y2 = C[1] + t2 * dy;
        if (y2 >= 0 && y2 <= Hc) { d[k] = 120; d[k + 1] = 80; d[k + 2] = 55; hit = true; }
        else if (y2 < 0) { d[k] = 90; d[k + 1] = 60; d[k + 2] = 40; hit = true; }
      }
    }
    if (!hit && p.floor && dy < 0) { // floor plane at y=0 with a soft contact shadow
      var tf = -C[1] / dy, fr = Math.hypot(C[0] + tf * dx, C[2] + tf * dz), sh = Math.min(1, Math.max(0.35, (fr - 0.95) / 0.8));
      d[k] = p.floor[0] * sh; d[k + 1] = p.floor[1] * sh; d[k + 2] = p.floor[2] * sh; hit = true;
    }
    if (!hit) { var g = 1 - 0.15 * (py / H); d[k] = bg[0] * g; d[k + 1] = bg[1] * g; d[k + 2] = bg[2] * g; }
  }
  ctx.putImageData(img, 0, 0);
  // True rim curves: front arc of the top and bottom circles, projected.
  function proj(P) {
    var v = [P[0] - C[0], P[1] - C[1], P[2] - C[2]], z = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
    return { x: W / 2 + (F * (v[0] * r[0] + v[1] * r[1] + v[2] * r[2])) / z, y: H / 2 - (F * (v[0] * u[0] + v[1] * u[1] + v[2] * u[2])) / z };
  }
  function arc(yy) {
    var pts = [];
    for (var i = 0; i <= 720; i++) {
      var th = -Math.PI / 2 + (i / 720) * Math.PI, q = proj([R * Math.sin(th), yy, -R * Math.cos(th)]);
      if (!pts.length || q.x > pts[pts.length - 1].x) pts.push(q);
    }
    return pts;
  }
  // Fraction of the circumference actually visible from the camera (horizontal distance).
  var dh = Math.hypot(C[0], C[2]), visHalf = Math.acos(R / dh);
  return { canvas: out, truth: { top: arc(Hc), bot: arc(0), visHalfDeg: (visHalf * 180) / Math.PI }, tex: tex, rot: rot };
}
