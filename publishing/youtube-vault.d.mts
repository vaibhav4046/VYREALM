import type { ProtectedVault } from './youtube-client.mjs';
export interface OperatingSystemProtection {
  information: { protected: boolean; qualified: boolean; mechanism: string; platform?: string; diagnostic?: string };
  encrypt(bytes: Buffer): Promise<Buffer>;
  decrypt(bytes: Buffer): Promise<Buffer>;
}
export declare function windowsDataProtection(options?: { platform?: string }): OperatingSystemProtection;
export declare function createYouTubeVault(options: { filePath: string; platform?: string; protection?: OperatingSystemProtection | null }): ProtectedVault;
