"""Source-only local overlap registration for the research seam merger."""
import cv2
import numpy as np


def normalized(im):
    gray = cv2.cvtColor(np.clip(im, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY)
    return cv2.createCLAHE(clipLimit=2, tileGridSize=(6, 10)).apply(gray)


def gradient_error(a, b):
    components = []
    for dx, dy in ((1, 0), (0, 1)):
        components.append(cv2.Sobel(a, cv2.CV_32F, dx, dy, scale=.125)
                          - cv2.Sobel(b, cv2.CV_32F, dx, dy, scale=.125))
    return cv2.GaussianBlur(np.hypot(*components), (0, 0), 4)


def align_overlap(guide, layer, valid, limit):
    """Warp the incoming source only in shared support, with tapered, consistent flow."""
    rows, cols = np.where(valid)
    if len(rows) < 500:
        return layer, {'reason': 'too little overlap'}
    x0, x1 = cols.min(), cols.max()+1
    y0, y1 = rows.min(), rows.max()+1
    area = np.s_[y0:y1, x0:x1]
    support = valid[area]
    if min(support.shape) < 40:
        return layer, {'reason': 'overlap too narrow'}
    a,b = normalized(guide[area]), normalized(layer[area])
    # Give the estimator a neutral boundary. Output pixels always sample the incoming photo.
    b = np.where(support, b, a).astype(np.uint8)
    flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    forward = flow.calc(a, b, None)
    reverse = flow.calc(b, a, None)
    y,x = np.indices(support.shape, dtype=np.float32)
    inverse_check = cv2.remap(reverse,x+forward[:,:,0],y+forward[:,:,1],cv2.INTER_LINEAR)
    fb = np.linalg.norm(forward+inverse_check,axis=2)
    # Pad the patch before distanceTransform so the taper also vanishes at crop edges.
    distance = cv2.distanceTransform(np.pad(support.astype(np.uint8),1),cv2.DIST_L2,5)[1:-1,1:-1]
    trusted = (distance>limit+2)&(fb<2.25)&(np.linalg.norm(forward,axis=2)<limit)
    if trusted.sum()<500:
        return layer, {'reason': 'insufficient consistent flow'}
    confidence = cv2.GaussianBlur(trusted.astype(np.float32),(0,0),5)
    delta = cv2.GaussianBlur(forward*trusted[...,None],(0,0),5)
    delta /= np.maximum(confidence[...,None],1e-5)
    taper = np.clip((distance-limit-2)/24,0,1)*np.clip(confidence*2,0,1)
    delta *= taper[...,None]
    old_error = gradient_error(a,b)
    moved = cv2.remap(b,x+delta[:,:,0],y+delta[:,:,1],cv2.INTER_LINEAR)
    benefit = cv2.GaussianBlur((gradient_error(a,moved)<old_error).astype(np.float32),(0,0),5)
    delta *= np.clip((benefit-.40)/.35,0,1)[...,None]
    delta = cv2.GaussianBlur(delta,(0,0),5)
    delta *= np.clip((distance-limit-2)/18,0,1)[...,None]
    # Bound spatial derivatives as well as displacement. The inverse map then
    # stays orientation-preserving even where neighboring flow estimates differ.
    derivatives = np.abs(np.gradient(delta,axis=0))+np.abs(np.gradient(delta,axis=1))
    delta *= min(1.,.60/max(float(derivatives.max()),1e-6))
    map_x,map_y=x+delta[:,:,0],y+delta[:,:,1]
    dx_x,dx_y=np.gradient(map_x,axis=1),np.gradient(map_x,axis=0)
    dy_x,dy_y=np.gradient(map_y,axis=1),np.gradient(map_y,axis=0)
    jacobian=dx_x*dy_y-dx_y*dy_x
    if jacobian.min()<.30:
        return layer, {'reason': 'flow risks folding the overlap'}
    new_error = gradient_error(a,cv2.remap(b,map_x,map_y,cv2.INTER_LINEAR))
    target = trusted & (taper>.75) & (old_error>3)
    if target.sum()<500:
        return layer, {'reason': 'too little painted support'}
    before,after = (float(np.median(error[target])) for error in (old_error,new_error))
    if after>=.98*before:
        return layer, {'reason': 'gradient agreement barely changed', 'before':before, 'after':after}
    result=layer.copy()
    result[area] = cv2.remap(layer[area].astype(np.float32),map_x,map_y,cv2.INTER_LINEAR)
    return result, {'before':before, 'after':after,'pixels':int(target.sum()),
                    'peakPx':float(np.max(np.linalg.norm(delta,axis=2))),
                    'minimumJacobian':float(jacobian.min())}
