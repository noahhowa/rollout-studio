#!/usr/bin/env python3
"""Seam-based merge prototype: no ghosting by construction.

Input: cylinder-flattened strips (Map + Adjust output, as uploaded to the Space) in order around
the vessel. Each strip is placed by a pure shift (no rotation or scale: the strips are already
flattened, so neighbours differ by a translation). In every overlap a minimum-difference seam is
cut top to bottom; each pixel comes from one strip only, with a narrow crossfade at the seam and
per-strip gain matching. Paint is never averaged from two misaligned photos, so it cannot double.

Usage: seam-stitch.py STRIP_DIR "0,1,2,3" OUT.png [REPORT.json]
"""
import json
import sys

import cv2
import numpy as np


def shift_between(a, b):
    """Translation (dx, dy) placing strip b relative to strip a, from SIFT matches + consensus."""
    sift = cv2.SIFT_create(nfeatures=8000)
    ga, gb = (cv2.cvtColor(x, cv2.COLOR_BGR2GRAY) for x in (a, b))
    ka, da = sift.detectAndCompute(ga, None)
    kb, db = sift.detectAndCompute(gb, None)
    matches = cv2.BFMatcher().knnMatch(da, db, k=2)
    d = np.array([np.subtract(ka[m.queryIdx].pt, kb[m.trainIdx].pt)
                  for m, n in (p for p in matches if len(p) == 2) if m.distance < 0.75 * n.distance])
    W = a.shape[1]
    d = d[(np.abs(d[:, 0]) > 0.15 * W) & (np.abs(d[:, 0]) < 0.97 * W)]  # overlapping, either side
    if len(d) < 8:
        raise RuntimeError("too few matches")
    # consensus: the displacement most other displacements agree with (within 3 px)
    best = max(range(len(d)), key=lambda i: np.sum(np.linalg.norm(d - d[i], axis=1) < 3))
    inl = d[np.linalg.norm(d - d[best], axis=1) < 3]
    return np.median(inl, axis=0), len(inl), len(d)


def seam_path(cost, lo, hi):
    """Min-cost top-to-bottom path through cost[:, lo:hi], moving at most 1 column per row."""
    c = cost[:, lo:hi].astype(np.float64)
    H, Wc = c.shape
    acc = c.copy()
    back = np.zeros((H, Wc), np.int8)
    for y in range(1, H):
        prev = acc[y - 1]
        left = np.r_[np.inf, prev[:-1]]
        right = np.r_[prev[1:], np.inf]
        stack = np.vstack([left, prev, right])
        k = np.argmin(stack, axis=0)
        acc[y] += stack[k, np.arange(Wc)]
        back[y] = k - 1
    x = int(np.argmin(acc[-1]))
    path = np.zeros(H, int)
    for y in range(H - 1, -1, -1):
        path[y] = x + lo
        x = min(Wc - 1, max(0, x + int(back[y, x])))
    return path


def place(strips):
    """Order-free placement: measure the shift between every pair, keep reliable ones, grow a
    maximum-spanning tree of the strongest matches from strip 0, then sort strips left to right."""
    n = len(strips)
    edges = []
    for i in range(n):
        for j in range(i + 1, n):
            try:
                s, ninl, nm = shift_between(strips[i], strips[j])
            except RuntimeError:
                continue
            if ninl >= 25:
                edges.append((ninl, i, j, s))
    pos = {0: np.zeros(2)}
    while len(pos) < n:
        cand = [(w, i, j, s) for w, i, j, s in edges if (i in pos) != (j in pos)]
        if not cand:
            raise RuntimeError(f"strips {sorted(set(range(n)) - set(pos))} could not be placed")
        w, i, j, s = max(cand, key=lambda e: e[0])
        if i in pos:
            pos[j] = pos[i] + s
        else:
            pos[i] = pos[j] - s
    order = sorted(range(n), key=lambda k: pos[k][0])
    return order, [pos[k] for k in order]


def stitch(strips, feather=4):
    order, P = place(strips)
    strips = [strips[k] for k in order]
    n = len(strips)
    pos = [p - P[0] for p in P]
    info = [{"join": [order[i], order[i + 1]], "dx": round(float(pos[i + 1][0] - pos[i][0]), 1),
             "dy": round(float(pos[i + 1][1] - pos[i][1]), 1)} for i in range(n - 1)]
    pos = np.array(pos)
    pos[:, 1] -= pos[:, 1].min()
    off = np.round(pos).astype(int)
    Wc = int(max(off[i, 0] + strips[i].shape[1] for i in range(n)))
    Hc = int(max(off[i, 1] + strips[i].shape[0] for i in range(n)))
    layers, valid = [], []
    for i, s in enumerate(strips):
        L = np.zeros((Hc, Wc, 3), np.float32)
        V = np.zeros((Hc, Wc), bool)
        x, y = off[i]
        L[y:y + s.shape[0], x:x + s.shape[1]] = s
        V[y:y + s.shape[0], x:x + s.shape[1]] = s.sum(axis=2) > 6  # black padding is not content
        layers.append(L)
        valid.append(V)
    # gain matching, chained through overlaps, normalised to mean 1
    gain = [np.ones(3)]
    for i in range(n - 1):
        m = valid[i] & valid[i + 1]
        ga = layers[i][m].mean(axis=0) * gain[i]
        gb = layers[i + 1][m].mean(axis=0)
        gain.append(ga / np.maximum(gb, 1))
    gain = np.array(gain) / np.mean(gain, axis=0)
    layers = [L * g for L, g in zip(layers, gain)]
    # compose left to right: the new strip owns everything right of the seam
    out = layers[0].copy()
    have = valid[0].copy()
    for i in range(1, n):
        both = have & valid[i]
        cols = np.where(both.any(axis=0))[0]
        if len(cols) < 10:
            raise RuntimeError(f"join {i - 1}-{i}: no overlap")
        a, b = cols[0], cols[-1]
        lo, hi = int(a + 0.2 * (b - a)), int(a + 0.8 * (b - a))
        diff = np.abs(out - layers[i]).sum(axis=2)
        diff = cv2.GaussianBlur(diff, (5, 5), 0)
        diff[~both] = 1e4  # never cut through a region one strip doesn't cover
        path = seam_path(diff, lo, hi)
        xs = np.arange(Wc)[None, :]
        dist = xs - path[:, None]  # >0: right of seam
        w = np.clip((dist + feather) / (2 * feather), 0, 1)  # 0 left .. 1 right, narrow ramp
        w = np.where(valid[i], w, 0)
        w = np.where(have, w, np.where(valid[i], 1, 0))
        out = out * (1 - w[..., None]) + layers[i] * w[..., None]
        have |= valid[i]
        rows = np.arange(Hc)
        ok = both[rows, path]
        info[i - 1].update({"seamX": [int(path.min()), int(path.max())], "overlapCols": [int(a), int(b)],
                            "seamMeanDiff": round(float(np.median(diff[rows[ok], path[ok]])), 2) if ok.any() else None,
                            "center": [int(np.median(path[ok])) if ok.any() else int((a + b) / 2), int(Hc / 2)]})
    out[~have] = 0
    return np.clip(out, 0, 255).astype(np.uint8), info, gain.tolist()


if __name__ == "__main__":
    folder, order, outp = sys.argv[1], [int(v) for v in sys.argv[2].split(",")], sys.argv[3]
    strips = [cv2.imread(f"{folder}/strip_{i}.jpg") for i in order]
    pano, info, gain = stitch(strips)  # placement order is found from the images
    cv2.imwrite(outp, pano)
    rep = {"order": order, "size": [pano.shape[1], pano.shape[0]], "joins": info, "gains": gain}
    print(json.dumps(rep, indent=1))
    if len(sys.argv) > 4:
        json.dump(rep, open(sys.argv[4], "w"), indent=1)
