# Met reference-guided merge

- [Highlighted stroke comparison](marked-stroke.jpg) shows the earlier seam merge (registered by an affine for display), the new reconstruction, and the museum rollout at the same scale.
- [Registration comparison](registration-steps.jpg) shows landmark alignment, bounded local optical flow, and the single-source region.
- [Full reconstruction](protected.png) uses pixels from the source stills. Black margins indicate uncovered reference coordinates.
- [Diagnostics](diagnostics.json) record the chosen source, patch coordinates, and motion bounds.

The warp uses the published rollout as a reference, so this is a same-vessel research experiment. The marked region was selected manually. To reproduce locally, run `museum-rollout-reconstruction/prototype/reference-local-merge.py` with the Met data folder and an output directory. The data folder must contain the museum crop `target.jpg` and the existing Map strips named `NN-auto.png`. The script requires NumPy and OpenCV. It does not run the production app or Stitch.
