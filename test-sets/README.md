# Test sets

Real photo sets of cylindrical vessels, used to evaluate rim detection and unwarping (see ../ROADMAP.md, Phase 1).

```
test-sets/
  manifest.json            list of sources (committed)
  <set-id>/
    meta.json              title, dimensions, source URL, image list (committed)
    photos/                views of the object, 01.jpg, 02.jpg, ... (gitignored)
    rollout/               a published rollout photo, if any: ground truth (gitignored)
    session.json           hand-corrected rims exported from the app (committed, once made)
```

Download or refresh the photos:

```bash
python3 scripts/fetch_test_sets.py            # all sets
python3 scripts/fetch_test_sets.py met-310364 # one set
```

The script grabs every image it can find on each page. Afterwards, move any rollout (flattened) photo from `photos/` into `rollout/`, and delete detail shots that don't show the whole vessel.

Images are third-party (auction houses/museums) and are **not committed**. The Met's Open Access images are public domain and could be committed if wanted.

## Current sets

| Set | Photos | Rollout (ground truth) | Notes |
|---|---|---|---|
| met-310364 | 10 | yes | Public domain. Two lighting setups (grey bg, dark bg) |
| pca4sale-446 | 5 | yes | Kerr K937. Rotating views, ~72° apart |
| sothebys-2026-maya-tall-polychrome-vessel | 5 | no | Rotating views, tall cylinder, floor visible |
| sothebys-2024-vase-maya | 4 | no | Waisted (concave) profile: a non-cylinder test case |
| sothebys-2023-grand-vase-cylindrique-600 | 5 | no | Tall, narrow; strong red, easy rims |
| christies-6303183, drouot-10888511, drouot-33050565 | – | – | Sites block scripts: add photos by hand |
