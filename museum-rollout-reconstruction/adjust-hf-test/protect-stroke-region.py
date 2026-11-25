"""Source-only diagnostic: keep a marked region together in one source photograph."""
import argparse
import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np

spec = importlib.util.spec_from_file_location("base_profile", Path(__file__).with_name("base-profile-align.py"))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("strips", type=Path)
    p.add_argument("order")
    p.add_argument("control", type=Path)
    p.add_argument("box", help="left,top,right,bottom in panorama pixels")
    p.add_argument("output", type=Path)
    args = p.parse_args()
    ids = [int(n) for n in args.order.split(",")]
    images = [cv2.imread(str(args.strips/f"strip_{i}.jpg")) for i in ids]
    order, poses = base.load_stitch().place(images)[:2]
    scale = np.exp(np.mean(np.log([p[1] for p in poses])))
    images = [cv2.resize(images[j],(images[j].shape[1],round(images[j].shape[0]*poses[i][1]/scale)),
                         interpolation=cv2.INTER_CUBIC) for i,j in enumerate(order)]
    offsets = np.array([[x-poses[0][0],y/scale] for x,_,y in poses])
    offsets[:,1] -= offsets[:,1].min()
    offsets = np.round(offsets).astype(int)
    warp,_ = base.fit_offsets(images, offsets)
    layers,masks = base.aligned(images, offsets, warp)
    control=cv2.imread(str(args.control))
    if control.shape != layers[0].shape:
        raise ValueError("Control must share the source alignment canvas")
    height,width=control.shape[:2]
    l,t,r,b=map(int,args.box.split(","))
    if not (0<=l<r<=width and 0<=t<b<=height):
        raise ValueError("Invalid box")
    yy,xx=np.indices(control.shape[:2])
    distance=np.maximum.reduce((l-xx, xx-(r-1), t-yy, yy-(b-1)))
    outside=(distance>0)&(distance<=42)
    core=distance<=0
    extended=distance<=42
    candidates=[]
    for i,(layer,mask) in enumerate(zip(layers,masks)):
        if not mask[core].all() or mask[extended].mean()<.98:
            continue
        existing=control[outside].astype(np.float32)
        photo=layer[outside]
        retain=(photo.min(axis=1)>22)&(existing.min(axis=1)>22)
        if retain.sum()<200:
            continue
        gain=np.clip(np.median((existing[retain]+8)/(photo[retain]+8),axis=0),.80,1.25)
        proximity=abs((l+r)/2-(offsets[i,0]+images[i].shape[1]/2))/images[i].shape[1]
        # Measure agreement in the surrounding band, away from the contour being repaired.
        score=float(np.median(abs(existing[retain]-photo[retain]*gain))* (1+proximity))
        candidates.append((score,i,gain))
    if not candidates:
        raise RuntimeError("No source covers the marked region plus transition")
    _,i,gain=min(candidates,key=lambda row:row[0])
    layer=layers[i]*gain
    margin=75
    area=np.s_[max(0,t-margin):min(height,b+margin),max(0,l-margin):min(width,r+margin)]
    # Seed owner inside the protected area and the existing mosaic on the outer collar.
    # Between them the graph cut can route around paint rather than exposing a box edge.
    control_mask=np.where(core[area],0,255).astype(np.uint8)
    source_mask=np.where(masks[i][area] & (distance[area]<margin-4),255,0).astype(np.uint8)
    cutter=cv2.detail_GraphCutSeamFinder("COST_COLOR_GRAD")
    selection=cutter.find([cv2.UMat(control[area].astype(np.float32)),cv2.UMat(layer[area].astype(np.float32))],
                          [(0,0),(0,0)],[cv2.UMat(control_mask),cv2.UMat(source_mask)])
    owner=np.zeros_like(core)
    owner[area]=selection[1].get()>0
    if not owner[core].all() or np.any(owner & ~masks[i]):
        raise RuntimeError("Cut violated source ownership")
    hard=owner.astype(np.float32)
    weight=cv2.GaussianBlur(hard,(0,0),12)*masks[i]
    control_low=base.low_frequency(control,np.ones_like(core),12)
    source_low=base.low_frequency(layer,masks[i],12)
    # Keep fine detail on a single source and feather the light across the new cut.
    output=control*(1-hard[...,None])+layer*hard[...,None]+(weight-hard)[...,None]*(source_low-control_low)
    cv2.imwrite(str(args.output),np.uint8(np.clip(output,0,255)))
    report={"box":[l,t,r,b],"source":ids[order[i]],"candidateScores":{ids[order[j]]:s for s,j,_ in candidates}}
    args.output.with_suffix(".json").write_text(json.dumps(report,indent=2)+"\n")
    overlay=np.uint8(np.clip(output,0,255))
    outline=cv2.morphologyEx(owner.astype(np.uint8),cv2.MORPH_GRADIENT,np.ones((3,3),np.uint8))
    overlay[outline>0]=(255,230,50)
    cv2.imwrite(str(args.output.with_name(args.output.stem+"-seam.png")),overlay)
    print(report)


if __name__ == "__main__":
    main()
