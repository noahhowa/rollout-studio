/* Stepper header and page navigation. */
"use strict";
/* ═══ STEPPER + NAV ═══ */
function renderStepper() {
  var el = document.getElementById("stepper");
  el.innerHTML = "";
  var steps = t("steps");
  steps.forEach(function (s, i) {
    var done = i < cur,
      active = i === cur,
      locked = i > mx;
    var d = document.createElement("div");
    d.className =
      "st" + (done ? " done" : "") + (active ? " active" : "") + (!locked && i !== cur ? " clickable" : "");
    d.innerHTML =
      '<div class="st-top"><div class="st-circle"><div class="dot"></div></div>' +
      (i < steps.length - 1 ? '<div class="st-line"></div>' : "") +
      '</div><div class="st-label">' +
      s +
      "</div>";
    if (!locked && i !== cur)
      d.onclick = function () {
        go(i);
      };
    el.appendChild(d);
  });
}
function go(n) {
  if (n < 0 || n > 4 || stitchRunning) return;
  if (showingAbout) {
    showingAbout = false;
    document.getElementById("pAbout").classList.remove("active");
  }
  document.getElementById("stepper").style.opacity = "";
  document.getElementById("stepper").style.pointerEvents = "";
  cur = n;
  if (n > mx) mx = n;
  document.querySelectorAll(".page").forEach(function (p, i) {
    p.classList.toggle("active", i === n);
  });
  renderStepper();
  var back = document.getElementById("btnBack");
  back.style.visibility = n > 0 && n !== 3 ? "visible" : "hidden";
  back.textContent = t("back");
  var nb = document.getElementById("btnNext"),
    hint = document.getElementById("hint");
  nb.textContent = t("next")[n] || "";
  nb.disabled = false;
  nb.style.display = n >= 3 ? "none" : "";
  hint.textContent = "";
  document.getElementById("bottombar").style.display = n === 4 ? "none" : "flex";
  if (n === 0) {
    renderUpload();
    nb.disabled = imgs.length < 2;
    hint.textContent = imgs.length > 0 && imgs.length < 2 ? t("addMin") : "";
  }
  if (n === 1) renderMap();
  if (n === 2) renderAdjust();
  if (n === 3) runStitch();
  if (n === 4) renderRefine();
}
document.getElementById("btnNext").onclick = function () {
  go(cur + 1);
};
document.getElementById("btnBack").onclick = function () {
  go(cur - 1);
};
