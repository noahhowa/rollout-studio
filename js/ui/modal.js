/* Confirm dialog for destructive actions. */
"use strict";
/* ═══ MODAL ═══ */
function confirmDestructive(opts) {
  var ov = document.getElementById("dModal");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "dModal";
    ov.className = "modal-overlay";
    ov.innerHTML =
      '<div class="modal-card"><div class="modal-title" id="dmT"></div><div class="modal-body" id="dmB"></div><div class="modal-actions"><button class="btn btn-ghost" id="dmC"></button><button class="btn btn-dark" id="dmOk"></button></div></div>';
    document.body.appendChild(ov);
  }
  document.getElementById("dmT").textContent = opts.title || t("modalDefault");
  document.getElementById("dmB").textContent = opts.body || "";
  document.getElementById("dmOk").textContent = opts.confirmText || t("modalContinue");
  document.getElementById("dmC").textContent = t("modalCancel");
  function close() {
    ov.classList.remove("open");
  }
  document.getElementById("dmC").onclick = close;
  document.getElementById("dmOk").onclick = function () {
    close();
    if (opts.onConfirm) opts.onConfirm();
  };
  ov.onclick = function (e) {
    if (e.target === ov) close();
  };
  ov.classList.add("open");
}
// Dialog with several choices: {title, lines: [text], note, actions: [{label, cls, onClick}]}.
// Every button closes it; Escape and a click outside count as the first (cancel) action.
function showChoice(opts) {
  var ov = document.getElementById("cModal");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "cModal";
    ov.className = "modal-overlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.innerHTML = '<div class="modal-card"><div class="modal-title" id="cmT"></div><div class="modal-body" id="cmB"></div><div class="modal-actions" id="cmA"></div></div>';
    document.body.appendChild(ov);
  }
  document.getElementById("cmT").textContent = opts.title || "";
  var body = document.getElementById("cmB"), acts = document.getElementById("cmA");
  body.innerHTML = ""; acts.innerHTML = "";
  (opts.lines || []).forEach(function (l) { var d = document.createElement("p"); d.textContent = l; d.style.margin = "0 0 8px"; body.appendChild(d); });
  if (opts.note) { var n = document.createElement("p"); n.textContent = opts.note; n.style.margin = "0"; n.style.opacity = "0.8"; body.appendChild(n); }
  function close() { ov.classList.remove("open"); document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape") close(); }
  var last = null;
  opts.actions.forEach(function (a) {
    var b = document.createElement("button");
    b.className = "btn " + (a.cls || "btn-outline");
    b.textContent = a.label;
    b.onclick = function () { close(); if (a.onClick) a.onClick(); };
    acts.appendChild(b); last = b;
  });
  ov.onclick = function (e) { if (e.target === ov) close(); };
  document.addEventListener("keydown", onKey);
  ov.classList.add("open");
  if (last) last.focus();
}
