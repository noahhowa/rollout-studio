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
