export class YouTubeError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'YouTubeError'; this.code = code; this.details = details; }
}
export const youtubeError = (code, message, details) => new YouTubeError(code, message, details);
