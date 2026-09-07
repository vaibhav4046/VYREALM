#!/usr/bin/env python
"""VYREALM QC probe: cheap, neural-net-free video quality metrics.

Emits a JSON blob of aggregate metrics plus per-frame arrays, for a quality gate
that decides pass / warn / fail on locally generated shots.

Design notes
------------
Three of VBench's six "temporal" dimensions are, in their own source, nothing but
``np.mean(cv2.absdiff(a, b))`` wrapped in ``(255.0 - x) / 255.0``. Those we
reproduce exactly, not approximately. The dimensions that genuinely need a
network (DINO / CLIP / MUSIQ) get named classical stand-ins, and every such
stand-in is labelled ``*_proxy`` so nobody mistakes it for the real score.

Runs on numpy + opencv only. No torch, no ffmpeg subprocess: OpenCV is built
with FFMPEG so ``cv2.VideoCapture`` already decodes these files.

Usage
    python probe_metrics.py VIDEO [--out metrics.json] [--no-per-frame]
    python probe_metrics.py --selfcheck
"""

from __future__ import annotations

import argparse
import json
import sys

import cv2
import numpy as np

# Flow is computed on frames rescaled to this minimum dimension. VBench scales
# its dynamic-degree threshold as 6.0 * (min_dim / 256.0); by normalising the
# frame instead of the threshold we can use their constant 6.0 unmodified and
# stay comparable across 576p / 1080p / 4K sources.
FLOW_MIN_DIM = 256
VBENCH_DYNAMIC_THRESHOLD = 6.0

# A pair whose mean absolute difference falls under this is a repeated frame.
# Not zero, because H.264 reconstruction of a duplicated frame is near-exact,
# not exact. Calibrated against the encoded samples, see the report.
NEAR_DUPLICATE_MAE = 0.5

ORB_FEATURES = 500
LOWE_RATIO = 0.75
RANSAC_REPROJ_PX = 3.0

BLOCK_SIZE = 8  # JPEG/H.264 transform grid, where blocking artefacts land.


class ProbeError(Exception):
    """Coded failure. Never approximate silently."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# --------------------------------------------------------------------------
# per-frame measurements
# --------------------------------------------------------------------------


def _blockiness(gray: np.ndarray) -> float:
    """Ratio of gradient energy on the 8x8 transform grid to gradient energy off it.

    1.0 means blocking is indistinguishable from ordinary image detail; above
    ~1.15 the block grid is visible. Cheap stand-in for a DCT-domain measure.
    """
    g = gray.astype(np.float32)
    ratios = []
    for axis in (0, 1):
        d = np.abs(np.diff(g, axis=axis))
        n = d.shape[axis]
        if n < BLOCK_SIZE * 2:
            continue
        # diff index i sits between samples i and i+1, so the boundary before
        # sample k*BLOCK_SIZE is diff index k*BLOCK_SIZE - 1.
        idx = np.arange(BLOCK_SIZE, n + 1, BLOCK_SIZE) - 1
        idx = idx[idx < n]
        on_grid = np.zeros(n, dtype=bool)
        on_grid[idx] = True
        if on_grid.all() or not on_grid.any():
            continue
        take = d[idx, :] if axis == 0 else d[:, idx]
        rest = d[~on_grid, :] if axis == 0 else d[:, ~on_grid]
        ratios.append(float((take.mean() + 1e-6) / (rest.mean() + 1e-6)))
    return float(np.mean(ratios)) if ratios else 1.0


def _frame_stats(bgr: np.ndarray) -> dict:
    """Scalars for one frame. The full-resolution HSV array is built, used and
    dropped here -- clipping fractions must be measured before any downscale,
    because area-averaging pulls clipped pixels back under the threshold."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]
    b, g, r = (float(bgr[:, :, i].mean()) for i in range(3))
    return {
        "gray": gray,
        # Variance of Laplacian: the standard no-reference focus measure.
        "sharpness": float(cv2.Laplacian(gray, cv2.CV_64F).var()),
        "luma_mean": float(gray.mean()),
        "mean_b": b,
        "mean_g": g,
        "mean_r": r,
        "sat_extreme_frac": float((sat >= 250).mean()),
        "highlight_clip_frac": float((val >= 250).mean()),
        "shadow_crush_frac": float((val <= 5).mean()),
        "blockiness": _blockiness(gray),
    }


def _hs_hist(hsv: np.ndarray) -> np.ndarray:
    h = cv2.calcHist([hsv], [0, 1], None, [50, 60], [0, 180, 0, 256])
    return cv2.normalize(h, h).flatten()


def _orb_ratios(matcher, kp_a, des_a, kp_b, des_b) -> tuple[float, float]:
    """(Lowe match ratio, RANSAC homography inlier ratio).

    The two disagree in a way we care about. A high match ratio with a low
    homography inlier ratio means the frames share texture but no single rigid
    transform explains them: the scene is morphing rather than moving. That is
    the signature failure of a diffusion video model, and it is invisible to a
    frame-difference metric.
    """
    if des_a is None or des_b is None or len(kp_a) < 8 or len(kp_b) < 8:
        return 0.0, 0.0
    pairs = matcher.knnMatch(des_a, des_b, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < LOWE_RATIO * n.distance]
    denom = min(len(kp_a), len(kp_b))
    match_ratio = len(good) / denom if denom else 0.0
    if len(good) < 8:
        return match_ratio, 0.0
    src = np.float32([kp_a[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp_b[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    _, mask = cv2.findHomography(src, dst, cv2.RANSAC, RANSAC_REPROJ_PX)
    inlier_ratio = float(mask.sum()) / len(good) if mask is not None else 0.0
    return match_ratio, inlier_ratio


def _slope(values: list[float], fps: float) -> float:
    """Least-squares slope in units per second."""
    if len(values) < 3:
        return 0.0
    t = np.arange(len(values), dtype=np.float64) / fps
    return float(np.polyfit(t, np.asarray(values, dtype=np.float64), 1)[0])


def _stats(values) -> dict:
    a = np.asarray(values, dtype=np.float64)
    if a.size == 0:
        return {"mean": 0.0, "std": 0.0, "min": 0.0, "max": 0.0, "p95": 0.0}
    return {
        "mean": float(a.mean()),
        "std": float(a.std()),
        "min": float(a.min()),
        "max": float(a.max()),
        "p95": float(np.percentile(a, 95)),
    }


# --------------------------------------------------------------------------
# core analysis (streams frames; never holds the whole video)
# --------------------------------------------------------------------------


def analyse(frames, fps: float) -> dict:
    """Consume an iterator of BGR uint8 frames and return the metric dict."""
    orb = cv2.ORB_create(nfeatures=ORB_FEATURES)
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)

    sharp, luma, mean_b, mean_g, mean_r = [], [], [], [], []
    sat_ex, hi_clip, lo_crush, blocky = [], [], [], []
    rgb_mae, luma_mae, hf_delta = [], [], []
    hist_prev, hist_first = [], []
    orb_prev, orb_first, orb_homog = [], [], []
    flow_mean, flow_top5, bg_hist_prev = [], [], []
    blend_mae = []

    first = None  # (hist, kp, des)
    ring: list[dict] = []  # up to 3 recent frames: bgr, gray, small_gray, hist, kp, des
    count = 0
    height = width = 0

    for bgr in frames:
        count += 1
        if height == 0:
            height, width = bgr.shape[:2]
        st = _frame_stats(bgr)
        sharp.append(st["sharpness"])
        luma.append(st["luma_mean"])
        mean_b.append(st["mean_b"])
        mean_g.append(st["mean_g"])
        mean_r.append(st["mean_r"])
        sat_ex.append(st["sat_extreme_frac"])
        hi_clip.append(st["highlight_clip_frac"])
        lo_crush.append(st["shadow_crush_frac"])
        blocky.append(st["blockiness"])

        gray = st["gray"]
        scale = FLOW_MIN_DIM / min(gray.shape[:2])
        small_bgr = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        small = cv2.cvtColor(small_bgr, cv2.COLOR_BGR2GRAY)
        small_hsv = cv2.cvtColor(small_bgr, cv2.COLOR_BGR2HSV)
        # Histograms are computed at flow scale, not full resolution: a colour
        # histogram is scale-invariant to within noise, and this keeps the ring
        # buffer at a few MB instead of tens.
        hist = _hs_hist(small_hsv)
        kp, des = orb.detectAndCompute(small, None)
        cur = {"bgr": bgr, "gray": gray, "small": small, "small_hsv": small_hsv,
               "hist": hist, "kp": kp, "des": des}

        if first is None:
            # Only the comparison keys are retained for the whole clip.
            first = {"hist": hist, "kp": kp, "des": des}
        else:
            prev = ring[-1]
            # --- VBench-exact temporal flickering input ---
            rgb_mae.append(float(np.mean(cv2.absdiff(bgr, prev["bgr"]))))
            luma_mae.append(float(np.mean(cv2.absdiff(gray, prev["gray"]))))
            hf_delta.append(abs(st["sharpness"] - sharp[-2]))

            hist_prev.append(float(cv2.compareHist(prev["hist"], hist, cv2.HISTCMP_CORREL)))
            hist_first.append(float(cv2.compareHist(first["hist"], hist, cv2.HISTCMP_CORREL)))

            mr, ir = _orb_ratios(matcher, prev["kp"], prev["des"], kp, des)
            orb_prev.append(mr)
            orb_homog.append(ir)
            orb_first.append(_orb_ratios(matcher, first["kp"], first["des"], kp, des)[0])

            flow = cv2.calcOpticalFlowFarneback(
                prev["small"], small, None, 0.5, 3, 15, 3, 5, 1.2, 0
            )
            rad = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)
            flow_mean.append(float(rad.mean()))
            # VBench dynamic degree takes the mean of the largest 5% of magnitudes.
            k = max(1, int(rad.size * 0.05))
            flow_top5.append(float(np.sort(rad.ravel())[-k:].mean()))

            # Background consistency proxy: histogram correlation restricted to
            # the half of the frame that is moving least. Free, because the flow
            # field is already computed. Not segmentation, so a static subject
            # lands in the "background" mask.
            mask = (rad <= np.median(rad)).astype(np.uint8) * 255
            if mask.any():
                hb = cv2.calcHist([small_hsv], [0, 1], mask, [50, 60], [0, 180, 0, 256])
                hb = cv2.normalize(hb, hb).flatten()
                pb = cv2.calcHist([prev["small_hsv"]], [0, 1], mask, [50, 60], [0, 180, 0, 256])
                pb = cv2.normalize(pb, pb).flatten()
                bg_hist_prev.append(float(cv2.compareHist(pb, hb, cv2.HISTCMP_CORREL)))

        ring.append(cur)
        if len(ring) > 3:
            ring.pop(0)
        # --- motion smoothness proxy: linear-blend frame reconstruction ---
        # VBench drops every other frame, rebuilds it with the AMT interpolation
        # network and scores (255 - MAE) / 255. Swap AMT for a linear blend and
        # the same formula holds; the residual |f_t - (f_{t-1} + f_{t+1}) / 2|
        # is exactly half the discrete second time-derivative of the pixel.
        if len(ring) == 3:
            a, b, c = ring[0]["bgr"], ring[1]["bgr"], ring[2]["bgr"]
            recon = ((a.astype(np.int16) + c.astype(np.int16)) // 2).astype(np.uint8)
            blend_mae.append(float(np.mean(cv2.absdiff(b, recon))))

    if count == 0:
        raise ProbeError("VYQC_NO_FRAMES", "decoder returned zero frames")
    if count < 3:
        raise ProbeError("VYQC_TOO_FEW_FRAMES", f"need >= 3 frames, got {count}")

    pairs = len(rgb_mae)
    duration = count / fps if fps > 0 else 0.0

    exact_dupes = [i for i, v in enumerate(rgb_mae) if v == 0.0]
    near_dupes = [i for i, v in enumerate(rgb_mae) if v < NEAR_DUPLICATE_MAE]
    longest_stall = 0
    run = 0
    for i in range(pairs):
        run = run + 1 if rgb_mae[i] < NEAR_DUPLICATE_MAE else 0
        longest_stall = max(longest_stall, run)

    # VBench dynamic-degree verdict, their thresholds, Farneback instead of RAFT.
    count_num = max(1, round(4 * (count / 16.0)))
    moving = sum(1 for v in flow_top5 if v > VBENCH_DYNAMIC_THRESHOLD)
    flow_accel = np.abs(np.diff(np.asarray(flow_mean), 2)) if len(flow_mean) >= 3 else np.array([])

    mean_sharp = float(np.mean(sharp)) if sharp else 0.0

    metrics = {
        "schemaVersion": 1,
        "source": {
            "frames": count,
            "fps": fps,
            "durationSec": round(duration, 4),
            "width": width,
            "height": height,
            "framePairs": pairs,
        },
        "temporalFlicker": {
            # (255 - mean MAE) / 255 on RGB: VBench's temporal_flickering, verbatim.
            "vbenchFlickerScore": (255.0 - float(np.mean(rgb_mae))) / 255.0 if rgb_mae else 1.0,
            "rgbMae": _stats(rgb_mae),
            "lumaMae": _stats(luma_mae),
            # Variance of the delta series: steady motion has a stable MAE,
            # flicker makes it jump frame to frame.
            "lumaMaeVariance": float(np.var(luma_mae)) if luma_mae else 0.0,
            "highFreqEnergyDelta": _stats(hf_delta),
        },
        "motionSmoothness": {
            "blendSmoothnessProxy": (255.0 - float(np.mean(blend_mae))) / 255.0 if blend_mae else 1.0,
            "blendReconstructionMae": _stats(blend_mae),
            "flowAcceleration": _stats(flow_accel),
        },
        "dynamicDegree": {
            "vbenchIsDynamic": moving >= count_num,
            "vbenchMovingPairs": moving,
            "vbenchRequiredPairs": count_num,
            "flowTop5Pct": _stats(flow_top5),
            "flowMean": _stats(flow_mean),
        },
        "stability": {
            "histCorrPrevFrame": _stats(hist_prev),
            "histCorrFirstFrame": _stats(hist_first),
            "backgroundHistCorrProxy": _stats(bg_hist_prev),
            "orbMatchRatioPrev": _stats(orb_prev),
            "orbMatchRatioFirst": _stats(orb_first),
            "orbHomographyInlierRatio": _stats(orb_homog),
        },
        "stall": {
            "exactDuplicatePairs": len(exact_dupes),
            "nearDuplicatePairs": len(near_dupes),
            "nearDuplicateIndices": near_dupes[:50],
            "longestStallRun": longest_stall,
            "nearDuplicateThresholdMae": NEAR_DUPLICATE_MAE,
        },
        "colourDrift": {
            "slopePerSec": {
                "b": _slope(mean_b, fps),
                "g": _slope(mean_g, fps),
                "r": _slope(mean_r, fps),
                "luma": _slope(luma, fps),
            },
            "endMinusStart": {
                "b": mean_b[-1] - mean_b[0],
                "g": mean_g[-1] - mean_g[0],
                "r": mean_r[-1] - mean_r[0],
                "luma": luma[-1] - luma[0],
            },
            "maxChannelSpreadDrift": max(
                abs(_slope(mean_b, fps) - _slope(mean_r, fps)),
                abs(_slope(mean_b, fps) - _slope(mean_g, fps)),
                abs(_slope(mean_g, fps) - _slope(mean_r, fps)),
            ),
        },
        "sharpness": {
            "laplacianVar": _stats(sharp),
            "slopePerSec": _slope(sharp, fps),
            # Relative trend is the comparable number across shots: absolute
            # Laplacian variance depends on content and resolution.
            "relativeSlopePctPerSec": 100.0 * _slope(sharp, fps) / mean_sharp if mean_sharp else 0.0,
        },
        "artefacts": {
            "blockinessRatio": _stats(blocky),
            "saturationExtremeFrac": _stats(sat_ex),
            "highlightClipFrac": _stats(hi_clip),
            "shadowCrushFrac": _stats(lo_crush),
        },
        "perFrame": {
            "sharpness": [round(v, 3) for v in sharp],
            "lumaMean": [round(v, 3) for v in luma],
            "rgbMae": [round(v, 4) for v in rgb_mae],
            "lumaMae": [round(v, 4) for v in luma_mae],
            "flowMean": [round(v, 4) for v in flow_mean],
            "flowTop5Pct": [round(v, 4) for v in flow_top5],
            "blendReconstructionMae": [round(v, 4) for v in blend_mae],
            "histCorrPrevFrame": [round(v, 5) for v in hist_prev],
            "orbHomographyInlierRatio": [round(v, 4) for v in orb_homog],
            "blockinessRatio": [round(v, 4) for v in blocky],
        },
    }
    return metrics


# --------------------------------------------------------------------------
# io
# --------------------------------------------------------------------------


def read_video(path: str):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise ProbeError("VYQC_OPEN_FAILED", f"OpenCV could not open {path}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps != fps or fps <= 0:
        cap.release()
        raise ProbeError("VYQC_BAD_FPS", f"decoder reported unusable fps {fps!r}")

    def gen():
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                yield frame
        finally:
            cap.release()

    return gen(), float(fps)


def probe(path: str) -> dict:
    import os

    if not os.path.isfile(path):
        raise ProbeError("VYQC_FILE_NOT_FOUND", f"no such file: {path}")
    frames, fps = read_video(path)
    out = analyse(frames, fps)
    out["source"]["path"] = os.path.abspath(path)
    return out


# --------------------------------------------------------------------------
# self-check: synthetic frames with known properties, no encoder in the loop
# --------------------------------------------------------------------------


def selfcheck() -> None:
    rng = np.random.default_rng(7)
    h, w, view, dx, n = 288, 704, 512, 8, 24
    # Hard-edged shapes so ORB has real corners to latch onto; flat noise does not
    # give a feature detector anything to work with.
    canvas = np.full((h, w, 3), 110, dtype=np.uint8)
    for _ in range(60):
        c = tuple(int(v) for v in rng.integers(0, 256, 3))
        x0, y0 = int(rng.integers(0, w - 40)), int(rng.integers(0, h - 40))
        if rng.random() < 0.5:
            cv2.rectangle(canvas, (x0, y0), (x0 + int(rng.integers(10, 40)),
                                             y0 + int(rng.integers(10, 40))), c, -1)
        else:
            cv2.circle(canvas, (x0, y0), int(rng.integers(5, 20)), c, -1)
    base = canvas[:, :view].copy()

    def frozen():
        for _ in range(n):
            yield base.copy()

    def panning():
        # Sliding crop, not np.roll: a wraparound seam would fake a motion edge.
        for i in range(n):
            yield canvas[:, i * dx: i * dx + view].copy()

    def flickering():
        for i in range(n):
            f = base.astype(np.int16) + (30 if i % 2 else -30)
            yield np.clip(f, 0, 255).astype(np.uint8)

    def softening():
        for i in range(n):
            yield cv2.GaussianBlur(base, (1 + 2 * i, 1 + 2 * i), 0)

    fz = analyse(frozen(), 24.0)
    pn = analyse(panning(), 24.0)
    fl = analyse(flickering(), 24.0)
    sf = analyse(softening(), 24.0)

    # A frozen clip is a perfect stall and not dynamic.
    assert fz["stall"]["exactDuplicatePairs"] == n - 1, fz["stall"]
    assert fz["stall"]["longestStallRun"] == n - 1, fz["stall"]
    assert fz["dynamicDegree"]["vbenchIsDynamic"] is False, fz["dynamicDegree"]
    assert fz["temporalFlicker"]["vbenchFlickerScore"] == 1.0, fz["temporalFlicker"]
    assert fz["motionSmoothness"]["blendSmoothnessProxy"] == 1.0, fz["motionSmoothness"]
    assert abs(fz["sharpness"]["relativeSlopePctPerSec"]) < 1e-6, fz["sharpness"]

    # A pan is dynamic, has no stalls, and stays coherent under a homography.
    assert pn["dynamicDegree"]["vbenchIsDynamic"] is True, pn["dynamicDegree"]
    assert pn["stall"]["nearDuplicatePairs"] == 0, pn["stall"]
    assert pn["stability"]["orbHomographyInlierRatio"]["mean"] > 0.8, pn["stability"]
    # Ground truth: the crop slides dx px/frame at full scale, and flow is
    # measured after rescaling to FLOW_MIN_DIM, so true displacement is known.
    # The top-5% statistic recovers it to within 10%; the whole-frame mean reads
    # roughly 60% low, because Farneback returns ~0 in the flat regions it cannot
    # solve. That gap is the reason VBench thresholds on the top 5% and not the
    # mean, and the reason the gate must not use flowMean as an absolute.
    truth = dx * (FLOW_MIN_DIM / h)
    assert abs(pn["dynamicDegree"]["flowTop5Pct"]["mean"] - truth) / truth < 0.10, (
        pn["dynamicDegree"], truth)
    assert pn["dynamicDegree"]["flowMean"]["mean"] < truth, "mean flow under-reads on flat content"

    # Flicker: large frame-to-frame difference with near-zero optical flow. The
    # pair is the signature -- neither number alone distinguishes flicker from
    # legitimate motion, which is the whole reason both are measured.
    assert fl["temporalFlicker"]["vbenchFlickerScore"] < fz["temporalFlicker"]["vbenchFlickerScore"]
    assert fl["temporalFlicker"]["rgbMae"]["mean"] > 25.0, fl["temporalFlicker"]
    assert fl["dynamicDegree"]["flowMean"]["mean"] < 1.0, fl["dynamicDegree"]
    # A 2-frame alternation is the worst case for the second time-derivative:
    # neighbours agree with each other and disagree with the middle frame, so
    # the linear-blend residual is the full swing. Smoothness must rank it
    # below a real pan.
    assert fl["motionSmoothness"]["blendSmoothnessProxy"] < 0.85, fl["motionSmoothness"]
    assert (fl["motionSmoothness"]["blendSmoothnessProxy"]
            < pn["motionSmoothness"]["blendSmoothnessProxy"]), "flicker should score rougher than a pan"

    # Progressive blur must show up as a negative sharpness trend.
    assert sf["sharpness"]["relativeSlopePctPerSec"] < -20.0, sf["sharpness"]

    print("selfcheck OK")
    print(f"  frozen    flicker={fz['temporalFlicker']['vbenchFlickerScore']:.6f} "
          f"flowMean={fz['dynamicDegree']['flowMean']['mean']:.4f}")
    print(f"  panning   flicker={pn['temporalFlicker']['vbenchFlickerScore']:.6f} "
          f"flowMean={pn['dynamicDegree']['flowMean']['mean']:.4f} "
          f"homogInlier={pn['stability']['orbHomographyInlierRatio']['mean']:.4f}")
    print(f"  flicker   flicker={fl['temporalFlicker']['vbenchFlickerScore']:.6f} "
          f"flowMean={fl['dynamicDegree']['flowMean']['mean']:.4f} "
          f"blendSmooth={fl['motionSmoothness']['blendSmoothnessProxy']:.6f}")
    print(f"  softening sharpTrend={sf['sharpness']['relativeSlopePctPerSec']:.2f} %/s")


def main() -> int:
    ap = argparse.ArgumentParser(description="VYREALM cheap video quality probe")
    ap.add_argument("video", nargs="?", help="path to the video file")
    ap.add_argument("--out", help="write JSON here instead of stdout")
    ap.add_argument("--no-per-frame", action="store_true", help="omit per-frame arrays")
    ap.add_argument("--selfcheck", action="store_true", help="run assertions on synthetic clips")
    args = ap.parse_args()

    if args.selfcheck:
        selfcheck()
        return 0
    if not args.video:
        ap.error("a video path is required unless --selfcheck is given")

    try:
        result = probe(args.video)
    except ProbeError as e:
        json.dump({"error": {"code": e.code, "message": e.message}}, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 2

    if args.no_per_frame:
        result.pop("perFrame", None)
    text = json.dumps(result, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print(f"wrote {args.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
