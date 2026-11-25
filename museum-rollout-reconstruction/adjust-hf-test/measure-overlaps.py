"""Measure overlap mismatch after the public Hugging Face alignment stage."""
import argparse
import ast
import contextlib
from importlib.util import module_from_spec, spec_from_file_location
import io
import json
from pathlib import Path

import cv2
import numpy as np

spec=spec_from_file_location("fit_adjust",Path(__file__).with_name("fit-adjust.py"))
fit_adjust=module_from_spec(spec)
spec.loader.exec_module(fit_adjust)


def backend_functions(file):
    # Use the Space's published numeric functions verbatim, without running its UI or plots.
    names={"load_images","extract_sift_features","match_features","get_matched_points",
           "compute_homography_ransac","compute_warped_bounds","apply_homography_to_point"}
    tree=ast.parse(file.read_text())
    functions=ast.Module(body=[node for node in tree.body
      if isinstance(node,ast.FunctionDef) and node.name in names],type_ignores=[])
    namespace={"cv2":cv2,"np":np}
    exec(compile(functions,str(file),"exec"),namespace)
    return namespace


def align(api, directory):
    paths=sorted(directory.glob('strip_*.jpg'))
    with contextlib.redirect_stdout(io.StringIO()):
        images,gray=api["load_images"]([str(p) for p in paths])
        kp,des=api["extract_sift_features"](gray)
        center=len(images)//2
        transforms=[None]*len(images)
        transforms[center]=np.eye(3)
        pairs=[]
        adjacent=[(i,i+1) for i in range(center-1,-1,-1)]+[(i,i-1) for i in range(center+1,len(images))]
        for i,j in adjacent:
            matches=api["match_features"](des[i],des[j])
            a,b=api["get_matched_points"](kp[i],kp[j],matches)
            matrix,valid=api["compute_homography_ransac"](a,b)
            transforms[i]=transforms[j]@matrix
            pairs.append({"views":sorted([i+1,j+1]),"matches":len(matches),"inliers":int(valid.sum())})
    bounds=[api["compute_warped_bounds"](H,*im.shape[:2]) for H,im in zip(transforms,images)]
    l,t,r,b=np.array(bounds).T
    origin=np.array([min(0,min(l)),min(0,min(t))])
    size=[int(max(r)-origin[0]+1),int(max(b)-origin[1]+1)]
    return transforms,images,pairs,origin,size


def recover_output_transforms(images, seed, panorama):
    """Register each source to the actual panorama, seeded by the published aligner."""
    sift=cv2.SIFT_create(nfeatures=16000)
    matcher=cv2.BFMatcher()
    clahe=cv2.createCLAHE(clipLimit=2,tileGridSize=(8,8))

    def descriptors(im, mask=None):
        gray=clahe.apply(cv2.cvtColor(im,cv2.COLOR_BGR2GRAY))
        key, desc=sift.detectAndCompute(gray,mask)
        return np.asarray([p.pt for p in key]),desc

    target, target_features=descriptors(panorama)
    matrices, evidence=[],[]
    for im, start in zip(images,seed):
        height,width=im.shape[:2]
        # The middle of each source is less exposed to overlapping blend weights and feathering.
        mask=np.zeros((height,width),np.uint8)
        mask[round(.05*height):round(.95*height),round(.2*width):round(.8*width)]=255
        source, features=descriptors(im,mask)
        candidates=[a for a,b in matcher.knnMatch(features,target_features,k=2) if a.distance < .82*b.distance]
        x=np.float32(source[[m.queryIdx for m in candidates]])
        y=np.float32(target[[m.trainIdx for m in candidates]])
        projected=np.einsum("ij,kj->ik",np.column_stack((x,np.ones(len(x)))),start[:2,:])
        plausible=np.linalg.norm(projected-y,axis=1)<38
        matrix,inlier=cv2.estimateAffinePartial2D(x[plausible],y[plausible],
                          ransacReprojThreshold=2.5,maxIters=10000,confidence=.999)
        if matrix is None or inlier.sum()<40:
            raise RuntimeError("Could not recover a source transform from the Hugging Face output")
        matrices.append(np.vstack((matrix,[0,0,1])))
        evidence.append(int(inlier.sum()))
    return matrices,evidence


def points_into_output(points, im, matrix, crop, coeff=None):
    W,H=fit_adjust.W,fit_adjust.H
    u=(points[:,0]+.5)/W
    v=(points[:,1]+.5)/H
    if coeff is not None:
        v=v+np.einsum("ij,j->i",fit_adjust.design(points),coeff)/H
    source_x=(u-crop)/(1-2*crop)*im.shape[1]-.5
    source_y=v*im.shape[0]-.5
    return np.einsum("ij,kj->ik",np.column_stack((source_x,source_y,np.ones(len(u)))),matrix[:2,:])


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('full_strips',type=Path)
    parser.add_argument('arms',type=Path)
    parser.add_argument('fit',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('--crop',type=float,default=.08)
    args=parser.parse_args()
    cv2.setRNGSeed(431)
    api=backend_functions(args.source)
    views=[fit_adjust.overlap.source(p) for p in sorted(args.full_strips.glob('*.png'))]
    edges=fit_adjust.select_edges(views)
    coefficients=np.array(json.loads(args.fit.read_text())['coefficients'])
    results={}
    for arm in ('baseline','adjusted'):
        transforms,images,inliers,origin,size=align(api,args.arms/arm)
        panorama=cv2.imread(str(args.arms/(arm+".png")))
        seeds=[h.copy() for h in transforms]
        for h in seeds:
            h[:2,2]-=origin
        transforms,evidence=recover_output_transforms(images,seeds,panorama)
        measure=[]
        for i,j in ((0,1),(1,2),(2,3)):
            edge=next(e for e in edges if e['i']==i and e['j']==j)
            a,b=edge['points']
            choose=(abs(a[:,0]-b[:,0]-edge['dx'])<20) & (abs(a[:,1]-b[:,1])<.055*fit_adjust.H)
            xy0=points_into_output(a[choose],images[i],transforms[i],args.crop,coefficients[i] if arm=='adjusted' else None)
            xy1=points_into_output(b[choose],images[j],transforms[j],args.crop,coefficients[j] if arm=='adjusted' else None)
            dy=abs(xy0[:,1]-xy1[:,1])
            measure.append({'views':[i+1,j+1], 'landmarks':len(dy),
                'verticalMedianPx':float(np.median(dy)),'verticalP90Px':float(np.percentile(dy,90)),
                'overlapCenter':((xy0.mean(axis=0)+xy1.mean(axis=0))/2).tolist()})
        results[arm]={'inliers':inliers,'projectedOverlaps':measure,'predictedSize':size,'actualSize':list(panorama.shape[:2][::-1]),'panoramaRegistrationInliers':evidence}
    print(json.dumps(results,indent=2))
    args.output.write_text(json.dumps(results,indent=2)+"\n")


if __name__=="__main__":
    main()
