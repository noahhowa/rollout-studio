# Browser seam merge: handoff

`js/core/seam-merge.js` (`SEAMMERGE.merge`) is a browser port of the seam-cut merge prototype in
[PR #22](https://github.com/noahhowa/rollout-studio/pull/22)
(`museum-rollout-reconstruction/adjust-hf-test/seam-stitch.py` on `codex/adjust-hf-test`). It's an
**opt-in alternative to the Hugging Face stitcher**: Adjust has a checkbox, "Merge in the browser with
seams instead of the server (beta, no ghosting)", which is off by default.

Why it exists: the Space's SIFT + similarity fit with multi-band blending rotates pieces and averages
misaligned paint, which causes ghosting, tilts and steps. Strips are already flattened by Map, so
neighbours differ only by a horizontal shift and a small vertical shift and scale. Placing them that way and
taking every pixel from a single source can't produce doubled paint.

## Pipeline
1. **Input.** `buildRawStrips()` in `js/core/unwarp.js` returns the Map strips, cropped and **not feathered**
   (a seam needs hard source pixels). If the Adjust overlap warp from #24 is on, it's applied first.
2. **Matching.** Every pair is matched at a working height of 400 px, on high-passed luminance:
   - `coarse()`: NCC over shifts at quarter scale. It returns up to 4 distinct peaks, because edge
     overlaps are foreshortened and a single low-resolution peak is often wrong there.
   - `patches()`: a grid of 13×13 patches (step 8). Each is searched ±6% vertically and ±5 px
     horizontally around a candidate. A match needs NCC ≥ 0.7 and a distinct peak, refined to subpixel.
   - `fitPair()`: dx consensus within ±2 px, then RANSAC for `y_a = s·y_b + t` (s from 0.85 to 1.15,
     tolerance 1.5 px) and a least-squares refit. If the inliers don't span 30% of the band, it falls
     back to a pure shift. The candidate peak with the most inliers wins, and a pair needs at least 20.
3. **Placement.** A maximum spanning tree of the strongest pairs, grown from photo 1, so the result
   doesn't depend on order. Strips are sorted left to right by x. Poses compose as `x0 = xk + X`, `y0 = S·yk + T`.
4. **Compose.** Each strip is resampled to the common scale (geometric mean 1). Strips are added left to right:
   - per-channel gain against the composite in the overlap, clamped to 0.4–2.5;
   - a minimum-difference DP seam through the middle 60% of the overlap, on a 5×5 box-blurred colour difference;
   - a 4 px crossfade at the seam.
5. **Output.** An opaque canvas with a black background, which goes to Refine like a Hugging Face result.
   - The log shows the time taken and the placement order.
   - If a photo can't be placed, it returns `{error}`, and Stitch logs the reason and **falls back to the server**.

## Results (headless Chromium, real upload path, `merge-in-app.cjs`)
| Set | Photos | Time | Result |
|---|---|---|---|
| LACMA 168693, default crop | 4 | 2.7 s | All placed. The join between photos 1 and 4 has 24 matches. **The Space fails on this set** at the default crop. See `lacma-results.jpg`. |
| LACMA 168596 | 4 | 5.9 s | All placed. Gains reach 0.58, because these photos alternate in brightness. |
| User's 3-photo vase (not committed) | 3 | 2.6 s | All placed. Close to the Python prototype, with the step at the thin 2–3 join slightly smaller. |

- **End-to-end:** upload → Adjust checkbox → Stitch produced a 2082×1337 result and made **no Space requests**.
- **Fallback:** a forced merge error falls back to the upload path.

## Known gaps (suggested order for the next rev)
1. **Vertical steps at thin joins.** The per-strip model is linear in y. Waisted or flared vessels
   and oblique overlaps need a smooth monotone y-mapping per strip (quadratic, or a 3–4 knot spline),
   bounded, with a fallback to linear. #22 lists this as item 1. Validate on a join where the base line steps.
2. **Speed.** All pairs are matched with 4 candidates each, so time grows with n². Match only neighbours
   in the upload order plus closure first, and widen to all pairs only if the tree is disconnected.
   Cache the grey pyramids.
3. **Seam placement.** Penalise crossing strong horizontal gradients (the rim and base bands) unless the
   two strips agree there, which stops diagonal cuts through bands. Prefer seams near the midpoint
   between view centres, i.e. the most face-on pixels.
4. **Duplicate views** (e.g. Met 310364's two lighting sessions): keep one source per angular sector.
5. **Loop closure / one-period crop**, and showing uncovered angles as an explicit gap.
6. **Exposure.** Global per-strip gain only. Consider gain that varies with x near the seam, or gradient-domain
   blending inside the seam band only.
7. **Evaluation.** Compare against the Met's published rollout (`test-sets/met-310364/rollout/02.jpg`):
   seam displacement jumps, a doubled-edge index, and loop residual.

## Guardrails
- Keep it opt-in until it beats the Space on the test vessels. Don't change Map, Refine or the Space call.
- Don't commit user photos or museum rollout images beyond what's already in `test-sets/`.
- `SEAMMERGE._internal` exposes `gray`, `coarse`, `patches` and `fitPair` for tests.

## Files
- `js/core/seam-merge.js`: the merge.
- `js/core/unwarp.js`: `buildRawStrips()`.
- `js/state.js`: `seamMergeOn`.
- `js/steps/3-adjust.js`: the checkbox.
- `js/steps/4-stitch.js`: the hook before `localStitch()`, and the fallback.
- `js/i18n.js`: EN and ES strings.
- `museum-rollout-reconstruction/browser-seam-merge/merge-in-app.cjs`: the fixture. Usage is in its header.
