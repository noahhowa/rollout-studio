# Rollout Studio

Turn several photos of a cylindrical object (cup, can, bottle) into one flat "rollout" image of its surface.

Live: https://noahhowa.github.io/rollout-studio/

## How it works

1. **Upload**: 2+ overlapping photos taken while rotating the object.
2. **Map**: the top and bottom rim of each photo are found automatically (adjustable by dragging).
3. **Adjust**: each photo is unwarped into a flat strip; crop and feather the strips.
4. **Stitch**: strips are sent to a Hugging Face Space (`noahhowa-image-stitch-fork`) and stitched.
5. **Refine**: trace the edges of the stitched result and rectify it.

## Layout

No build step. Plain scripts that share globals and are loaded in order by `index.html`, so it's served as-is by GitHub Pages.

```
index.html              page shell + Google Analytics tag
css/styles.css          all styles
js/i18n.js              EN/ES strings, t(), setLang()
js/state.js             config constants (HF endpoint, loupe sizes) and shared state
js/ui/                  about page, confirm modal, stepper/navigation
js/core/rim-detect.js   object bounds, initial rim guess, edge-snapping (DP seam + ellipse prior)
js/core/unwarp.js       rim geometry, cylinder -> flat strip, vignette, crop, feather
js/steps/1-upload.js … 5-refine.js   one file per step of the wizard
js/main.js              boot
```

Script order matters (`state.js` before anything that reads state); see `index.html`.

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. (Opening the file directly also mostly works, but a server is closer to Pages.)

See [ROADMAP.md](ROADMAP.md) for planned improvements.
