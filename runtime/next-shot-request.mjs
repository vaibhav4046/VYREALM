import { join } from 'node:path';

export function prepareNextShotInput({ request, project, sourceJob, receipt, jobsDir }) {
  const sourceMode = request.sourceMode ?? 'locked-keyframe';
  const reject = (code, message) => { throw Object.assign(new Error(message), { code }); };
  if (!['locked-keyframe', 'new-keyframe'].includes(sourceMode)) reject('SHOT_SOURCE_MODE_INVALID', 'Choose a locked keyframe or a new independent keyframe');
  if (!project || request.expectedRevision !== project.revision) reject('PROJECT_CHANGED', 'Refresh the project before generating another shot');
  if (typeof request.brief !== 'string' || !request.brief.trim() || request.brief.length > 6000) reject('SHOT_BRIEF_INVALID', 'Describe the next shot in 1–6000 characters');
  if (!sourceJob || sourceJob.project_id !== project.id || sourceJob.status !== 'succeeded' || !['generation-test', 'generation-shot'].includes(sourceJob.type) || receipt?.provenance?.generationStatus !== 'generated' || !receipt.provenance.evidenceHash || !receipt.provenance.keyframe?.outputHash || receipt.review?.verdict !== 'passed') reject('REVIEWED_REFERENCE_REQUIRED', 'A reviewed local keyframe-and-motion generation from this project is required first');
  if (receipt.review.outputHash !== receipt.provenance.outputHash) reject('REFERENCE_REVIEW_STALE', 'Review the current delivery bytes before using this generation prerequisite');
  const input = {
    projectId: project.id, revision: project.revision, brief: request.brief.trim(),
    seed: Number.isSafeInteger(request.seed) && request.seed >= 0 ? request.seed : 7092027,
    append: true, sourceMode, prerequisiteJobId: sourceJob.id,
  };
  // A new shot invokes the provider's keyframe stage. It does not condition on
  // the prerequisite's image and cannot claim to lock its face or wardrobe.
  if (sourceMode === 'locked-keyframe') input.reference = {
    path: receipt.provenance.keyframe.sourceJobId ? join(jobsDir, sourceJob.id, 'reference.png') : join(jobsDir, sourceJob.id, 'keyframe', 'frames', '00000.png'),
    sourceJobId: sourceJob.id, sha256: receipt.provenance.keyframe.outputHash, promptId: receipt.provenance.keyframe.promptId,
  };
  return input;
}
