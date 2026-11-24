"""Estimate vertical and total alignment at the joins in returned Space panoramas."""
import argparse
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path

import cv2
import numpy as np

spec=spec_from_file_location("measure_overlaps", Path(__file__).with_name("measure-overlaps.py"))
measure=module_from_spec(spec)
spec.loader.exec_module(measure)

CASES={"lacma-168596":[0,1,2,3],"met-310364":[0,8,3,7,4,6,1,5,2]}


def register(api, strip_dir, panorama):
    transforms, images, _, origin, _=measure.align(api,strip_dir)
    for h in transforms:
        h[:2,2]-=origin
    return measure.recover_output_transforms(images,transforms,panorama)


def locate(api, folder, arm, order, directory):
    panorama=cv2.imread(str(folder/(arm+".png")))
    images=[cv2.imread(str(directory/f"strip_{i}.jpg")) for i in range(len(order))]
    # The returned second batch places the first panorama as one image. Compose the
    # actual source registrations from both returned images before the final check.
    if len(order)>5:
        stage1=cv2.imread(str(folder/(arm+"-interim.png")))
        first, evidence1=register(api,folder/(arm+"-batch1"),stage1)
        second, evidence2=register(api,folder/(arm+"-batch2"),panorama)
        seeds=[second[0] @ h for h in first]+second[1:]
        try:
            ordered,evidence=measure.recover_output_transforms([images[i] for i in order],seeds,panorama)
        except RuntimeError:
            ordered,evidence=seeds,{"batch1":evidence1,"batch2":evidence2}
    else:
        ordered,evidence=register(api,directory,panorama)
    return panorama,images,{i:h for i,h in zip(order,ordered)},evidence


def overlap_stats(api, folder, arm, order, original):
    directory=folder/arm if arm!="lower-feather" else folder/"lower-feather"/"adjusted"
    target,images,matrices,evidence=locate(api,folder,arm,order,directory)
    coeff=np.array(json.loads((folder/'coefficients.json').read_text())['coefficients'])
    edges=measure.fit_adjust.select_edges(original)
    rows=[]
    for i,j in zip(order,order[1:]):
        a,b=sorted((i,j))
        edge=next((e for e in edges if e['i']==a and e['j']==b),None)
        if not edge:
            rows.append({"views":[a,b],"reason":"too few reliable source correspondences"})
            continue
        p,q=edge['points']
        W,H=measure.fit_adjust.W,measure.fit_adjust.H
        choose=(abs(p[:,0]-q[:,0]-edge['dx'])<20)&(abs(p[:,1]-q[:,1])<.055*H)
        for xy in (p,q):
            choose &= (xy[:,0]>=.08*W)&(xy[:,0]<=.92*W)
        p,q=p[choose],q[choose]
        xy0=measure.points_into_output(p,images[a],matrices[a],.08,coeff[a] if arm!="baseline" else None)
        xy1=measure.points_into_output(q,images[b],matrices[b],.08,coeff[b] if arm!="baseline" else None)
        d=abs(xy0-xy1)
        rows.append({"views":[a,b],"points":len(d),"vertical":float(np.median(d[:,1])),
                     "total":float(np.median(np.linalg.norm(d,axis=1))),
                     "totalP90":float(np.percentile(np.linalg.norm(d,axis=1),90)),
                     "center":((xy0.mean(axis=0)+xy1.mean(axis=0))/2).tolist()})
    return {"size":list(target.shape[:2][::-1]),"registrationInliers":evidence,"joins":rows}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source",type=Path)
    parser.add_argument("runs",type=Path)
    parser.add_argument("output",type=Path)
    args=parser.parse_args()
    cv2.setRNGSeed(431)
    api=measure.backend_functions(args.source)
    results={}
    for case,order in CASES.items():
        folder=args.runs/case
        paths=sorted((folder/'full').glob('*.png'))
        original=[measure.fit_adjust.overlap.source(p) for p in paths]
        result={"photoOrder":[paths[i].stem for i in order],"arms":{}}
        for arm in ("baseline","adjusted","lower-feather"):
            if (folder/(arm+".png")).is_file():
                result["arms"][arm]=overlap_stats(api,folder,arm,order,original)
        results[case]=result
    args.output.write_text(json.dumps(results,indent=2)+"\n")


if __name__=="__main__":
    main()
