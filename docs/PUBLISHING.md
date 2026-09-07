# Local publishing subsystem

`publishing/index.js` (with declarations in `publishing/index.d.ts`) is the local boundary for preparing a YouTube release without making network requests. A future YouTube adapter can consume this package after the owner has reviewed and approved it.

## Release package

Each persisted record in the JSON store (`data/releases.json` by default) has this shape:

```json
{
  "schemaVersion": 1,
  "id": "release-id",
  "state": "draft",
  "project": { "id": "project-id", "revision": "rev-7" },
  "output": { "path": "outputs/final.mp4", "sha256": "...", "mimeType": "video/mp4", "durationSeconds": 42 },
  "metadata": {
    "channelId": "channel-id", "title": "Title", "description": "...", "tags": [],
    "privacyStatus": "private", "publishAt": "2030-01-01T12:00:00.000Z"
  },
  "captions": [{ "language": "en", "path": "captions/en.vtt", "sha256": "..." }],
  "thumbnail": { "path": "thumb.jpg", "sha256": "..." },
  "aiDisclosure": { "containsSyntheticMedia": true, "rationale": "AI voice and visuals" },
  "rightsLedger": [{ "assetId": "song-1", "kind": "music", "source": "licensed", "evidence": "licence.pdf" }],
  "channel": { "id": "channel-id", "title": "My channel", "apiProject": { "verified": true } },
  "upload": null,
  "approvals": [], "history": [], "createdAt": "...", "updatedAt": "..."
}
```

`aiDisclosure.containsSyntheticMedia` is required and must be explicitly `true` or `false`. Rights entries are evidence for the owner, not a copyright guarantee.

## State machine and guards

The allowed path is `draft → rendered → reviewed → approved → uploading → uploaded_private → processing → scheduled|published`; `scheduled → published` is also allowed. Any nonterminal state can become `blocked`; a blocked package can be returned to `draft` after correction. A stale or invalid `publishAt` is rejected, and scheduled metadata must remain private. The selected channel is required and its ID must match `metadata.channelId`. A transition to `scheduled` or `published` is rejected when `channel.apiProject.verified` is false, reflecting YouTube's unverified API-project private-only restriction.

`beginUpload(releaseId, sessionUri)` records a resumable session and moves an approved release to `uploading`. Session URIs are unique across all local releases; attempting to reuse one raises `DUPLICATE_RESUMABLE_SESSION`. This lets a future adapter reconcile a session after an ambiguous network error instead of creating a duplicate video.

## API and CLI

```js
import { ReleaseStore, validateRelease, hashOutput } from './publishing/index.js';
const store = new ReleaseStore({ filePath: 'data/releases.json' });
const release = await store.create(packageObject);
await store.transition(release.id, 'rendered');
await store.beginUpload(release.id, 'https://upload-session-from-adapter');
```

The CLI is intentionally local:

```text
node publishing/cli.mjs create --package=package.json
node publishing/cli.mjs list
node publishing/cli.mjs validate --id=release-id
node publishing/cli.mjs transition --id=release-id --state=reviewed
node publishing/cli.mjs begin-upload --id=release-id --session=session-uri
```

The root application can wire this in by creating a package from its project revision and rendered output hash, calling `create`, then requiring human review before `approved`. A YouTube adapter should: authenticate with the supported OAuth flow; verify the channel ID and API project audit status; call `beginUpload` once; persist server video ID and byte offsets through `update`; and transition through `uploaded_private`, `processing`, and finally `scheduled` or `published` only after polling/reconciling server state. No credential storage or network client is included here.

## Deterministic testing

Inject `clock` and `idFactory` into `ReleaseStore` to make timestamps and IDs stable. Validation is pure (`validateRelease`) and raises `ReleaseValidationError` with machine-readable codes such as `STALE_PUBLISH_AT`, `WRONG_CHANNEL`, `UNVERIFIED_API_PROJECT`, and `DUPLICATE_RESUMABLE_SESSION`.


