import sys, runpy, cv2, numpy as np
from pathlib import Path
script=Path(sys.argv.pop(1)).resolve()
sys.path.insert(0,str(script.parent))
m=runpy.run_path(str(script))
g=m['main'].__globals__
original=g['aligned']

def smoothstep(t):
    t=np.clip(t,0,1)
    return t*t*(3-2*t)

def aligned(strips,offsets,fit):
    layers,masks=original(strips,offsets,fit)
    curves={}
    for i in (2,3):
        layer=layers[i]
        x0=offsets[i,0]
        width=strips[i].shape[1]
        gray=cv2.cvtColor(layer[:,x0:x0+width],cv2.COLOR_BGR2GRAY)
        smooth=cv2.GaussianBlur(gray,(55,5),0)
        detail=cv2.GaussianBlur(smooth,(1,21),0)-smooth
        y=np.arange(1240,1290)
        score=detail[y]+detail[y+17]
        path=g['load_stitch']().seam_path(-score.T,0,len(y))+y[0]
        path=cv2.GaussianBlur(path.astype(np.float32)[None],(85,1),0).ravel()
        curves[i]=path
    target=float(np.median(curves[3][180:330]))
    print('band level',target, 'traces',[(i,curves[i][60:-55:70].round(1).tolist()) for i in curves],flush=True)
    h,w=masks[0].shape
    xx,yy=np.meshgrid(np.arange(w,dtype=np.float32),np.arange(h,dtype=np.float32))
    for i,curve in curves.items():
        x0=offsets[i,0]
        trace=np.interp(xx[0],x0+np.arange(len(curve)),curve).astype(np.float32)
        delta=np.clip(trace-target,-26,26)
        weight=smoothstep((xx-1290)/195)*smoothstep((1840-xx)/190)
        depth=smoothstep((yy-1155)/94)
        # Anchor the silhouette and transition through the lower painted bands.
        depth*=smoothstep((1330-yy)/40)
        sy=yy+delta*weight*depth
        layers[i]=cv2.remap(layers[i],xx,sy,cv2.INTER_LINEAR)
        masks[i]=cv2.remap(masks[i].astype(np.uint8),xx,sy,cv2.INTER_NEAREST).astype(bool)
    return layers,masks
g['aligned']=aligned
g['main']()
