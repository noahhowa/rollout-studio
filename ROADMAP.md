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

### Additional hand labels

The supplied label export adds 13 photos and replaces the existing coordinates with the full-precision export, for 42 labelled photos total. Six additional LACMA photos were fetched, giving 17 available labelled photos across eight sets. All 25 labelled Met photos remain unavailable, including the seven newly labelled originals whose public image URLs returned blocking pages.

The same comparison on the expanded labels, using Playwright Chromium and the procedural synthetic texture fallback:

| detector | real top %H | real bottom %H | real top ends %W | real bottom ends %W | synthetic top %H | synthetic bottom %H |
|---|---:|---:|---:|---:|---:|---:|
| A2 original fit | 0.90 | 1.22 | 1.60 | 1.91 | 3.23 | 5.51 |
| A2 two-class (new default) | 0.70 | 1.22 | 0.93 | 1.91 | 3.22 | 5.51 |

The expanded set exposes two larger outliers: `lacma-168977/03.jpg` has 2.34%H top error and `lacma-168399/03.jpg` has 9.74%W bottom endpoint error. The largest bottom curve error remains `pca4sale-446/02.jpg` at 3.81%H.

### Multi-photo rim experiments

Normalized median openness and rim-position priors were tested across all views of each vessel, with each photo normalized to its own detected object bounds. Direct median openness worsened top/bottom rim errors from approximately 0.92/1.42 to 1.05/1.57%H. Local gradient candidate searches with shared shape priors also lost to the existing detector. A small bottom-fit calibration reached about 0.71%H bottom error with entire vessels held out of training, but lacked synthetic validation. These experiments were removed when work moved to the whole-rollout yardstick.

### Second additional label export

Ten further LACMA labels bring the total to 52, with all existing coordinates preserved. All ten photos downloaded, giving 27 available labelled photos across 12 sets. The 25 labelled Met photos remain unavailable.

| detector | real top %H | real bottom %H | real top ends %W | real bottom ends %W | synthetic top %H | synthetic bottom %H |
|---|---:|---:|---:|---:|---:|---:|
| A2 original fit | 1.13 | 1.42 | 1.79 | 1.87 | 3.23 | 5.51 |
| A2 two-class (new default) | 0.92 | 1.42 | 1.12 | 1.87 | 3.22 | 5.51 |

Measured with the same Playwright Chromium comparison and procedural synthetic texture fallback. All pipelines completed successfully.

### Bottom-rim regressions from supplied dark-backdrop photos

Two supplied PNG screenshots are checked in under `test-sets/bottom-rim-regression/photos/`, with hand-labelled front base arcs. The evaluator includes each at 75%, 100% and 150% size through `meta.json`'s `evaluationScales`, since the first failure depends on resampling.

- A dark painted band can truncate the initial mask halfway down the vessel. The refinement previously searched only 15% below that incomplete component. When the initial bottom fit is flat and ends well above the image border, refinement now searches the remaining rows and permits a longer gap to an aligned base fragment.
- A floor patch can join the refined mask below an already rounded base. The detector now trims a sudden widening after the silhouette has tapered. If the patch has grown gradually, it retains the initial rounded base when refinement extends substantially lower and the initial base has comparable width.

| case | bottom error before %H | bottom error after %H |
|---|---:|---:|
| Left photo, 75% size, mid-body cutoff | 42.47 | 0.53 |
| Left photo, original size | 0.41 | 0.49 |
| Left photo, 150% size | 0.46 | 0.55 |
| Right photo, 75% size, floor leak | 12.49 | 0.30 |
| Right photo, original size, floor leak | 12.18 | 0.34 |
| Right photo, 150% size, floor leak | 13.66 | 0.28 |

The six regression cases average 13.61 → 0.42%H bottom error. The 27 previously available labelled photos retain their exact rim scores (bottom mean 1.42%H). All nine synthetic scenes retain their exact rim scores (top 3.22%H, bottom 5.51%H). The combined 33 labelled cases score 3.63 → 1.24%H bottom error. Met collection photos remain unavailable for this run.

Reproduce with `node scripts/eval.js --only "A2 before base fix,A2 two-class"`. Run `node scripts/check_bottom_rims.js` for assertions on both supplied photos at all three sizes and three repeated canvas reads, plus the normal Upload → Map Rims path. Each base curve and front midpoint must be within 2% of vessel height, and endpoint x error must be under 5% of rim width. The report is `eval/out/report.html`, and the upload preview is `eval/out/bottom-rim-fix.png`.

### Shallow-base recovery and independent edge-case labels

Eleven new hand labels from `lacma-168499` and `lacma-168564` bring the label file to 65 entries. This run has 40 available source photos and 44 scored cases, including the supplied PNGs at three sizes. The 25 Met photos remain unavailable. Scores below use Playwright Chromium and the procedural synthetic texture fallback. The expanded sample exposes harder failures, so its baseline should be compared within this table.

| detector | real top %H | real bottom %H | real top ends %W | real bottom ends %W | synthetic top %H | synthetic bottom %H |
|---|---:|---:|---:|---:|---:|---:|
| A2 before curve recovery | 1.404 | 2.148 | 1.707 | 2.602 | 3.225 | 5.511 |
| **A2 two-class** | **1.404** | **1.881** | **1.707** | **2.602** | **3.225** | **5.511** |

The kept change reduces mean bottom error by 12.4%. On `lacma-168564/04.jpg`, a painted band produces a shallow base that the existing floor-leak guard preserves. The detector now fits the outer side portions of the lower mask boundary when the base is nearly flat. It requires support on both sides, a small residual, and plausible width, curvature and displacement. Central contact shadows are excluded, and stable rim ends are retained. This photo improves from 12.610 to 0.867%H bottom error with unchanged 0.761%W endpoint error. The other 43 cases and all nine synthetic scenes retain their scores.

Experiments were removed unless kept above. Early trials used the 33 cases available before the independent labels arrived.

| experiment family | comparison | outcome |
|---|---|---|
| Paired front/back opening contrast, including dark interiors | 33-case top 0.954 → 2.370; half blend 1.390 | Painted bands attracted the fit. A guarded combination reached 0.849 but synthetic top worsened 3.225 → 4.031. Removed. |
| Initial or union mask for top fitting | 33-case top 0.954 → 1.335 or 0.904 | Union gain did not generalize to the new vessels, giving only 1.404 → 1.400 on all 44 cases. Removed. |
| Body-axis bottom correction | 33-case bottom 1.235 → 1.628, ends 1.871 → 2.410 | Worsened curvature and ends. Removed. |
| Tighter floor-growth guard | 33-case bottom 1.235 → 1.222, ends 1.871 → 2.004 | Synthetic bottom also worsened 5.511 → 5.960. Removed. |
| Calibrated bottom proposal with gradient acceptance | 44-case bottom 2.148 → 2.077 | Small gain required learned coefficients from earlier photos. Removed in favor of the simpler geometric recovery. |
| Wider refinement search below the silhouette | 44-case top 1.404 → 2.320, bottom 2.148 → 2.205 | Larger search found distracting edges. Removed. |
| Shallow-base recovery variants | 44-case bottom 2.148 → 1.876 with relaxed rounded guard | Bottom ends worsened 2.602 → 2.739. Kept the side-supported fit instead, at 1.881 with unchanged ends. |
| Stronger shadow rejection only below the initial mask | 44-case bottom 1.881 → 1.885 or 1.884 | No further gain. Removed. |

Reproduce with `node scripts/eval.js --only "A2 before curve recovery,A2 two-class"`. After fetching `lacma-168564`, run `node scripts/check_bottom_rims.js --include-real`. The recovered photo passes at 75%, 100% and 150% size, with three repeated canvas reads. Bottom errors are 0.438, 0.867 and 0.670%H, respectively. The original PNG regression and normal Upload → Map Rims checks also pass. Comparing detections on all 72 synthetic photos in the whole-rollout yardstick found no changed inputs; a new full camera/registration benchmark was therefore not run.

Worst remaining photos in this run:

- `lacma-168564/05.jpg` has 23.197%H bottom error and 17.255%W bottom endpoint error. Its dark base merges into the floor and contact shadow.
- `lacma-168564/02.jpg` has 13.112%H bottom error and 13.187%W bottom endpoint error. Painted bands and the dark background leave an incorrect base component.
- `lacma-168564/03.jpg` has 16.236%W bottom endpoint error and 10.730%W top endpoint error. The mask loses low-contrast side regions.
- `lacma-168564/04.jpg` still has 5.777%H top error. Its dark lip/interior and painted edges make the opening ambiguous. `lacma-168550/02.jpg` has 4.950%H top error.

A background photo search prepared ten unlabelled photos across five additional vessels. The `edge-*` sets in the manifest include official source URLs, local dimensions, and original set/file provenance where available. They cover dark gradients, textured stone floors, pale vessel/background transitions and contact shadows. The smallest Christie’s image is only 512 × 431, so annotation precision is limited. Download with `python3 scripts/fetch_test_sets.py edge-sothebys-2023-bird-vessel edge-sothebys-2024-polychrome edge-sothebys-2026-stone-floor edge-christies-4916369 edge-sothebys-2016-124`.

The labeller now prefers downloaded photos, seeds committed labels while preserving browser-saved edits, accepts `?sets=id,id&unlabelled=1`, and supports Sotheby's and Christie's sources. The ten-photo queue uses those five `edge-*` IDs. Its images and persistence were checked in isolated Playwright Chromium. These photos have not influenced detector tuning or the reported scores.

### Independent edge-case ground truth

The next export labels all ten queued `edge-*` photos across five vessels, without changing any prior coordinates. There are now 75 labels, with 50 source photos available and 54 scored cases including the PNG size variants. The same 25 Met photos remain unavailable. No detector tuning was performed on this batch.

| detector / sample | top %H | bottom %H | top ends %W | bottom ends %W |
|---|---:|---:|---:|---:|
| Before curve recovery, all 54 cases | 1.461 | 2.149 | 4.018 | 4.074 |
| Current default, all 54 cases | 1.461 | 1.932 | 4.018 | 4.074 |
| Current default, ten new cases only | 1.710 | 2.157 | 14.184 | 10.552 |

The earlier recovery still reduces aggregate bottom error by 10.1%. On the ten independent cases, nine results are unchanged, while `edge-sothebys-2023-bird-vessel/01.jpg` changes from 0.2545 to 0.2556%H bottom error. Synthetic scores remain 3.225/5.511%H top/bottom and all pipelines complete without errors. Reproduce with `node scripts/eval.js --only "A2 before curve recovery,A2 two-class"`.

The new labels expose much larger endpoint errors than curve-position errors. The stone-floor vessel has 26.66–41.92%W top endpoint error, and the 2024 polychrome vessel has 24.89–26.16%W bottom endpoint error. These are priority cases for checking mask extent and fitted rim width in the overlays. The bird vessel has 6.22 and 5.89%H top errors; its labelled front middle sits above the endpoints, which conflicts with the detector's fixed camera-above assumption. The stone-floor fourth view has the largest new bottom curve error, 6.29%H. These observations identify the next experiments; they do not establish a fix.

### Tilted shallow lip and Map reset regression

A further supplied PNG (`top-rim-regression/photos/01.png`, 852 × 1142) exposes a top line above the lip. The visible lip slopes downward to the right. A fresh upload reproduces the high line, but the extra-wide ends shown in the user's app screenshot were not reproduced with this source at the tested resolutions. The Map reset button also still used `initH`, the old red-pixel heuristic. Reset now reruns `RIM2.detect` and updates the existing bounds object so rendering and preview callbacks see the new result. It retains the old fallback if detection fails.

For nearly flat top fits only, a local full-resolution gradient search can now fit a tilted line. It keeps the existing width and accepts only a small, coherent slope supported by at least 20 of 25 columns, with bounded displacement and residual. The handle representation preserves that slope. Curved rims retain the existing ellipse path. This is an approximation for nearly edge-on tilted lips, not a general rotated-ellipse model.

| detector, 54 labelled cases | top %H | bottom %H | top ends %W | bottom ends %W | synthetic top %H | synthetic bottom %H |
|---|---:|---:|---:|---:|---:|---:|
| Before tilted-lip refinement | 1.461 | 1.932 | 4.018 | 4.074 | 3.225 | 5.511 |
| Current default | 1.442 | 1.932 | 4.018 | 4.074 | 3.225 | 5.511 |

Two labelled top scores improve: `lacma-168564/04.jpg`, 5.777 → 5.060%H, and `edge-sothebys-2023-bird-vessel/02.jpg`, 5.893 → 5.622%H. The other 52 labelled cases, all bottom/endpoint scores and nine synthetic scores are unchanged. These are modest aggregate gains and leave the large endpoint outliers unresolved. No pipeline errors occurred. Reproduce with `node scripts/eval.js --only "A2 before tilted lip,A2 two-class"`.

On the new supplied PNG, the detected top middle moves from y=132.06 to y=148.83, following the visible red lip. This fixture has no user hand labels and is excluded from the aggregate label scores. `node scripts/check_top_rim.js` separately asserts broad corridors around the visible endpoints at 75%, 100% and 150% scale, repeated reads, a normal upload, and recovery from deliberately corrupted handles through Reset rims. The test passes, as does `node scripts/check_bottom_rims.js --include-real`. The corrected Map preview is written to `eval/out/top-rim-fix.png`. General tilted-cylinder camera geometry and the whole-rollout benchmark were not changed or rerun in this pass.

### Preserve a curved top when refinement collapses

The second supplied top-rim PNG (`top-rim-regression/photos/02.png`, 882 × 1102) reproduces another failure at original size. The initial mask fits a curved opening (work-size radius 113, depth 11.17), but refinement fits a narrow flat row (radius 73, depth approximately zero). The default now retains the initial top only when refinement loses both width (below 85% of the initial radius) and curvature (below 3% of its radius), while the initial opening has clear curvature (above 6% of its radius). This guard leaves all other top refinement behavior intact.

| detector, 54 labelled cases | top %H | bottom %H | top ends %W | bottom ends %W | synthetic top %H | synthetic bottom %H |
|---|---:|---:|---:|---:|---:|---:|
| Before top stability guard | 1.442 | 1.932 | 4.018 | 4.074 | 3.225 | 5.511 |
| Current default | 1.260 | 1.932 | 3.903 | 4.074 | 3.225 | 5.511 |

Mean top error improves by 12.6%. `lacma-168564/04.jpg` improves 5.060 → 0.749%H, `/05.jpg` improves 4.852 → 0.103%H, and `lacma-168977/03.jpg` improves 2.344 → 1.568%H. Top endpoint error improves on the first two, but worsens 1.057 → 1.767%W on the last. The remaining 51 labelled cases, every bottom score, and all nine synthetic scores are unchanged. The same 25 Met labels remain unscored. Reproduce with `node scripts/eval.js --only "A2 before top stability,A2 two-class"`. No pipeline errors occurred.

On the second supplied PNG, the front middle moves from y=153.58 to y=204.11 and the fitted ends expand to the visible opening. This fixture remains outside the hand-labelled aggregate benchmark. `node scripts/check_top_rim.js` now checks both supplied originals at three sizes, repeated reads, normal uploads and Reset for both cards. It asserts the front middle as well as both ends, preventing a flat back-edge fit from passing. The first fixture's existing endpoint tolerances are retained. The corrected two-photo preview is `eval/out/top-rim-fix.png`.

The user's deployed URL is GitHub Pages. Its served detector and Map code matched the preceding merged patch, but the horizontal, extra-wide line in the first screenshot could not be reproduced on a fresh upload of that source. An already-open tab or cached script remains a possible explanation; this has not been confirmed in the user's browser. The application now versions the detector and Map script URLs so a refreshed page requests the updated assets after deployment. Saved rim coordinates still need Reset or re-upload to be recomputed. This follow-up does not change camera/registration geometry or rerun the whole-rollout benchmark.

### Browser upload validation against hand labels

The user's Chrome screenshots still failed after PR #18. The deployed detector matched the merged code, and a fresh upload reproduced the oversized top in full Chromium. Playwright's default headless shell had hidden this failure. Full Chromium can reproduce the same rendering path with `channel: "chromium", headless: true`, without opening a desktop browser or accessing a personal profile. Later tests use that mode. Renderer-dependent canvas/image sampling changes masks enough to invalidate the earlier assumption that a headless-shell pass predicts normal Chrome results.

Added `scripts/check_browser_rims.js` to upload every available hand-labelled source through the actual app, including its 1200-pixel upload resize. It measures the same rim and endpoint errors as the evaluator, renders the app's Map cards, and overlays the committed labels in cyan. Exact click positions are drawn separately from the evaluator's axis-aligned truth arcs. Reports and coordinates are written to `eval/out/browser-rims-deployed.{html,json}` or `browser-rims-local.{html,json}`. The test opens no desktop windows. With a local server on port 8765, reproduce using:

```
node scripts/check_browser_rims.js --url https://noahhowa.github.io/rollout-studio/
node scripts/check_browser_rims.js
```

This sample contains 50 unique available source photos. The 25 Met photos remain missing. It differs from the 54-case detector-only benchmark, which includes PNG scale variants and does not apply the app's upload resize.

| actual uploads, full Chromium headless | top %H | bottom %H | top ends %W | bottom ends %W |
|---|---:|---:|---:|---:|
| Deployed PR #18 baseline | 1.2324 | 2.2718 | 4.3495 | 3.5516 |
| Browser guards | 1.2263 | 2.2718 | 4.3495 | 3.5516 |

The aggregate improvement is small. Only the bird vessel's second photo changes on these 50 source uploads, from 5.8922 to 5.5869%H top error. The standard 54-case evaluator changes top 1.260319 → 1.259726%H, with bottom 1.931983%H and ends 3.903487/4.073964%W unchanged. All nine synthetic scenes retain their scores, top 3.224620%H and bottom 5.510605%H. These are separate measurements and should not be combined.

Kept changes address the exact browser regressions:

- Reject extreme growth of a nearly flat top if several upper-body rows support a narrower width close to the initial fit. On `top-rim-regression/01.png`, full Chromium's top width changes from 649.65 to 502.68 pixels, close to the approximately 510-pixel visible lip. The default headless shell had already returned a width near 517 pixels. This fixture has no user hand labels, so its visual bounds are excluded from aggregate ground-truth scores.
- Preserve a curved initial opening when a later flat fit of comparable width jumps above its back rim. Restricting the width comparison avoids imposing false positive curvature on the stone-floor vessel.
- Seed the tilted-lip line with median pair slopes and intercepts, then reject outliers before least squares. Accept 18 supported columns only if they span both sides; the earlier 20-column threshold rejected coherent tilted edges at another scale.

`node scripts/check_top_rim.js` now uses full Chromium headlessly by default; `--shell` checks the old runner too. Both supplied originals pass at three sizes, three repeated reads, normal uploads and Reset. Reset is checked against visual corridors rather than bit-identical coordinates, since Chrome can change its canvas sampling path after readback. The first fixture's existing endpoint tolerances remain intact. The corrected two-photo Map preview is `eval/out/top-rim-fix.png`. The detector/Map script URL versions are updated for deployment.

Rejected experiments in this pass:

| experiment | finding |
|---|---|
| CPU-backed resize target | No correction of the oversized browser rim; removed. |
| CPU-backed upload canvas | Did not stabilize the fit and could flatten the tilted line; removed. |
| Explicit bilinear sampler | Standard real bottom worsened 1.932 → 2.367%H and synthetic bottom 5.511 → 6.242%H; removed. |
| Broader back-edge fallback | Standard top worsened 1.260 → 1.309%H while top ends improved 3.903 → 3.276%W. It restored the wrong curvature on the stone-floor vessel. Restricted to comparable widths in the kept guard. |

The browser report exposes remaining substantial failures. `edge-sothebys-2026-stone-floor/02.jpg` has 44.605%W top endpoint error; `/03.jpg` has 38.792%W. `lacma-168564/05.jpg` has 21.867%H bottom and 20.702%W bottom endpoint error, and `/02.jpg` has 15.589%H bottom error. Even the previously checked-in `bottom-rim-regression/01.png` has 8.088%H bottom error in this browser path. Dark paint, contact shadows and background fragments still produce incorrect masks. These failures remain visible in the cyan-label report; this patch does not resolve them or claim a broad detector improvement. The whole-rollout benchmark was not rerun.

The two exact gray-backdrop originals still need user hand labels. The labeller now supports explicitly selected local fixture metadata outside the download manifest, with no remote URL required. The verified queue is `eval/label.html?sets=top-rim-regression&unlabelled=1`. Until those labels arrive, their regression checks use approximate visible-edge corridors only.

### Fix the largest upload-path failures

Continued from PR #19's browser-validation head (`33bf127`). All browser work in this pass used isolated headless processes. The 50 available labelled source photos are scored through actual uploads in full Chromium 159.0.8154.6, including the app's resize to 1200 pixels wide. The 25 Met photos remain unavailable. These labels guided the changes, so this is a regression benchmark rather than a held-out generalization estimate.

| actual upload metric | before investigation | kept changes | reduction |
|---|---:|---:|---:|
| Top rim %H | 1.2263 | 1.2195 | 0.6% |
| Bottom rim %H | 2.2718 | 1.1650 | **48.7%** |
| Top ends %W | 4.3495 | 1.6411 | **62.3%** |
| Bottom ends %W | 3.5516 | 2.2346 | **37.1%** |

The standard detector-only comparison has 54 cases because it also includes PNG size variants and uses the original image sizes. Its top/bottom errors change 1.2597/1.9320 → 1.2510/1.3184%H, and endpoints 3.9035/4.0740 → 2.1559/2.5788%W. Synthetic top remains 3.2246%H. Synthetic bottom improves 5.5106 → 3.7376%H, entirely from `floor-grey` improving 16.607 → 0.651%H; every other synthetic rim score is unchanged. Synthetic detector runtime in this run was approximately 82 → 88 ms per scene, rather than a dedicated performance benchmark.

Kept behavior:

- When refinement nearly doubles a flat rim's width, retain the initial rim ends only if its axis agrees with the refined axis. Preserve the current curve height. This removes textured-backdrop wings without imposing the initial top's sometimes incorrect curvature.
- Detect a floor patch that reconnects through a narrow waist, including a gradual widening. Cut at the waist only near or below the initial base. The lower bound prevents the stone-floor horizon from being mistaken for the vessel bottom.
- Retain an initial rounded base when its radius agrees with the recovered top and the two bottom fits reach the same vertical region. This rejects widened floor components that the earlier similarly-wide-base guard could not handle.
- Confirm suspicious bases against image edges. Fit coherent side generators over the body, find where they end, and search a constrained ellipse family nearby. Require background-colour support below the proposed arc at several depths, using reference colours outside both the side lines and the top rim. Shared-radius checks reject proposals that move farther from plausible vessel geometry.
- For an already well-positioned base with inconsistent width or axis, search locally while anchoring the front middle. Require support in both outer arc sectors and use the lower body rather than a wider shoulder for the width prior. A shallow inner-foot fit under an open top is checked around the full body width. Local fitting cannot replace a confirmed generator width with a worse shared-radius fit.

Largest addressed cases in actual uploads:

| photo | metric | before | after |
|---|---|---:|---:|
| `edge-sothebys-2026-stone-floor/01.jpg` | top ends %W | 30.42 | 2.69 |
| `edge-sothebys-2026-stone-floor/02.jpg` | top ends %W | 44.61 | 1.65 |
| `edge-sothebys-2026-stone-floor/03.jpg` | top ends %W | 38.79 | 5.75 |
| `edge-sothebys-2026-stone-floor/04.jpg` | top ends %W | 32.58 | 0.88 |
| `lacma-168564/05.jpg` | bottom %H / ends %W | 21.87 / 20.70 | 0.43 / 0.69 |
| `lacma-168564/02.jpg` | bottom %H / ends %W | 15.59 / 11.19 | 0.70 / 0.90 |
| `bottom-rim-regression/01.png` | bottom %H | 8.09 | 0.54 |

Approaches and counterexamples were checked before retaining them:

| trial / refinement | measured finding | outcome |
|---|---|---|
| Initial-width fallback without an axis check | The stone-floor ends improved, but `lacma-168564/02.jpg` top ends worsened 7.68 → 26.85%W because its initial component covers only part of the vessel. | Added axis agreement; partial-component fallback removed. |
| Unbounded waist trimming | Actual bottom mean worsened 2.27 → 2.90%H because the stone-floor horizon was cut above the base. | Bound cuts by the initial bottom; the kept width/waist stage reached 1.61%H. |
| Connected horizontal expansion at a clipped refinement ROI | Actual bottom mean worsened 1.61 → 2.13%H, including `lacma-168564/03.jpg` at 1.36 → 26.66%H. | Removed. Restoring a side also grew floor material. |
| Connected recovery above a flat mask for missing dark lips | No measurable improvement on either the 50 upload cases or the 54 detector cases. | Removed, including the experimental direction rule. |
| Side-generator / gradient base search alone | Found the remaining dark base, but `pca4sale-446/04.jpg` worsened 3.23 → 21.96%H. Synthetic gains alone did not justify keeping it. | Raw search removed; require background farther below the arc. |
| Background confirmation using samples just outside fitted side lines | Some fitted lines were inside the vessel, making painted material look like background; the pca outlier reached 26.63%H. | Move references outside the top extent too, check three lower layers, and enforce radius agreement. The four pca upload cases retain their prior scores. |
| Rounded-base / top-radius agreement | The stone-floor first and second bottom-end errors improve 19.90 → 6.98 and 15.60 → 3.44%W. | Kept with a close-front-height requirement. |
| Local endpoint fitting with a middle-body width prior | An existing full-Chromium resized-end failure remained, and a wider shoulder could replace a correct tapered base. | Use lower-body spans, balanced outer-arc support, and preserve the generator radius when arbitrating fits. |

The full-Chromium bottom regression now passes at three sizes and three repeated reads without relaxing its limits: curve/middle <2%H and ends <5%W. For example, the second PNG at 75% size improves 11.14 → 2.29%W ends, and the additional LACMA fixture at 150% size improves 9.98 → 2.01%W. The original headless-shell suite also passes. The two supplied gray-backdrop top fixtures still pass their separate visual corridors, uploads and Reset checks; they have no user hand labels and remain outside the aggregate metrics.

Reproduce final validation with a local server on port 8765:

```
node scripts/check_browser_rims.js --assert-regressions
node scripts/eval.js --only "A2 before failure fixes,A2 two-class"
node scripts/check_bottom_rims.js --include-real
node scripts/check_bottom_rims.js --include-real --shell
node scripts/check_top_rim.js
```

`check_browser_rims.js` also accepts `--sets`, `--opts` and `--tag` for controlled comparisons. To reproduce the investigation baseline, pass `--opts '{"rimWidthPrior":false,"trimNecks":false,"imageBase":false,"consistentBase":false}' --tag before-failures`. The final report is `eval/out/browser-rims-local.html`; the saved side-by-side comparison for this run is `eval/out/rim-failure-comparison.html`. All 50 scores complete without page errors, and explicit regression limits cover the four stone-floor photos, both severe LACMA base leaks, the PNG cutoff and all four pca controls.

Remaining failures are concentrated in missing dark lips and partial masks. The bird-vessel top errors remain 6.22 and 5.59%H because the colour mask starts below the black lip and the top direction is ambiguous. `lacma-168550/02.jpg` still has 4.95%H top error. `lacma-168564/03.jpg` retains 10.73/14.45%W top/bottom endpoint error from an incomplete component; the rejected ROI extension shows why widening that search indiscriminately is unsafe. `lacma-140748/02.jpg` is the largest remaining bottom-curve case at 5.34%H: its silhouette includes the dark foot/support below the labelled cylinder edge. `pca4sale-446/02.jpg` remains at 3.80%H where the base blends into its support. The nearly edge-on `edge-sothebys-2024-polychrome/01.jpg` still has 11.25%W bottom-end error; a narrow inner-foot ellipse matches the central curve and lacks enough opening evidence to select the full base confidently. One tradeoff is `lacma-140750/01.jpg`: bottom curve improves 3.38 → 0.63%H while ends worsen 3.03 → 4.74%W. Native-size detector-only results still include a large `lacma-168564/02.jpg` bottom error, although the actual 1200-pixel upload path is corrected. The whole-rollout camera/registration benchmark was not rerun.

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

### Automatic camera and rotation estimation checkpoint

Draft implementation and handoff details are in `HANDOFF.md`, with the complete experiment recorded in `eval/automatic-rollout-results.json`. Camera candidates come from the two rim conics, shared vessel-height hypotheses stabilize per-photo fits, and overlapping painted detail jointly selects cameras and relative rotations. The estimator receives photographs and rim handles.

Across all 12 synthetic sets, the detected-rim automatic pipeline improves mean full-rollout angular MAE from **3.154° to 0.945° (70.0%)**. The reframed procedural set scores 0.185°, including a photo with a cropped bottom rim. Real pca4sale photo matching remains disconnected, close-view rotation outliers remain, and production app integration is pending. These limitations are documented in the handoff and the draft PR.

### Yardstick milestone

Implemented by `scripts/eval-rollout.js`, with fixtures in `eval/rollout-cases.json`. The committed `eval/rollout-baseline.json` records every pipeline, scene, reference, coverage figure, and runtime version. Browser output goes to `eval/out/rollout-scores.json` and the visual `eval/out/rollout-report.html`.

Run with Node, Playwright Chromium, and Python/Pillow installed:

```sh
python3 scripts/fetch_rollout_references.py
node scripts/eval-rollout.js
```

Each of 12 synthetic sets has six photos at 0°, 52°, 119°, 184°, 247°, and 304°. Textures are deterministic procedural artwork and cropped copies of the two published rollouts, Met 1978.412.206 and Kerr K937/pca4sale-446. Four camera scenes cover close, studio, far, and per-photo changes in zoom and framing. Source links and manually selected crop rectangles are recorded in the fixture manifest. The Met texture is available from figure 5 of its public article through the article CDN.

The known-camera flattening check passes across all 12 sets. Its worst mean angular error is **0.078°**, worst p95 is **0.167°**, and worst image-based texture matching error is **0.093°**. Every oracle has at least 99% circumference and contributor coverage, and at least 95% matched texture columns. The CLI exits unsuccessfully if an oracle exceeds 0.5° mean or p95, required fixtures are missing, or the coverage checks fail. A deliberately incorrect focal length (+10%) scores **2.556°**. Keeping only one view reduces circumference coverage to **36.056%**. Both negative controls are required to be detected.

Synthetic angular MAE in degrees, averaged over the three textures:

| camera scene | known camera | true rims + app sampler | detected rims + app sampler |
|---|---:|---:|---:|
| close | 0.077 | 5.521 | 5.440 |
| studio | 0.075 | 2.752 | 2.702 |
| far | 0.076 | 1.494 | 1.497 |
| reframed | 0.076 | 2.776 | 2.975 |

The synthetic compositor uses known rotations, a fixed 14% side crop, and cosine overlap weights. It samples the production `unwarp` function for both app baselines. True rim curves are converted to the production handle format by the existing oracle. Independently ray-traced surface coordinates measure each contributing sample's angular error before blending, so opposite errors cannot cancel at seams. Height error and coverage are also recorded. A separate image score compares the full reconstructed rollout with the source texture using normalized column descriptors. Its whole-rollout loss is `(1 - mean correlation) / 2`, with uncovered or featureless output columns contributing correlation -1. Angular texture matches search ±20° and require correlation at least 0.65, so their matching coverage is always reported.

The real pca4sale baseline registers each of its five strips to the published rollout with one angular shift per photo, then assembles the whole circumference. It scores **5.140°** image-based angular MAE, **14.500°** p95, **60.972%** matched columns, **100%** circumference coverage, and **0.282** whole-rollout loss. Real-photo descriptor matching tolerates ±8.333% vertical displacement because the published texture's framing differs. This is a reference-registered flattening baseline. Synthetic assemblies use known rotations. These baselines isolate flattening and use the evaluation compositor in place of the hosted stitcher.

The real-photo Met comparison is explicitly marked **missing photos**. The published Met texture participates in all four synthetic sets and passes the camera check, while its original collection photos remain blocked by the image server.

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
