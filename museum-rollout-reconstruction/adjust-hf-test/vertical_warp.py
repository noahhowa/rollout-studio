"""Bounded per-strip vertical warp on coordinates already aligned by the scale fit."""
import cv2
import numpy as np

LIMIT = 8.0
MIN_SLOPE = 0.9
MAX_SLOPE = 1.1


def basis(y, height, support):
    z = 2 * np.clip(y / (height - 1), *support) - 1
    return np.column_stack((np.ones_like(z), z, z*z - 1/3))


def solve(A, delta, heights, supports, active, curved):
    n = len(heights)
    penalty = np.tile([2., 4., 7.], n).reshape(n, 3)
    weight = np.ones(len(delta))
    columns = np.repeat(active, 3)
    if not curved:
        columns[2::3] = False
    if not columns.any():
        return np.zeros((n, 3))
    a = A[:, columns]
    regularizer = np.diag(penalty.ravel()[columns])
    for _ in range(4):
        coeff = np.linalg.lstsq(np.vstack((a * weight[:, None], regularizer)),
                                np.r_[delta * weight, np.zeros(len(regularizer))], rcond=None)[0]
        error = delta - np.einsum('ij,j->i', a, coeff)
        weight = np.sqrt(np.minimum(1, 2.5 / np.maximum(.01, abs(error))))
    fitted = np.zeros(3*n)
    fitted[columns] = coeff
    fitted = fitted.reshape(n, 3)
    for i, (height, support) in enumerate(zip(heights, supports)):
        y = np.linspace(0, height - 1, 201)
        move = np.einsum('ij,j->i', basis(y, height, support), fitted[i])
        # Scale the entire correction to stay inside both the displacement and slope bounds.
        slope = (2 * abs(fitted[i, 1]) + 4 * abs(fitted[i, 2])) / (height - 1)
        fitted[i] *= min(1, LIMIT / max(abs(move).max(), 1e-9),
                         min(1-MIN_SLOPE, MAX_SLOPE-1) / max(slope, 1e-9))
    return fitted


def summarize(delta, error, height_fraction):
    regions = {'all': np.ones(len(delta), dtype=bool), 'rim': height_fraction < .25,
               'base': height_fraction > .75}
    return {key: {'points': int(m.sum()), 'median': float(np.median(abs(error[m]))),
                  'p90': float(np.percentile(abs(error[m]),90))}
            for key, m in regions.items() if m.any()}


def fit_warp(edges, order, sizes, heights, offsets, preview_rejected=False):
    """Fit all overlaps jointly. Unmatched ends inherit the nearest supported correction."""
    lookup = {k:i for i,k in enumerate(order)}
    equations = []
    evidence = [[] for _ in order]
    for _, i, j, _, matches in edges:
        a,b = lookup[i], lookup[j]
        ya = (matches[:,1]+.5)*heights[a]/sizes[i]-.5
        yb = (matches[:,3]+.5)*heights[b]/sizes[j]-.5
        delta = yb + offsets[b,1] - ya - offsets[a,1]
        use = abs(delta) <= 16
        if use.sum() < 15:
            continue
        ya,yb,delta = ya[use],yb[use],delta[use]
        xa = matches[use,0] + offsets[a,0]
        evidence[a].extend(ya / (heights[a]-1))
        evidence[b].extend(yb / (heights[b]-1))
        equations.append((a,b,ya,yb,xa,delta))
    if not equations:
        return np.zeros((len(order),3)), [(0,1)]*len(order), {'reason':'too little evidence'}
    supports = [tuple(np.clip(np.quantile(v,[.05,.95]),0,1)) if len(v)>=30 else (0,1)
                for v in evidence]
    active = [bool(len(v)>=30 and hi-lo>=.48) for v,(lo,hi) in zip(evidence,supports)]
    chunks, deltas, folds, fraction = [], [], [], []
    for a,b,ya,yb,xa,delta in equations:
        A = np.zeros((len(ya), 3*len(order)))
        A[:,3*a:3*a+3] = basis(ya,heights[a],supports[a])
        A[:,3*b:3*b+3] = -basis(yb,heights[b],supports[b])
        chunks.append(A)
        deltas.append(delta)
        folds.append(((xa//55 + 2*((ya+offsets[a,1])//65)) % 5).astype(int))
        fraction.append((ya/(heights[a]-1) + yb/(heights[b]-1)) / 2)
    A,delta,fold,frac = map(np.concatenate, (chunks,deltas,folds,fraction))
    reports = {'scale': summarize(delta,delta,frac)}
    for kind,curved in [('affine',False),('nonlinear',True)]:
        residual = delta.copy()
        for group in np.unique(fold):
            held = fold==group
            coeff = solve(A[~held],delta[~held],heights,supports,active,curved)
            residual[held] -= np.einsum('ij,j->i', A[held], coeff.ravel())
        reports[kind] = summarize(delta,residual,frac)
    # Keep the scale-only fallback if height coverage is weak or the held-out fit regresses.
    base, trial = reports['scale'], reports['nonlinear']
    applied = (any(active) and trial['all']['median'] < base['all']['median'] and
               all(trial[r]['median'] <= base[r]['median'] for r in ('rim','base') if r in base))
    rendered = applied or (preview_rejected and any(active))
    coeff = solve(A,delta,heights,supports,active,True) if rendered else np.zeros((len(order),3))
    reports.update({'applied': applied, 'rendered': rendered, 'support': supports, 'active': active, 'coefficients':coeff.tolist()})
    return coeff,supports,reports


def resample(strip, coeff, support):
    height,width = strip.shape[:2]
    rows = np.arange(height,dtype=float)
    warped = rows + np.einsum('ij,j->i',basis(rows,height,support),coeff)
    if np.any(np.diff(warped) <= 0):
        raise ValueError('Vertical warp must be monotone')
    top,bottom = int(np.ceil(warped[0])), int(np.floor(warped[-1]))
    source_y = np.interp(np.arange(top,bottom+1),warped,rows).astype(np.float32)
    map_x = np.broadcast_to(np.arange(width,dtype=np.float32),(len(source_y),width)).copy()
    map_y = np.broadcast_to(source_y[:,None],map_x.shape).copy()
    return cv2.remap(strip,map_x,map_y,cv2.INTER_LINEAR),top
