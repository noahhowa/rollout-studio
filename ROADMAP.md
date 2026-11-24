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

## Current goal: in-browser cylinder compositor (replaces the Hugging Face stitch)

Treat the vessel as a known surface and the rollout as its texture map: estimate each photo's camera from its two rim ellipses, project the photo onto the cylinder (angle θ, height h), line up neighbouring views with a horizontal θ shift, make the shifts add up to 360°, and blend each output column from the photo that sees it most face-on. Runs fully in the browser, no server.

Each milestone is done when its target is met in `node scripts/eval.js`.

| # | Milestone | Target (how it's measured) |
|---|---|---|
| M0 | **Yardstick.** (a) Synthetic multi-view scenes: render N views of one textured cylinder at known rotations, so the true rollout and true shifts are known. (b) End-to-end rollout score vs ground truth (synthetic texture; published rollouts for Met 310364 and pca4sale 446) after global registration (circular x shift + scale): median local column displacement (% of circumference), NCC, and seam ghosting. (c) Sanity row: unwarp with the synthetic scene's true camera. | (c) scores ≤0.5° angle error (proves the metric). Baseline numbers recorded for the current pipeline. |
| M1 | **Projective unwarp.** Per-photo pose from the ellipses (elevation from b/a, distance from apparent size/taper, focal from EXIF or a default), sample the cylinder through a pinhole camera; each view's visible angle range computed, not assumed 180°. | Synthetic, true rims: ≤1° median angle error at 0–60° from facing. With detected rims: ≤3°. |
| M2 | **Registration.** Pairwise θ shift between neighbouring views by normalised cross-correlation on their overlap; global solve with loop closure (shifts sum to 360°) when coverage is complete; per-set coverage reported. | Synthetic: shift error ≤1°. Real sets with full coverage: loop-closure residual ≤3°. |
| M3 | **Compositing.** Blend weighted by how face-on each view is (cos of incidence), seams placed where views agree; uncovered angles shown as an explicit gap, never stretched. | End-to-end vs published rollouts: median column displacement ≤1% of circumference, no visible seams on review; synthetic ≤0.5%. |
| M4 | **In the app.** New Stitch step uses the compositor (Hugging Face kept as fallback until M3 passes); progress shown, no network. | 5 photos stitched in ≤10 s on a laptop browser; works offline. |
| M5 | **Clean-up.** Remove the Hugging Face call and simplify the Refine step if the composite no longer needs manual rectification. | No external calls in the stitch path. |

Out of scope for now: SAM-class segmentation (only if rim errors limit M3), video/turntable mode, multi-view bundle adjustment.

## Status / handoff (latest)

- App default rim detector: `RIM2.detect` (A2) in `js/core/rim-detect-v2.js`; the old one is the fallback in `js/steps/1-upload.js`.
- Measure any change with `node scripts/eval.js` (needs `python3 scripts/fetch_test_sets.py` once). Use `--only "A2 two-class,..."` to keep the report readable; check real photos visually, since synthetic floor shadows are harsher than real ones.
- Next steps: the compositor milestones above (M0 first). Rim detection is good enough on real photos (~1–2%) that stitching is now the bottleneck.

## Phase 2: automatic rim recognition

### Real-photo scores (hand labels, `test-sets/labels.json`, 21 scored photos in 9 sets)

| detector | top rim %H | bottom rim %H | rim ends, top % | rim ends, bottom % |
|---|---|---|---|---|
| original | 4.6 | 5.6 | 25 | 30 |
| A2 + "camera above" (current) | **1.1** | **1.2** | **2.3** | **1.6** |

The perspective-based camera above/below guess was removed: on real photos it scored 3.9% top vs 1.1% for always assuming "above". Label more photos at `eval/label.html` (Met sets need their photos saved by hand to be scored).

### Done: silhouette + ellipse detector (`js/core/rim-detect-v2.js`), now the app default

Approaches tried (9 synthetic scenes, mean rim error as % of vessel height; real photos checked by eye):

| approach | top | bottom | verdict |
|---|---|---|---|
| original (red-pixel scan) | 8.5 | 6.4 | fails outright on many real photos |
| original + Snap | 7.3 | 5.2 | |
| **A: silhouette (local border-colour model) + ellipse fit** | **1.5** | 8.0* | **winner, shipped** |
| **A2: A + two-class mask (vessel colours vs background-or-shadow)** | **1.5** | **4.8** | **current default** |
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
