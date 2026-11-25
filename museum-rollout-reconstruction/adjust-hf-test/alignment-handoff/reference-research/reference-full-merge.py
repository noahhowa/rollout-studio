"""Reference-coordinate, source-photo-only Met merge with automatic stroke-aware seams."""
import argparse
import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np

spec = importlib.util.spec_from_file_location('local_merge',Path(__file__).with_name('reference-local-merge.py'))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


def repeat_period(reference):
    gray = cv2.cvtColor(reference,cv2.COLOR_BGR2GRAY).astype(np.float32)
    gray -= cv2.GaussianBlur(gray,(0,0),6)
    h,w = gray.shape
    scores = {}
    for shift in range(round(.60*w),round(.82*w)):
        a,b = gray[h//10:-h//10,:-shift],gray[h//10:-h//10,shift:]
        scores[shift] = float(np.sum(a*b) / np.sqrt(np.sum(a*a)*np.sum(b*b)))
    period = max(scores,key=scores.get)
    if scores[period] < .22:
        raise ValueError('No reliable repeat in the museum rollout')
    return period,scores[period]


def translate(im,shift):
    out = np.zeros_like(im)
    if shift >= 0:
        out[:,shift:] = im[:,:im.shape[1]-shift]
    else:
        out[:,:shift] = im[:,-shift:]
    return out


def masked_blur(im, mask, sigma):
    weight = cv2.GaussianBlur(mask.astype(np.float32),(0,0),sigma)
    color = cv2.GaussianBlur(im.astype(np.float32)*mask[...,None],(0,0),sigma)
    return color / np.maximum(weight[...,None],1e-5)


def seam(cost):
    h,w=cost.shape
    prev=cost[0].copy()
    back=np.zeros((h,w),np.int8)
    xs=np.arange(w)
    for y in range(1,h):
        step=np.vstack((np.r_[np.inf,prev[:-1]]+0.35,prev,
                         np.r_[prev[1:],np.inf]+0.35))
        at=step.argmin(axis=0)
        back[y]=at-1
        prev=cost[y]+step[at,xs]
    path=np.empty(h,int)
    path[-1]=prev.argmin()
    for y in range(h-1,0,-1):
        path[y-1]=path[y]+back[y,path[y]]
    return path


def route(tiles,width):
    # Find a chain of reliable overlapping intervals using the fewest seams.
    tiles=sorted(tiles,key=lambda t:t['end'])
    initial=[(t['start']+1,i,[i]) for i,t in enumerate(tiles) if t['start']<=3]
    if not initial:
        raise RuntimeError('No source covers the start of the reference')
    best={i:(value,path) for value,i,path in initial}
    for i,a in enumerate(tiles):
        if i not in best:
            continue
        value,path=best[i]
        for j in range(i+1,len(tiles)):
            b=tiles[j]
            if b['end']-a['end']<18 or a['end']-b['start']<45:
                continue
            # A longer center-supported overlap is safer than an edge-to-edge join.
            cost=value+1+60/(a['end']-b['start'])
            if j not in best or cost<best[j][0]:
                best[j]=cost,path+[j]
    candidates=[(v,p) for i,(v,p) in best.items() if tiles[i]['end']>=width-4]
    if not candidates:
        raise RuntimeError('No chain covers the reference width')
    return [tiles[i] for i in min(candidates)[1]]


def merge(tiles,reference,stroke_aware):
    h,w=reference.shape[:2]
    target=local.normalize(reference)
    gx,gy=local.gradients(target)
    # Protect dark paint ridges as well as strong edges. A multiplicative agreement
    # term still allows crossings where two photos already show the same stroke.
    ridge=np.maximum(0,cv2.GaussianBlur(target.astype(np.float32),(0,0),4)-target)
    ink=cv2.dilate((np.hypot(gx,gy)+ridge*.65).astype(np.float32),np.ones((5,5),np.uint8))
    out=tiles[0]['image'].astype(np.float32)
    mask=tiles[0]['valid'].copy()
    paths=[]
    stats=[]
    for left,right in zip(tiles,tiles[1:]):
        incoming=right['image'].astype(np.float32)
        valid=right['valid']
        both=mask&valid
        lo=right['start']
        hi=left['end']
        padding=max(5,round((hi-lo)*.10))
        lo,hi=lo+padding,hi-padding
        # Recover simple exposure offsets from matching source areas, not the reference.
        shared=both[:,lo:hi]
        a,b=out[:,lo:hi][shared],incoming[:,lo:hi][shared]
        gain=np.clip(np.median((a+12)/(b+12),axis=0),.80,1.25)
        incoming *= gain
        ga=local.normalize(np.clip(out,0,255).astype(np.uint8))
        gb=local.normalize(np.clip(incoming,0,255).astype(np.uint8))
        dis=local.local_error(ga,gb)
        color=cv2.GaussianBlur(abs(out-incoming).mean(axis=2),(0,0),2)
        cost=color+.015*abs(np.arange(w)-(lo+hi)/2)[None,:]
        if stroke_aware:
            cost=cost+ink*(.22+.10*np.minimum(dis,30))+1.5*dis
        band=cost[:,lo:hi].astype(np.float32).copy()
        # The cropped reference can extend beyond a strip vertically. Route through
        # reliable overlap when possible; ownership falls back to valid pixels.
        band[~both[:,lo:hi]]=1e4
        path=seam(band)+lo
        y=np.arange(h)
        ok=both[y,path]
        stats.append({'sources':[left['id'],right['id']], 'center':int(np.median(path[ok])) if ok.any() else int(np.median(path)),
          'strokeMismatchP90':float(np.percentile((dis*ink)[y[ok],path[ok]],90)) if ok.any() else None,
          'strongInkRows':int((ink[y[ok],path[ok]]>40).sum())})
        dist=np.arange(w)[None,:]-path[:,None]
        narrow=np.clip((dist+1)/2,0,1)
        # Keep full detail from the seam owner. Widen only the illumination blend.
        wide=np.clip((dist+30)/60,0,1)
        wide=wide*wide*(3-2*wide)
        base=(masked_blur(incoming,valid,12)-masked_blur(out,mask,12))*(wide-narrow)[...,None]
        weight=np.where(both,narrow,valid)
        out=out*(1-weight[...,None])+incoming*weight[...,None]+base*both[...,None]
        mask|=valid
        paths.append(path)
    out[~mask]=0
    return np.uint8(np.clip(out,0,255)),mask,paths,stats


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('met_folder',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    cv2.setRNGSeed(431)
    ref=cv2.imread(str(args.met_folder/'target.jpg'))
    target=local.normalize(ref)
    pts,desc=local.fit.features(ref)
    yy,xx=np.indices(ref.shape[:2],dtype=np.float32)
    period,score=repeat_period(ref)
    tiles=[]
    for file in sorted(args.met_folder.glob('[0-9][0-9]-auto.png')):
        im=cv2.imread(str(file),cv2.IMREAD_UNCHANGED)
        row=local.fit.analyze(im,pts,desc,ref.shape)
        if row is None:
            continue
        image,valid,weight=local.coarse_layer(im,row,ref.shape,xx,yy)
        for shift in (0,-period,period):
            shifted_valid=translate(valid,shift)
            cols=np.flatnonzero(shifted_valid[40:-35].mean(axis=0)>.90)
            if len(cols)<65:
                continue
            layer,motion=local.refine(target,translate(image,shift),shifted_valid,xx,yy,6)
            tiles.append({'id':f'{file.stem}:{shift:+d}', 'image':layer, 'valid':shifted_valid,
                          'start':int(cols[0]),'end':int(cols[-1])+1, 'motion':motion})
    print('period',period,score,[(t['id'],t['start'],t['end']) for t in tiles],flush=True)
    chosen=route(tiles,ref.shape[1])
    report={'period':period,'repeatCorrelation':score, 'tiles':[t['id'] for t in chosen]}
    for kind in ('color','stroke'):
        output,mask,paths,stats=merge(chosen,ref,kind=='stroke')
        cv2.imwrite(str(args.output/(kind+'.png')),output)
        report[kind]={'coverage':float(mask.mean()), 'joins':stats}
        if kind=='stroke':
            overlay=output.copy()
            for p in paths:
                cv2.polylines(overlay,[np.column_stack((p,np.arange(len(p)))).astype(np.int32)],False,(255,230,30),1)
            cv2.imwrite(str(args.output/'seams-overlay.png'),overlay)
    cv2.imwrite(str(args.output/'museum-reference.png'),ref)
    (args.output/'diagnostics.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    main()
