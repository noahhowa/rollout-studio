"""Reference-guided Met reconstruction from source photos and bounded local registration."""
import argparse
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path

import cv2
import numpy as np

spec = spec_from_file_location("reference_fit", Path(__file__).with_name("fit-rollout-landmarks.py"))
fit = module_from_spec(spec)
spec.loader.exec_module(fit)


def normalize(image):
    gray = cv2.cvtColor(image[:,:,:3],cv2.COLOR_BGR2GRAY)
    c = cv2.createCLAHE(clipLimit=2,tileGridSize=(12,6))
    return c.apply(gray)


def gradients(gray):
    return cv2.Sobel(gray,cv2.CV_32F,1,0,scale=.125), cv2.Sobel(gray,cv2.CV_32F,0,1,scale=.125)


def local_error(a,b):
    dx,dy = gradients(a)
    ux,uy = gradients(b)
    return cv2.GaussianBlur(np.hypot(dx-ux,dy-uy),(0,0),2.)


def coarse_layer(image, row, shape, xx, yy):
    w = shape[1]
    xmin,xmax = np.quantile(row['target'][:,0],[.01,.99])
    lo, hi = max(0,int(xmin-.08*w)), min(w,int(xmax+.08*w)+1)
    p = fit.train(row['target'],row['source'],shape,'smooth')
    xy = fit.predict(np.c_[xx.ravel(),yy.ravel()],shape,'smooth',p).reshape(shape[:2]+(2,)).astype(np.float32)
    x,y = xy[:,:,0],xy[:,:,1]
    if (row['errors']['smooth']['xy']>=row['errors']['affine']['xy'] or
        min(np.diff(x[:,lo:hi],axis=1).min(),np.diff(y[:,lo:hi],axis=0).min())<=0):
        mat = cv2.invertAffineTransform(np.array(row['matrix']))
        x = (mat[0,0]*xx+mat[0,1]*yy+mat[0,2]).astype(np.float32)
        y = (mat[1,0]*xx+mat[1,1]*yy+mat[1,2]).astype(np.float32)
    sh,sw = image.shape[:2]
    valid = (x>=.15*sw)&(x<.85*sw)&(y>=2)&(y<sh-3)&(xx>=lo)&(xx<hi)
    weight = np.clip(1-abs(2*x/(sw-1)-1)/.7,0,1)*valid
    layer = cv2.remap(image[:,:,:3],x,y,cv2.INTER_LINEAR)
    return layer, valid, weight.astype(np.float32)


def refine(target, layer, valid, xx, yy, limit):
    before = normalize(layer)
    # Supply reference luminance outside the strip only to keep the estimator from
    # following black padding. The remapper only samples pixels inside this strip.
    moving = np.where(valid,before,target).astype(np.uint8)
    flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    forward = flow.calc(target,moving,None)
    reverse = flow.calc(moving,target,None)
    rx,ry = (xx+forward[:,:,0]).astype(np.float32),(yy+forward[:,:,1]).astype(np.float32)
    sampled = cv2.remap(reverse,rx,ry,cv2.INTER_LINEAR)
    fb = np.linalg.norm(sampled+forward,axis=2)
    norm = np.linalg.norm(forward,axis=2)
    interior = cv2.erode(valid.astype(np.uint8),np.ones((17,17),np.uint8)).astype(bool)
    accept = interior & (fb<1.75) & (norm<=limit)
    weight = cv2.GaussianBlur(accept.astype(np.float32),(0,0),2)
    delta = cv2.GaussianBlur(forward*accept[...,None],(0,0),2)
    delta /= np.maximum(weight[...,None],1e-4)
    delta *= np.clip(weight[...,None]*2,0,1)*interior[...,None]
    x,y = xx+delta[:,:,0],yy+delta[:,:,1]
    # Accept the local correction only where moving the actual texture helps.
    moved = cv2.remap(moving,x,y,cv2.INTER_LINEAR)
    wins = interior & (local_error(target,moved)<local_error(target,moving))
    softness = cv2.GaussianBlur(wins.astype(np.float32),(0,0),2)*interior
    x,y = xx+delta[:,:,0]*softness, yy+delta[:,:,1]*softness
    out = cv2.remap(layer,x,y,cv2.INTER_LINEAR)
    return out, {'supportedPixels':int(accept.sum()),'peakMotionPx':float(np.max(np.linalg.norm(delta*softness[...,None],axis=2)))}


def composite(images, weights):
    accum = np.zeros_like(images[0],np.float32)
    total = np.zeros(images[0].shape[:2],np.float32)
    for im,w in zip(images,weights):
        w=w**5
        accum += im*w[...,None]
        total += w
    return np.uint8(np.clip(np.divide(accum,total[...,None],out=np.zeros_like(accum),
                                     where=total[...,None]>1e-12),0,255))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("met_folder",type=Path)
    parser.add_argument("output",type=Path)
    opt=parser.parse_args()
    opt.output.mkdir(parents=True,exist_ok=True)
    cv2.setRNGSeed(431)
    ref=cv2.imread(str(opt.met_folder/'target.jpg'))
    pts,desc=fit.features(ref)
    target=normalize(ref)
    yy,xx=np.indices(ref.shape[:2],dtype=np.float32)
    sources, coarse, refined, weights, detail = [],[],[],[],[]
    for file in sorted(opt.met_folder.glob('[0-9][0-9]-auto.png')):
        im=cv2.imread(str(file),cv2.IMREAD_UNCHANGED)
        row=fit.analyze(im,pts,desc,ref.shape)
        if row is None:
            continue
        layer, valid, weight=coarse_layer(im,row,ref.shape,xx,yy)
        result, report=refine(target,layer,valid,xx,yy,6.)
        sources.append(file.name); coarse.append(layer); refined.append(result); weights.append(weight)
        detail.append(report)
    initial=composite(coarse,weights)
    dense=composite(refined,weights)
    # Met-specific diagnostic region covering the annotated back contour. Choose
    # one registered source to carry the whole stroke through it.
    l,t,r,b=1060,277,1245,402
    stats=[]
    for i,(im,w) in enumerate(zip(refined,weights)):
        if (w[t:b,l:r]>.002).mean()<.995:
            continue
        err=local_error(target,normalize(im))[t:b,l:r]
        stats.append((float(np.median(err)),i))
    result=dense.copy()
    owner=None
    if stats:
        _,index=min(stats)
        owner=sources[index]
        distance=np.maximum(np.maximum(l-xx, xx-(r-1)),np.maximum(t-yy,yy-(b-1)))
        alpha=np.clip(1-distance/18,0,1)*(weights[index]>.002)
        result=np.uint8(refined[index]*alpha[...,None]+dense*(1-alpha[...,None]))
    for name,img in [('coarse',initial),('dense',dense),('protected',result),('museum-reference',ref)]:
        cv2.imwrite(str(opt.output/(name+'.png')),img)
    report={'region':[l,t,r,b],'owner':owner,'eligible':[(sources[i],s) for s,i in sorted(stats)],
            'layers':dict(zip(sources,detail))}
    (opt.output/'diagnostics.json').write_text(json.dumps(report,indent=2)+'\n')
    print(report)


if __name__=='__main__':
    main()
