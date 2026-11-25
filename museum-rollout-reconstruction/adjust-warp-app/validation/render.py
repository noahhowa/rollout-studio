import json
import sys
from pathlib import Path

import cv2
import numpy as np


def load(path):
    image = cv2.imread(str(path))
    if image is None:
        raise ValueError(path)
    return image


def panel(image, title, width):
    canvas = np.full((image.shape[0] + 32, width, 3), 25, dtype=np.uint8)
    canvas[32:, :image.shape[1]] = image
    cv2.putText(canvas, title, (9, 22), cv2.FONT_HERSHEY_SIMPLEX, .55, (240, 240, 240), 1, cv2.LINE_AA)
    return canvas


def save(name, image):
    if not cv2.imwrite(str(out / name), image, [cv2.IMWRITE_JPEG_QUALITY, 93]):
        raise RuntimeError(name)


def crop(image, center, width=510, height=410):
    x, y = np.round(center).astype(int)
    x = int(np.clip(x - width // 2, 0, image.shape[1] - width))
    y = int(np.clip(y - height // 2, 0, image.shape[0] - height))
    return image[y:y+height, x:x+width]


folder, score_file, out = map(Path, sys.argv[1:])
out.mkdir(parents=True, exist_ok=True)
arms = ('baseline', 'adjusted')
images = [load(folder / (arm + '.png')) for arm in arms]
names = ['Adjust warp off', 'Adjust warp on']
width = min(1560, max(image.shape[1] for image in images))
scale = width / max(image.shape[1] for image in images)
scaled = [cv2.resize(im, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) for im in images]
save('full.jpg', np.vstack([panel(im, lbl, width) for im, lbl in zip(scaled, names)]))
scores = json.loads(score_file.read_text())[folder.name]
for index, (before, after) in enumerate(zip(*(scores['arms'][arm]['joins'] for arm in arms)), 1):
    if 'center' not in before or 'center' not in after:
        continue
    tiles = [crop(im, row['center']) for im, row in zip(images, [before, after])]
    pair = ' / '.join(scores['photoOrder'][i] for i in (index-1, index))
    panels = [panel(im, f'{lbl}   |   Photos {pair}', 510) for im, lbl in zip(tiles, names)]
    save(f'join-{index}.jpg', np.hstack(panels))
