/* Step 1: upload photos, save/load session JSON. */
"use strict";
/* ═══ UPLOAD ═══ */
var fi = document.getElementById("fi");
fi.onchange = function (e) {
  doFiles(e.target.files);
};
// Photos keep the order they were selected in. Files load asynchronously and finish in any order
// (large files later), so each gets a sequence number and is inserted in sequence, not on arrival.
var uploadSeq = 0;
function doFiles(fs) {
  Array.from(fs).forEach(function (f) {
    if (/\.json$/i.test(f.name)) {
      loadSession(f);
      return;
    }
    var seq = uploadSeq++, r = new FileReader();
    r.onload = function (e) {
      loadSrc(e.target.result, seq);
    };
    r.readAsDataURL(f);
  });
}
function loadSrc(src, seq) {
  var im = new Image();
  im.onload = function () {
    var sc = Math.min(1, 1200 / im.width),
      c = document.createElement("canvas");
    c.width = Math.round(im.width * sc);
    c.height = Math.round(im.height * sc);
    c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
    // Silhouette + ellipse rim detection; fall back to the original red-pixel scan if it fails.
    var b = null;
    try { b = RIM2.detect(c); } catch (e) { b = null; }
    if (!b) {
      b = detectBounds(c);
      b.topH = initH(c, b, "top");
      b.botH = initH(c, b, "bot");
    }
    var entry = { cv: c, b: b, cropL: 0.14, cropR: 0.86, seq: seq == null ? uploadSeq++ : seq }, at = imgs.length;
    while (at > 0 && imgs[at - 1].seq != null && imgs[at - 1].seq > entry.seq) at--;
    imgs.splice(at, 0, entry);
    stripCache = [];
    renderUpload();
    document.getElementById("btnNext").disabled = imgs.length < 2;
    document.getElementById("hint").textContent = imgs.length > 0 && imgs.length < 2 ? t("addMin") : "";
  };
  im.src = src;
}
function saveSession() {
  if (!imgs.length) return;
  var d = {
    images: imgs.map(function (im) {
      return {
        b: {
          cx: im.b.cx,
          r: im.b.r,
          yTop: im.b.yTop,
          yBot: im.b.yBot,
          xLeft: im.b.xLeft,
          xRight: im.b.xRight,
          topH: im.b.topH.map(function (h) {
            var o = { x: h.x, y: h.y };
            if (h.cp) o.cp = { x: h.cp.x, y: h.cp.y };
            return o;
          }),
          botH: im.b.botH.map(function (h) {
            var o = { x: h.x, y: h.y };
            if (h.cp) o.cp = { x: h.cp.x, y: h.cp.y };
            return o;
          }),
        },
        cropL: im.cropL,
        cropR: im.cropR,
        img: im.cv.toDataURL("image/jpeg", 0.92),
      };
    }),
  };
  var a = document.createElement("a");
  a.href = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(d));
  a.download = "vase_session.json";
  a.click();
}
function loadSession(file) {
  var r = new FileReader();
  r.onload = function (e) {
    try {
      var s = JSON.parse(e.target.result);
      imgs = [];
      var ent = s.images || s;
      var i = 0;
      (function nx() {
        if (i >= ent.length) {
          stripCache = [];
          renderUpload();
          document.getElementById("btnNext").disabled = imgs.length < 2;
          return;
        }
        var en = ent[i++],
          im = new Image();
        im.onload = function () {
          var c = document.createElement("canvas");
          c.width = im.width;
          c.height = im.height;
          c.getContext("2d").drawImage(im, 0, 0);
          var b = en.b;
          b.topH = b.topH.map(function (h) {
            var o = { x: h.x, y: h.y };
            if (h.cp) o.cp = { x: h.cp.x, y: h.cp.y };
            return o;
          });
          b.botH = b.botH.map(function (h) {
            var o = { x: h.x, y: h.y };
            if (h.cp) o.cp = { x: h.cp.x, y: h.cp.y };
            return o;
          });
          if (!b.topH[0].cp || !b.topH[2].cp) {
            var sp0 = b.topH[2].x - b.topH[0].x;
            b.topH[0].cp = { x: b.topH[0].x + sp0 * 0.25, y: b.topH[0].y };
            b.topH[2].cp = { x: b.topH[2].x - sp0 * 0.25, y: b.topH[2].y };
          }
          if (!b.botH[0].cp || !b.botH[2].cp) {
            var sp1 = b.botH[2].x - b.botH[0].x;
            b.botH[0].cp = { x: b.botH[0].x + sp1 * 0.25, y: b.botH[0].y };
            b.botH[2].cp = { x: b.botH[2].x - sp1 * 0.25, y: b.botH[2].y };
          }
          imgs.push({
            cv: c,
            b: b,
            cropL: en.cropL != null ? en.cropL : 0.14,
            cropR: en.cropR != null ? en.cropR : 0.86,
          });
          nx();
        };
        im.src = en.img;
      })();
    } catch (err) {
      alert(t("loadFailed") + err.message);
    }
  };
  r.readAsText(file);
}
function renderUpload() {
  var el = document.getElementById("p0");
  el.innerHTML = "<h1>" + t("steps")[0] + "</h1>";
  var dz = document.createElement("div");
  dz.className = "dropzone";
  dz.innerHTML =
    '<div class="dz-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg></div><div class="dz-title">' +
    t("dropTitle") +
    '</div><div class="dz-sub">' +
    t("dropSub") +
    "</div>";
  dz.onclick = function () {
    fi.click();
  };
  dz.ondragover = function (e) {
    e.preventDefault();
    dz.classList.add("over");
  };
  dz.ondragleave = function () {
    dz.classList.remove("over");
  };
  dz.ondrop = function (e) {
    e.preventDefault();
    dz.classList.remove("over");
    doFiles(e.dataTransfer.files);
  };
  el.appendChild(dz);
  if (imgs.length) {
    var grid = document.createElement("div");
    grid.className = "thumb-grid";
    imgs.forEach(function (im, i) {
      var th = document.createElement("div");
      th.className = "thumb";
      var img = document.createElement("img");
      img.src = im.cv.toDataURL("image/jpeg", 0.5);
      th.appendChild(img);
      th.innerHTML +=
        '<div class="num">' + (i + 1) + '</div><button class="rm" data-i="' + i + '">\u2715</button>';
      grid.appendChild(th);
    });
    el.appendChild(grid);
    grid.querySelectorAll(".rm").forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        imgs.splice(+this.dataset.i, 1);
        stripCache = [];
        renderUpload();
        document.getElementById("btnNext").disabled = imgs.length < 2;
      };
    });
    var ct = document.createElement("div");
    ct.className = "count";
    ct.textContent = imgs.length + " " + (imgs.length > 1 ? t("photos") : t("photo"));
    el.appendChild(ct);
  }
}
