# Optional YouTube backend

This module is independent of offline creation. It implements account authorization, private video upload and read-only channel analytics. It does not publish publicly, schedule publication or change Google accounts automatically.

## Integration contract

Create one client and one vault for the owning backend process. Do not instantiate multiple writers against the same vault file.

```js
import { createYouTubeVault } from './publishing/youtube-vault.mjs';
import { createYouTubeClient } from './publishing/youtube-client.mjs';

const vault = createYouTubeVault({ filePath: absoluteCredentialFile });
const youtube = createYouTubeClient({ clientId: configuredPublicDesktopClientId, vault });
```

`clientId` is a developer-registered Google **Desktop app** client ID ending in `.apps.googleusercontent.com`. No API key is used. If Google's downloaded Desktop credential includes a client secret, import it directly through `configureDesktopCredentials`; the optional secret is retained only in the protected vault. Missing configuration returns `YOUTUBE_CLIENT_NOT_CONFIGURED`; unsupported credential protection returns `YOUTUBE_PROTECTED_STORE_REQUIRED`. Neither constructor nor `status()` contacts Google.

| Method | Input and result |
| --- | --- |
| `configureDesktopCredentials(credentials)` | Backend-only import of Google's `{installed:{client_id,client_secret?}}` object. Rejects Web clients and mismatched IDs. Persists the optional secret in the protected vault and returns only public configuration status. Never log or echo the input. |
| `status()` | Redacted stored-authorization status, granted scopes, feature availability and credential-store diagnostic. `verifiedLive:false` distinguishes stored tokens from a tested connection. |
| `beginAuthorization({features})` | `features` contains `upload`, `analytics`, or both. Returns `authorizationUrl`, `redirectUri`, `expiresAt`, `scopes`, `completion` promise, and `cancel()` function. Open the returned URL in the **system browser** only. Await `completion` in the backend; return only its redacted fields to the UI. |
| `disconnect()` | Removes local access/refresh tokens and cancels pending authorization. Retains protected upload receipts. Account-level revocation is separate. |
| `beginPrivateUpload(input)` | Requires exact selected local path, approved SHA-256, intended channel ID, metadata, explicit synthetic-media disclosure and `confirmed:true`. Starts a resumable session and returns a redacted upload receipt. |
| `resumeUpload(id,{signal,onProgress,maxChunks})` | Revalidates file hash and channel, asks Google for its actual byte offset, and sends bounded chunks. Returns `uploading` or `uploaded_private`. Default: 32 chunks per call; call again through a bounded durable job if unfinished. |
| `getUploadStatus(id)` / `listUploads()` | Local redacted receipt(s), without tokens or resumable session URLs. No network request. |
| `analytics({startDate,endDate,videoId?})` | Read-only daily metrics for `channel==MINE`, optional one-video filter, valid ISO dates, maximum 366-day interval. Results can lag recent activity. |

Upload input:

```js
{
  filePath: approvedExportAbsolutePath,
  sha256: approvedExportSha256,
  expectedChannelId: selectedChannelId,
  confirmed: true,
  containsSyntheticMedia: true,
  metadata: {
    title: 'Original film', description: 'Description', tags: ['original'],
    selfDeclaredMadeForKids: false
  },
  signal: optionalAbortSignal
}
```

The caller must resolve the path/hash from the existing reviewed release/project record and bind confirmation to that exact file, channel and metadata. Do not accept arbitrary renderer-provided filesystem paths. Keep existing local request authentication/CSRF validation around server routes. `uploaded_private` proves Google's upload receipt, not completion of YouTube's subsequent video processing or public availability. The backend never obtains public-publishing authority through this adapter.

The redacted upload receipt contains `id`, `state`, `videoId`, `channelId`, `fileName`, `sha256`, `bytesTotal`, `bytesUploaded`, timestamps and `privacyStatus:'private'`. Successful receipts include a watch URL. Errors have a stable `code`, a safe `message`, and optional non-secret details such as HTTP status or required scopes. Do not log transport bodies, authorization URLs, callback query strings, tokens or protected vault contents.

## Credentials and network boundaries

Windows storage uses a random AES-256-GCM encryption key wrapped by **CurrentUser DPAPI**, with authenticated metadata, a fresh nonce per save and atomic replacement. DPAPI receives its payload over stdin to a hidden PowerShell process, with no secret arguments, environment variables or plaintext temporary file. Its key is unwrapped once per process session to avoid a PowerShell launch for every progress update. `vault.close()` clears the cached encryption-key buffer. Call it on shutdown. JavaScript-held access tokens still necessarily exist in the backend process memory while used.

macOS Keychain has not been implemented or qualified here. macOS account connection is blocked unless a separately qualified protected provider is explicitly injected; there is no plaintext fallback. Offline production remains independent of YouTube availability.

OAuth uses S256 PKCE, cryptographically random state, constant-time comparison, exact loopback host/path checks, a temporary `127.0.0.1` port and one-use callbacks. Expiry/cancellation cannot restore credentials after disconnect. Google API transport is HTTPS-only with fixed endpoint checks and redirects rejected. Upload session URLs are restricted to the documented Google upload endpoint. Access tokens use authorization headers; resumable URLs and progress are retained inside the encrypted vault.

Uploads use a single operation lease, 8 MiB chunks by default (configurable 256 KiB–16 MiB, multiples of 256 KiB), bounded retries, request timeouts and cancellation. An ambiguous transfer is followed by a status query, never an assumed byte offset. Reconnecting to a different channel cannot resume a retained upload. The module does not allocate the entire video in RAM.

## Google setup prerequisites

The developer must register a Desktop OAuth client, configure the consent screen/test users, and enable the YouTube Data and YouTube Analytics APIs. Desktop clients use the system browser and loopback redirects; existing browser cookies do not authorize this application. Google documents `client_secret` as optional for desktop code exchange and refresh. When imported, the adapter includes it only in the token endpoint request body; PKCE remains enabled. [Google desktop OAuth documentation](https://developers.google.com/identity/protocols/oauth2/native-app).

Upload authorization requests `youtube.upload` plus `youtube.readonly` so the adapter can verify the selected channel. Analytics additionally requests `yt-analytics.readonly`; the current reports documentation also requires `youtube.readonly`. No monetary-report or broad account-management scope is requested. [YouTube analytics reports](https://developers.google.com/youtube/analytics/reference/reports/query).

Chunk uploads use Google's 308 `Range` acknowledgement and resumable status-query protocol. An expired session requires an explicit new upload; the adapter never silently starts a duplicate. [Resumable upload protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol).

YouTube API projects created after 28 July 2020 that have not passed the relevant audit are restricted to private uploads. OAuth consent verification and the YouTube API compliance audit are distinct requirements. This implementation deliberately uploads privately in all cases. [YouTube videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert).

## Verification and limits

Run `node --test publishing/youtube-client.test.mjs`. The tests use a real local callback listener, controlled HTTP responses and temporary test files. On Windows they also perform a real DPAPI encrypt/reopen/decrypt roundtrip. They test replay/expiry/cancellation, selected-channel and file-hash checks, interrupted uploads, invalid ranges, bounded retries, analytics permissions, ciphertext tampering and redaction. No test creates a Google account, consents to access or uploads to YouTube.

The module has not yet been tested against a registered live Google client. Google registration/consent, real private-upload acceptance, installed Settings/system-browser acceptance and macOS protection qualification remain separate checks. Core creation must remain usable when those checks are unavailable.

## Local server integration

`server.js` delegates its authenticated `/api/youtube/*` routes to `youtube-service.mjs`. The public client ID lives in this operating-system user's `dataDir/integrations/youtube-client.json`; credentials and resumable URLs live only in `youtube-credentials.protected.json` beside it. Neither file is a project asset or part of portable project export. A clean profile inherits no author's account authorization. Account switching requires disconnecting first.

- `GET /api/youtube/status`: stored authorization, `profile:'local-user'`, `connectedChannel:{id,title}|null`, and `auth.phase` for polling. During explicit consent completion, the backend reads the actual selected channel from Google before recording that identity.
- `POST /api/youtube/config`: imports `{installed:{client_id,client_secret?}}` to the local profile; rejects Web credentials.
- `POST /api/youtube/authorize`: accepts `{features:['upload','analytics']}` and returns the system-browser URL; credentials and completion promises stay in the backend.
- `POST /api/youtube/disconnect`: removes authorization and linked channel; retained encrypted upload sessions can be resumed only after the same channel is reauthorized.
- `GET /api/youtube/analytics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&videoId=...`: the video filter is optional. Unknown query fields are rejected.
- `GET /api/youtube/uploads`: local redacted upload receipts.
- `POST /api/youtube/upload`: accepts `{projectId,expectedRevision,expectedOutputHash,expectedChannelId,confirmed:true,containsSyntheticMedia,metadata}`. **No file path is accepted.** The backend resolves the current owned MP4, passed visual review and matching hash, then creates a `youtube-upload` job in the existing jobs table. This network/CPU job bypasses the GPU lease. Existing job cancellation/retry controls pause and resume it. A restart preserves its encrypted resumable session; interrupted jobs require explicit retry.

`youtube-settings.js` provides `createYouTubeSettings({api,render,openExternal,getProject?})` with `html`, `bind`, `update`, and `dispose`. Its Settings panel supports local Desktop JSON import, sign-in status, disconnect and escaped analytics tables. It contains no upload button; the reviewed export screen must expose that explicit action. Root integration supplies the app render hook and qualified system-browser opener, and includes the file in desktop packaging.

Run the isolated backend/UI verification with `node --test publishing/youtube-client.test.mjs publishing/youtube-service.test.mjs publishing/youtube-settings.test.mjs`. HTTP tests launch the actual server against a temporary database and real Windows protection, start/cancel a local OAuth listener, and never contact Google. Durable-upload tests use fixture transports and real SQLite; they do not prove a live upload.
