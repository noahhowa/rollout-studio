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
