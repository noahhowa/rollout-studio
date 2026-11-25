# Claude handoff for overlap-aware crop fallback

The second opportunity in the photo-to-rollout pipeline is stitch reliability. The default Adjust crop removes 14% on each side of each Map strip. Some photo sets lose the overlap Hugging Face needs. A smaller crop retains more overlap but also lets more stretched edge pixels into the match and blend.

Keep the default crop on reliable inputs. Prototype a bounded fallback to a wider crop only when an ordered overlap is weak and the wider crop improves it. This work belongs at the Adjust-to-Stitch boundary and can proceed independently of selective seam compositing. Use only the source strips for decisions. Use the museum rollout after stitching for evaluation.

## Evidence

The baseline used Map and Refine from `849a4f1`, Adjust warp off, actual Hugging Face Stitch, and 12% feather. The arms held photos, order, and batching constant within each vessel. LACMA 168693's 14% control returned an error. The published backend's local RANSAC check found only 4 of 47 inliers at that crop. At 8%, the weakest pair had 18 of 85 inliers and the Space returned a panorama. Both crops returned on the other vessels.

| Vessel | 14% crop after Refine | 8% crop after Refine |
| --- | --- | --- |
| Met 310364 | 0.85% median error, 45/48 supported reference tiles | 0.77%, 40/48 |
| LACMA 168596 | 0.85%, 46/48 | 0.92%, 36/48 |
| LACMA 168693 | Space rejected | 0.81%, 45/48 |

Error is measured on painted landmarks against the published rollout as a percentage of band height. The tile count reflects the spatial support of close matches, not pixel coverage. Before Refine, LACMA 168596's 8% crop also had much worse tail error, 5.86% vs 2.09%. Successful defaults are important controls.

## Implement and validate

1. Reuse the production Map strips and evaluate matching support for the actual ordered joins. If testing multiple crops, reuse the source evidence and count which correspondences survive each crop. Require spatial spread and geometric agreement in addition to match count. Start with the current 14% crop and test 8% as a fallback. Treat uncertain overlap as a suggestion to the user until held-out validation supports automation.
2. Respect manually set crops, project persistence, and any requested order. Keep the first iteration outside the production Stitch path. If validated, apply the fallback as a one-run crop suggestion or use a bounded retry for a verified alignment failure. Preserve batch ordering, cancellation, and the Hugging Face endpoint. A generic API error also covers outages or unrelated failures, so it cannot identify a weak overlap on its own.
3. Compare against the fixed crop on LACMA 168693 and several held-out runs. Record stitch completion, elapsed time, obvious ghosting and seams, and landmark agreement or supported reference tiles after Refine. Check full outputs alongside close-ups. Keep the default when the fallback hurts successful runs. Include a no-overlap case and a manually cropped case.
4. Keep placement, seam composition, Refine and the experimental Adjust warp outside this change. Keep all reference images and any unpublished sources out of the PR.

Reproduce crop exports with [the app fixture](../adjust-warp-app/fit-in-app.cjs). The expanded [measurement helpers](../adjust-hf-test/measure-overlaps.py) can load the published Space alignment routines for a diagnostic comparison. [PR #25](https://github.com/noahhowa/rollout-studio/pull/25) includes the 168693 failure receipt, app fixture options, and matched Space runner.
