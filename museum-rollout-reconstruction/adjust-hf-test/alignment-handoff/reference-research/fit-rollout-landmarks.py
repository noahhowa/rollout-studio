from pathlib import Path
from os import environ
import cv2
import numpy as np
import json

RUNS = [
    ('met-310364', (.055, .188, .942, .866), 1400),
    ('lacma-168596', (0, .052, 1, .95), 940),
]
KINDS = ('auto', 'labeled', 'auto-camera', 'auto-pinned', 'labeled-camera', 'labeled-pinned')
sift = cv2.SIFT_create(nfeatures=10000, contrastThreshold=.012)
matcher = cv2.BFMatcher()

def features(image, mask=None):
    gray = cv2.cvtColor(image[:,:,:3], cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2, tileGridSize=(8,8)).apply(gray)
    points, desc = sift.detectAndCompute(gray, mask)
    return np.float32([p.pt for p in points]), desc

def design(points, shape, model):
    x = 2*points[:,0]/shape[1]-1
    y = 2*points[:,1]/shape[0]-1
    one = np.ones_like(x)
    if model == 'axis': return (np.c_[one,x],np.c_[one,y])
    if model == 'affine': return (np.c_[one,x,y],)*2
    horizontal = np.c_[one,x,y,x*x,x*x*x,x*y]
    vertical = np.c_[one,x,y,x*x,x*y,x*x*y]
    affine = np.c_[one,x,y]
    return (horizontal if model in ('smooth-x','smooth') else affine,
            vertical if model in ('smooth-y','smooth') else affine)

def train(x, y, shape, kind):
    return [np.linalg.lstsq(d, y[:,i], rcond=None)[0] for i,d in enumerate(design(x,shape,kind))]

def predict(x, shape, kind, parameters):
    return np.column_stack([np.einsum("ij,j->i",a,b) for a,b in zip(design(x,shape,kind), parameters)])

def analyze(img, target, desc, shape):
    h,w=img.shape[:2]
    mask=np.zeros((h,w),dtype=np.uint8)
    mask[int(h*.045):int(h*.96),int(w*.16):int(w*.84)]=255
    if img.shape[2]==4: mask[img[:,:,3]<250]=0
    src, desc_src=features(img,mask)
    if desc_src is None: return None
    matches=[m for m,n in matcher.knnMatch(desc_src,desc,k=2) if m.distance < .78*n.distance]
    if len(matches)<18: return None
    x=src[[m.queryIdx for m in matches]]
    y=target[[m.trainIdx for m in matches]]
    mat,inliers=cv2.estimateAffine2D(x,y,method=cv2.RANSAC,ransacReprojThreshold=13,maxIters=10000,confidence=.999)
    if mat is None or np.linalg.det(mat[:,:2])<=0 or mat[0,0]<=0 or mat[1,1]<=0: return None
    selected=inliers.ravel().astype(bool)
    x,y=x[selected],y[selected]
    if len(x)<18 or np.ptp(x[:,0]) < .15*w or np.ptp(x[:,1]) < .22*h: return None
    # Hold out whole image tiles to test interpolation away from fitted feature clusters.
    fold=(np.floor(7*x[:,0]/w).astype(int)+2*np.floor(7*x[:,1]/h).astype(int))%4
    errors={}
    for kind in ('axis','affine','smooth-x','smooth-y','smooth'):
        per=[]
        for i in range(4):
            fit=fold!=i
            if fit.sum()<12 or fit.all(): continue
            p=train(x[fit], y[fit], img.shape, kind)
            per.extend((predict(x[~fit],img.shape,kind,p)-y[~fit]).tolist())
        deltas=np.abs(np.array(per))
        errors[kind]={'xy':round(100*np.median(np.linalg.norm(deltas,axis=1))/shape[0],3),
                      'y':round(100*np.median(deltas[:,1])/shape[0],3)}
    return {'n':len(x),'errors':errors,'matrix':mat.tolist(),'source':x,'target':y}

def assemble(items, dims, kind):
    h,w=dims
    accum=np.zeros((h,w,3),np.float32)
    total=np.zeros((h,w),np.float32)
    for image,row in items:
        sh,sw=image.shape[:2]
        scale=np.minimum(1,np.maximum(0,1-np.abs(2*np.arange(sw)/(sw-1)-1)/.7))**3
        border=np.clip(np.minimum(np.arange(sh),np.arange(sh)[::-1])/10,0,1)
        mask=(border[:,None]*scale[None,:]).astype('float32')
        if image.shape[2]==4: mask[image[:,:,3]<250]=0
        # Use a low-order target→strip map only inside the landmark-supported region.
        yy,xx=np.indices((h,w),dtype='float32')
        choice = kind
        if kind=='smooth' and row['errors']['smooth']['xy'] >= row['errors']['affine']['xy']:
            choice='affine'
        xmin,xmax=np.quantile(row['target'][:,0],[.01,.99])
        lo=max(0,int(xmin-.08*w)); hi=min(w,int(xmax+.08*w)+1)
        if choice=='smooth':
            p=train(row['target'],row['source'],(h,w),kind)
            xy=predict(np.c_[xx.ravel(),yy.ravel()],(h,w),kind,p).reshape((h,w,2)).astype('float32')
            x,y=xy[:,:,0],xy[:,:,1]
            # Reject folding. The output may contain missing areas, but never reflected strips.
            if min(np.min(np.diff(x[:,lo:hi],axis=1)),np.min(np.diff(y[:,lo:hi],axis=0)))<=0:
                choice='affine'
        if choice=='affine':
            mat=cv2.invertAffineTransform(np.array(row['matrix']))
            x=(mat[0,0]*xx+mat[0,1]*yy+mat[0,2]).astype('float32')
            y=(mat[1,0]*xx+mat[1,1]*yy+mat[1,2]).astype('float32')
        support=(xx>=lo)&(xx<hi)
        z=cv2.remap(mask,x,y,cv2.INTER_LINEAR)*support
        # Prefer the most face-on supported view and crossfade only near ownership changes.
        z=z**5
        color=cv2.remap(image[:,:,:3],x,y,cv2.INTER_LINEAR)
        accum += color * z[:,:,None]
        total += z
    out=np.divide(accum,total[:,:,None],where=total[:,:,None]>1e-15,out=np.zeros_like(accum))
    return np.uint8(np.clip(out,0,255)),round(100*np.mean(total>1e-15),1)

if __name__ == "__main__":
    DATA = Path(environ["ROLLOUT_REFERENCE_DATA"])
    for id,crop,width in RUNS:
        folder=DATA/id
        ref=cv2.imread(str(folder/'reference.jpg'))
        h,w=ref.shape[:2]; l,t,r,b=crop
        ref=ref[round(t*h):round(b*h),round(l*w):round(r*w)]
        ref=cv2.resize(ref,(width,round(ref.shape[0]*width/ref.shape[1])),interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(folder/'target.jpg'),ref)
        pts,desc=features(ref)
        counts={}
        for kind in KINDS:
            result={}
            items=[]
            for file in sorted(folder.glob('[0-9][0-9]-'+kind+'.png')):
                img=cv2.imread(str(file),cv2.IMREAD_UNCHANGED)
                row=analyze(img,pts,desc,ref.shape)
                if not row: continue
                result[file.name[:2]]={k:v for k,v in row.items() if k in ('n','errors')}
                items.append((img,row))
            if items:
                image,coverage=assemble(items,ref.shape[:2],'affine')
                cv2.imwrite(str(folder/('reference-fit-'+kind+'.jpg')),image)
                if kind == 'auto':
                    tuned,tuned_coverage=assemble(items,ref.shape[:2],'smooth')
                    cv2.imwrite(str(folder/'reference-fit-smooth.jpg'),tuned)
                med={method:{key:round(float(np.median([r['errors'][method][key] for r in result.values()])),3)
                             for key in ('xy','y')}
                     for method in ('axis','affine','smooth-x','smooth-y','smooth')}
                counts[kind]={'views':len(result),'coverage':coverage,'errors':med,'views_detail':result}
                if kind=='auto': counts[kind]['smooth_coverage']=tuned_coverage
        (folder/'landmarks.json').write_text(json.dumps(counts,indent=2))
        print(id,json.dumps({key:{k:v for k,v in row.items() if k!='views_detail'} for key,row in counts.items()}),flush=True)
