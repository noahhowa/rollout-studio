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

- [x] **Synthetic test set**: `eval/synth.js` ray-traces a textured cylinder at a known distance and elevation; it gives exact rims and texture.
- [x] **Real sets**: `test-sets/` (5 sets, 2 with published rollouts). Still to do: hand-corrected rims as session JSON, so real photos can be scored too.
- [x] **Metrics + visual report**: `node scripts/eval.js` (see `eval/README.md`).

Baseline (6 synthetic scenes, mean):

| pipeline | top rim err %H | bottom rim err %H | angle err 0–30° | 30–60° | 60–90° |
|---|---|---|---|---|---|
| baseline (auto on upload) | 8.6 | 5.6 | 16.6 | 16.8 | 17.5 |
| baseline + Snap | 7.1 | 4.3 | 13.0 | 17.8 | 24.3 |
| oracle (perfect rims, current unwarp) | 0 | 0 | 13.3 | 12.7 | 15.2 |

On real photos the red-pixel rim scan often fails outright (e.g. the Met set, where the rims leave the image). Targets: rim error < 1% H (Phase 2), oracle angle error < 2° (Phase 3).

## Status / handoff (latest)

- App default rim detector: `RIM2.detect` (A2) in `js/core/rim-detect-v2.js`; the old one is the fallback in `js/steps/1-upload.js`.
- Measure any change with `node scripts/eval.js` (needs `python3 scripts/fetch_test_sets.py` once). Use `--only "A2 two-class,..."` to keep the report readable; check real photos visually, since synthetic floor shadows are harsher than real ones.
- Next steps: Phase 2 failures 2–4 below, then Phase 3 (perspective-correct unwarp using the fitted ellipses `b.topE`/`b.botE`, with `s` = top-rim curve direction). The oracle row's 12–15° error is the target to remove.

## Phase 2: automatic rim recognition

### Earlier real-photo scores (hand labels, `test-sets/labels.json`, 21 scored photos in 9 sets)

| detector | top rim %H | bottom rim %H | rim ends, top % | rim ends, bottom % |
|---|---|---|---|---|
| original | 4.6 | 5.6 | 25 | 30 |
| A2 + "camera above" (original fit) | **1.1** | **1.2** | **2.3** | **1.6** |

The perspective-based camera above/below guess was removed: on real photos it scored 3.9% top vs 1.1% for always assuming "above". Label more photos at `eval/label.html` (Met sets need their photos saved by hand to be scored).

### Top-rim refinement on labelled photos

The default now recovers clipped ends on nearly flat top rims from the median of several mask rows just below the lip. It then checks for a coherent front edge at the original photo resolution. The edge search stays below the ellipse centre and close to the mask fit. It blends an accepted fit halfway with the silhouette estimate to limit shifts toward painted bands.

Playwright Chromium results on 11 labelled photos from five LACMA and pca4sale sets and nine synthetic scenes. The Met image server returned blocking pages for all 18 labelled Met photos, including the 10 from `met-310364`. The synthetic harness used its procedural texture fallback because the Met rollout image was also unavailable.

| detector | real top %H | real bottom %H | real top ends %W | real bottom ends %W | synthetic top %H | synthetic bottom %H |
|---|---:|---:|---:|---:|---:|---:|
| A2 original fit | 0.84 | 1.54 | 1.46 | 1.66 | 3.23 | 5.51 |
| **A2 two-class (new default)** | **0.67** | **1.54** | **0.98** | **1.66** | **3.22** | **5.51** |

Run `node scripts/eval.js --only "A2 original fit,A2 two-class"` to reproduce the comparison. The evaluator gives each pipeline a fresh canvas so Chrome's pixel-read heuristics cannot change the coarse resize between variants. Chrome and Playwright's bundled Chromium produced slightly different baseline masks on this machine. The exploratory scores below use the same installed Chrome build throughout.

| trial | real top %H | real bottom %H | real top ends %W | real bottom ends %W | synthetic top %H | synthetic bottom %H | finding |
|---|---:|---:|---:|---:|---:|---:|---|
| A2 original fit | 0.92 | 1.52 | 1.71 | 1.59 | 3.27 | 6.08 | Comparison baseline |
| 1. Extrapolate ends from strong side gradients | 0.93 | 1.52 | 2.02 | 1.80 | 3.26 | 6.07 | Outer wall edges often fell outside the labelled ends |
| 2. Refit the two outer arcs to nearby gradients | 0.68 | 1.58 | 1.71 | 1.59 | 3.36 | 6.00 | Top improved, bottom worsened on real photos |
| 3. Blend a local fit to the top front edge | 0.68 | 1.52 | 1.71 | 1.59 | 3.37 | 6.08 | Improved the top curve with the existing width |
| 4. Recover flat-rim ends from nearby mask rows | 0.92 | 1.52 | 1.01 | 1.59 | 3.27 | 6.08 | Recovered the clipped pca4sale ends |
| 5. Search for a bottom edge leading into backdrop colour | 0.92 | 1.52 | 1.71 | 1.59 | 3.27 | 6.08 | No candidate met the contrast and support requirements |
| 6. Combine flat-rim width recovery and front-edge fitting | 0.75 | 1.52 | 1.01 | 1.59 | 3.37 | 6.08 | Kept with the below-centre guard, which resolved a back-edge match in synthetic `far-flat` |
| 7. Estimate bottom width from lower shoulder rows | 0.92 | 1.52 | 1.71 | 1.68 | 3.27 | 6.09 | Bottom end error increased |
| 8. Search for a dark transition across the foot | 0.92 | 1.38 | 1.71 | 1.59 | 3.27 | 6.46 | Helped two pca4sale views but worsened another and followed a painted band in `mid-dark` (0.28 → 3.72%H) |

Remaining outliers in the final Chromium run:

- **Bottom curve:** `pca4sale-446/02.jpg` (3.81%H), `04.jpg` (3.02%H) and `01.jpg` (2.61%H). The dark base grades into the acrylic stand and shadow. The silhouette fit follows a lower edge than the hand label.
- **Top curve:** `pca4sale-446/01.jpg` (1.89%H) has a nearly edge-on lip, and its labelled front middle sits above the endpoint average. `lacma-168468/01.jpg` (1.38%H) has a broad lip, with the labelled curve along its inner edge.
- **Ends:** `lacma-168693/01.jpg` (top 2.15%W) has a wider outer lip than the labelled opening. The rounded bases of `lacma-168693/02.jpg` (bottom 3.68%W) and `lacma-168596/02.jpg` and `03.jpg` (3.36 and 3.22%W) leave the fitted ends higher and wider than the labelled ends.

### Done: silhouette + ellipse detector (`js/core/rim-detect-v2.js`), now the app default

Approaches tried (9 synthetic scenes, mean rim error as % of vessel height; real photos checked by eye):

| approach | top | bottom | verdict |
|---|---|---|---|
| original (red-pixel scan) | 8.5 | 6.4 | fails outright on many real photos |
| original + Snap | 7.3 | 5.2 | |
| **A: silhouette (local border-colour model) + ellipse fit** | **1.5** | 8.0* | **winner, shipped** |
| **A2: A + two-class mask (vessel colours vs background-or-shadow)** | **1.5** | **4.8** | **mask still used by default** |
| A + Snap | 3.7 | 8.6 | Snap now makes rims *worse* |
| C: A + edge search over ellipse params | 6.0 | 6.7 | locks onto painted bands |
| D: bottom from where side edges end | 1.5 | 10.0 | fooled by floor horizon lines |
| E: bottom from mirror-symmetrised silhouette | 8.1 | 8.4 | rounded bases break it |

\*A's bottom error is ~1% on the 6 scenes without a floor; the 3 floor scenes have very dark contact shadows (harsher than real studio shadows) that merge into the silhouette.

Key pieces of A: the background is modelled from border pixels at similar rows/columns (backdrops are gradients); rims are ellipses (a projected circle is exactly an ellipse); the top rim's curve direction (camera above/below the rim) is decided from perspective geometry (the two rims' openness + separation must imply a plausible lens).

A2 (`refineMask`): learns the vessel's colours from A's mask, then a pixel is vessel only if it is closer to a vessel colour than to the local background or a darkened (35–100%) copy of it. On real photos it ignores one-sided shadows (Sotheby's 2024) and finds the base on the pca and most Met dark-backdrop shots. Floor scenes: 17.5/19.7/30.4 → 7.0/16.6/16.6 (the remaining error is a synthetic black base band that is as dark as the shadow).

Known failures, in priority order:
1. ~~Contact shadows / dark bases on dark backdrops~~ fixed by A2 + silhouette repair: fragments split off by dark paint (e.g. a red base band under black rows) are merged back, and rows missing a side are mirrored about the vessel's axis (`revolve`). All 5 Met dark-backdrop shots now get the base right. Cost: the harsh synthetic floor-close scene's bottom 16.6 → 25.5, and floor-wood's top-direction decision flips (top 1.5 → 10.3).
2. Light parts of the vessel on a white backdrop (Sotheby's 2023 bird vessel): the silhouette loses them.
3. Very wide-angle close-ups: the "plausible lens" prior picks the wrong top-rim direction.
4. Snap (old DP edge snap) degrades good rims: constrain it to ellipses or remove it.

Next for 2 (white-on-white): colour alone can't separate them; use edges (the vessel outline is a continuous edge even where colours match), e.g. close the mask along strong gradients, or a segmentation model (SAM-class) if a cheap one is acceptable.

### Original plan

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
