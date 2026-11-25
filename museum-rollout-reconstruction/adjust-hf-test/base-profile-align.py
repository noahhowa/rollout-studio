"""Research-only base alignment. Imports scale placement and seam cut from seam-stitch.py."""
import argparse
import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np

from overlap_flow import align_overlap


def load_stitch():
    path = Path(__file__).with_name("seam-stitch.py")
    spec = importlib.util.spec_from_file_location("seam_stitch", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def projection(strip, start, stop):
    gray = cv2.cvtColor(strip[:, start:stop], cv2.COLOR_BGR2GRAY).astype(np.float32)
    smooth = cv2.GaussianBlur(gray, (15, 5), 0)
    gradient = cv2.Sobel(smooth, cv2.CV_32F, 0, 1, ksize=3, scale=.25)
    return np.median(gradient, axis=1)


def estimate_pair(a, b, offset_a, offset_b):
    ax, ay = offset_a
    bx, by = offset_b
    ah, aw = a.shape[:2]
    bh, bw = b.shape[:2]
    start = max(ax + round(.13 * aw), bx + round(.13 * bw))
    stop = min(ax + round(.87 * aw), bx + round(.87 * bw))
    top = max(ay + round(.88 * ah), by + round(.88 * bh))
    bottom = min(ay + round(.956 * ah), by + round(.956 * bh))
    if stop - start < 80 or bottom - top < 35:
        return
    # Adjacent windows are independent enough to reject overfitting spatially.
    boundaries = np.linspace(start, stop, 1 + max(2, round((stop-start)/75)), dtype=int)
    for left, right in zip(boundaries[:-1], boundaries[1:]):
        lhs = projection(a, left-ax, right-ax)[top-ay:bottom-ay]
        rhs = projection(b, left-bx, right-bx)
        lhs -= lhs.mean()
        scores = []
        for lag in range(-14, 15):
            match = rhs[top-by+lag:bottom-by+lag].copy()
            match -= match.mean()
            norm = np.linalg.norm(lhs) * np.linalg.norm(match)
            scores.append(float(np.dot(lhs, match) / max(norm, 1e-6)))
        scores = np.asarray(scores)
        # Prefer smaller offsets where two repeated horizontal strokes look alike.
        ranking = scores - .004 * np.abs(np.arange(-14, 15))
        best = int(ranking.argmax())
        other = np.abs(np.arange(len(scores)) - best) > 2
        if best in (0, 28) or scores[best] < .55 or ranking[best] - ranking[other].max() < .07:
            continue
        center = (left+right)/2
        yield center, (center-ax)/aw - .5, (center-bx)/bw - .5, best-14, scores[best]


def fit_offsets(strips, offsets):
    n = len(strips)
    rows, delta, weights, centers, pairs = [], [], [], [], []
    for i in range(n):
        for j in range(i + 1, n):
            for x, u, v, shift, confidence in estimate_pair(strips[i], strips[j], offsets[i], offsets[j]):
                row = np.zeros(2*n)
                row[2*i:2*i+2] = [1, u]
                row[2*j:2*j+2] = [-1, -v]
                rows.append(row)
                delta.append(shift)
                weights.append(confidence)
                centers.append(x)
                pairs.append((i,j))
    if len(rows) < 8:
        return np.zeros((n, 2)), {"anchors": len(rows), "status": "insufficient evidence"}
    rows, delta, weights = map(np.asarray, (rows, delta, weights))

    def solve(A, b, w):
        penalty = np.tile([.65, 2.2], n)
        for _ in range(4):
            x = np.linalg.lstsq(
                np.vstack((w[:,None]*A, np.diag(penalty))),
                np.r_[w*b, np.zeros(2*n)],
                rcond=None,
            )[0]
            residual = b - np.einsum("ij,j->i", A, x)
            w = np.minimum(1, 4/np.maximum(.01, abs(residual)))
        x = x.reshape((n, 2))
        peak = np.abs(x[:,0]) + .5*np.abs(x[:,1])
        return (x*np.minimum(1, 8/np.maximum(1, peak))[:,None]).ravel()

    folds = (np.asarray(centers) // 65).astype(int) % 4
    error = np.empty(len(rows))
    for group in np.unique(folds):
        train = folds != group
        error[~train] = delta[~train] - np.einsum(
            "ij,j->i", rows[~train], solve(rows[train], delta[train], weights[train])
        )
    before, after = float(np.median(abs(delta))), float(np.median(abs(error)))
    if after >= .9*before:
        return np.zeros((n, 2)), {"anchors": len(rows), "before": before, "after": after, "status": "held-out gate declined"}
    fit = solve(rows, delta, weights).reshape((n,2))
    return fit, {"anchors": len(rows), "pairs": len(set(pairs)), "before": before, "after": after, "status": "applied",
                 "offsets": fit.tolist()}


def aligned(strips, placement, fit):
    x_offsets, y_offsets = placement.T
    bottom = np.maximum(0, fit[:,0] + .5*np.abs(fit[:,1]))
    h = max(int(y+s.shape[0]+np.ceil(extra)) for y,s,extra in zip(y_offsets,strips,bottom))
    w = max(x+s.shape[1] for x,s in zip(x_offsets, strips))
    layers, valid = [], []
    for strip, (x,y), (dy,slope) in zip(strips, placement, fit):
        H,W = strip.shape[:2]
        src = np.zeros((h, W, 3), dtype=np.float32)
        src[y:y+H] = strip
        valid_src = src.sum(axis=2) > 6
        if dy or slope:
            xx, yy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(h, dtype=np.float32))
            shift = dy+slope*(xx/W-.5)
            # Invert y_warp = y + smoothstep(y)*shift. The bound makes this a contraction.
            sample = yy
            for _ in range(4):
                u = np.clip(((sample-y)/H-.76)/.13, 0, 1)
                sample = yy - u*u*(3-2*u)*shift
            src = cv2.remap(src, xx, sample.astype(np.float32), cv2.INTER_LINEAR)
            valid_src = cv2.remap(valid_src.astype(np.uint8), xx, sample.astype(np.float32), cv2.INTER_NEAREST).astype(bool)
        color = np.zeros((h,w,3), dtype=np.float32)
        mask = np.zeros((h,w), dtype=bool)
        color[:,x:x+W], mask[:,x:x+W] = src, valid_src
        layers.append(color)
        valid.append(mask)
    return layers, valid


def low_frequency(image, valid, sigma):
    """Blur illumination without drawing black padding into the exposure estimate."""
    mask = valid.astype(np.float32)
    color = (image * mask[..., None]).astype(np.float32)
    weight = cv2.GaussianBlur(mask, (0, 0), sigma)
    blurred = cv2.GaussianBlur(color, (0, 0), sigma)
    return blurred / np.maximum(weight[..., None], 1e-4)


def tone_jump(image, both, path):
    # Sample across the cut on low-passed color so snapped texture is a minor contributor.
    smooth = low_frequency(image, both, 2)
    y = np.arange(len(path))
    l = np.maximum(0, path-6)
    r = np.minimum(image.shape[1]-1, path+6)
    ok = both[y,l] & both[y,r] & (y>10) & (y+10<len(y))
    if not ok.any():
        return None
    return round(float(np.percentile(abs(smooth[y[ok],r[ok]]-smooth[y[ok],l[ok]]).mean(axis=1),90)),3)


def ink_and_disagreement(a, b, valid):
    """Estimate painted strokes and their alignment from the overlapping photos."""
    gray = [cv2.cvtColor(np.clip(im,0,255).astype(np.uint8),cv2.COLOR_BGR2GRAY)
            for im in (a,b)]
    clahe = cv2.createCLAHE(clipLimit=2,tileGridSize=(12,8))
    gray = [clahe.apply(im).astype(np.float32) for im in gray]
    gradient = [np.stack([cv2.Sobel(im,cv2.CV_32F,1,0,scale=.125),
                         cv2.Sobel(im,cv2.CV_32F,0,1,scale=.125)],axis=-1) for im in gray]
    strength = [np.linalg.norm(g,axis=2)+.65*np.maximum(0,cv2.GaussianBlur(im,(0,0),4)-im)
                for im,g in zip(gray,gradient)]
    ink = cv2.dilate(np.maximum(*strength),np.ones((5,5),np.uint8))
    mismatch = cv2.GaussianBlur(np.linalg.norm(gradient[0]-gradient[1],axis=2),(0,0),2)
    interior = cv2.erode(valid.astype(np.uint8),np.ones((11,11),np.uint8)).astype(bool)
    ink[~interior] = 0
    mismatch[~interior] = 0
    return ink,mismatch,interior


def composite(layers, valid, seam_path, light_blend=0, stroke_aware=False, local_alignment=0, protected=None):
    gains = [np.ones(3)]
    for i in range(len(layers)-1):
        shared = valid[i] & valid[i+1]
        gains.append(layers[i][shared].mean(axis=0)*gains[i] / np.maximum(1, layers[i+1][shared].mean(axis=0)))
    gains = np.array(gains)/np.mean(gains,axis=0)
    layers = [layer * gain for layer, gain in zip(layers, gains)]
    # Keep seam choice on the original color guide for the comparison.
    out = layers[0]
    guide = layers[0]
    have = valid[0].copy()
    seams = []
    jumps = []
    paths = []
    statistics = []
    alignment_stats = []
    for i in range(1,len(layers)):
        layer = layers[i]
        both = have & valid[i]
        if local_alignment:
            layer, alignment = align_overlap(guide,layer,both,local_alignment)
            alignment_stats.append(alignment)
        cols = np.flatnonzero(both.any(axis=0))
        l,r = cols[[0,-1]]
        cost = cv2.GaussianBlur(np.abs(guide-layer).sum(axis=2),(5,5),0)
        ink, mismatch, interior = ink_and_disagreement(guide,layer,both)
        if stroke_aware:
            cost += ink*(.22+.10*np.minimum(mismatch,30))+1.5*mismatch
        cost[~both] = 1e4
        lo,hi = int(l+.2*(r-l)),int(l+.8*(r-l))
        if protected and i >= protected[0]:
            owner,x0,y0,x1,y1 = protected
            # The protected source owns the marked strokes. Let the cut move
            # through the wider overlap to get around them.
            if i == owner:
                cost[y0:y1,x0-4:] += 1e6
                lo,hi = l+4,r-3
            elif l <= x1+4 < r-4:
                cost[y0:y1,:x1+4] += 1e6
                lo,hi = l+4,r-3
        path = seam_path(cost,lo,hi)
        rows = np.arange(len(path))
        good = interior[rows,path]
        statistics.append({'strongInkRows':int((ink[rows[good],path[good]]>40).sum()),
                           'interiorRows':int(good.sum())})
        paths.append(path)
        weight = np.clip((np.arange(out.shape[1])[None,:]-path[:,None]+4)/8,0,1)
        weight = np.where(have,weight*valid[i],valid[i])[...,None]
        if light_blend:
            # Only the slowly varying part uses the wide transition. Fine paint detail
            # keeps the existing seam ownership and narrow crossfade.
            wide = np.clip((np.arange(out.shape[1])[None,:]-path[:,None]+light_blend)/(2*light_blend),0,1)
            wide = (wide*wide*(3-2*wide))[...,None]
            low_a = low_frequency(out, have, 18)
            low_b = low_frequency(layer, valid[i], 18)
            lighting = (wide-weight)*(low_b-low_a)*both[...,None]
            out = out*(1-weight)+layer*weight+lighting
        else:
            out = out*(1-weight)+layer*weight
        guide = guide*(1-weight)+layer*weight
        jumps.append(tone_jump(out,both,path))
        have |= valid[i]
        seams.append(int(path[int(.925*len(path))]))
    out[~have] = 0
    return np.clip(out,0,255).astype(np.uint8), seams, jumps, paths, statistics, alignment_stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("order")
    parser.add_argument("output", type=Path)
    parser.add_argument("--light-blend", type=int, default=0,
                        help="Width in pixels on either side of the seam for low-frequency crossfade")
    parser.add_argument("--trim-bottom", type=int, default=0,
                        help="Manually reviewed row cutoff for the display output")
    parser.add_argument("--stroke-aware", action="store_true")
    parser.add_argument("--local-alignment", type=float, default=0, metavar="MAX_PX")
    parser.add_argument("--protect", metavar="SOURCE,X0,Y0,X1,Y1")
    args = parser.parse_args()
    if args.light_blend < 0 or args.trim_bottom < 0 or not 0 <= args.local_alignment <= 20:
        parser.error("Blend width and trim row must be nonnegative")
    module = load_stitch()
    ids = list(map(int,args.order.split(",")))
    inputs = [cv2.imread(str(args.folder/f"strip_{i}.jpg")) for i in ids]
    order, P = module.place(inputs)[:2]
    norm = np.exp(np.mean(np.log([p[1] for p in P])))
    strips = [cv2.resize(inputs[k],(inputs[k].shape[1],round(inputs[k].shape[0]*P[i][1]/norm)),
                         interpolation=cv2.INTER_CUBIC) for i,k in enumerate(order)]
    pos = np.array([[p[0]-P[0][0],p[2]/norm] for p in P])
    pos[:,1] -= pos[:,1].min()
    offsets = np.round(pos).astype(int)
    fit, report = fit_offsets(strips, offsets)
    layers,masks = aligned(strips, offsets, fit)
    protected = None
    if args.protect:
        owner,x0,y0,x1,y1 = map(int,args.protect.split(","))
        index = [ids[k] for k in order].index(owner)
        if not masks[index][y0:y1,x0:x1].all():
            raise ValueError("Chosen source does not cover the protected region")
        protected = (index,x0,y0,x1,y1)
    output, seams, jumps, paths, statistics, alignment_stats = composite(
        layers,masks, module.seam_path, args.light_blend, args.stroke_aware, args.local_alignment, protected)
    if protected:
        index,x0,y0,x1,y1 = protected
        if (index and not (paths[index-1][y0:y1] < x0-3).all()) or any(
            (path[y0:y1] < x1+4).any() for path in paths[index:]
        ):
            raise RuntimeError("No seam path can preserve the selected source in this region")
        report["protected"] = {"source":owner,"box":[x0,y0,x1,y1]}
    full_height = output.shape[0]
    if args.trim_bottom:
        output = output[:args.trim_bottom]
    report.update({"order": [ids[k] for k in order], "baseSeams": seams, "seamToneJumpP90": jumps,
                   "lightBlendRadius": args.light_blend, "bottomRowsTrimmed":full_height-output.shape[0]})
    report.update({"strokeAware":args.stroke_aware,"strokeCuts":statistics,"localAlignment":alignment_stats})
    cv2.imwrite(str(args.output), output)
    if args.stroke_aware:
        overlay = output.copy()
        for path in paths:
            path = path[:len(output)]
            cv2.polylines(overlay,[np.column_stack((path,np.arange(len(path)))).astype(np.int32)],
                          False,(255,235,30),1)
        cv2.imwrite(str(args.output.with_name(args.output.stem+"-seams.png")),overlay)
    args.output.with_suffix(".json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
