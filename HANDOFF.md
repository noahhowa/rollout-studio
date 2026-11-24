# Automatic camera and rotation estimation handoff

## Update (Claude takeover)

Changes in `js/core/registration.js`:
- **Matching:** shading-removed block normalised cross-correlation over the whole overlap, with a ±3-row vertical search, replaces per-column correlation. A match is accepted when its peak beats every shift more than ~8° away by a margin (`ok`), instead of a fixed 0.65 cut-off.
- **Solve:** spanning trees grown from every photo, scored by the pair matches they agree with (a contradiction penalty was tried and rejected: it biased camera choice towards hypotheses with fewer accepted pairs).
- **Loop closure (`closeLoop`):** when neighbouring photos connect all the way round, the steps are rescaled to sum to 360°.
- `estimate()` also returns `pairs` (best match per photo pair) for debugging.
- Yardstick quick mode: `ROLLOUT_ONLY="procedural/close,real:pca4sale-446" node scripts/eval-rollout.js` (~30 s per scene).

Detected rims + estimated cameras and rotations, geometric angle MAE (°):

| scene | procedural | Met | pca4sale |
|---|---|---|---|
| close | 0.192 → **0.109** | 1.359 → **0.275** | 6.236 → **1.032** |
| studio | 0.176 → 0.326 | 1.285 → **0.323** | 0.281 → **0.212** |
| far | 0.129 → 0.667 | 0.168 → 0.170 | 0.194 → 0.231 |
| reframed | 0.185 → 0.201 | 0.302 → 0.298 | 0.834 → **0.212** |

Mean over 12 sets: **0.945° → 0.338°**; worst **6.24° → 1.03°**. True-rim diagnostic: Met close 55.0 → 13.6°, pca close 36.3 → 1.5°; procedural close still fails (84.9°, the generated texture's repeating motifs give false matches).

Real pca4sale (photo-only, no reference): previously disconnected; now **5/5 connected in ~2.4 s**, image-based angle MAE 5.98° on 51% matched columns (reference-registered baseline: 5.14° on 61%), 96% coverage.

Open items:
- procedural/far regressed 0.13 → 0.67°: rotations are within 1°, so it's the camera-hypothesis choice; check how match weights rank hypotheses.
- True-rim procedural close (repeating texture) and the true-handle centre bias (below) remain.
- App integration (next steps 3–4 below) not started.

## Original Codex handoff

This is a draft implementation checkpoint. The user asked for an automatic photos-to-rollout pipeline, measured with the whole-rollout yardstick, and then asked to prioritize a PR that Claude can take over.

## Current state

- Branch `codex/automatic-camera-rotation`, based on `19fcce2` on main, which merged the yardstick PR #8.
- Two new browser-native modules implement camera calibration, photo registration, and local rollout assembly. The yardstick exercises them.
- App integration is pending. The modules are loaded by `eval/rollout.html`. The production upload, strip cache, and hosted stitching flow keep their existing behavior.
- The original `eval/rollout-baseline.json` is preserved. `eval/automatic-rollout-results.json` records the current experiment, including all failures.

## Measured results

The detected-rim automatic pipeline receives photos and rim bounds. It estimates cameras and rotations from photo overlaps. Synthetic truth is consulted afterward to score it and remove the unobservable common rotation by anchoring the first photo.

Across the 12 synthetic sets, mean full-rollout geometric angular MAE improves from **3.154° to 0.945°**, a **70.0% reduction**. These are means over the same scenes and textures, with estimated rotations included in the new pipeline's error.

| Scene, averaged across three textures | Previous sampler with known rotations | Estimated cameras and rotations |
|---|---:|---:|
| Close | 5.440° | 2.595° |
| Studio | 2.702° | 0.581° |
| Far | 1.497° | 0.164° |
| Different framing | 2.975° | 0.440° |

All detected-rim automatic sets have connected match graphs and at least 99.35% geometric circumference coverage. The production compositor's coverage is recorded separately as `assemblyCoveragePct`.

Important outliers and limitations:

- **Real pca4sale photos remain disconnected.** No reference texture is passed to their automatic estimator. Its graph currently has confidence zero and cannot assemble a real rollout. The existing reference-registered real baseline still runs independently.
- Synthetic pca4sale/close scores **6.236°**, versus the previous **6.324°**. Rotation MAE is **5.947°**. Other notable rotation errors are Met/close (1.293°) and Met/studio (1.186°).
- The diagnostic that supplies `oracleB`'s true-rim handles to the estimator has severe failures on the close Met and pca4sale textures. Keep these visible. A separate diagnostic found the close true-handle conversion's horizontal ellipse centre at about 326.2 px for a rendered camera centred at 320 px. Investigate the front-arc sampling/ellipse conversion and registration robustness.
- One photo in the existing reframed fixture actually clips the bottom of the vessel. Its single-photo mask reports a flat bottom far above the true base. Shared-height calibration now recovers a camera hypothesis using the surviving top rim and physical pose from peers. The detected-rim procedural/reframed score is **0.185°**.
- Camera calibration assumes circular, equal-radius rims. Tapered, damaged, or badly labelled vessels need a conservative fallback.
- Registration and calibration currently run synchronously. Measure browser latency before app integration, especially with many photos.
- The original Met collection photos remain blocked. Its published rollout texture is available and used in synthetic evaluation.

## Code map

### `js/core/camera.js`

`ROLLCAMERA.candidates(cv, bounds)` derives possible cylindrical pinhole cameras from the two ellipse conics. It tries both signs of the top rim, because the camera can be above or below that rim. The inferred principal point can move with cropping and framing.

For a rim ellipse with major radius `a`, signed minor radius `b`, and centre `yc`, let `q = b / a²` and `k = (yc - horizon) / b`. Both circles share `a² (k² - 1)`. A quadratic gives candidate horizons, then focal length, camera distance, elevation, and vessel height follow. Length units use vessel radius 1.

`ROLLCAMERA.fitShared(cv, bounds, height, template)` uses bounded Nelder–Mead fitting against the projected conic parameters while sharing a physical vessel-height hypothesis. Each photo retains its own distance, focal length, principal point, and vertical camera position. When a rim is lost, it can transfer a peer pose hypothesis and fit the surviving rim's scale and framing. This hypothesis is then assessed through photo overlap matching.

`ROLLCAMERA.flatten(cv, model, radius, size)` samples the image through the estimated camera. It retains alpha and respects the visible angular arc. A null model uses the existing `unwarp` sampler. `size.bounds` is required for that fallback.

### `js/core/registration.js`

`ROLLREGISTER.estimate(images)` takes `{cv, b}` records. It constructs shared-height camera hypotheses, flattens candidate strips, and matches normalized luminance column descriptors in overlapping angular ranges. It jointly selects camera hypotheses and relative rotations with a maximum spanning tree plus loop closures. Small candidate spaces are enumerated, with coordinate search used for larger ones. The result contains `connected`, `cameras`, `rotations`, and `confidence`.

A null camera is an explicit existing-sampler candidate. The first photo's rotation is fixed at zero. The estimator receives neither published textures nor synthetic camera/rotation truth.

`ROLLREGISTER.compose(images, registration, strips, opts)` assembles the prepared strips locally with crop-aware cosine weights and alpha validity. It supports whole-circle or partial rollout output. `opts.fullCircle`, `width`, and `height` make the yardstick output comparable to the existing baselines. It returns a canvas, coverage, start angle, and angular span, or null for a disconnected graph.

### Yardstick integration

`eval/rollout.js` adds true-rim and detected-rim estimated-camera/rotation pipelines, records rotation error and camera choices, and uses the production compositor for their displayed images and texture scores. The independent surface-coordinate scorer remains in place. Its known-camera check and negative controls still pass.

For real photos, `published()` independently runs both the existing reference-registered baseline and the new photo-only estimator. Automatic results are in `published[].automatic`. The report should expose the disconnected real result prominently.

## Validation already completed

- Full `node scripts/eval-rollout.js` completed with the current calibration/registration modules. The known-camera check passed, including the 0.5° limits and negative controls.
- JavaScript syntax checks and `git diff --check` passed.
- The compositor was exercised through the yardstick's automatic pipelines.
- The production app flow has not been smoke-tested with this implementation because integration is pending.

## Next steps for Claude

1. Fix real-photo registration and investigate the close-view synthetic rotation failures. Check feature uniqueness, vertical normalization, and tolerance for different camera elevations and taper. Preserve the photo-only estimator boundary and keep all failures in the yardstick. Re-run all 12 sets and compare the original baseline and current checkpoint.
2. Investigate the true-handle centre discrepancy without silently changing the old baseline. It is a diagnostic issue that can also affect user-adjusted handles.
3. Integrate into `rebuildStripCache()` in `js/core/unwarp.js` and `runStitch()` in `js/steps/4-stitch.js` once confidence and coverage criteria are justified. Cache estimates with the prepared strips, invalidate them after handle edits, additions/removals, and session loads, and preserve user crop/feather controls. Keep the hosted path available when reliable local registration cannot be established.
4. Test the normal upload → Map → Adjust → Stitch path with varied framing, shuffled photo order, partial coverage, old saved sessions, manual rim edits, and cancellation. Use isolated Playwright sessions. The user explicitly prefers terminal/GitHub CLI operations and is uncomfortable with access to their personal Chrome session.
5. Record final results in ROADMAP.md and update the PR description around the resulting implementation. Keep the PR in draft until app integration and real-photo behavior are ready.

## Reproduction on this machine

Repository `/Users/noah/Documents/ChatGPT/Rollout studio/rollout-studio`.

```sh
python3 scripts/fetch_rollout_references.py
node scripts/eval-rollout.js
```

Installed local runtime equivalents:

```sh
/private/tmp/rollout-rim-venv/bin/python scripts/fetch_rollout_references.py
PLAYWRIGHT_BROWSERS_PATH="$PWD/node_modules/.playwright-browsers" /Users/noah/.local/node/bin/node scripts/eval-rollout.js
```

The visual report and current JSON are generated under `eval/out/`. Fixture images and dependencies are gitignored. The current experiment snapshot is committed separately under `eval/automatic-rollout-results.json`.

GitHub CLI is `/private/tmp/rollout-gh/gh_2.105.0_macOS_arm64/bin/gh`, authenticated as `noahhowa`. The user authorized pushing and opening this handoff PR. They have not requested merging this PR.
