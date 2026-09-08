# Connect your own YouTube channel

Source qualification: 8 September 2026. YouTube is optional and online; local creation needs no account or API key.

## Installed application

The new source supports a publisher-supplied Google **Desktop application** registration. Release packaging injects its minimal configuration into `resources/oauth/youtube-desktop.json`; it is excluded from public Git and source snapshots. A fresh profile configures itself offline, starts disconnected, and shows **Ready to connect**. Choose **Connect YouTube**, select your Google/Brand Account, allow the requested features, and confirm the channel shown in Settings. You do not need your own Cloud project when this resource is included.

The released 1.0.8 installer predates this bootstrap change. A later installer must pass its own packaging and fresh-profile tests before claiming the feature ships. Developer checkouts without a publisher registration retain the advanced Desktop JSON importer.

Sign-in uses the system browser, S256 PKCE, random one-use state and a temporary loopback callback. Google rejected the tested Desktop registration without its required native application credential (`CLIENT_SECRET_REQUIRED`); the supported native-registration flow subsequently returned HTTP 200 and read the user's own channel from a fresh protected profile. This application credential is distinct from confidential Web-client secrets and private user tokens. Native applications cannot keep embedded static credentials confidential. [Google installed applications](https://developers.google.com/identity/protocols/oauth2#installed), [RFC 8252 section 8.5](https://www.rfc-editor.org/rfc/rfc8252.html#section-8.5).

## Permissions and publishing

Upload requests YouTube upload and channel-read access. Analytics is an optional additional consent. Settings verifies the actual channel with Google's API; browser login alone is insufficient.

Export provides a private-upload form with title, description, audience, synthetic-media disclosure and destination confirmation. Admission binds the current reviewed project revision, owned output hash and channel. Interrupted uploads resume the same durable request. **Private transfer completed** is separate from **Private video ready**: the latter requires a successful processing and private-visibility readback.

Thumbnail Studio creates a 3840x2160 master, a JPEG under 2 MB and a small preview. A video-derived thumbnail remains bound to the exact source hash. Export attaches it to that video's actual YouTube ID; a denied thumbnail preserves the video. Prompt-only typography is labelled as composition, not AI image generation. A large thumbnail canvas does not restore missing source detail.

Actual Windows tests have completed a private video upload, processing verification and matching thumbnail attachment. The project-derived thumbnail receipt persists after reload. Public/scheduled publishing is not implemented by this adapter.

## Analytics and iteration

The optional 24/48-hour schedule runs while the app is open. It stores actual channel/video reports and can create a draft brief from sufficiently supported comparisons. The tested channel currently has insufficient data for recommendations; no viral forecast or invented CTR is shown. Thumbnail/title alignment, clear small-screen composition and actual audience response guide iteration. [YouTube thumbnail advice](https://support.google.com/youtube/answer/12340300?hl=en), [audience retention](https://support.google.com/youtube/answer/9314415?hl=en).

## Publisher release gates

Google Branding is configured with VYREALM's public homepage/privacy/terms and the app is External/In production. **Google verification is not complete**; an unverified-user cap remains. Declared scopes, domain/branding verification, scope justification and an authorization demonstration still require publisher completion/review. Production status alone does not establish approval. [Google verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).

The YouTube API audit is separate: uploads from applicable unaudited API projects are restricted to private viewing. API quotas and channel limits apply. Do not claim unrestricted public onboarding or unlimited uploads. [YouTube upload restrictions](https://developers.google.com/youtube/v3/docs/videos/insert).

## Storage and removal

Each OS-user profile owns its connection. Windows uses AES-256-GCM with a CurrentUser DPAPI protected key. No account tokens ship in installers, public source, project exports or logs. A clean profile never inherits the publisher's channel. Existing local configuration is preserved when the application updates.

Disconnect removes local tokens/channel identity and retains app registration/upload receipts. It does not revoke Google's grant or delete uploaded videos; Google Account's third-party connections provides grant removal. macOS/Linux have no qualified default credential store in this version and remain blocked for account connection; there is no plaintext fallback.
