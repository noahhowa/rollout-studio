from pathlib import Path
from os import environ
import itertools,json,cv2,numpy as np
W,H=650,540
sift=cv2.SIFT_create(nfeatures=4500,contrastThreshold=.018)
bf=cv2.BFMatcher()
def wrap(x):
    return (x+W)%(2*W)-W
def source(file):
    im=cv2.resize(cv2.imread(str(file),cv2.IMREAD_UNCHANGED),(W,H),interpolation=cv2.INTER_AREA)
    gray=cv2.cvtColor(im[:,:,:3],cv2.COLOR_BGR2GRAY)
    gray=cv2.createCLAHE(clipLimit=2,tileGridSize=(8,8)).apply(gray)
    mask=np.zeros((H,W),np.uint8); mask[32:-28,95:-95]=255
    key,desc=sift.detectAndCompute(gray,mask)
    return im,np.float32([k.pt for k in key]),desc
def pair(a,b,i,j,minimum_width=45):
    if a[2] is None or b[2] is None: return None
    matches=[m for m,n in bf.knnMatch(a[2],b[2],k=2) if m.distance<.74*n.distance]
    if len(matches)<18: return None
    x,y=a[1][[m.queryIdx for m in matches]],b[1][[m.trainIdx for m in matches]]
    mat,mask=cv2.estimateAffine2D(x,y,ransacReprojThreshold=8,maxIters=5000,confidence=.999)
    if mat is None or not (.76<mat[0,0]<1.26 and .83<mat[1,1]<1.18): return None
    good=mask.ravel().astype(bool)
    xx=x[good]; yy=y[good]; n=len(xx)
    if n<18 or np.ptp(xx[:,0])<minimum_width or np.ptp(xx[:,1])<130: return None
    dx,dy=np.median(xx-yy,axis=0)
    if abs(dy)>65: return None
    return {'i':i,'j':j,'dx':float(dx),'dy':float(dy),'n':n,'points':(xx,yy)}
def solve(edges,n):
    known={0:(0,0)}
    while len(known)<n:
        edge=next((e for e in edges if (e['i'] in known) != (e['j'] in known)),None)
        if edge is None: return None
        i,j=edge['i'],edge['j']; sign=1
        if j in known: i,j,sign=j,i,-1
        known[j]=(known[i][0]+sign*edge['dx'],known[i][1]+sign*edge['dy'])
    matrix=[]; targets=[]
    for e in edges:
        i,j=e['i'],e['j']; dx,dy=e['dx'],e['dy']
        guess=known[j][0]-known[i][0]
        dx=guess+wrap(dx-guess)
        if abs(guess-dx)>55 or abs(known[j][1]-known[i][1]-dy)>30: continue
        w=min(10,np.sqrt(e['n']))
        row=np.zeros(n); row[j]=w; row[i]=-w
        matrix.append(row[1:]); targets.append([w*dx,w*dy])
    if len(matrix)<n-1: return None
    fit,_,rank,_=np.linalg.lstsq(matrix,targets,rcond=None)
    if rank<n-1: return None
    f=np.vstack(([0,0],fit))
    f[:,1]-=np.median(f[:,1])
    return f
def vertical_model(points):
    u=(points[:,0]-W/2)/(W*.37)
    v=points[:,1]/H-.5
    return np.column_stack((np.ones(len(u)),u,u*u,v))

def vertical_fit(edges, poses):
    rows=[]; targets=[]; train=[]
    n=len(poses)
    accepted_edges=0
    for edge in edges:
        i,j=edge['i'],edge['j']
        a,b=edge['points']
        y_error=(b[:,1]+poses[j,1])-(a[:,1]+poses[i,1])
        support=(abs(wrap(a[:,0]+poses[i,0]-b[:,0]-poses[j,0]))<20)&(abs(y_error)<30)
        a,b,y_error=a[support],b[support],y_error[support]
        if len(a)<16: continue
        accepted_edges+=1
        frame=np.zeros((len(a),4*n))
        frame[:,4*i:4*i+4]=vertical_model(a)
        frame[:,4*j:4*j+4]=-vertical_model(b)
        rows.extend(frame); targets.extend(y_error)
        train.extend(((a[:,0]//38+2*(a[:,1]//52))%4 != 0).tolist())
    if not rows or np.all(train): return np.zeros((n,4)),None
    A=np.array(rows); y=np.array(targets); train=np.asarray(train,dtype=bool)
    def fit(A,y):
        # A shared baseline and a penalty on bend/stretch prevent poorly covered views from drifting.
        reg=np.diag(np.tile([3,9,13,17],n))
        w=np.ones(len(y))
        for _ in range(3):
            sol=np.linalg.lstsq(np.vstack((A*w[:,None],reg)),np.r_[y*w,np.zeros(4*n)],rcond=None)[0]
            w=np.minimum(1,5/np.maximum(1,abs(y-np.einsum("ij,j->i",A,sol))))**.5
        coeff=sol.reshape((n,4))
        max_change=abs(coeff[:,0])+abs(coeff[:,1])+abs(coeff[:,2])+abs(coeff[:,3])/2
        return (coeff*np.minimum(1,.03*H/np.maximum(1,max_change))[:,None]).reshape(-1)
    learned=fit(A[train],y[train])
    before=float(np.median(abs(y[~train]))*100/H)
    after=float(np.median(abs(y[~train]-np.einsum("ij,j->i",A[~train],learned)))*100/H)
    full=fit(A,y) if after < before else np.zeros(4*n)
    return full.reshape(n,4),{'before':before,'after':after,'held_out':int((~train).sum()),'pairs':accepted_edges}

def compose(views,poses,model):
    x,y=np.meshgrid(np.arange(2*W,dtype=np.float32),np.arange(H,dtype=np.float32))
    accum=np.zeros((H,2*W,3),np.float32); total=np.zeros((H,2*W),np.float32)
    mapped=[]
    for (im,_,_),(dx,dy),(a,b,c,s) in zip(views,poses,model):
        u=(wrap(x-dx-W/2)+W/2).astype(np.float32)
        un=(u-W/2)/(W*.37)
        v=((y-dy-a-b*un-c*un*un+s/2)/(1+s/H)).astype(np.float32)
        score=np.clip(1-abs(u-W/2)/(W*.37),0,1)*(v>=0)*(v<H-1)
        alpha=im[:,:,3] if im.shape[2]==4 else np.full((H,W),255,np.uint8)
        score*=cv2.remap(alpha,u,v,cv2.INTER_LINEAR)>=250
        rgb=cv2.remap(im[:,:,:3],u,v,cv2.INTER_LINEAR)
        mapped.append((rgb,score))
    best=np.max([row[1] for row in mapped],axis=0)
    for color,score in mapped:
        weight=np.clip((score-best+.055)/.055,0,1)*(score>0)
        accum+=color*weight[:,:,None]; total+=weight
    out=np.divide(accum,total[:,:,None],where=total[:,:,None]>0,out=np.zeros_like(accum))
    return np.uint8(out),100*np.mean(total>0)

if __name__ == "__main__":
    D=Path(environ["ROLLOUT_REFERENCE_DATA"])
    for key in ('met-310364','lacma-168596'):
        root=D/key
        files=sorted(root.glob('[0-9][0-9]-auto.png'))
        views=[source(f) for f in files]
        edges=sorted([e for i,j in itertools.combinations(range(len(views)),2) if (e:=pair(views[i],views[j],i,j))], key=lambda e:-e['n'])
        fit=solve(edges,len(views))
        if fit is None:
            print(key,'disconnected',edges,flush=True); continue
        model,check=vertical_fit(edges,fit)
        source_sizes=[cv2.imread(str(f),cv2.IMREAD_UNCHANGED).shape[:2] for f in files]
        native_height=round(W*np.median([h/w for h,w in source_sizes]))
        for name, m in [('offsets',np.zeros_like(model)),('deribboned',model)]:
            out,coverage=compose(views,fit,m)
            out=cv2.resize(out,(2*W,native_height),interpolation=cv2.INTER_LINEAR)
            cv2.imwrite(str(root/('photo-only-'+name+'.jpg')),out)
        (root/'photo-only-landmarks.json').write_text(json.dumps({'coverage':coverage,'xShift':fit[:,0].tolist(),'yShift':fit[:,1].tolist(),'vertical_holdout':check,'edges':[{k:v for k,v in e.items() if k!='points'} for e in edges]},indent=2))
        print(key,len(edges),'matches',np.round(fit[:,0]).tolist(),round(coverage,2),'vertical',check,flush=True)
