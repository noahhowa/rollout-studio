# Alignment handoff

Start with the [Hugging Face before-and-after comparisons](lacma-adjust-comparison/comparison.html). The production candidate is the bounded vertical correction before Stitch. The custom seam experiments below are research.

## Promote the bounded Adjust warp

Map detects the rim and base and unwarps each source photo. Keep that path and the Hugging Face backend. Port the [source-only overlap fit](../fit-adjust.py) and [bounded inverse remap](../prepare-strips.cjs) into Adjust, initially as an opt-in control. Fit on the full Map strips and apply the same saved crop and feather after warping. The prototype uses normalized coordinates, regularizes the per-strip fit, caps displacement at 3% of strip height, and tapers to zero at the rim and base. It declines disconnected overlaps and fits that fail the spatial holdout. A declined fit should submit the original strips and leave Adjust usable.

Use the matched control and adjusted inputs on Met 310364, LACMA 168596, and LACMA 168693. Compare the actual HF output before Refine, with identical input ordering, crop, feather, and stitch settings. Review both the full rollouts and seam crops. Include cases with weak or disconnected overlap and check the fallback. The existing evidence is mixed across joins. LACMA 168596 has a more level right third, with better total landmark agreement at all three measured joins and better vertical agreement at one. LACMA 168693 has modest vertical improvements, with a visible lower seam remaining. This PR packages the evidence and prototype for integration.

[PR #22](https://github.com/noahhowa/rollout-studio/pull/22) contains the first A/B runs and receipts. The [expanded inputs and outputs](../resume/adjust-expanded) include Met and 168596. The [168693 inputs](../resume/adjust-wide-168693) and [HF outputs](../images) are also here. The source URLs for the LACMA stills are in the corresponding test-set metadata.

## Seam and base experiments

- [Nonlinear vertical fit versus scale](nonlinear-vertical-comparison/comparison.html). The bounded per-strip quadratic passed the Met overlap holdout but left visible base steps. The gate rejected the LACMA candidate. The independent base-edge fit gave a better visual result at the Met red band and declined on the LACMA runs for lack of evidence.
- [Met lighting and base finish](met-seam-finish/comparison.html). A wide low-frequency light blend softens illumination changes while a narrow blend handles fine painted detail. A bottom trim is a display choice. The hard geometry breaks can persist through either.
- [Automatic stroke-aware merge with bounded overlap flow](source-overlap-alignment/comparison.html). The Met short stroke became single but acquired a pointed join and the outer contour broke. The stroke-crossing count missed those regressions. The source-only controls and overlays are in [Met](met-source-only-stroke) and [LACMA](source-only-stroke-other).
- [Met manual seam detour](met-stroke-protection/reroute-three-way.jpg). Source view 3 carries both curves through the marked region. The alternate direct patch improved the contours but left a visible boundary. The full detour and overlay are saved beside the crop. Automatic source selection and detouring across all Met joins remain open.
- [LACMA 168693 marked lower border](lacma-base-seam/comparison.jpg). A local vertical correction traces both parallel painted lines from the neighboring strips before the existing stitch and blend. The painted lines meet more evenly while a small silhouette step remains. The fit is a hand-targeted prototype, with the original output reproduced byte-for-byte as the control.
- [Reference-guided research](reference-research) preserves the separate exploratory scripts. The museum rollout was an input to those experiments only. Their diagnostics are under [local](met-reference-guided) and [full](met-full-reference-merge) reference-guided runs. Museum rollout images and private attachments are omitted from this package.

## Reproduce the latest source-only comparisons

From the directory containing this README, use Python with NumPy and OpenCV. These commands use the saved source strips, so they require no network or Space jobs.

```sh
met=../resume/adjust-expanded/met-310364/adjusted
lacma=../resume/adjust-wide-168693/adjusted

python3 ../base-profile-align.py "$met" 0,8,3,7,4,6,1,5,2 met-rerouted.png \
  --stroke-aware --light-blend 64 --protect 3,1400,555,1705,860

python3 ../base-profile-align.py "$lacma" 0,1,2,3 lacma-control.png \
  --stroke-aware --light-blend 64 --local-alignment 18

python3 lacma-base-seam/painted-base-test.py ../base-profile-align.py "$lacma" \
  0,1,2,3 lacma-painted-base.png --stroke-aware --light-blend 64 --local-alignment 18
```

Each command writes a full panorama, seam overlay, and diagnostics. For the next seam experiment, search for source views that cover both sides of an interrupted stroke, then reroute only if the whole protected region has valid support and the detour avoids introducing a new visible cut. Compare full Met coverage and same-scale before-and-after crops at each moved join, using the museum rollout only after reconstruction.
