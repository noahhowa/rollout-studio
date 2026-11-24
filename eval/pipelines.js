/* Rim-detection pipelines under evaluation. Each takes a canvas and returns the app's
   rim structure b = {cx, r, yTop, yBot, xLeft, xRight, topH, botH}.
   To try a new detector: add an entry here; it shows up as a new row in the report. */
"use strict";
var PIPELINES = {
  // The original detector (red-pixel scan), kept as a reference.
  baseline: function (cv) {
    var b = detectBounds(cv);
    b.topH = initH(cv, b, "top");
    b.botH = initH(cv, b, "bot");
    return b;
  },
  // Original + pressing "Snap" in the Map step.
  "baseline+snap": function (cv) {
    var b = PIPELINES.baseline(cv), im = { cv: cv, b: b };
    snapRimToEdge(im, "top");
    snapRimToEdge(im, "bot");
    return b;
  },
  // Silhouette + ellipse fit, without the two-class mask refinement
  "A silhouette": function (cv) { return RIM2.detect(cv, { twoClass: false }); },
  // Current app default: A + two-class (vessel colours vs background/shadow) mask refinement
  "A2 two-class": function (cv) { return RIM2.detect(cv); },
  // A2 + Snap
  "A+snap": function (cv) {
    var b = RIM2.detect(cv), im = { cv: cv, b: b };
    snapRimToEdge(im, "top");
    snapRimToEdge(im, "bot");
    return b;
  },
};
