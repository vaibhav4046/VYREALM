"""Motion-compensated detail stabilization for a single upscaled shot.

Keeps low-frequency colour/lighting from each current frame. Reuses only 25%
of previous fine detail where source optical flow passes a photometric check.
Hard cuts reset history. This is not a semantic deformation/face detector.
"""
import argparse, json, pathlib
import cv2
import numpy as np
p=argparse.ArgumentParser()
p.add_argument('--source',required=True);p.add_argument('--enhanced',required=True);p.add_argument('--output',required=True)
a=p.parse_args();source=pathlib.Path(a.source);enhanced=pathlib.Path(a.enhanced);output=pathlib.Path(a.output);output.mkdir(parents=True,exist_ok=True)
files=sorted(source.glob('*.png'));previous_source=None;previous_detail=None;metrics=[]
if not files:raise RuntimeError('No source frames')
for i,path in enumerate(files):
    original=cv2.imread(str(path));up=cv2.imread(str(enhanced/path.name))
    if original is None or up is None:raise RuntimeError(f'Missing frame {path.name}')
    original=cv2.cvtColor(original,cv2.COLOR_BGR2GRAY)
    up=up.astype(np.float32)
    low=cv2.GaussianBlur(up,(0,0),1.4);detail=up-low
    accepted=0.0;cut=False
    if previous_source is not None:
        cut=float(np.mean(cv2.absdiff(original,previous_source)))>45
        if not cut:
            # Backward flow maps the current frame into the previous one.
            flow=cv2.calcOpticalFlowFarneback(original,previous_source,None,0.5,3,19,3,5,1.2,0)
            sh,sw=original.shape;h,w=up.shape[:2]
            small_x,small_y=np.meshgrid(np.arange(sw,dtype=np.float32),np.arange(sh,dtype=np.float32))
            warped_source=cv2.remap(previous_source,small_x+flow[:,:,0],small_y+flow[:,:,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT101)
            confidence=np.clip(1.0-cv2.absdiff(original,warped_source).astype(np.float32)/18.0,0,1)
            confidence=cv2.GaussianBlur(confidence,(3,3),0)
            flow=cv2.resize(flow,(w,h));flow[:,:,0]*=w/sw;flow[:,:,1]*=h/sh
            xx,yy=np.meshgrid(np.arange(w,dtype=np.float32),np.arange(h,dtype=np.float32))
            previous_warp=cv2.remap(previous_detail,xx+flow[:,:,0],yy+flow[:,:,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT101)
            weight=cv2.resize(confidence,(w,h))[:,:,None]*0.25
            detail=detail*(1-weight)+previous_warp*weight
            accepted=float(confidence.mean())
    result=np.clip(low+detail,0,255).astype(np.uint8)
    if not cv2.imwrite(str(output/path.name),result):raise RuntimeError('Frame write failed')
    metrics.append({'frame':i,'sceneReset':cut,'meanFlowConfidence':round(accepted,5)})
    previous_source=original;previous_detail=detail
    if i%12==0:print(json.dumps({'stage':'Temporal detail stabilization','frame':i,'frames':len(files)}),flush=True)
(output/'temporal-report.json').write_text(json.dumps({'method':'backward-flow-photometric-mask-detail-blend-v1','maxHistoryWeight':0.25,'sceneCutMeanDelta':45,'frames':metrics},indent=2))
