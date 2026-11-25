#!/usr/bin/env python3
"""Seam-based merge prototype: no ghosting by construction.

Input: cylinder-flattened strips (Map + Adjust output, as uploaded to the Space) in order around
the vessel. Each strip is placed by a shift plus a vertical scale (no rotation: the strips are already
flattened, but per-photo rim detection can leave them slightly taller or shorter). In every overlap a minimum-difference seam is
cut top to bottom; each pixel comes from one strip only, with a narrow crossfade at the seam and
per-strip gain matching. Paint is never averaged from two misaligned photos, so it cannot double.

Usage: seam-stitch.py STRIP_DIR "0,1,2,3" OUT.png [REPORT.json]
"""
import json
import sys

import cv2
import numpy as np


def shift_between(a, b):
    """Map strip b into strip a's frame: x_a = x_b + tx, y_a = sy * y_b + ty.
    The vertical scale sy absorbs strips that came out of the Map step slightly taller or shorter
    (rim/base detection differs per photo); a pure shift can align only the middle of the band."""
    sift = cv2.SIFT_create(nfeatures=8000)
    ga, gb = (cv2.cvtColor(x, cv2.COLOR_BGR2GRAY) for x in (a, b))
    ka, da = sift.detectAndCompute(ga, None)
    kb, db = sift.detectAndCompute(gb, None)
    matches = cv2.BFMatcher().knnMatch(da, db, k=2)
    pr = np.array([ka[m.queryIdx].pt + kb[m.trainIdx].pt
                   for m, n in (p for p in matches if len(p) == 2) if m.distance < 0.75 * n.distance])
    if len(pr) < 8:
        raise RuntimeError("too few matches")
    W = a.shape[1]
    dx = pr[:, 0] - pr[:, 2]
    pr, dx = pr[(np.abs(dx) > 0.15 * W) & (np.abs(dx) < 0.97 * W)], dx[(np.abs(dx) > 0.15 * W) & (np.abs(dx) < 0.97 * W)]
    if len(pr) < 8:
        raise RuntimeError("too few matches")
    # consensus on dx (scale does not change it), then a robust line y_a = sy * y_b + ty
    best = max(range(len(dx)), key=lambda i: np.sum(np.abs(dx - dx[i]) < 3))
    pr = pr[np.abs(dx - dx[best]) < 3]
    if len(pr) < 8:
        raise RuntimeError("too few consistent matches")
    ya, yb = pr[:, 1], pr[:, 3]
    rng = np.random.default_rng(0)
    bs, bt, bn = 1.0, float(np.median(ya - yb)), 0
    for _ in range(300):
        i, j = rng.choice(len(ya), 2, replace=False)
        if abs(yb[i] - yb[j]) < 0.2 * a.shape[0]:
            continue
        sy = (ya[i] - ya[j]) / (yb[i] - yb[j])
        if not 0.85 < sy < 1.15:
            continue
        ty = ya[i] - sy * yb[i]
        n = np.sum(np.abs(sy * yb + ty - ya) < 2)
        if n > bn:
            bs, bt, bn = sy, ty, n
    inl = np.abs(bs * yb + bt - ya) < 2
    if inl.sum() >= 8 and np.ptp(yb[inl]) > 0.3 * a.shape[0]:  # refit on inliers if they span the band
        bs, bt = np.polyfit(yb[inl], ya[inl], 1)
    else:  # not enough vertical spread to trust a scale: fall back to a shift
        bs, inl = 1.0, np.abs(ya - yb - np.median(ya - yb)) < 3
        bt = float(np.median((ya - yb)[inl]))
    tx = float(np.median((pr[:, 0] - pr[:, 2])[inl]))
    return (tx, float(bs), float(bt)), int(inl.sum()), len(pr)


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
    # pose k: x_0 = x_k + X, y_0 = S * y_k + T (strip 0's frame)
    pos = {0: (0.0, 1.0, 0.0)}
    while len(pos) < n:
        cand = [(w, i, j, s) for w, i, j, s in edges if (i in pos) != (j in pos)]
        if not cand:
            raise RuntimeError(f"strips {sorted(set(range(n)) - set(pos))} could not be placed")
        w, i, j, (tx, sy, ty) = max(cand, key=lambda e: e[0])
        if i in pos:  # j -> i -> 0
            X, S, T = pos[i]
            pos[j] = (X + tx, S * sy, S * ty + T)
        else:  # i -> j -> 0, with the inverse of (j -> i)
            X, S, T = pos[j]
            pos[i] = (X - tx, S / sy, T - S * ty / sy)
    order = sorted(range(n), key=lambda k: pos[k][0])
    return order, [pos[k] for k in order]


def stitch(strips, feather=4):
    order, P = place(strips)
    n = len(order)
    S = np.array([p[1] for p in P])
    S = S / np.exp(np.mean(np.log(S)))  # keep the average strip height unchanged
    # resample each strip vertically to the common scale
    strips = [cv2.resize(strips[k], (strips[k].shape[1], int(round(strips[k].shape[0] * S[i]))),
                         interpolation=cv2.INTER_CUBIC) for i, k in enumerate(order)]
    norm = np.exp(np.mean(np.log([p[1] for p in P])))
    pos = np.array([[P[i][0] - P[0][0], P[i][2] / norm] for i in range(n)])
    info = [{"join": [order[i], order[i + 1]], "dx": round(float(pos[i + 1][0] - pos[i][0]), 1),
             "dy": round(float(pos[i + 1][1] - pos[i][1]), 1), "scale": round(float(S[i + 1] / S[i]), 4)}
            for i in range(n - 1)]
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
