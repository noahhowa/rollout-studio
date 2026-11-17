# Roadmap

## Where things stand

**Rim recognition** (`js/core/rim-detect.js`)
- `detectBounds`: background color = median of 8 border pixels; any pixel >35 away counts as object. Breaks on busy backgrounds, shadows, or an object touching the frame edge.
- `rimY`: scans down/up at 3 x-positions looking for **red pixels** (`isRed`). Only works if the rim is red (or a red marker is used); otherwise falls back to a fixed 12% of height.
- Each rim is a 3-point Bézier.
- `snapRimToEdge`: dynamic-programming seam through a Sobel + DoG edge map, regularized toward an ellipse fitted to the current curve. Solid idea, but it only refines; it can't recover from a bad start, and it picks the strongest horizontal edge, which is often a print line or shadow.

**Unwarp** (`js/core/unwarp.js`)
- Treats the camera as **orthographic**: output column θ samples `x = cx + r·sin θ` across a full 180°, and rows interpolate linearly between the two rim curves.
- That ignores perspective. A real camera at distance D sees only `2·acos(R/D)` of the cylinder (e.g. ~140° at D = 3R), so the outer columns are stretched and the strip edges are smeared.
- A tapered cup (top radius ≠ bottom radius) is a cone frustum, whose surface unrolls to an **arc**, not a rectangle. Unwarping it to a rectangle distorts artwork. Right now only the width is interpolated.

## Phase 1: measure before changing (do first)

Without ground truth, every "better detection" is a guess.

- [ ] **Synthetic test set**: a small three.js page that renders a textured cylinder or frustum at a known radius, camera distance, elevation and roll, and saves the image plus true rim ellipses and the true flat texture. Vary background, lighting and rim color.
- [ ] **Real golden set**: 10–20 real photo sets with hand-corrected rims, saved as session JSON (the app already exports this).
- [ ] **Metrics script**: mean rim error in pixels, and rollout error (SSIM against the true texture). Run it on every algorithm change.

## Phase 2: automatic rim recognition

A circle seen by a pinhole camera is **exactly an ellipse**, which is the key structure to exploit.

1. **Object silhouette without color assumptions.** In rough order of effort:
   - Better background model: sample the border band, use Lab color, then flood-fill/GrabCut-style refinement.
   - Two near-vertical **side lines** via edge detection + Hough. These give left/right edges directly, and their convergence gives camera tilt.
   - Optional ML: run Segment Anything (MobileSAM/EfficientSAM via `onnxruntime-web`, tens of MB, lazy-loaded) or a hosted model on the existing HF Space. One click on the object gives a clean mask.
2. **Rims as ellipses, not Béziers.** From the mask's top/bottom boundary plus edge points, fit a **5-parameter ellipse** with RANSAC + direct least squares (Fitzgibbon). The top rim's back half is usually visible too, which constrains the fit strongly. Keep the drag handles, but drag ellipse parameters.
3. **Joint constraints.** Both rims share an axis, and their minor/major ratios are consistent with one camera elevation. Fitting them jointly removes most of the remaining outliers.
4. **Confidence score per photo**: inlier ratio and residual. Flag low-confidence photos in the Map step so users check those and skip the rest.
5. **Cross-photo consistency.** All photos of one object usually share a camera setup, so a median of the ellipse parameters is a strong prior for outlier photos.

## Phase 3: automatic depth/perspective correction

Replace the orthographic sampler with a camera model.

1. **Estimate camera pose from the rims.** The ellipse aspect ratio gives the elevation angle. Ellipse size and the taper of the side lines give distance D/R. EXIF focal length, when present, pins down the field of view.
2. **Projective unwarp.** For each output (θ, h), take the 3D surface point `(R cos θ, h, R sin θ)`, project it through the estimated pinhole camera, and sample bilinearly (the existing `bil`). Only `|θ| < acos(R/D)` is visible, which gives each strip's true angular extent automatically.
3. **Frustum mode.** If top and bottom radii differ, unroll to an annular sector (true flat pattern) with an option to straighten it into a rectangle afterwards.
4. **Lens distortion** (later): a one-parameter radial model, estimated from the requirement that the side lines be straight.

## Phase 4: stitching

- With a calibrated unwarp, each strip covers a known angle, so the rotation between photos can be estimated by feature matching (ORB via OpenCV.js) **in unwarped space**, where it's a pure horizontal shift. Then blend locally. This makes the HF Space optional (it's currently a hard dependency and a single point of failure).

## Phase 5: engineering cleanup (as needed)

- Move heavy pixel loops (edge maps, DP, unwarp) into a **Web Worker** so the UI doesn't freeze on large photos.
- Convert to native ES modules (`<script type="module">`, still no build step) once globals start getting in the way.
- GA events: `step_reached`, `stitch_success`/`stitch_error`, `rims_adjusted_manually` (the last one doubles as a measure of how good auto-detection is in the wild).

## Suggested order

Phase 1 → Phase 2 steps 1–2 → Phase 3 steps 1–2 → measure → rest.
