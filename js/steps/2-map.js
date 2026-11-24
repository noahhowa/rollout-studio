/* Step 2: map top/bottom rims per photo (draggable handles + loupe). */
"use strict";
/* ═══ MAP RIMS ═══ */
function renderMap() {
  var el = document.getElementById("p1");
  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:baseline"><h1>' +
    t("mapRims") +
    '</h1><div class="legend"><span><span class="legend-dot" style="background:#f97316"></span>' +
    t("top") +
    '</span><span><span class="legend-dot" style="background:#3b82f6"></span>' +
    t("bottom") +
    "</span></div></div>";
  var grid = document.createElement("div");
  grid.className = "rim-grid";
  imgs.forEach(function (im, i) {
    grid.appendChild(makeRimCard(im, i));
  });
  el.appendChild(grid);
}
function _clampCP(h, which, cv) {
  var H = cv.height,
    x0 = h[0].x,
    x2 = h[2].x,
    mn = Math.min(x0, x2),
    mx2 = Math.max(x0, x2),
    sp = mx2 - mn,
    cp = which === 0 ? h[0].cp : h[2].cp;
  if (!cp) return;
  var pad = Math.max(2, sp * 0.02);
  cp.x = Math.max(mn + pad, Math.min(mx2 - pad, cp.x));
  cp.y = Math.max(0, Math.min(H - 1, cp.y));
  var ay = which === 0 ? h[0].y : h[2].y,
    maxDy = Math.max(10, H * 0.25);
  cp.y = Math.max(ay - maxDy, Math.min(ay + maxDy, cp.y));
}
function makeRimCard(im, idx) {
  var card = document.createElement("div");
  card.className = "rim-card";
  var PW = 280,
    sc = PW / im.cv.width,
    PH = Math.round(im.cv.height * sc);
  var cv = document.createElement("canvas");
  cv.width = PW;
  cv.height = PH;
  card.appendChild(cv);
  var prevLabel = document.createElement("div");
  prevLabel.style.cssText =
    "padding:4px 10px 2px;font-size:10px;color:var(--t3);border-top:1px solid var(--border-lt)";
  prevLabel.textContent = t("unwarpPreview");
  card.appendChild(prevLabel);
  var prevCv = document.createElement("canvas");
  prevCv.style.cssText = "display:block;width:100%;border-radius:0 0 var(--r) var(--r)";
  card.appendChild(prevCv);
  var foot = document.createElement("div");
  foot.className = "rim-foot";
  foot.innerHTML = "<span>" + (idx + 1) + " \u00B7 " + im.cv.width + "\u00D7" + im.cv.height + "</span>";
  var reBtn = document.createElement("button");
  reBtn.className = "btn btn-ghost btn-icon";
  reBtn.style.fontSize = "10px";
  reBtn.textContent = "\u21BA";
  reBtn.title = t("resetRims");
  reBtn.onclick = function () {
    // Re-run the current detector, including for rims loaded from an older session.
    var detected = null;
    try { detected = RIM2.detect(im.cv); } catch (e) {}
    if (detected) Object.assign(im.b, detected);
    else {
      im.b.topH = initH(im.cv, im.b, "top");
      im.b.botH = initH(im.cv, im.b, "bot");
    }
    stripCache = [];
    redraw(null);
    updatePreview();
  };
  var snapBtn = document.createElement("button");
  snapBtn.className = "btn btn-outline btn-sm";
  snapBtn.textContent = t("snap");
  snapBtn.style.marginLeft = "6px";
  snapBtn.onclick = function () {
    try {
      snapRimToEdge(im, "top");
      snapRimToEdge(im, "bot");
      stripCache = [];
      redraw(null);
      updatePreview();
    } catch (e) {}
  };
  foot.appendChild(reBtn);
  foot.appendChild(snapBtn);
  card.appendChild(foot);
  var b = im.b,
    ctx = cv.getContext("2d"),
    drag = null,
    prevDb = null;
  function updatePreview() {
    try {
      var g = hGeom(b),
        strip = unwarp(im.cv, b, g.r),
        psc = PW / strip.width,
        pH = Math.max(30, Math.round(strip.height * psc));
      prevCv.width = PW;
      prevCv.height = pH;
      prevCv.getContext("2d").drawImage(strip, 0, 0, PW, pH);
    } catch (e) {}
  }
  function schedPrev() {
    if (prevDb) clearTimeout(prevDb);
    prevDb = setTimeout(updatePreview, 80);
  }
  function cxy(e) {
    var rect = cv.getBoundingClientRect(),
      sx = PW / rect.width,
      sy = PH / rect.height,
      ev = e.touches ? e.touches[0] : e;
    return [(ev.clientX - rect.left) * sx, (ev.clientY - rect.top) * sy];
  }
  function hit(mmx, mmy) {
    var sets = [b.topH, b.botH];
    for (var si = 0; si < 2; si++) {
      var hh = sets[si];
      if (hh[0].cp && Math.hypot(mmx - hh[0].cp.x * sc, mmy - hh[0].cp.y * sc) <= HR + 2)
        return { h: hh, i: "cp0" };
      if (hh[2].cp && Math.hypot(mmx - hh[2].cp.x * sc, mmy - hh[2].cp.y * sc) <= HR + 2)
        return { h: hh, i: "cp2" };
    }
    for (var si = 0; si < 2; si++)
      for (var i = 0; i < 3; i++) {
        var hh = sets[si][i];
        if (Math.hypot(mmx - hh.x * sc, mmy - hh.y * sc) <= HR + 3) return { h: sets[si], i: i };
      }
    return null;
  }
  function applyDrag(p) {
    if (drag.i === "cp0") {
      drag.h[0].cp.x = p[0] / sc;
      drag.h[0].cp.y = p[1] / sc;
      _clampCP(drag.h, 0, im.cv);
    } else if (drag.i === "cp2") {
      drag.h[2].cp.x = p[0] / sc;
      drag.h[2].cp.y = p[1] / sc;
      _clampCP(drag.h, 2, im.cv);
    } else {
      drag.h[drag.i].x = p[0] / sc;
      drag.h[drag.i].y = p[1] / sc;
    }
    stripCache = [];
    redraw({
      mx: p[0],
      my: p[1],
      h: drag.h,
      hi: typeof drag.i === "number" ? drag.i : drag.i === "cp0" ? 0 : 2,
    });
    schedPrev();
  }
  cv.onmousedown = function (e) {
    e.preventDefault();
    drag = hit.apply(null, cxy(e));
  };
  cv.onmousemove = function (e) {
    e.preventDefault();
    var p = cxy(e);
    if (drag) applyDrag(p);
    else cv.style.cursor = hit(p[0], p[1]) ? "move" : "default";
  };
  window.addEventListener("mouseup", function () {
    if (drag) {
      drag = null;
      redraw(null);
      updatePreview();
    }
  });
  cv.addEventListener(
    "touchstart",
    function (e) {
      e.preventDefault();
      drag = hit.apply(null, cxy(e));
    },
    { passive: false },
  );
  cv.addEventListener(
    "touchmove",
    function (e) {
      e.preventDefault();
      if (drag) applyDrag(cxy(e));
    },
    { passive: false },
  );
  cv.addEventListener("touchend", function () {
    if (drag) {
      drag = null;
      redraw(null);
      updatePreview();
    }
  });
  function redraw(li) {
    ctx.drawImage(im.cv, 0, 0, PW, PH);
    drawOvl(ctx, b, sc);
    if (li) drawLoupe(ctx, im.cv, li, sc, PW, PH);
  }
  redraw(null);
  updatePreview();
  return card;
}
function drawOvl(ctx, b, sc) {
  [
    [b.topH, "rgba(249,115,22,.95)"],
    [b.botH, "rgba(59,130,246,.95)"],
  ].forEach(function (pair) {
    var h = pair[0],
      col = pair[1];
    var cp0 = h[0].cp || { x: h[0].x + (h[1].x - h[0].x) * 0.33, y: h[0].y };
    var cp2 = h[2].cp || { x: h[2].x - (h[2].x - h[1].x) * 0.33, y: h[2].y };
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (var px = h[0].x; px <= h[2].x; px++) {
      var py = evalRimCurve(h, px) * sc;
      px === h[0].x ? ctx.moveTo(px * sc, py) : ctx.lineTo(px * sc, py);
    }
    ctx.stroke();
    ctx.strokeStyle = col.replace(".95", ".3");
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(h[0].x * sc, h[0].y * sc);
    ctx.lineTo(cp0.x * sc, cp0.y * sc);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(h[2].x * sc, h[2].y * sc);
    ctx.lineTo(cp2.x * sc, cp2.y * sc);
    ctx.stroke();
    ctx.setLineDash([]);
    h.forEach(function (p, i) {
      ctx.beginPath();
      ctx.arc(p.x * sc, p.y * sc, HR + 0.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,.3)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x * sc, p.y * sc, HR, 0, Math.PI * 2);
      ctx.fillStyle = i === 1 ? col : col.replace(".95", ".6");
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    [cp0, cp2].forEach(function (cp) {
      ctx.beginPath();
      ctx.arc(cp.x * sc, cp.y * sc, HR - 1, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,.15)";
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  });
}
function drawLoupe(ctx, srcCv, info, sc, PW, PH) {
  var hx = info.h[info.hi].x * sc,
    hy = info.h[info.hi].y * sc,
    lx = hx + LR + 18,
    ly = hy - LR - 18;
  if (lx + LR > PW) lx = hx - LR - 18;
  if (ly - LR < 0) ly = hy + LR + 18;
  lx = Math.max(LR, Math.min(PW - LR, lx));
  ly = Math.max(LR, Math.min(PH - LR, ly));
  var sr = LR / LZOOM;
  ctx.save();
  ctx.beginPath();
  ctx.arc(lx, ly, LR, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(
    srcCv,
    info.h[info.hi].x - sr,
    info.h[info.hi].y - sr,
    sr * 2,
    sr * 2,
    lx - LR,
    ly - LR,
    LR * 2,
    LR * 2,
  );
  ctx.strokeStyle = "rgba(255,255,255,.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(lx - 8, ly);
  ctx.lineTo(lx + 8, ly);
  ctx.moveTo(lx, ly - 8);
  ctx.lineTo(lx, ly + 8);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(lx, ly, LR, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,.5)";
  ctx.lineWidth = 2;
  ctx.stroke();
}
