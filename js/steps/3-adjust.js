/* Step 3: crop/feather strips and preview. */
"use strict";
/* ═══ ADJUST ═══ */
function renderAdjust() {
  var el = document.getElementById("p2");
  el.innerHTML = "<h1>" + t("adjustStrips") + "</h1>";
  var card = document.createElement("div");
  card.className = "card card-pad";
  var sr = document.createElement("div");
  sr.className = "slider-row";
  sr.style.marginBottom = "14px";
  sr.innerHTML =
    "<label>" +
    t("feather") +
    '</label><input type="range" min="0" max="30" step="1" value="' +
    feather +
    '" id="fsl"><span class="val" id="fv">' +
    feather +
    "%</span>";
  card.appendChild(sr);
  var chk = document.createElement("div");
  chk.className = "chk-row";
  chk.innerHTML =
    '<input type="checkbox" id="autoOrderToggle"' + (autoOrderOn ? " checked" : "") + '><label for="autoOrderToggle">' + t("autoOrder") + "</label>";
  chk.querySelector("input").onchange = function () { autoOrderOn = this.checked; };
  card.appendChild(chk);
  var sep = document.createElement("div");
  sep.style.cssText = "height:1px;background:var(--border-lt);margin:14px 0";
  card.appendChild(sep);
  if (stripCache.length !== imgs.length) rebuildStripCache();
  var scroll = document.createElement("div");
  scroll.className = "strip-scroll";
  imgs.forEach(function (im, i) {
    scroll.appendChild(makeCropCard(im, i));
  });
  card.appendChild(scroll);
  el.appendChild(card);
  var prevBtn = document.createElement("button");
  prevBtn.className = "btn btn-outline";
  prevBtn.style.marginTop = "12px";
  prevBtn.textContent = t("preview");
  prevBtn.onclick = previewStrips;
  el.appendChild(prevBtn);
  var pw = document.createElement("div");
  pw.className = "preview-bar";
  pw.id = "prevWrap";
  pw.style.display = "none";
  el.appendChild(pw);
  var meta = document.createElement("div");
  meta.className = "meta";
  meta.id = "prevMeta";
  el.appendChild(meta);
  setTimeout(function () {
    var fsl = document.getElementById("fsl");
    if (fsl)
      fsl.oninput = function () {
        feather = +this.value;
        document.getElementById("fv").textContent = feather + "%";
      };
  }, 0);
}
function makeCropCard(im, idx) {
  var strip = stripCache[idx];
  if (!strip) return document.createElement("div");
  var card = document.createElement("div");
  card.className = "strip-card";
  var PW = 220,
    sc = PW / strip.width,
    PH = Math.max(40, Math.round(strip.height * sc));
  var cv = document.createElement("canvas");
  cv.width = PW;
  cv.height = PH;
  card.appendChild(cv);
  var foot = document.createElement("div");
  foot.className = "strip-foot";
  var lbl = document.createElement("span");
  lbl.textContent =
    idx +
    1 +
    " \u00B7 " +
    Math.round(im.cropL * 180) +
    "\u00B0\u2013" +
    Math.round(im.cropR * 180) +
    "\u00B0";
  foot.appendChild(lbl);
  var acts = document.createElement("div");
  acts.className = "acts";
  var ml = document.createElement("button");
  ml.className = "btn btn-ghost btn-icon btn-sm";
  ml.textContent = "\u25C0";
  ml.disabled = idx === 0;
  ml.onclick = function () {
    if (idx > 0) {
      var tt = imgs[idx];
      imgs[idx] = imgs[idx - 1];
      imgs[idx - 1] = tt;
      var tc = stripCache[idx];
      stripCache[idx] = stripCache[idx - 1];
      stripCache[idx - 1] = tc;
      renderAdjust();
    }
  };
  var mr = document.createElement("button");
  mr.className = "btn btn-ghost btn-icon btn-sm";
  mr.textContent = "\u25B6";
  mr.disabled = idx === imgs.length - 1;
  mr.onclick = function () {
    if (idx < imgs.length - 1) {
      var tt = imgs[idx];
      imgs[idx] = imgs[idx + 1];
      imgs[idx + 1] = tt;
      var tc = stripCache[idx];
      stripCache[idx] = stripCache[idx + 1];
      stripCache[idx + 1] = tc;
      renderAdjust();
    }
  };
  var rm = document.createElement("button");
  rm.className = "btn btn-ghost btn-icon btn-sm btn-danger";
  rm.textContent = "\u2715";
  rm.onclick = function () {
    imgs.splice(idx, 1);
    stripCache.splice(idx, 1);
    renderAdjust();
  };
  acts.appendChild(ml);
  acts.appendChild(mr);
  acts.appendChild(rm);
  foot.appendChild(acts);
  card.appendChild(foot);
  var ctx = cv.getContext("2d"),
    dragging = null;
  function draw() {
    ctx.drawImage(strip, 0, 0, PW, PH);
    var lx = Math.round(im.cropL * PW),
      rx = Math.round(im.cropR * PW);
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(0, 0, lx, PH);
    ctx.fillRect(rx, 0, PW - rx, PH);
    ctx.fillStyle = "rgba(249,115,22,.8)";
    ctx.fillRect(lx - 1.5, 0, 3, PH);
    ctx.fillStyle = "rgba(59,130,246,.8)";
    ctx.fillRect(rx - 1.5, 0, 3, PH);
  }
  function evX(e) {
    var rect = cv.getBoundingClientRect(),
      ev = e.touches ? e.touches[0] : e;
    return (ev.clientX - rect.left) * (PW / rect.width);
  }
  function hitE(mmx) {
    var lx = im.cropL * PW,
      rx = im.cropR * PW;
    if (Math.abs(mmx - lx) < 12) return "L";
    if (Math.abs(mmx - rx) < 12) return "R";
    return null;
  }
  cv.onmousedown = function (e) {
    e.preventDefault();
    dragging = hitE(evX(e));
  };
  cv.onmousemove = function (e) {
    e.preventDefault();
    var mmx = evX(e);
    if (dragging) {
      var v = Math.max(0, Math.min(1, mmx / PW));
      if (dragging === "L") im.cropL = Math.min(v, im.cropR - 0.05);
      else im.cropR = Math.max(v, im.cropL + 0.05);
      lbl.textContent =
        idx +
        1 +
        " \u00B7 " +
        Math.round(im.cropL * 180) +
        "\u00B0\u2013" +
        Math.round(im.cropR * 180) +
        "\u00B0";
      draw();
    } else cv.style.cursor = hitE(mmx) ? "ew-resize" : "default";
  };
  window.addEventListener("mouseup", function () {
    dragging = null;
  });
  cv.addEventListener(
    "touchstart",
    function (e) {
      e.preventDefault();
      dragging = hitE(evX(e));
    },
    { passive: false },
  );
  cv.addEventListener(
    "touchmove",
    function (e) {
      e.preventDefault();
      var mmx = evX(e);
      if (dragging) {
        var v = Math.max(0, Math.min(1, mmx / PW));
        if (dragging === "L") im.cropL = Math.min(v, im.cropR - 0.05);
        else im.cropR = Math.max(v, im.cropL + 0.05);
        lbl.textContent =
          idx +
          1 +
          " \u00B7 " +
          Math.round(im.cropL * 180) +
          "\u00B0\u2013" +
          Math.round(im.cropR * 180) +
          "\u00B0";
        draw();
      }
    },
    { passive: false },
  );
  cv.addEventListener("touchend", function () {
    dragging = null;
  });
  draw();
  return card;
}
function previewStrips() {
  if (!imgs.length) return;
  var strips = buildStrips(),
    gap = 6,
    maxH = 0;
  strips.forEach(function (s) {
    if (s.height > maxH) maxH = s.height;
  });
  var totalW =
    strips.reduce(function (s, c) {
      return s + c.width;
    }, 0) +
    gap * (strips.length - 1);
  var wrap = document.getElementById("prevWrap");
  wrap.style.display = "block";
  wrap.innerHTML = "";
  var cv = document.createElement("canvas");
  cv.width = totalW;
  cv.height = maxH;
  var ctx = cv.getContext("2d");
  ctx.fillStyle = "#f5f5f5";
  ctx.fillRect(0, 0, totalW, maxH);
  var cx = 0;
  for (var i = 0; i < strips.length; i++) {
    ctx.drawImage(strips[i], cx, Math.round((maxH - strips[i].height) / 2));
    cx += strips[i].width;
    if (i < strips.length - 1) {
      ctx.fillStyle = "#e0e0e0";
      ctx.fillRect(cx, 0, gap, maxH);
      cx += gap;
    }
  }
  wrap.appendChild(cv);
  document.getElementById("prevMeta").textContent =
    strips.length + " " + t("strips") + " \u00B7 " + totalW + " \u00D7 " + maxH + " px";
}
