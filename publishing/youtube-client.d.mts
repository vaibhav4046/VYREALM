export type YouTubeFeature = 'upload' | 'analytics';
export interface ProtectedVault {
  protection(): { protected: boolean; qualified: boolean; mechanism?: string; platform?: string; diagnostic?: string };
  read(): Promise<Record<string, unknown>>;
  write(value: Record<string, unknown>): Promise<void>;
  clear?(): Promise<void>;
  close?(): void;
}
export interface UploadReceipt {
  id: string; state: 'uploading' | 'uploaded_private'; videoId: string | null;
  channelId: string; fileName: string; sha256: string;
  bytesTotal: number; bytesUploaded: number; createdAt: string; updatedAt: string;
  privacyStatus: 'private'; watchUrl?: string;
}
export interface AuthorizationResult {
  connected: boolean; code: string; scopes?: string[]; refreshAvailable?: boolean;
}
export interface PrivateUploadInput {
  filePath: string; sha256: string; expectedChannelId: string; confirmed: true;
  containsSyntheticMedia: boolean; signal?: AbortSignal;
  metadata: { title: string; description?: string; tags?: string[]; privacyStatus?: 'private'; selfDeclaredMadeForKids?: boolean };
}
export interface YouTubeClient {
  status(): Promise<Record<string, unknown>>;
  configureDesktopCredentials(credentials: { installed: { client_id: string; client_secret?: string } }): Promise<{ configured: true; clientId: string; secretStored: boolean; protection?: string }>;
  beginAuthorization(options?: { features?: YouTubeFeature[] }): Promise<{ authorizationUrl: string; redirectUri: string; expiresAt: number; scopes: string[]; completion: Promise<AuthorizationResult>; cancel(): void }>;
  disconnect(): Promise<{ connected: false; code: string; diagnostic: string }>;
  beginPrivateUpload(input: PrivateUploadInput): Promise<UploadReceipt>;
  resumeUpload(id: string, options?: { signal?: AbortSignal; onProgress?: (receipt: UploadReceipt) => void | Promise<void>; maxChunks?: number }): Promise<UploadReceipt>;
  getUploadStatus(id: string): Promise<UploadReceipt | null>;
  listUploads(): Promise<UploadReceipt[]>;
  channels(): Promise<Array<{id: string; title: string}>>;
  analytics(input: { startDate: string; endDate: string; videoId?: string }): Promise<{ status: 'available'; source: 'youtube-analytics-api'; fetchedAt: string; startDate: string; endDate: string; videoId: string | null; columnHeaders: unknown[]; rows: unknown[][]; diagnostic: string }>;
}
export declare class YouTubeError extends Error { code: string; details: Record<string, unknown>; }
export declare const YOUTUBE_SCOPES: Readonly<{ upload: string; readonly: string; analytics: string }>;
export declare function validateUploadSessionUrl(value: string): string;
export declare function createYouTubeClient(options?: { clientId?: string; vault?: ProtectedVault; transport?: typeof fetch; clock?: () => number; sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>; chunkBytes?: number; maxRetries?: number; requestTimeoutMs?: number }): YouTubeClient;
