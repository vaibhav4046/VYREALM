export type ReleaseState = 'draft' | 'rendered' | 'reviewed' | 'approved' | 'uploading' | 'uploaded_private' | 'processing' | 'scheduled' | 'published' | 'blocked';
export interface ProjectRef { id: string; revision: string }
export interface OutputRef { path: string; sha256: string; mimeType?: string; durationSeconds?: number }
export interface ReleaseMetadata { channelId: string; title: string; description?: string; tags?: string[]; privacyStatus?: 'private'|'unlisted'|'public'; publishAt?: string }
export interface CaptionTrack { language: string; path: string; sha256?: string; name?: string }
export interface ThumbnailRef { path: string; sha256?: string }
export interface AiDisclosure { containsSyntheticMedia: boolean; rationale?: string }
export interface RightsEntry { assetId: string; kind: string; source: string; evidence?: string }
export interface ChannelRef { id: string; title?: string; apiProject?: { verified?: boolean; auditStatus?: string } }
export interface UploadRecord { sessionUri: string; bytesUploaded: number; startedAt: string; videoId?: string }
export interface ReleasePackage { schemaVersion: 1; id: string; state: ReleaseState; project: ProjectRef; output: OutputRef; metadata: ReleaseMetadata; captions: CaptionTrack[]; thumbnail: ThumbnailRef|null; aiDisclosure: AiDisclosure; rightsLedger: RightsEntry[]; channel: ChannelRef; upload: UploadRecord|null; approvals: unknown[]; history: unknown[]; createdAt: string; updatedAt: string }
export class ReleaseValidationError extends Error { code: string; details: Record<string, unknown> }
export declare const RELEASE_STATES: readonly ReleaseState[];
export declare const allowedTransitions: Readonly<Record<ReleaseState, readonly ReleaseState[]>>;
export declare const RELEASE_PACKAGE_SCHEMA: Record<string, unknown>;
export interface ReleaseStoreOptions { filePath?: string; clock?: () => Date; idFactory?: () => string }
export class ReleaseStore {
  constructor(options?: ReleaseStoreOptions);
  list(): Promise<ReleasePackage[]>;
  get(id: string): Promise<ReleasePackage|null>;
  create(input: Partial<ReleasePackage>): Promise<ReleasePackage>;
  update(id: string, patch: Partial<ReleasePackage>): Promise<ReleasePackage>;
  transition(id: string, state: ReleaseState, options?: { reason?: string; actor?: string }): Promise<ReleasePackage>;
  beginUpload(id: string, sessionUri: string): Promise<ReleasePackage>;
  recordUpload(id: string, patch: Partial<UploadRecord>): Promise<ReleasePackage>;
}
export declare function validateRelease(release: ReleasePackage, options?: { now?: Date; targetState?: ReleaseState }): true;
export declare function createReleasePackage(input: Partial<ReleasePackage>, options?: { clock?: () => Date; idFactory?: () => string }): ReleasePackage;
export declare function hashOutput(filePath: string): Promise<string>;
