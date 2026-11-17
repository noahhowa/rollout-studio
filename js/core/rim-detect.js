/* Auto rim detection: bounds, initial rim guess, edge snapping. */
"use strict";
/* ═══ IMAGE PROCESSING ═══ */
function getPx(c) {
  return c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
}
function detectBounds(cv) {
  var W = cv.width,
    H = cv.height,
    px = getPx(cv);
  var pts = [
    [0, 0],
    [W - 1, 0],
    [0, H - 1],
    [W - 1, H - 1],
    [W >> 1, 0],
    [W >> 1, H - 1],
    [0, H >> 1],
    [W - 1, H >> 1],
  ];
  var s = pts.map(function (p) {
    var i = (p[1] * W + p[0]) * 4;
    return [px[i], px[i + 1], px[i + 2]];
  });
  var bR = med(
      s.map(function (v) {
        return v[0];
      }),
    ),
    bG = med(
      s.map(function (v) {
        return v[1];
      }),
    ),
    bB = med(
      s.map(function (v) {
        return v[2];
      }),
    );
  function fg(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    var i = (y * W + x) * 4;
    return Math.abs(px[i] - bR) + Math.abs(px[i + 1] - bG) + Math.abs(px[i + 2] - bB) > 35;
  }
  var xL = W,
    xR = 0,
    yT = -1,
    yB = -1;
  for (var y = 0; y < H; y++) {
    var l = -1,
      rr = -1;
    for (var x = 0; x < W; x++) {
      if (fg(x, y)) {
        if (l < 0) l = x;
        rr = x;
      }
    }
    if (l >= 0 && rr - l > W * 0.05) {
      if (yT < 0) yT = y;
      yB = y;
      if (l < xL) xL = l;
      if (rr > xR) xR = rr;
    }
  }
  if (yT < 0) {
    yT = 5;
    yB = H - 5;
    xL = Math.round(W * 0.1);
    xR = Math.round(W * 0.9);
  }
  return {
    cx: (xL + xR) / 2,
    r: (xR - xL) / 2,
    yTop: Math.max(0, yT - 3),
    yBot: Math.min(H - 1, yB + 3),
    xLeft: Math.max(0, xL - 3),
    xRight: Math.min(W - 1, xR + 3),
  };
}
function isRed(r, g, b) {
  return r > 90 && r > g * 1.4 && r > b * 1.4;
}
function rimY(cv, b, x, w) {
  var px = getPx(cv),
    W = cv.width,
    sp = b.yBot - b.yTop;
  x = Math.max(0, Math.min(W - 1, Math.round(x)));
  if (w === "top") {
    var ir = false;
    for (var y = b.yTop; y < b.yTop + sp * 0.5; y++) {
      var i = (y * W + x) * 4;
      if (isRed(px[i], px[i + 1], px[i + 2])) ir = true;
      else if (ir) return y;
    }
    return b.yTop + sp * 0.12;
  } else {
    var ir2 = false;
    for (var y2 = b.yBot; y2 > b.yBot - sp * 0.5; y2--) {
      var i2 = (y2 * W + x) * 4;
      if (isRed(px[i2], px[i2 + 1], px[i2 + 2])) ir2 = true;
      else if (ir2) return y2;
    }
    return b.yBot - sp * 0.12;
  }
}
function initH(cv, b, w) {
  var pts = [b.xLeft, b.cx, b.xRight].map(function (x) {
    return { x: x, y: rimY(cv, b, x, w) };
  });
  var span = pts[2].x - pts[0].x;
  pts[0].cp = { x: pts[0].x + span * 0.25, y: pts[0].y };
  pts[2].cp = { x: pts[2].x - span * 0.25, y: pts[2].y };
  return pts;
}
function cubicBez(p0, p1, p2, p3, t) {
  var u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}
function evalRimCurve(h, x) {
  var cp0 = h[0].cp || { x: h[0].x + (h[1].x - h[0].x) * 0.33, y: h[0].y };
  var cp2 = h[2].cp || { x: h[2].x - (h[2].x - h[1].x) * 0.33, y: h[2].y };
  var midCpL = { x: h[1].x - (h[1].x - h[0].x) * 0.33, y: h[1].y };
  var midCpR = { x: h[1].x + (h[2].x - h[1].x) * 0.33, y: h[1].y };
  if (x <= h[0].x) return h[0].y;
  if (x >= h[2].x) return h[2].y;
  if (x <= h[1].x) {
    var tR = h[1].x - h[0].x;
    if (tR < 1) return h[0].y;
    var tt = (x - h[0].x) / tR;
    for (var it = 0; it < 5; it++) {
      var pt = cubicBez(h[0], cp0, midCpL, h[1], tt);
      var dx =
        3 * (1 - tt) * (1 - tt) * (cp0.x - h[0].x) +
        6 * (1 - tt) * tt * (midCpL.x - cp0.x) +
        3 * tt * tt * (h[1].x - midCpL.x);
      if (Math.abs(dx) > 0.01) tt -= (pt.x - x) / dx;
      tt = Math.max(0, Math.min(1, tt));
    }
    return cubicBez(h[0], cp0, midCpL, h[1], tt).y;
  } else {
    var tR2 = h[2].x - h[1].x;
    if (tR2 < 1) return h[1].y;
    var tt2 = (x - h[1].x) / tR2;
    for (var it2 = 0; it2 < 5; it2++) {
      var pt2 = cubicBez(h[1], midCpR, cp2, h[2], tt2);
      var dx2 =
        3 * (1 - tt2) * (1 - tt2) * (midCpR.x - h[1].x) +
        6 * (1 - tt2) * tt2 * (cp2.x - midCpR.x) +
        3 * tt2 * tt2 * (h[2].x - cp2.x);
      if (Math.abs(dx2) > 0.01) tt2 -= (pt2.x - x) / dx2;
      tt2 = Math.max(0, Math.min(1, tt2));
    }
    return cubicBez(h[1], midCpR, cp2, h[2], tt2).y;
  }
}
function _snap_buildLum(cv) {
  var ctx = cv.getContext("2d"),
    W = cv.width,
    H = cv.height,
    d = ctx.getImageData(0, 0, W, H).data,
    lum = new Float32Array(W * H);
  for (var i = 0, px = 0; i < lum.length; i++, px += 4)
    lum[i] = 0.299 * d[px] + 0.587 * d[px + 1] + 0.114 * d[px + 2];
  return { lum: lum, W: W, H: H };
}
function _snap_blur1D(src, W, H, r) {
  if (r <= 0) return src;
  var tmp = new Float32Array(W * H),
    out = new Float32Array(W * H);
  for (var y = 0; y < H; y++) {
    var base = y * W;
    for (var x = 0; x < W; x++) {
      var s = 0,
        n = 0;
      for (var dx = -r; dx <= r; dx++) {
        var xx = x + dx;
        if (xx >= 0 && xx < W) {
          s += src[base + xx];
          n++;
        }
      }
      tmp[base + x] = s / n;
    }
  }
  for (var x = 0; x < W; x++) {
    for (var y = 0; y < H; y++) {
      var s = 0,
        n = 0;
      for (var dy = -r; dy <= r; dy++) {
        var yy = y + dy;
        if (yy >= 0 && yy < H) {
          s += tmp[yy * W + x];
          n++;
        }
      }
      out[y * W + x] = s / n;
    }
  }
  return out;
}
function _snap_buildVertGrad(lum, W, H) {
  var g = new Float32Array(W * H);
  for (var y = 1; y < H - 1; y++) {
    var y0 = (y - 1) * W,
      y1 = y * W,
      y2 = (y + 1) * W;
    for (var x = 1; x < W - 1; x++) {
      var dY =
        lum[y2 + x - 1] +
        2 * lum[y2 + x] +
        lum[y2 + x + 1] -
        (lum[y0 + x - 1] + 2 * lum[y0 + x] + lum[y0 + x + 1]);
      g[y1 + x] = Math.abs(dY);
    }
  }
  return g;
}
function _snap_buildDoG(lum, W, H, r1, r2) {
  var b1 = _snap_blur1D(lum, W, H, r1),
    b2 = _snap_blur1D(lum, W, H, r2),
    dog = new Float32Array(W * H);
  for (var i = 0; i < dog.length; i++) dog[i] = Math.abs(b1[i] - b2[i]);
  return dog;
}
function _snap_getEdgeCache(im, mode) {
  mode = mode || 3;
  if (!im._ec) im._ec = {};
  var k = "m" + mode,
    W = im.cv.width,
    H = im.cv.height;
  if (im._ec[k] && im._ec[k].w === W) return im._ec[k];
  var r = _snap_buildLum(im.cv),
    lum = r.lum,
    lumB = _snap_blur1D(lum, W, H, 2);
  var vg = _snap_buildVertGrad(lumB, W, H),
    dog = _snap_buildDoG(lumB, W, H, 1, 4),
    em = new Float32Array(W * H);
  for (var i = 0; i < em.length; i++) em[i] = 0.65 * vg[i] + 0.35 * dog[i];
  var res = { grad: em, w: W, h: H };
  im._ec[k] = res;
  return res;
}
function _snap_fitEllipse(xs, ys, xC, a, sgn) {
  var sT = 0,
    sY = 0,
    sTT = 0,
    sTY = 0,
    n = xs.length;
  for (var i = 0; i < n; i++) {
    var u = (xs[i] - xC) / a,
      tt = u * u <= 1 ? Math.sqrt(1 - u * u) : 0;
    sT += tt;
    sY += ys[i];
    sTT += tt * tt;
    sTY += tt * ys[i];
  }
  var mT = sT / n,
    mY = sY / n,
    vT = Math.max(1e-6, sTT - n * mT * mT);
  return { yC: mY - ((sTY - n * mT * mY) / vT) * mT, k: ((sTY - n * mT * mY) / vT) * sgn };
}
function snapRimToEdge(im, w, opts) {
  opts = opts || {};
  var b = im.b,
    edge = _snap_getEdgeCache(im, 3),
    grad = edge.grad,
    W = edge.w,
    H = edge.h;
  var sR = opts.searchR || 22,
    sP = opts.smoothPenalty || 2.8,
    pW = opts.priorW || 0.55;
  var h = w === "top" ? b.topH : b.botH,
    xL = Math.max(2, Math.round(h[0].x)),
    xR = Math.min(W - 3, Math.round(h[2].x));
  if (xR <= xL + 5) return;
  var xs = [],
    ys = [];
  for (var x = xL; x <= xR; x += 3) {
    xs.push(x);
    ys.push(evalRimCurve(h, x));
  }
  var xC = (xL + xR) / 2,
    a = (xR - xL) / 2,
    sgn = w === "top" ? -1 : 1,
    prior = _snap_fitEllipse(xs, ys, xC, a, sgn);
  var cols = [];
  for (var x = xL; x <= xR; x++) cols.push(x);
  var XN = cols.length;
  var bMin = new Int16Array(XN),
    bMax = new Int16Array(XN),
    YN = 0;
  for (var i = 0; i < XN; i++) {
    var y0 = evalRimCurve(h, cols[i]);
    bMin[i] = Math.max(2, Math.round(y0 - sR));
    bMax[i] = Math.min(H - 3, Math.round(y0 + sR));
    if (bMax[i] < bMin[i]) {
      bMin[i] = Math.max(2, Math.round(y0));
      bMax[i] = bMin[i];
    }
    YN = Math.max(YN, bMax[i] - bMin[i] + 1);
  }
  if (YN < 2) return;
  var dp = new Float32Array(XN * YN),
    back = new Int16Array(XN * YN),
    yB = new Int16Array(XN);
  yB[0] = bMin[0];
  var yN0 = bMax[0] - bMin[0] + 1;
  for (var yi = 0; yi < YN; yi++) {
    dp[yi] = -1e30;
    back[yi] = -1;
  }
  for (var yi = 0; yi < yN0; yi++) {
    var y = bMin[0] + yi,
      u = (cols[0] - xC) / a,
      tt = u * u <= 1 ? Math.sqrt(1 - u * u) : 0,
      yE = prior.yC + prior.k * tt;
    dp[yi] = grad[y * W + cols[0]] - pW * Math.abs(y - yE);
  }
  for (var xi = 1; xi < XN; xi++) {
    yB[xi] = bMin[xi];
    var yNi = bMax[xi] - bMin[xi] + 1;
    for (var yi = 0; yi < YN; yi++) {
      dp[xi * YN + yi] = -1e30;
    }
    var x = cols[xi],
      u = (x - xC) / a,
      tt = u * u <= 1 ? Math.sqrt(1 - u * u) : 0,
      yE = prior.yC + prior.k * tt,
      pMin = yB[xi - 1],
      pN = bMax[xi - 1] - bMin[xi - 1] + 1;
    for (var yi = 0; yi < yNi; yi++) {
      var y = bMin[xi] + yi,
        best = -1e30,
        bp = 0;
      for (var py = 0; py < pN; py++) {
        var pY = pMin + py;
        if (Math.abs(pY - y) > 7) continue;
        var c = dp[(xi - 1) * YN + py] - sP * Math.abs(y - pY);
        if (c > best) {
          best = c;
          bp = py;
        }
      }
      dp[xi * YN + yi] = best + grad[y * W + x] - pW * Math.abs(y - yE);
      back[xi * YN + yi] = bp;
    }
  }
  var eN = bMax[XN - 1] - bMin[XN - 1] + 1,
    eYi = 0,
    eB = -1e30;
  for (var yi = 0; yi < eN; yi++) {
    var v = dp[(XN - 1) * YN + yi];
    if (v > eB) {
      eB = v;
      eYi = yi;
    }
  }
  var seam = new Array(XN),
    c = eYi;
  for (var xi = XN - 1; xi >= 0; xi--) {
    seam[xi] = yB[xi] + c;
    c = back[xi * YN + c] || 0;
  }
  function at(xq) {
    if (xq <= cols[0]) return seam[0];
    if (xq >= cols[XN - 1]) return seam[XN - 1];
    return seam[Math.max(0, Math.min(XN - 1, Math.round(xq - cols[0])))];
  }
  h[0].y = at(h[0].x);
  h[1].y = at(h[1].x);
  h[2].y = at(h[2].x);
  if (h[0].cp) h[0].cp.y = at(h[0].cp.x);
  if (h[2].cp) h[2].cp.y = at(h[2].cp.x);
}
