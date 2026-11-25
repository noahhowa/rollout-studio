"""Fit a bounded vertical-only correction using overlap in the current Map strips."""
import argparse
from importlib.util import module_from_spec, spec_from_file_location
from itertools import combinations
import json
from pathlib import Path

import cv2
import numpy as np

spec=spec_from_file_location("rollout_overlap",Path(__file__).resolve().parents[1]/"prototype/align-panorama-photo-only.py")
overlap=module_from_spec(spec)
spec.loader.exec_module(overlap)
W,H=overlap.W,overlap.H


def design(points):
    u=(points[:,0]-W/2)/(W*.37)
    v=points[:,1]/H
    taper=np.minimum(1,np.minimum(v,1-v)/.10)
    return np.column_stack((np.ones(len(u)),u,u*u,v-.5))*taper[:,None]


def select_edges(views):
    edges=[]
    for i,j in combinations(range(len(views)),2):
        match=overlap.pair(views[i],views[j],i,j,minimum_width=32)
        if match is not None and match["n"] >= 35:
            edges.append(match)
    edges.sort(key=lambda row: -row["n"])
    return edges


def equations(edges, photo_count):
    names=[]
    rows=[]
    targets=[]
    folds=[]
    for edge in edges:
        i,j=edge['i'],edge['j']
        left,right=edge['points']
        dy=right[:,1]-left[:,1]
        # Keep landmarks consistent with their pair's displacement, without fitting a panorama.
        dx=left[:,0]-right[:,0]-edge['dx']
        valid=(abs(dx)<20)&(abs(dy)<.055*H)
        left,right,dy=left[valid],right[valid],dy[valid]
        if len(left)<18:
            continue
        A=np.zeros((len(left),4*photo_count))
        A[:,4*i:4*i+4]=design(left)
        A[:,4*j:4*j+4]=-design(right)
        rows.append(A)
        targets.append(dy)
        folds.append(((left[:,0]//38+2*(left[:,1]//52))%4).astype(int))
        names.append((i,j))
    return names,rows,targets,folds


def fit(A,b):
    regularizer=np.diag(np.tile([5,10,14,17],A.shape[1]//4))
    weights=np.ones(len(A))
    for _ in range(4):
        beta=np.linalg.lstsq(np.vstack((A*weights[:,None],regularizer)),np.r_[b*weights,np.zeros(A.shape[1])],rcond=None)[0]
        residual=b-np.einsum("ij,j->i",A,beta)
        weights=np.sqrt(np.minimum(1,5/np.maximum(1,abs(residual))))
    coefficients=beta.reshape((-1,4))
    umax=.5/.37
    cap=abs(coefficients) @ np.array([1,umax,umax**2,.5])
    return (coefficients*np.minimum(1,.03*H/np.maximum(1,cap))[:,None]).ravel()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("strips",type=Path)
    parser.add_argument("out",type=Path)
    args=parser.parse_args()
    cv2.setRNGSeed(431)
    views=[overlap.source(f) for f in sorted(args.strips.glob("*.png"))]
    if len(views)<3:
        raise ValueError("At least three Map strips required")
    edges=select_edges(views)
    names, rows, targets, group=equations(edges,len(views))
    connected={0}
    for _ in views:
        for i,j in names:
            if i in connected or j in connected:
                connected.update((i,j))
    if len(connected) != len(views):
        raise RuntimeError("Not enough consistent overlaps for correction")
    A,b,fold=np.concatenate(rows),np.concatenate(targets),np.concatenate(group)
    pred=np.empty(len(A))
    for i in np.unique(fold):
        held=fold==i
        pred[held]=np.einsum("ij,j->i",A[held],fit(A[~held],b[~held]))
    before=float(np.median(abs(b))*100/H)
    after=float(np.median(abs(b-pred))*100/H)
    if after >= before:
        raise RuntimeError(f"Overlap holdout did not improve: {before:.3f} → {after:.3f}")
    start=0
    detail=[]
    for (i,j),values in zip(names,targets):
        count=len(values)
        detail.append({"views":[i+1,j+1],"matches":count,
          "before":float(np.median(abs(values))*100/H),
          "after":float(np.median(abs(values-pred[start:start+count]))*100/H)})
        start+=count
    coefficients=fit(A,b).reshape((-1,4))
    result={"coefficients":coefficients.tolist(),"preflight":{"before":before,"after":after,"count":len(b),"pairs":detail}}
    args.out.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))


if __name__=="__main__":
    main()
