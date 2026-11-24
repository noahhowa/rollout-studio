/* Translations (EN/ES) and language switching. */
"use strict";
/* ═══ I18N ═══ */
var lang = "en";
var T = {
  en: {
    steps: ["Upload", "Map", "Adjust", "Stitch", "Refine"],
    next: ["Map Rims \u2192", "Adjust Strips \u2192", "Start Stitching", "", ""],
    back: "\u2190 Back",
    about: "About",
    backToTool: "\u2190 Back to tool",
    dropTitle: "Drop photos or click to browse",
    dropSub: "2+ overlapping shots \u00B7 JPG, PNG, or .json session",
    addMin: "Add at least 2 photos",
    photo: "photo",
    photos: "photos",
    mapRims: "Map Rims",
    top: "Top",
    bottom: "Bottom",
    unwarpPreview: "Unwarp preview",
    resetRims: "Reset rims",
    snap: "Snap",
    adjustStrips: "Adjust Strips",
    feather: "Feather",
    smartCrop: "HF smart crop",
    preview: "Preview",
    strips: "strips",
    stitching: "Stitching\u2026",
    buildingStrips: "Building strips",
    localStitch: "Lining up photos in your browser",
    qualityLow: "Photos didn't line up well enough (overlaps disagree); using the stitching server",
    localDone: "Stitched in your browser: ",
    localFallback: "Couldn't line up the photos locally; using the stitching server",
    coverageGap: "Photos don't cover the full circle; the uncovered part is left out",
    uploadingServer: "Uploading to server",
    runningPS: "Running Pixel Stitch",
    downloadingResult: "Downloading result",
    cancel: "Cancel",
    done: "Done",
    cancelled: "Cancelled",
    failed: "Failed",
    processing: "Processing\u2026",
    batchDone: "\u2713 Batch done",
    refine: "Refine",
    straighten: "Straighten",
    optional: "Optional",
    horizontal: "Horizontal",
    vertical: "Vertical",
    revert: "Revert",
    rectify: "Rectify",
    applied: "\u2713 Applied",
    downloadPNG: "Download PNG",
    saveSession: "Save Session",
    modalDefault: "Are you sure?",
    modalCancel: "Cancel",
    modalContinue: "Continue",
    loadFailed: "Load failed: ",
    uploading: "Uploading ",
    stripsWord: " strips\u2026",
    callingPS: "Calling Pixel Stitch\u2026",
    result: "Result: ",
    batch: "Batch ",
    aboutDesc:
      'This tool transforms normal photographs of the sides of Maya vases into stitched Kerr-style rollout photos via a custom image processing pipeline. Built by <a href="https://noahhoward.co" target="_blank" rel="noopener">Noah Howard\u2009\u2197</a> and released as an open-source tool under a <a href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html" target="_blank" rel="noopener">GPLv2 license\u2009\u2197</a>.',
    howItWorks: "How It Works",
    badgeUser: "User",
    badgeLocal: "Local",
    badgeAPI: "API",
    hw1: "Upload \u22653 overlapping photos covering a contiguous portion of a cylindrical vessel. For the entire circumference, use at least 4 equally-spaced images.",
    hw2: "Fit parabolic rim arcs along the top and bottom edges of the vase in each image.",
    hw3: "Cylindrical unwarp via inverse mapping: for each output pixel, compute \u03B8 from horizontal position, map back to source via <code style=\"font-family:'SF Mono','Consolas','Menlo',monospace;font-size:.92em;background:#f0f0f0;padding:1px 5px;border-radius:3px;border:1px solid #e0e0e0\">sx\u2009=\u2009cx\u2009+\u2009r\u00B7sin(\u03B8)</code>, interpolate vertically between the two parabolas, and sample with bilinear interpolation.",
    hw4: "Vignette compensation: box-filter each column\u2019s luminance profile and normalize gain to the center-region mean, correcting for light falloff along the edges of the vase.",
    hw5: "Manually crop each strip to reduce excess overlap (which can produce ghosting artifacts during stitching). Smoothstep feather blends strip edges toward the mean RGB to further optimize for stitching.",
    hw6: "Feathered strips uploaded as JPGs \u2192 feature matching \u2192 homography estimation \u2192 seam blending. If there are more than 5, strips are batched iteratively. SSE streaming for progress.",
    hw7: "Polyline-guided rectification and distortion correction. The user places control points to define ground-truth horizontal and vertical lines along the stitched image.",
    hw8: "Per-column interpolation of each polyline \u2192 vertical/horizontal remap applied to remove distortion and correct for shearing introduced during the stitch process.",
    ytFallback: "\u25B6 Watch walkthrough on YouTube",
  },
  es: {
    steps: ["Subir", "Alinear", "Ajustar", "Combinar", "Mejorar"],
    next: ["Alinear bordes \u2192", "Ajustar tiras \u2192", "Combinar", "", ""],
    back: "\u2190 Atr\u00E1s",
    about: "Acerca de",
    backToTool: "\u2190 Volver a la herramienta",
    dropTitle: "Arrastre y suelte o haga clic para subir im\u00E1genes",
    dropSub: "2+ fotos superpuestas \u00B7 JPG, PNG o .json",
    addMin: "Agregue al menos 2 fotos",
    photo: "foto",
    photos: "fotos",
    mapRims: "Alinear bordes",
    top: "Superior",
    bottom: "Inferior",
    unwarpPreview: "Vista previa",
    resetRims: "Reiniciar bordes",
    snap: "Ajustar",
    adjustStrips: "Ajustar tiras",
    feather: "Difuminar bordes",
    smartCrop: "Recorte inteligente",
    preview: "Vista previa",
    strips: "tiras",
    stitching: "Combinando\u2026",
    buildingStrips: "Haciendo tiras",
    localStitch: "Alineando fotos en el navegador",
    qualityLow: "Las fotos no se alinearon bien (los solapes no coinciden); usando el servidor",
    localDone: "Unido en el navegador: ",
    localFallback: "No se pudieron alinear las fotos localmente; usando el servidor",
    coverageGap: "Las fotos no cubren todo el círculo; la parte sin cubrir se omite",
    uploadingServer: "Subiendo al servidor",
    runningPS: "Ejecutando Pixel Stitch",
    downloadingResult: "Descargando resultado",
    cancel: "Cancelar",
    done: "Listo",
    cancelled: "Cancelado",
    failed: "Error",
    processing: "Procesando\u2026",
    batchDone: "\u2713 Lote completado",
    refine: "Mejorar",
    straighten: "Enderezar",
    optional: "Opcional",
    horizontal: "Horizontal",
    vertical: "Vertical",
    revert: "Revertir",
    rectify: "Aplicar cambios",
    applied: "\u2713 Aplicado",
    downloadPNG: "Descargar PNG",
    saveSession: "Guardar sesi\u00F3n",
    modalDefault: "\u00BFEst\u00E1 seguro?",
    modalCancel: "Cancelar",
    modalContinue: "Continuar",
    loadFailed: "Error al cargar: ",
    uploading: "Subiendo ",
    stripsWord: " tiras\u2026",
    callingPS: "Ejecutando Pixel Stitch\u2026",
    result: "Resultado: ",
    batch: "Lote ",
    aboutDesc:
      'Esta herramienta transforma fotograf\u00EDas normales de los lados de vasos mayas en fotos desplegadas al estilo Kerr mediante un pipeline de procesamiento de im\u00E1genes personalizado. Creado por <a href="https://noahhoward.co" target="_blank" rel="noopener">Noah Howard\u2009\u2197</a> y publicado como herramienta de c\u00F3digo abierto bajo una <a href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html" target="_blank" rel="noopener">licencia GPLv2\u2009\u2197</a>.',
    howItWorks: "C\u00F3mo funciona",
    badgeUser: "Usuario",
    badgeLocal: "Local",
    badgeAPI: "API",
    hw1: "Sube \u22653 fotos superpuestas que cubran una porci\u00F3n contigua de un vaso cil\u00EDndrico. Para toda la circunferencia, usa al menos 4 im\u00E1genes con la misma separaci\u00F3n.",
    hw2: "Coloque arcos a lo largo de los bordes superior e inferior del vaso en cada imagen.",
    hw3: "Descomposici\u00F3n cil\u00EDndrica mediante mapeo inverso: para cada p\u00EDxel de salida, calcular \u03B8 desde la posici\u00F3n horizontal, mapear nuevamente a la fuente mediante <code style=\"font-family:'SF Mono','Consolas','Menlo',monospace;font-size:.92em;background:#f0f0f0;padding:1px 5px;border-radius:3px;border:1px solid #e0e0e0\">sx\u2009=\u2009cx\u2009+\u2009r\u00B7sin(\u03B8)</code>, interpolar verticalmente entre las dos par\u00E1bolas y muestrear con interpolaci\u00F3n bilineal.",
    hw4: "Compensaci\u00F3n de vi\u00F1eta: filtra el perfil de luminancia de cada columna y normaliza la ganancia a la media de la regi\u00F3n central, corrigiendo la ca\u00EDda de luz a lo largo de los bordes del vaso.",
    hw5: "Recorta manualmente cada tira para reducir la superposici\u00F3n excesiva (que puede producir im\u00E1genes dobles durante la uni\u00F3n). El suavizado suaviza los bordes de las tiras hacia el RGB medio para optimizar a\u00FAn m\u00E1s la uni\u00F3n.",
    hw6: "Tiras difuminadas cargadas como archivos JPG \u2192 coincidencia de caracter\u00EDsticas \u2192 estimaci\u00F3n de homograf\u00EDa \u2192 fusi\u00F3n de costuras. Si hay m\u00E1s de 5 tiras, se procesan iterativamente por lotes. Transmisi\u00F3n SSE para el progreso.",
    hw7: "Rectificaci\u00F3n y correcci\u00F3n de distorsi\u00F3n guiadas por polil\u00EDneas. El usuario coloca puntos de control para definir l\u00EDneas horizontales y verticales de referencia a lo largo de la imagen unida.",
    hw8: "Interpolaci\u00F3n por columna de cada polil\u00EDnea \u2192 reasignaci\u00F3n vertical/horizontal aplicada para eliminar la distorsi\u00F3n y corregir el corte introducido durante el proceso de costura.",
    ytFallback: "\u25B6 Ver tutorial en YouTube",
  },
};
function t(k) {
  return T[lang][k] || T.en[k] || k;
}
function setLang(l) {
  lang = l;
  document.querySelectorAll("#langToggle button").forEach(function (b) {
    b.classList.toggle("active", b.dataset.l === l);
  });
  document.getElementById("aboutBtn").textContent = t("about");
  document.getElementById("btnBack").textContent = t("back");
  document.documentElement.lang = l;
  if (showingAbout) {
    renderAbout();
  } else {
    renderStepper();
    var nb = document.getElementById("btnNext");
    nb.textContent = t("next")[cur] || "";
    if (cur === 0) {
      renderUpload();
      nb.disabled = imgs.length < 2;
      document.getElementById("hint").textContent = imgs.length > 0 && imgs.length < 2 ? t("addMin") : "";
    }
    if (cur === 1) renderMap();
    if (cur === 2) renderAdjust();
    if (cur === 4) renderRefine();
  }
}
document.getElementById("langToggle").onclick = function (e) {
  var b = e.target.closest("button");
  if (b && b.dataset.l) setLang(b.dataset.l);
};
