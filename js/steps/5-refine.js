/* Step 5: trace edges on the stitched result and rectify. */
"use strict";
/* ═══ REFINE ═══ */
var rcv, rctx;
function interpPolylineX(pts, x) {
  if (pts.length < 2) return pts.length ? pts[0].y : 0;
  if (x <= pts[0].x) return pts[0].y;
  if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
  for (var i = 0; i < pts.length - 1; i++) {
    if (x >= pts[i].x && x <= pts[i + 1].x) {
      var tt = (x - pts[i].x) / (pts[i + 1].x - pts[i].x);
      return pts[i].y * (1 - tt) + pts[i + 1].y * tt;
    }
  }
  return pts[pts.length - 1].y;
}
function interpPolylineY(pts, y) {
  if (pts.length < 2) return pts.length ? pts[0].x : 0;
  var sorted = pts.slice().sort(function (a, b) {
    return a.y - b.y;
  });
  if (y <= sorted[0].y) return sorted[0].x;
  if (y >= sorted[sorted.length - 1].y) return sorted[sorted.length - 1].x;
  for (var i = 0; i < sorted.length - 1; i++) {
    if (y >= sorted[i].y && y <= sorted[i + 1].y) {
      var tt = (y - sorted[i].y) / (sorted[i + 1].y - sorted[i].y);
      return sorted[i].x * (1 - tt) + sorted[i + 1].x * tt;
    }
  }
  return sorted[sorted.length - 1].x;
}
function renderRefine() {
  var el = document.getElementById("p4");
  el.innerHTML = "<h1>" + t("refine") + "</h1>";
  var sec = document.createElement("div");
  sec.className = "section";
  sec.innerHTML =
    '<div class="sec-head"><span class="sec-label">' +
    t("straighten") +
    '</span><span class="opt-badge">' +
    t("optional") +
    "</span></div>";
  var tb = document.createElement("div");
  tb.className = "toolbar";
  tb.innerHTML =
    '<button class="btn btn-dark btn-sm" id="tHoriz">' +
    t("horizontal") +
    '</button><button class="btn btn-outline btn-sm" id="tVert">' +
    t("vertical") +
    '</button><div style="flex:1"></div><button class="btn btn-outline btn-sm" id="tRevert">' +
    t("revert") +
    '</button><button class="btn btn-dark btn-sm" id="tApply" disabled>' +
    t("rectify") +
    "</button>";
  sec.appendChild(tb);
  var cw = document.createElement("div");
  cw.className = "canvas-wrap";
  rcv = document.createElement("canvas");
  rcv.id = "rectCanvas";
  rcv.style.cursor = "crosshair";
  cw.appendChild(rcv);
  sec.appendChild(cw);
  el.appendChild(sec);
  rctx = rcv.getContext("2d");
  if (rawHFCanvas) {
    var maxW = Math.min(1200, window.innerWidth - 80);
    rectSc = Math.min(1, maxW / rawHFCanvas.width);
    rcv.width = Math.round(rawHFCanvas.width * rectSc);
    rcv.height = Math.round(rawHFCanvas.height * rectSc);
    if (!topLine.length) {
      // Pre-fill the band's detected top/bottom edges (js/core/auto-rectify.js); placeholders otherwise.
      var auto = typeof AUTORECT !== "undefined" ? AUTORECT.bandLines(rawHFCanvas) : null;
      if (auto) { topLine = auto.top; botLine = auto.bot; }
    }
    if (!topLine.length) {
      var pad = Math.round(rawHFCanvas.width * 0.02);
      topLine = [
        { x: pad, y: Math.round(rawHFCanvas.height * 0.15) },
        { x: rawHFCanvas.width - pad, y: Math.round(rawHFCanvas.height * 0.15) },
      ];
      botLine = [
        { x: pad, y: Math.round(rawHFCanvas.height * 0.85) },
        { x: rawHFCanvas.width - pad, y: Math.round(rawHFCanvas.height * 0.85) },
      ];
    }
    if (!leftLine.length) {
      var pad2 = Math.round(rawHFCanvas.width * 0.12);
      leftLine = [
        { x: pad2, y: Math.round(rawHFCanvas.height * 0.1) },
        { x: pad2, y: Math.round(rawHFCanvas.height * 0.9) },
      ];
      rightLine = [
        { x: rawHFCanvas.width - pad2, y: Math.round(rawHFCanvas.height * 0.1) },
        { x: rawHFCanvas.width - pad2, y: Math.round(rawHFCanvas.height * 0.9) },
      ];
    }
    drawRect();
  }
  document.getElementById("tHoriz").onclick = function () {
    refineMode = "h";
    activeLine = "top";
    drawRect();
  };
  document.getElementById("tVert").onclick = function () {
    refineMode = "v";
    activeLine = "left";
    drawRect();
  };
  document.getElementById("tRevert").onclick = function () {
    if (!originalHFCanvas) return;
    rawHFCanvas = originalHFCanvas;
    rCanvas = originalHFCanvas;
    topLine = [];
    botLine = [];
    leftLine = [];
    rightLine = [];
    var W = rawHFCanvas.width,
      H = rawHFCanvas.height,
      pad = Math.round(W * 0.02),
      pad2 = Math.round(W * 0.12);
    var auto = typeof AUTORECT !== "undefined" ? AUTORECT.bandLines(rawHFCanvas) : null;
    topLine = auto ? auto.top : [
      { x: pad, y: Math.round(H * 0.15) },
      { x: W - pad, y: Math.round(H * 0.15) },
    ];
    botLine = auto ? auto.bot : [
      { x: pad, y: Math.round(H * 0.85) },
      { x: W - pad, y: Math.round(H * 0.85) },
    ];
    leftLine = [
      { x: pad2, y: Math.round(H * 0.1) },
      { x: pad2, y: Math.round(H * 0.9) },
    ];
    rightLine = [
      { x: W - pad2, y: Math.round(H * 0.1) },
      { x: W - pad2, y: Math.round(H * 0.9) },
    ];
    drawRect();
  };
  document.getElementById("tApply").onclick = doRectify;
  rcv.addEventListener("mousedown", onRectDown);
  rcv.addEventListener("mousemove", onRectMove);
  window.addEventListener("mouseup", function () {
    dragIdx = -1;
  });
  rcv.addEventListener("dblclick", onRectDbl);
  rcv.addEventListener("touchstart", onRectTouchStart, { passive: false });
  rcv.addEventListener("touchmove", onRectTouchMove, { passive: false });
  rcv.addEventListener("touchend", function () {
    dragIdx = -1;
  });
  var exp = document.createElement("div");
  exp.className = "export-row";
  exp.style.marginTop = "8px";
  var dl = document.createElement("button");
  dl.className = "btn btn-dark";
  dl.textContent = t("downloadPNG");
  dl.onclick = function () {
    if (!rCanvas) return;
    var a = document.createElement("a");
    a.href = rCanvas.toDataURL("image/png");
    a.download = "vase_rollout.png";
    a.click();
  };
  var sv = document.createElement("button");
  sv.className = "btn btn-outline";
  sv.textContent = t("saveSession");
  sv.onclick = saveSession;
  exp.appendChild(dl);
  exp.appendChild(sv);
  el.appendChild(exp);
  if (rawHFCanvas && !rCanvas) rCanvas = rawHFCanvas;
}
function drawRect() {
  if (!rawHFCanvas || !rctx) return;
  rctx.drawImage(rawHFCanvas, 0, 0, rcv.width, rcv.height);
  rctx.fillStyle = "rgba(0,0,0,0.08)";
  rctx.fillRect(0, 0, rcv.width, rcv.height);
  var isH = refineMode === "h";
  var bh = document.getElementById("tHoriz"),
    bv = document.getElementById("tVert");
  if (bh) bh.className = isH ? "btn btn-dark btn-sm" : "btn btn-outline btn-sm";
  if (bv) bv.className = isH ? "btn btn-outline btn-sm" : "btn btn-dark btn-sm";
  if (isH) {
    drawPolyline(topLine, "rgba(249,115,22,.9)", "rgba(249,115,22,.4)");
    drawPolyline(botLine, "rgba(59,130,246,.9)", "rgba(59,130,246,.4)");
  } else {
    drawPolyline(leftLine, "rgba(249,115,22,.9)", "rgba(249,115,22,.4)");
    drawPolyline(rightLine, "rgba(59,130,246,.9)", "rgba(59,130,246,.4)");
  }
  var btn = document.getElementById("tApply");
  if (btn)
    btn.disabled = isH
      ? !(topLine.length >= 2 && botLine.length >= 2)
      : !(leftLine.length >= 2 && rightLine.length >= 2);
}
function drawPolyline(pts, col, fill) {
  if (!pts.length) return;
  var sc = rectSc;
  if (pts.length >= 2) {
    rctx.strokeStyle = col;
    rctx.lineWidth = 2;
    rctx.setLineDash([]);
    rctx.beginPath();
    rctx.moveTo(pts[0].x * sc, pts[0].y * sc);
    for (var i = 1; i < pts.length; i++) rctx.lineTo(pts[i].x * sc, pts[i].y * sc);
    rctx.stroke();
  }
  pts.forEach(function (p) {
    rctx.beginPath();
    rctx.arc(p.x * sc, p.y * sc, 6, 0, Math.PI * 2);
    rctx.fillStyle = fill;
    rctx.fill();
    rctx.strokeStyle = "#fff";
    rctx.lineWidth = 1.5;
    rctx.stroke();
  });
}
function evXY(e) {
  var rect = rcv.getBoundingClientRect(),
    ev = e.touches ? e.touches[0] : e;
  return {
    x: ((ev.clientX - rect.left) * (rcv.width / rect.width)) / rectSc,
    y: ((ev.clientY - rect.top) * (rcv.height / rect.height)) / rectSc,
  };
}
function hitPt(pts, mmx, mmy) {
  var hr = 12 / rectSc;
  for (var i = 0; i < pts.length; i++) if (Math.hypot(mmx - pts[i].x, mmy - pts[i].y) < hr) return i;
  return -1;
}
function hitSeg(pts, mmx, mmy) {
  if (pts.length < 2) return pts.length;
  var best = -1,
    bestD = 20 / rectSc;
  for (var i = 0; i < pts.length - 1; i++) {
    var ax = pts[i].x,
      ay = pts[i].y,
      bx = pts[i + 1].x,
      by = pts[i + 1].y,
      dx = bx - ax,
      dy = by - ay,
      len = Math.hypot(dx, dy);
    if (len < 1) continue;
    var tt = Math.max(0, Math.min(1, ((mmx - ax) * dx + (mmy - ay) * dy) / (len * len)));
    var d = Math.hypot(mmx - (ax + tt * dx), mmy - (ay + tt * dy));
    if (d < bestD) {
      bestD = d;
      best = i + 1;
    }
  }
  return best;
}
function addPtSorted(pts, p, sortByX) {
  var np = { x: Math.round(p.x), y: Math.round(p.y) };
  var seg = hitSeg(pts, p.x, p.y);
  if (seg >= 0) pts.splice(seg, 0, np);
  else pts.push(np);
  if (sortByX)
    pts.sort(function (a, b) {
      return a.x - b.x;
    });
  else
    pts.sort(function (a, b) {
      return a.y - b.y;
    });
  return pts.indexOf(np);
}
function resolveLineH(p) {
  if (topLine.length < 2 || botLine.length < 2) return activeLine;
  var ty = interpPolylineX(topLine, p.x),
    by = interpPolylineX(botLine, p.x);
  var dt = Math.abs(p.y - ty),
    db = Math.abs(p.y - by),
    span = Math.abs(by - ty);
  if (span < 10) return activeLine;
  var ratio = dt / (dt + db);
  return ratio < 0.35 ? "top" : ratio > 0.65 ? "bot" : activeLine;
}
function resolveLineV(p) {
  if (leftLine.length < 2 && rightLine.length >= 2) return "left";
  if (rightLine.length < 2 && leftLine.length >= 2) return "right";
  if (leftLine.length < 2 || rightLine.length < 2) return activeLine;
  var lx = interpPolylineY(leftLine, p.y),
    rx = interpPolylineY(rightLine, p.y);
  return Math.abs(p.x - lx) < Math.abs(p.x - rx) ? "left" : "right";
}
function getActiveLines() {
  var isH = refineMode === "h";
  return {
    A: isH ? topLine : leftLine,
    B: isH ? botLine : rightLine,
    aName: isH ? "top" : "left",
    bName: isH ? "bot" : "right",
    sortByX: isH,
  };
}
function onRectDown(e) {
  e.preventDefault();
  var p = evXY(e),
    g = getActiveLines();
  var hiA = hitPt(g.A, p.x, p.y),
    hiB = hitPt(g.B, p.x, p.y);
  if (hiA >= 0) {
    activeLine = g.aName;
    dragIdx = hiA;
    return;
  }
  if (hiB >= 0) {
    activeLine = g.bName;
    dragIdx = hiB;
    return;
  }
  var resolved = refineMode === "h" ? resolveLineH(p) : resolveLineV(p);
  activeLine = resolved;
  var pts = resolved === g.aName ? g.A : g.B;
  dragIdx = addPtSorted(pts, p, g.sortByX);
  drawRect();
}
function onRectMove(e) {
  e.preventDefault();
  var p = evXY(e),
    g = getActiveLines();
  var pts = activeLine === g.aName ? g.A : g.B;
  if (dragIdx >= 0 && dragIdx < pts.length) {
    pts[dragIdx].x = Math.max(0, Math.min(rawHFCanvas.width, Math.round(p.x)));
    pts[dragIdx].y = Math.max(0, Math.min(rawHFCanvas.height, Math.round(p.y)));
    drawRect();
  } else {
    rcv.style.cursor = hitPt(g.A, p.x, p.y) >= 0 || hitPt(g.B, p.x, p.y) >= 0 ? "grab" : "crosshair";
  }
}
function onRectDbl(e) {
  e.preventDefault();
  var p = evXY(e),
    g = getActiveLines();
  var hiA = hitPt(g.A, p.x, p.y),
    hiB = hitPt(g.B, p.x, p.y);
  if (hiA >= 0 && g.A.length > 2) {
    g.A.splice(hiA, 1);
    drawRect();
    return;
  }
  if (hiB >= 0 && g.B.length > 2) {
    g.B.splice(hiB, 1);
    drawRect();
  }
}
function onRectTouchStart(e) {
  e.preventDefault();
  var p = evXY(e),
    g = getActiveLines();
  var hiA = hitPt(g.A, p.x, p.y),
    hiB = hitPt(g.B, p.x, p.y);
  if (hiA >= 0) {
    activeLine = g.aName;
    dragIdx = hiA;
    return;
  }
  if (hiB >= 0) {
    activeLine = g.bName;
    dragIdx = hiB;
    return;
  }
  var resolved = refineMode === "h" ? resolveLineH(p) : resolveLineV(p);
  activeLine = resolved;
  var pts = resolved === g.aName ? g.A : g.B;
  dragIdx = addPtSorted(pts, p, g.sortByX);
  drawRect();
}
function onRectTouchMove(e) {
  e.preventDefault();
  if (dragIdx < 0) return;
  var p = evXY(e),
    g = getActiveLines();
  var pts = activeLine === g.aName ? g.A : g.B;
  if (dragIdx < pts.length) {
    pts[dragIdx].x = Math.max(0, Math.min(rawHFCanvas.width, Math.round(p.x)));
    pts[dragIdx].y = Math.max(0, Math.min(rawHFCanvas.height, Math.round(p.y)));
    drawRect();
  }
}
function doRectify() {
  if (!rawHFCanvas) return;
  var W = rawHFCanvas.width,
    H = rawHFCanvas.height;
  var src = rawHFCanvas.getContext("2d").getImageData(0, 0, W, H),
    sd = src.data;
  var out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  var octx = out.getContext("2d"),
    dst = octx.createImageData(W, H),
    dd = dst.data;
  if (refineMode === "h") {
    if (topLine.length < 2 || botLine.length < 2) return;
    var tS = [],
      bS = [];
    for (var x = 0; x < W; x += Math.max(1, Math.round(W / 200))) {
      tS.push(interpPolylineX(topLine, x));
      bS.push(interpPolylineX(botLine, x));
    }
    var flatTopY = med(tS),
      flatBotY = med(bS);
    for (var ox = 0; ox < W; ox++) {
      var curTop = interpPolylineX(topLine, ox),
        curBot = interpPolylineX(botLine, ox),
        curSpan = Math.max(1, curBot - curTop),
        flatSpan = Math.max(1, flatBotY - flatTopY);
      for (var oy = 0; oy < H; oy++) {
        var srcY;
        if (oy <= flatTopY) srcY = oy + (curTop - flatTopY);
        else if (oy >= flatBotY) srcY = oy + (curBot - flatBotY);
        else {
          var tt = (oy - flatTopY) / flatSpan;
          srcY = curTop + tt * curSpan;
        }
        var sy0 = srcY | 0,
          sy1 = sy0 + 1,
          fy = srcY - sy0;
        if (sy0 < 0) {
          sy0 = 0;
          sy1 = 0;
          fy = 0;
        }
        if (sy1 >= H) {
          sy1 = H - 1;
          sy0 = sy1;
          fy = 0;
        }
        var i0 = (sy0 * W + ox) * 4,
          i1 = (sy1 * W + ox) * 4,
          oi = (oy * W + ox) * 4;
        dd[oi] = sd[i0] * (1 - fy) + sd[i1] * fy;
        dd[oi + 1] = sd[i0 + 1] * (1 - fy) + sd[i1 + 1] * fy;
        dd[oi + 2] = sd[i0 + 2] * (1 - fy) + sd[i1 + 2] * fy;
        dd[oi + 3] = 255;
      }
    }
  } else {
    if (leftLine.length < 2 || rightLine.length < 2) return;
    var lS = [],
      rS = [];
    for (var y = 0; y < H; y += Math.max(1, Math.round(H / 200))) {
      lS.push(interpPolylineY(leftLine, y));
      rS.push(interpPolylineY(rightLine, y));
    }
    var flatLeftX = med(lS),
      flatRightX = med(rS);
    for (var oy = 0; oy < H; oy++) {
      var curLeft = interpPolylineY(leftLine, oy),
        curRight = interpPolylineY(rightLine, oy),
        curSpan = Math.max(1, curRight - curLeft),
        flatSpan = Math.max(1, flatRightX - flatLeftX);
      for (var ox = 0; ox < W; ox++) {
        var srcX;
        if (ox <= flatLeftX) srcX = ox + (curLeft - flatLeftX);
        else if (ox >= flatRightX) srcX = ox + (curRight - flatRightX);
        else {
          var tt = (ox - flatLeftX) / flatSpan;
          srcX = curLeft + tt * curSpan;
        }
        var sx0 = srcX | 0,
          sx1 = sx0 + 1,
          fx = srcX - sx0;
        if (sx0 < 0) {
          sx0 = 0;
          sx1 = 0;
          fx = 0;
        }
        if (sx1 >= W) {
          sx1 = W - 1;
          sx0 = sx1;
          fx = 0;
        }
        var i0 = (oy * W + sx0) * 4,
          i1 = (oy * W + sx1) * 4,
          oi = (oy * W + ox) * 4;
        dd[oi] = sd[i0] * (1 - fx) + sd[i1] * fx;
        dd[oi + 1] = sd[i0 + 1] * (1 - fx) + sd[i1 + 1] * fx;
        dd[oi + 2] = sd[i0 + 2] * (1 - fx) + sd[i1 + 2] * fx;
        dd[oi + 3] = 255;
      }
    }
  }
  octx.putImageData(dst, 0, 0);
  rCanvas = out;
  rawHFCanvas = out;
  if (refineMode === "h") {
    topLine = [];
    botLine = [];
    var pad = Math.round(W * 0.02);
    topLine = [
      { x: pad, y: Math.round(H * 0.15) },
      { x: W - pad, y: Math.round(H * 0.15) },
    ];
    botLine = [
      { x: pad, y: Math.round(H * 0.85) },
      { x: W - pad, y: Math.round(H * 0.85) },
    ];
  } else {
    leftLine = [];
    rightLine = [];
    var pad2 = Math.round(W * 0.12);
    leftLine = [
      { x: pad2, y: Math.round(H * 0.1) },
      { x: pad2, y: Math.round(H * 0.9) },
    ];
    rightLine = [
      { x: W - pad2, y: Math.round(H * 0.1) },
      { x: W - pad2, y: Math.round(H * 0.9) },
    ];
  }
  drawRect();
  var btn = document.getElementById("tApply");
  if (btn) {
    btn.textContent = t("applied");
    btn.disabled = true;
    setTimeout(function () {
      btn.textContent = t("rectify");
      btn.disabled = false;
    }, 1000);
  }
}
