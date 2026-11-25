# Handoff for Claude: Adjust correction and ghosting

Finish the controlled Hugging Face comparisons for Met 310364 and LACMA 168596. Keep the shipped Map at `0bd5465`, the same source views, order, and crop within each comparison, and inspect the returned panoramas before Refine. Probe ghosting separately by comparing corrected strips at 12% and 4% Adjust feathering. The Space remains the stitcher. This is a local prototype and the production checkout has no implementation diff for it.

## What is done

- The earlier LACMA 168693 A/B is complete in [comparison.html](comparison.html). At common 8–92% crop, median vertical mismatch improved at all three joins (3.18→1.83, 3.65→2.28, 2.47→2.07 px). Both arms had failed at the narrower default crop.
- The two new cases use the same 8–92% crop and 12% feathering in both main arms. The warp is vertical only, capped at 3% of strip height and tapered to zero at top and bottom.
- The overlap holdout before Stitch improved from 0.858% to 0.225% of strip height for Met (19,922 landmarks) and 0.495% to 0.206% for LACMA 168596 (1,407). These are preflight results, independent of the eventual seam assessment.
- The checked-in snapshot in `resume/adjust-expanded/` contains all four completed main-arm PNGs, full Map strips, upload JPEGs, 4%-feather input JPEGs, coefficients, and job receipts. The 4%-feather arms still need to run.

## Resume from the repository root

1. Use the checked-out branch as-is. The prepared inputs require no original stills or local workspace. Install Python with NumPy and OpenCV. Install Playwright and its Chromium browser for encoding the Met intermediate panorama.
2. Run `ARMS=lower-feather bash museum-rollout-reconstruction/adjust-hf-test/resume/run-expanded-adjust.sh`. The runner writes into the checked-in snapshot directory, skips existing finals, and submits jobs sequentially. Met order is 01, 10, 05, 09, 06, 08, 03, 07, 04. It uses the app's two-batch workflow. LACMA uses 01–04 in one batch.
3. Compare the 4%-feather arm to corrected 12% feathering. Use the same photo order, split, and crop.

4. Run `measure-expanded.py BACKEND.py RUNS_DIR OUTPUT.json` with Python, OpenCV, and NumPy. `resume/adjust-hf-stitch.py` is the downloaded public numeric backend and seeds the strip-to-returned-panorama registration. The measurement script had been written but not yet run end-to-end on these two cases. Check for missing files or weak source registrations and report those explicitly. Use `museum-rollout-reconstruction/adjust-hf-test/resume/adjust-expanded` as RUNS_DIR.
5. Build a report with actual pre-Refine panoramas and same-scale crops around the reported overlaps. Use vertical mismatch to evaluate the warp. Use total mismatch as a ghosting-risk proxy and visually confirm doubled paint strokes. A smaller geometric residual alone cannot establish that a blended image has less visible ghosting. If the lower-feather run trades sharpness for harder exposure joins, show that tradeoff.

Keep the work local unless explicitly asked to publish or open a PR. Existing `prepare-strips.cjs`, `fit-adjust.py`, `run-hf.py`, and `measure-expanded.py` are alongside this handoff.
