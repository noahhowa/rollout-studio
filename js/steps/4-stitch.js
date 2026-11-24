/* Step 4: send strips to the Hugging Face stitching space. */
"use strict";
/* ═══ STITCH ═══ */
function cvToBlob(cv, q) {
  return new Promise(function (r) {
    cv.toBlob(
      function (b) {
        r(b);
      },
      "image/jpeg",
      q || 0.92,
    );
  });
}
async function hfUpload(canvases) {
  var boundary = "----FB" + Date.now().toString(36),
    parts = [];
  for (var i = 0; i < canvases.length; i++) {
    var blob = await cvToBlob(canvases[i], 0.92),
      ab = await blob.arrayBuffer();
    parts.push(
      new TextEncoder().encode(
        "--" +
          boundary +
          '\r\nContent-Disposition: form-data; name="files"; filename="strip_' +
          i +
          '.jpg"\r\nContent-Type: image/jpeg\r\n\r\n',
      ),
    );
    parts.push(new Uint8Array(ab));
    parts.push(new TextEncoder().encode("\r\n"));
  }
  parts.push(new TextEncoder().encode("--" + boundary + "--\r\n"));
  var tLen = 0;
  for (var p = 0; p < parts.length; p++) tLen += parts[p].byteLength;
  var body = new Uint8Array(tLen),
    off = 0;
  for (var p = 0; p < parts.length; p++) {
    body.set(parts[p], off);
    off += parts[p].byteLength;
  }
  var opts = {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=" + boundary },
    body: body,
  };
  if (stitchAbort) opts.signal = stitchAbort.signal;
  var resp = await fetch(HF + "/gradio_api/upload?upload_id=" + Date.now().toString(36), opts);
  if (!resp.ok) throw new Error("Upload failed: " + resp.status);
  return await resp.json();
}
function mkIO(p) {
  return {
    path: p,
    url: null,
    size: null,
    orig_name: "strip.jpg",
    mime_type: "image/jpeg",
    is_stream: false,
    meta: {},
  };
}
async function hfCall(paths, doCrop) {
  var data = [];
  for (var i = 0; i < 5; i++) data.push(i < paths.length ? mkIO(paths[i]) : null);
  // The Space's process_images endpoint takes exactly five images. It used to take a sixth
  // "smart crop" flag; sending it now makes Gradio fail with a bare "API: null" error.
  var resp = await fetch(HF + "/gradio_api/call/process_images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: data }),
    signal: stitchAbort ? stitchAbort.signal : undefined,
  });
  if (!resp.ok) throw new Error("API submit failed: " + resp.status);
  var job = await resp.json();
  logMsg("Job: " + job.event_id);
  var sse = await fetch(
    HF + "/gradio_api/call/process_images/" + job.event_id,
    stitchAbort ? { signal: stitchAbort.signal } : {},
  );
  if (!sse.ok) throw new Error("SSE failed: " + sse.status);
  var rd = sse.body.getReader(),
    dc = new TextDecoder(),
    buf = "";
  while (true) {
    var ch = await rd.read();
    if (ch.done) break;
    buf += dc.decode(ch.value, { stream: true });
    var cm = buf.match(/event:\s*complete\ndata:\s*(.+)/);
    if (cm) {
      try {
        rd.cancel();
      } catch (e) {}
      return JSON.parse(cm[1])[0];
    }
    var em = buf.match(/event:\s*error\ndata:\s*(.+)/);
    if (em) {
      try {
        rd.cancel();
      } catch (e) {}
      throw new Error("API: " + em[1].substring(0, 200));
    }
    if (buf.includes("event: heartbeat")) logMsg(t("processing"));
  }
  throw new Error("SSE ended without result");
}
async function loadResult(obj) {
  var url = obj.url
    ? obj.url.startsWith("/")
      ? HF + obj.url
      : obj.url
    : HF + "/gradio_api/file=" + obj.path;
  var resp = await fetch(url);
  if (!resp.ok) throw new Error("Load failed: " + resp.status);
  var blob = await resp.blob(),
    u = URL.createObjectURL(blob);
  return new Promise(function (res, rej) {
    var im = new Image();
    im.onload = function () {
      var cv = document.createElement("canvas");
      cv.width = im.width;
      cv.height = im.height;
      cv.getContext("2d").drawImage(im, 0, 0);
      URL.revokeObjectURL(u);
      res(cv);
    };
    im.onerror = function () {
      URL.revokeObjectURL(u);
      rej(new Error("Image load failed"));
    };
    im.src = u;
  });
}
async function stitchBatch(canvases) {
  logMsg(t("uploading") + canvases.length + t("stripsWord"));
  var paths = await hfUpload(canvases);
  logMsg(t("callingPS"));
  var ct = document.getElementById("cropToggle"),
    doCrop = ct ? ct.checked : true;
  var r = await hfCall(paths, doCrop);
  logMsg(t("batchDone"));
  return await loadResult(r);
}
var logEl = null;
function logMsg(m) {
  if (logEl) {
    logEl.style.display = "block";
    logEl.textContent += m + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  }
}
function setProgress(pct) {
  var f = document.getElementById("pf");
  if (f) f.style.width = pct + "%";
}
function setStepState(idx, state) {
  var steps = document.querySelectorAll("#stitchSteps .p-step");
  if (steps[idx]) steps[idx].className = "p-step " + state;
}
/* Auto-sort: the stitching server needs photos in left-to-right order around the vessel and
   fails otherwise. Match the photos pairwise (js/core/registration.js), solve their angles, and
   order them by angle, starting just after the largest uncovered gap. Returns an index order, or
   null if the photos can't be related (then the upload order is kept). */
function autoOrder() {
  if (typeof ROLLREGISTER === "undefined" || imgs.length < 3) return null;
  var inputs = imgs.map(function (im) { return { cv: im.cv, b: im.b, cropL: im.cropL, cropR: im.cropR }; });
  var reg = ROLLREGISTER.estimate(inputs);
  if (!reg.connected) return null;
  var a = reg.rotations.map(function (r, i) { return { i: i, r: ((r % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) }; })
    .sort(function (p, q) { return p.r - q.r; });
  var gapAt = 0, gap = -1;
  for (var k = 0; k < a.length; k++) { // gap after a[k]
    var g = (k + 1 < a.length ? a[k + 1].r : a[0].r + 2 * Math.PI) - a[k].r;
    if (g > gap) { gap = g; gapAt = (k + 1) % a.length; }
  }
  var order = [];
  for (var m = 0; m < a.length; m++) order.push(a[(gapAt + m) % a.length].i);
  return order;
}

/* In-browser stitching: estimate each photo's camera from its rims, register rotations from
   overlapping detail, and blend on the cylinder (js/core/camera.js, js/core/registration.js).
   Returns a canvas, or null when the photos can't be lined up reliably (caller falls back to the
   server). Uses each photo's crop from the Adjust step and the feather setting. */
function localStitch() {
  // Experimental: off by default until real-photo registration is reliable. Enable with ?local=1.
  if (!/[?&]local=1\b/.test(location.search)) return null;
  if (typeof ROLLREGISTER === "undefined" || imgs.length < 2) return null;
  var inputs = imgs.map(function (im) { return { cv: im.cv, b: im.b, cropL: im.cropL, cropR: im.cropR }; });
  var t0 = performance.now(), reg = ROLLREGISTER.estimate(inputs);
  logMsg(t("localStitch") + ": " + (reg.connected ? "ok" : "not connected") + " (" + Math.round(performance.now() - t0) + " ms)");
  if (!reg.connected) return null;
  var strips = imgs.map(function (im, i) {
    return ROLLCAMERA.flatten(im.cv, reg.cameras[i], hGeom(im.b).r, { bounds: im.b, rectify: true });
  });
  var out = ROLLREGISTER.compose(inputs, reg, strips, { feather: feather / 100 });
  if (!out) return null;
  if (out.span < 2 * Math.PI - 0.01) logMsg(t("coverageGap") + " (" + Math.round((out.span * 180) / Math.PI) + "\u00B0)");
  return out.canvas;
}
function nextFrame() { return new Promise(function (r) { setTimeout(r, 30); }); }

async function runStitch() {
  if (imgs.length < 2) return;
  stitchRunning = true;
  stitchAbort = new AbortController();
  var el = document.getElementById("p3");
  el.innerHTML =
    '<div class="card"><div class="stitch-center"><div class="spinner" id="sp"></div><div style="font-size:.95em;font-weight:500" id="stTitle">' +
    t("stitching") +
    '</div><div class="pbar"><div class="pbar-fill" id="pf"></div></div><div class="p-steps" id="stitchSteps"><div class="p-step active"><div class="p-dot"></div>' +
    t("buildingStrips") +
    '</div><div class="p-step"><div class="p-dot"></div>' +
    t("uploadingServer") +
    '</div><div class="p-step"><div class="p-dot"></div>' +
    t("runningPS") +
    '</div><div class="p-step"><div class="p-dot"></div>' +
    t("downloadingResult") +
    '</div></div><button class="btn btn-outline btn-sm" id="btnAbort" style="margin-top:16px">' +
    t("cancel") +
    '</button></div></div><div class="stitch-log" id="stitchLog"></div>';
  logEl = document.getElementById("stitchLog");
  document.getElementById("btnAbort").onclick = function () {
    if (stitchAbort) {
      stitchAbort.abort();
      stitchAbort = null;
    }
    logMsg(t("cancelled"));
    document.getElementById("stTitle").textContent = t("cancelled");
    document.getElementById("sp").style.display = "none";
    this.disabled = true;
    stitchRunning = false;
    document.getElementById("btnBack").style.visibility = "visible";
  };
  try {
    setStepState(0, "p-step active");
    setProgress(5);
    var strips = buildStrips(),
      N = strips.length;
    await nextFrame();
    var order = null;
    try { order = autoOrder(); } catch (e) { order = null; }
    if (order && order.some(function (v, k) { return v !== k; })) {
      strips = order.map(function (i) { return strips[i]; });
      logMsg(t("autoSorted") + order.map(function (i) { return i + 1; }).join(", "));
    }
    logMsg(N + " " + t("strips") + " (" + strips[0].width + "\u00D7" + strips[0].height + "px)");
    setStepState(0, "p-step done");
    setProgress(15);
    await nextFrame(); // let the progress UI paint before the synchronous local solve
    var result = null;
    var tryLocal = /[?&]local=1\b/.test(location.search);
    try { result = localStitch(); } catch (e) { logMsg("\u2717 local: " + e.message); result = null; }
    if (result) {
      logMsg(t("localDone") + result.width + "\u00D7" + result.height + "px");
      var ps = document.querySelectorAll("#stitchSteps .p-step"); // relabel: nothing was uploaded
      if (ps[1]) ps[1].lastChild.textContent = t("localStitch");
      if (ps[2]) ps[2].style.display = "none";
      setStepState(1, "p-step done");
      setStepState(2, "p-step done");
    } else {
      if (!stitchRunning) return; // cancelled meanwhile
      if (tryLocal) logMsg(t("localFallback"));
      setStepState(1, "p-step active");
    }
    if (result) {
      // local result ready; skip the server
    } else if (N <= 5) {
      var b = strips.slice();
      while (b.length < 3) b.push(b[b.length - 1]);
      result = await stitchBatch(b);
      setProgress(70);
    } else {
      var fn = Math.min(5, N);
      result = await stitchBatch(strips.slice(0, fn));
      setProgress(30);
      var done = fn,
        bn = 2;
      while (done < N) {
        var tk = Math.min(N - done, 4);
        if (tk < 2) tk = 2;
        var batch = [result];
        for (var i = 0; i < tk; i++) batch.push(strips[(done + i) % N]);
        logMsg(t("batch") + bn);
        result = await stitchBatch(batch);
        done += tk;
        bn++;
        setProgress(30 + Math.round((40 * done) / N));
      }
    }
    setStepState(1, "p-step done");
    setStepState(2, "p-step done");
    setStepState(3, "p-step active");
    setProgress(85);
    logMsg(t("result") + result.width + "\u00D7" + result.height + "px");
    setStepState(3, "p-step done");
    setProgress(100);
    document.getElementById("stTitle").textContent = t("done");
    document.getElementById("sp").outerHTML = '<div class="check-circle">\u2713</div>';
    rawHFCanvas = result;
    rCanvas = result;
    originalHFCanvas = result;
    topLine = [];
    botLine = [];
    leftLine = [];
    rightLine = [];
    stitchRunning = false;
    stitchAbort = null;
    setTimeout(function () {
      mx = 4;
      go(4);
    }, 600);
  } catch (err) {
    if (err.name === "AbortError") return;
    logMsg("\u2717 " + err.message);
    document.getElementById("stTitle").textContent = t("failed");
    document.getElementById("sp").style.display = "none";
    var ab = document.getElementById("btnAbort");
    if (ab) ab.disabled = true;
    stitchRunning = false;
    stitchAbort = null;
    document.getElementById("btnBack").style.visibility = "visible";
  }
}
