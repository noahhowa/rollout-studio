# Adjust overlap warp on the current Hugging Face pipeline

This follow-up to [PR #24](https://github.com/noahhowa/rollout-studio/pull/24) uses app commit `849a4f1`. Both arms used the same source photos, Map rim detection and unwarp, order, crop, 12% feather, and Hugging Face stitcher. Outputs are before Refine. The Met uses the same nine stills and two batches as PR #22, with the first panorama re-encoded as the first input to batch two.

| Vessel | Crop per side | App fit holdout, % of height | Vertical median, px | Total median, px |
| --- | ---: | ---: | ---: | ---: |
| Met 310364 | 14% | 0.98 → 0.26 | 1.85 → 2.03 | 4.13 → 4.11 |
| LACMA 168693 | 8% | 0.24 → 0.18 | 3.18 → 2.50 | 3.78 → 3.39 |

The output metrics are the median of the per-join medians. We register the source strips to each returned image and measure the separation of matched landmarks after projection. This estimates alignment where blending can create doubled paint. The close-ups show the visible result.

## Met 310364

[Full comparison](met-310364/full.jpg) · [Warp off](met-310364/baseline.png) · [Warp on](met-310364/adjusted.png) · [Measurements](met-310364/measurements.json)

Five of eight joins have higher vertical mismatch with the warp. The largest rise in total mismatch is 4.29 → 6.06 px at photos 06/08. The 07/04 join improves from 5.03 to 4.37 px total, and part of the linework is more distinct, though doubled paint remains. The jumbled base and doubled center strokes remain visible in the full view.

[Join 1](met-310364/join-1.jpg) · [Join 2](met-310364/join-2.jpg) · [Join 3](met-310364/join-3.jpg) · [Join 4](met-310364/join-4.jpg) · [Join 5](met-310364/join-5.jpg) · [Join 6](met-310364/join-6.jpg) · [Join 7](met-310364/join-7.jpg) · [Join 8](met-310364/join-8.jpg)

## LACMA 168693

[Full comparison](lacma-168693/full.jpg) · [Warp off](lacma-168693/baseline.png) · [Warp on](lacma-168693/adjusted.png) · [Measurements](lacma-168693/measurements.json)

All three joins have slightly lower median vertical and total mismatch. The visible changes are small. Residual doubled paint and lower-band curvature remain. The 14% crop [failed at the Space on the control](lacma-168693/rejected-14-percent-crop.events.txt), and the local backend alignment routines had insufficient RANSAC support at that crop in both arms. The comparison uses the earlier 8% crop in both arms.

[Join 1](lacma-168693/join-1.jpg) · [Join 2](lacma-168693/join-2.jpg) · [Join 3](lacma-168693/join-3.jpg)

## Reproduce

Run from the repository root with the public source stills in each test set's `photos` directory, Playwright with Chromium, Python, NumPy, and OpenCV. Use `FILES` if the Met directory includes additional photos. `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome` uses an installed Chrome.

```bash
app=museum-rollout-reconstruction/adjust-warp-app
testdir=museum-rollout-reconstruction/adjust-hf-test
export RUN_ROOT=/tmp/rollout-adjust-runs
export VESSELS="met-310364 lacma-168693"
for vessel in $VESSELS; do
  if [ "$vessel" = met-310364 ]; then
    export ADJUST_CROP=.14 FILES=01.jpg,03.jpg,04.jpg,05.jpg,06.jpg,07.jpg,08.jpg,09.jpg,10.jpg
  else
    export ADJUST_CROP=.08 FILES=01.jpg,02.jpg,03.jpg,04.jpg
  fi
  NOWARP=1 EXPORT_FULL=1 node "$app/fit-in-app.cjs" "$vessel" "$RUN_ROOT/$vessel/baseline"
  node "$app/fit-in-app.cjs" "$vessel" "$RUN_ROOT/$vessel/adjusted"
done
ARMS="baseline adjusted" bash "$testdir/resume/run-expanded-adjust.sh"

# Set BACKEND to the Space's published panorama_stitch_memsafe.py.
python3 "$testdir/measure-expanded.py" "$BACKEND" "$RUN_ROOT" "$RUN_ROOT/met.json" \
  --crop .14 --case met-310364
python3 "$testdir/measure-expanded.py" "$BACKEND" "$RUN_ROOT" "$RUN_ROOT/lacma.json" \
  --crop .08 --case lacma-168693
```

The Space receipts and full fits accompany the images. The held-out fit gain alone did not predict a cleaner Met stitch. These results support leaving the warp opt-in and continuing seam research from the source strips.
