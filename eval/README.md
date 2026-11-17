# Eval harness

Runs the app's real rim-detection and unwarp code (`js/core/*`) headlessly on:
- **synthetic cylinders**, ray-traced with a known camera (`synth.js`), which give exact rims and texture, so they're **scored**;
- **real test sets** (`../test-sets/`), which are shown **visually** next to the published rollout where one exists.

```bash
python3 scripts/fetch_test_sets.py   # once, downloads the real photos
node scripts/eval.js                 # writes eval/out/report.html + scores.json
```

Open `eval/out/report.html` to check results by eye.

**Adding a detector:** add a function to `pipelines.js` (canvas -> rim structure). It becomes a new row in the summary and a new strip on every case.

Scores:
- *rim err %H*: mean vertical distance between detected and true rim, as % of vessel height.
- *angle err*: median degrees between where the unwarp places surface content and where it truly is, by band of angle from the facing direction. The **oracle** row uses perfect rims, so its error is purely the unwarp's flat (orthographic) model, i.e. the depth-distortion problem.
