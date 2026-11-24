# Bounded vertical Adjust experiment

Open [the Hugging Face A/B report](comparison.html). The final PNGs were downloaded directly from the configured Space. Map runs from merge commit `0bd5465`. This prototype is outside the production checkout.

From the Rollout Studio checkout with Playwright and Chromium, run `prepare-strips.cjs PHOTO_DIR WORK_DIR` to save baseline strips and full Map strips. Set `ADJUST_CROP=.08` for the comparison crop. Estimate the correction with `fit-adjust.py WORK_DIR/full WORK_DIR/coefficients.json` using Python, NumPy, and OpenCV. Run the same Node command again with `WORK_DIR/coefficients.json` as the third argument. The resulting `baseline` and `adjusted` arm directories contain the JPEGs submitted to Hugging Face.

Run `run-hf.py WORK_DIR/baseline WORK_DIR/baseline.png` and then `run-hf.py WORK_DIR/adjusted WORK_DIR/adjusted.png` for fresh jobs. Use a new output filename for a new job. The service baseline for this report used the four public photos of LACMA 168693 in numerical order. Both arms used the same crop and runtime.

For seam measurement, download the Space’s public `panorama_stitch_memsafe.py` as a local file and pass it to `measure-overlaps.py` as the first argument, followed by the full strips directory, working directory, coefficients JSON path, and output JSON path. The Space code seeds the source-to-panorama registration. The measurement then uses feature matches to each returned panorama.
