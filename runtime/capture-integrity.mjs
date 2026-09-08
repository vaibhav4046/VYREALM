// Capture evidence is kept unmodified. This gate labels missing time instead of
// padding, stretching, duplicating frames, or claiming uninterrupted recording.
export function validateCaptureSegment({ wallSeconds, capturedSeconds, interrupted = false, probeAvailable = true, toleranceSeconds = 2 }) {
  const validWall = Number.isFinite(wallSeconds) && wallSeconds > 0;
  const validCapture = probeAvailable && Number.isFinite(capturedSeconds) && capturedSeconds > 0;
  const durationDeltaSeconds = validWall && validCapture ? capturedSeconds - wallSeconds : null;
  const reasons = [];
  if (!validWall) reasons.push('INVALID_WALL_CLOCK_INTERVAL');
  if (!validCapture) reasons.push('VIDEO_DURATION_UNVERIFIED');
  if (durationDeltaSeconds != null && Math.abs(durationDeltaSeconds) > toleranceSeconds) reasons.push('VIDEO_WALL_CLOCK_MISMATCH');
  if (interrupted) reasons.push('OBSERVATION_INTERRUPTED');
  return {
    state: reasons.length ? 'incomplete' : 'complete',
    reasons, wallSeconds, capturedSeconds: validCapture ? capturedSeconds : null,
    durationDeltaSeconds, toleranceSeconds,
    missingSeconds: durationDeltaSeconds == null ? null : Math.max(0, -durationDeltaSeconds),
    timing: reasons.length ? 'original unretimed recording; incomplete evidence' : 'original unretimed recording; wall-clock duration verified',
  };
}
