/* Rim-detection pipelines under evaluation. Each takes a canvas and returns the app's
   rim structure b = {cx, r, yTop, yBot, xLeft, xRight, topH, botH}.
   To try a new detector: add an entry here; it shows up as a new row in the report. */
"use strict";
var PIPELINES = {
  // What the app does on upload.
  baseline: function (cv) {
    var b = detectBounds(cv);
    b.topH = initH(cv, b, "top");
    b.botH = initH(cv, b, "bot");
    return b;
  },
  // Upload + pressing "Snap" in the Map step.
  "baseline+snap": function (cv) {
    var b = PIPELINES.baseline(cv), im = { cv: cv, b: b };
    snapRimToEdge(im, "top");
    snapRimToEdge(im, "bot");
    return b;
  },
};
