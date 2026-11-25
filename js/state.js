/* Config constants and shared app state. */
"use strict";
var LZOOM = 2,
  LR = 40,
  HR = 5;
var HF = "https://noahhowa-image-stitch-fork.hf.space";
var imgs = [],
  stripCache = [],
  rCanvas = null,
  rawHFCanvas = null;
var cur = 0,
  mx = 0,
  feather = 12;
var topLine = [],
  botLine = [],
  leftLine = [],
  rightLine = [];
var refineMode = "h",
  activeLine = "top",
  dragIdx = -1,
  rectSc = 1;
var originalHFCanvas = null;
var stitchRunning = false,
  stitchAbort = null;
var showingAbout = false,
  returnPage = 0;
function med(a) {
  var s = a.slice().sort(function (x, y) {
    return x - y;
  });
  return s[s.length >> 1];
}
// Adjust auto-sort by overlap: done once per set of photos (key = sorted upload seqs).
var autoSort = { key: null, order: null, prev: null, checking: false };
// Bounded vertical overlap correction before stitching (Adjust step checkbox, experimental).
// Off by default; declined fits fall back to the original strips. Last result in overlapWarpReport.
var overlapWarpOn = false,
  overlapWarpReport = null;
// Merge strips in the browser with seams instead of the Hugging Face stitcher (Adjust checkbox,
// beta). Off by default; if the merge can't place every photo, Stitch falls back to the server.
var seamMergeOn = false;
