# Programmatic publishing: what VYREALM can and cannot honestly claim

Research date: 2026-09-08. Every claim below was read off the vendor's own current
documentation on that date, not recalled. Where a doc page contradicts itself or
another page from the same vendor, both readings are given and the conflict is
marked. Nothing here has been exercised against a live account — this is a
documentation audit, not an integration test. Anything that would need a real
token to confirm is listed under "Not verified" at the end.

---

## 0. Three assumptions in the brief that turned out to be wrong or stale

These matter because they change what VYREALM should build, not just what it says.

**1. YouTube no longer charges 1600 quota units per upload.**
The 1600-unit figure is the old model and is gone from the current docs.
`videos.insert` now sits in its own bucket:

> "Projects that enable the YouTube Data API have a default quota allocation of
> 100 `search.list` calls, 100 `videos.insert` calls, and 10,000 units per day
> combined for all other endpoints."
> — [YouTube Data API Overview](https://developers.google.com/youtube/v3/getting-started)

> "100 calls per day. A call to this method has a quota cost of 1 unit in the
> Video Uploads quota bucket."
> — [Videos: insert](https://developers.google.com/youtube/v3/docs/videos/insert)

So the practical ceiling is **100 uploads/day**, and uploads no longer eat the
10,000-unit pool that metadata reads and playlist writes come out of. Two
independent Google pages agree on this. Do not ship copy that says "about six
uploads a day" — that was true under the old model and is now wrong.

**2. Instagram does not require a linked Facebook Page any more — if you use
Instagram Login.** The brief's version is true only for the older
Facebook-Login configuration. Meta's own comparison table:

- Instagram API **with Instagram Login** — Facebook Page: not required. Serves
  "Instagram professional accounts with a presence on Instagram only."
- Instagram API **with Facebook Login** — Facebook Page: "Required."

Both configurations support content publishing.
— [Instagram Platform Overview](https://developers.facebook.com/docs/instagram-platform/overview)

**3. Instagram does not require you to host the video on a public URL.**
The `video_url` parameter does require a public server —

> "`video_url` – Set to the path of the video. We will cURL your image using the
> passed in URL so it must be on a public server."

— but there is a second, documented path that takes a local file directly:

> `POST https://rupload.facebook.com/ig-api-upload/<API_VERSION>/<IG_MEDIA_CONTAINER_ID>`
> with headers `Authorization: OAuth <ACCESS_TOKEN>`, `offset: 0`,
> `file_size: <bytes>`; container created with `upload_type=resumable` and
> `media_type=REELS`.
> — [Resumable Uploads](https://developers.facebook.com/docs/instagram-platform/content-publishing/resumable-uploads/)

This is the single most important architectural finding for a local-first app:
**Instagram Reels can be published from a file on disk with no web host, no
tunnel, and no CDN.** The commonly-repeated "you need to host the MP4 somewhere
public" is out of date.

---

## 1. YouTube — Shorts and long-form

Shorts and long-form use the **same** upload call. There is no Shorts endpoint,
no Shorts flag, and no Shorts field in the API.

### Endpoint

```
POST https://www.googleapis.com/upload/youtube/v3/videos
```

Resumable upload is supported (`uploadType=resumable`), which is what a desktop
app on a domestic connection should use. Accepted media types are `video/*` and
`application/octet-stream`. Maximum file size **256 GB**.
— [Videos: insert](https://developers.google.com/youtube/v3/docs/videos/insert)

### OAuth scopes

Any one of these authorises the call:

| Scope | Notes |
|---|---|
| `https://www.googleapis.com/auth/youtube.upload` | Narrowest; the right choice |
| `https://www.googleapis.com/auth/youtube` | Full manage |
| `https://www.googleapis.com/auth/youtube.force-ssl` | Full manage, SSL |
| `https://www.googleapis.com/auth/youtubepartner` | Partner/CMS |

Use `youtube.upload` alone. Requesting more than you need makes Google's
verification review harder, not easier.

### The real blocker: the API-project audit

> "All videos uploaded via the `videos.insert` endpoint from unverified API
> projects created after 28 July 2020 will be restricted to private viewing
> mode. To lift this restriction, each API project must undergo an audit to
> verify compliance with the Terms of Service."
> — [Videos: insert](https://developers.google.com/youtube/v3/docs/videos/insert)

Read that carefully: **the restriction attaches to the API project, not to the
user's channel.** It is not lifted by the user owning the channel, by the user
being the developer, or by the video being their own content. A brand-new Cloud
project uploading to its own owner's channel still lands the video as private.

The audit is requested through the "YouTube API Services – Audit and Quota
Extension Form"; the docs frame it primarily as the route to extra quota and
promise only that "A member of YouTube's API Services team will contact you as
soon as possible" — **no published SLA**.
— [Quota and Compliance Audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)

### The second blocker: Google OAuth consent status

Separate from YouTube's audit, Google's own OAuth layer bites:

> "A Google Cloud Platform project with an OAuth consent screen configured for
> an external user type and a publishing status of 'Testing' is issued a refresh
> token expiring in 7 days, unless the only OAuth scopes requested are a subset
> of name, email address, and user profile."
> — [Using OAuth 2.0 to Access Google APIs](https://developers.google.com/identity/protocols/oauth2)

For a desktop app that is not yet through Google's app verification, this means
**the user re-authorises every seven days**. That is a UX fact VYREALM has to
design around and disclose, not a bug to be surprised by later.

### Shorts eligibility

Shorts classification is inferred by YouTube after upload, from the file itself:

> "Any videos uploaded on or after this date with a square or vertical aspect
> ratio up to three minutes in length will be categorized as Shorts on YouTube."
> (effective 15 October 2024 for standard channels)
> — [YouTube Help: three-minute Shorts](https://support.google.com/youtube/answer/15424877)

So VYREALM makes a Short by rendering ≤ 3:00 at 9:16 (or 1:1) and uploading it
normally. It cannot *request* a Short, and it cannot promise one — the
classification is YouTube's call. Note also that the Shorts player caps at 1080p
([YouTube Help](https://support.google.com/youtube/answer/10059070)), so
rendering a 4K vertical Short buys nothing on the Shorts surface.

### Terms governing automated posting

Two clauses in the Developer Policies are directly load-bearing for an
AI-generated-video tool:

> III.E.3.d — "API Clients must clearly identify any actions that they take to
> insert, share, update, or delete data or content on the authorizing user's
> behalf. In addition, the user must expressly consent to those actions prior to
> their actual execution."

> III.I.2 — "you must not automate or trigger views, uploads, comments, likes,
> dislikes, or other actions without the user's prior specific and express
> consent."

> III.C.3 — "users must have final control over the data that will be published
> to YouTube Applications" and you must not modify "user-provided values before
> sending them to YouTube by truncating, appending, or otherwise altering those
> values unless the user has explicitly consented."

— [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)

The last one is aimed squarely at tools that rewrite a title or append a hashtag
block on the way out. If VYREALM's LLM touches the title or description after
the user has seen it, that needs an explicit opt-in.

The Terms of Service add that "YouTube may monitor, review and inspect your API
Client(s) ... at any time and without further notice" (§6) and that clients
"will not, and will not attempt to, exceed or circumvent use or quota
restrictions" (§15).
— [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service)

### Can a personal account publish?

Yes. Any Google account with a channel can authorise `youtube.upload`. There is
no business-account gate. The gate is entirely on the *developer* side — the API
project's audit status and the OAuth consent screen's publishing status.

---

## 2. Instagram — Reels

### Endpoints

Three calls, in order:

```
POST  https://graph.instagram.com/v<ver>/<IG_ID>/media                  # create container
POST  https://rupload.facebook.com/ig-api-upload/v<ver>/<CONTAINER_ID>  # upload local file
GET   https://graph.instagram.com/v<ver>/<CONTAINER_ID>?fields=status_code
POST  https://graph.instagram.com/v<ver>/<IG_ID>/media_publish          # publish
```

The container must reach `status_code=FINISHED` before publishing:

> "FINISHED — The container and its media object are ready to be published."

Meta's own guidance is to poll "once per minute, for no more than 5 minutes."
— [Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing)

For the local-file path, create the container with `upload_type=resumable` and
`media_type=REELS`, then PUT the bytes to `rupload.facebook.com` with `offset`
and `file_size` headers. Interrupted uploads return a `file_offset` to resume
from — which suits a desktop app on a flaky connection much better than asking
Meta to cURL a URL.

### Scopes

| Login type | Permissions |
|---|---|
| Instagram Login | `instagram_business_basic`, `instagram_business_content_publish` |
| Facebook Login | `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` (+ `ads_management`, `ads_read` if the Page role comes via Business Manager) |

— [Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing)

### Account requirements

Instagram **professional** account (business or creator). Personal Instagram
accounts cannot publish via the API at all — that is a hard, unavoidable gate,
and the one Instagram constraint the brief got exactly right. Switching a
personal account to Creator is free and takes about thirty seconds in the app,
but it *is* a switch the user has to make.

Facebook Page: required only on the Facebook Login path. Page Publishing
Authorization must be completed if the Page demands it.

### App Review — the nuance that decides everything

Meta's access model:

> Standard Access: "Permissions with Standard Access can only be requested from
> app users who have a role on the requesting app."
> Advanced Access: "Permissions with Advanced Access can be requested from any
> app user, and features with Advanced Access are active for all app users."
> — [Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels)

And the review matrix:

> "My app is only for a business I own or manage" + Standard Access → App Review
> "Not required".
> "I am a Tech Provider and my app serves multiple businesses" → App Review for
> Advanced Access required, including "a screencast showing the end-to-end user
> experience for that specific permission."
> — [App Review](https://developers.facebook.com/docs/instagram-platform/app-review)

This splits VYREALM cleanly in two:

- **A user running VYREALM against their own Meta app, publishing to their own
  IG professional account: works today, no App Review.** They are an app admin,
  so Standard Access covers them.
- **VYREALM shipping one shared app ID that publishes to strangers' accounts:**
  needs Advanced Access, App Review, and a screencast.

For a local-first desktop product, the first model is the natural fit and it is
the one that is actually available now. The cost is that each user must create
their own Meta app — real friction, but honest friction, and far cheaper than an
App Review that a local-first tool may struggle to demo anyway.

### Rate limit

> "Instagram accounts are limited to 100 API-published posts within a 24-hour
> moving period."

Queryable at `GET /<IG_ID>/content_publishing_limit`.
— [Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing)

VYREALM should call that endpoint before a batch rather than discovering the
ceiling by hitting it.

### Reels file constraints

From Meta's reel specifications
([IG User Media reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media)):

| Property | Value |
|---|---|
| Container | "MOV or MP4 (MPEG-4 Part 14), no edit lists, moov atom at the front of the file" |
| Video codec | "HEVC or H264, progressive scan, closed GOP, 4:2:0 chroma subsampling" |
| Audio codec | "AAC, 48khz sample rate maximum, 1 or 2 channels (mono or stereo)" |
| Max file size | 300 MB |
| Duration | "15 mins maximum, 3 seconds minimum" |
| Frame rate | "23-60 FPS" |
| Max horizontal resolution | 1920 px ("Maximum columns (horizontal pixels): 1920") |
| Aspect ratio | "between 0.01:1 and 10:1 but we recommend 9:16 to avoid cropping or blank space" |
| Max video bitrate | "25Mbps maximum" |
| Audio bitrate | 128 kbps |

Three of these are things a render pipeline gets wrong by default and should be
enforced in a preflight check, not left to chance:

- **`moov` atom at the front.** FFmpeg puts it at the end unless you pass
  `-movflags +faststart`. This is the classic silent Instagram rejection.
- **No edit lists.** Some FFmpeg filter graphs emit an `elst` box.
- **1920 px horizontal ceiling.** At 9:16 the horizontal dimension is the short
  one, so 1080×1920 passes and 2160×3840 does not (2160 > 1920).

VYREALM already has `PLATFORM_SPECS` in `runtime/format-library.mjs`; these
numbers belong there as hard lint rules with coded errors, not as comments.

---

## 3. TikTok — Content Posting API

TikTok is the strictest of the four, and the only one where the honest answer to
"can we post publicly today" is a flat no.

### Two different endpoints, two different stories

**Direct Post** (publishes to the profile):

```
POST https://open.tiktokapis.com/v2/post/publish/video/init/
```
Scope: `video.publish`. Rate limit: "Each user access_token is limited to 6
requests per minute."
— [Direct Post reference](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)

**Upload to Drafts / Inbox** (lands in the creator's TikTok inbox; they finish it
in the app):

```
POST https://open.tiktokapis.com/v2/post/publish/inbox/video/init/
```
Scope: `video.upload`. Same 6 req/min limit.
> "You should inform users that they must click on inbox notifications to
> continue the editing flow in TikTok and complete the post."
> — [Upload Video reference](https://developers.tiktok.com/doc/content-posting-api-reference-upload-video)

Scope definitions:
> `video.publish` — "Directly post content to a user's TikTok profile."
> `video.upload` — "Share content to creator's account as a draft to further
> edit and post in TikTok."
> — [TikTok API Scopes](https://developers.tiktok.com/doc/tiktok-api-scopes)

### The audit

> "All content posted by unaudited clients will be restricted to private viewing
> mode."
> — [Content Posting API Get Started](https://developers.tiktok.com/doc/content-posting-api-get-started)

Unaudited clients are confined to `SELF_ONLY` privacy. The prerequisites list is
explicit that you must add the Content Posting API product to your app, enable
Direct Post configuration, and "Get approval for the `video.publish` scope"
before direct posting works at all. The audit is requested at
`https://developers.tiktok.com/application/content-posting-api`.

There is no self-serve escape hatch. Owning the account does not help; the
restriction is on the client.

### What passing the audit actually requires

TikTok audits the *UI*, and the requirements are unusually prescriptive
([Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines)):

- Display the creator's nickname, and check posting capacity, before allowing an
  upload.
- Validate duration against `max_video_post_duration_sec` from the
  `creator_info` query — which must be called first.
- Privacy: "The options listed in the UX must follow the `privacy_level_options`
  returned in the creator_info API. Users must manually select the privacy status
  from a dropdown and there should be no default value."
- Commercial-content toggle defaults **off**; if on, the user picks "Your Brand"
  and/or "Branded Content", at least one required.
- "If a user wants to choose Branded Content, it is important to note that it can
  only be configured with visibility as public/friends."
- Legal acknowledgement text, varying by selection: Music Usage Confirmation
  alone for Your Brand; Branded Content Policy **and** Music Usage Confirmation
  when Branded Content is selected.
- Interaction settings (Duet, Stitch, comments): "Users must manually turn on
  these interaction settings and none should be checked by default."

This is a real UI build — a compliant TikTok publish screen is not a title field
and a button. Budget it as a feature, not a form.

### File constraints

— [Media Transfer Guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide)

| Property | Value |
|---|---|
| Formats | "MP4 (recommended), WebM, MOV" |
| Codecs | "H.264 (recommended), H.265, VP8, VP9" |
| Max file size | 4 GB |
| Duration | "All TikTok creators can post 3-minute videos, while some have access to post 5-minute or 10-minute videos"; up to 10 min via the Upload Video endpoint |
| Chunk size | ≥ 5 MB and ≤ 64 MB, "except for the final chunk, which can be greater than `chunk_size` (up to 128 MB)"; < 5 MB uploads as a single chunk; max 1000 chunks |

`FILE_UPLOAD` works from local disk — good for VYREALM. `PULL_FROM_URL` requires
adding and verifying "your Domain or URL Prefix property to your application",
which a local-first app cannot satisfy. Use `FILE_UPLOAD`.

Note the duration trap: the per-creator maximum is not a constant. It comes back
from `creator_info` as `max_video_post_duration_sec` and must be checked per
user, per session. A hardcoded 180 s will silently fail for some accounts and
needlessly truncate for others.

### Can a personal account publish?

Yes — TikTok has no business-account requirement. The gate is entirely on the
developer's client audit. Which is worse for VYREALM, not better: an
account-type gate can be cleared by the user in thirty seconds, whereas an audit
of the shipping client is on the developer's critical path.

---

## 4. LinkedIn — the messiest of the four

LinkedIn is not one answer. It is four, depending on author type and which
generation of the API you use.

### Path A — personal profile, self-serve ("Share on LinkedIn")

Product: **Share on LinkedIn**, added from the Products tab in the Developer
Portal. Self-serve, no partner application.

> "If your application does not have this permission, you can add it through the
> Developer Portal ... add the Share on LinkedIn product which will grant you
> `w_member_social`."

Scope: `w_member_social` — "Required to create a LinkedIn post on behalf of the
authenticated member."

This page documents video, on the legacy stack:

```
POST https://api.linkedin.com/v2/assets?action=registerUpload
     recipe: urn:li:digitalmediaRecipe:feedshare-video
PUT  <uploadUrl>                            # binary
POST https://api.linkedin.com/v2/ugcPosts   # shareMediaCategory: VIDEO
```

> "for a video, the shareMediaCategory should be VIDEO instead of IMAGE."

Rate limits on this product: **Member 150 requests/day, Application 100,000
requests/day** (UTC).
— [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)

**Caveat, and it is a serious one.** That page's metadata reads
`ms.date: 2021-02-05`, last updated 2023-12-14. Both APIs it describes are
formally superseded: "The Posts API replaces the ugcPosts API" and "The Videos
API replaces the Assets API." The self-serve video path is therefore *documented*
but sitting on deprecated rails. Treat it as plausible-but-unproven until
someone runs it with a real token.

### Path B — personal profile, modern API

The modern Posts API lists `w_member_social` — "Post, comment, and like posts on
behalf of an authenticated member" — with no partner qualifier, and its content
matrix marks Videos as supported for organic posts. Videos API likewise lists
`w_member_social` and enforces "For videos with member URN owners, the caller
needs to match the video owner."

```
POST https://api.linkedin.com/rest/videos?action=initializeUpload
PUT  <uploadUrl>            # 4 MB parts, collect ETags
POST https://api.linkedin.com/rest/videos?action=finalizeUpload
POST https://api.linkedin.com/rest/posts   # content.media.id = urn:li:video:...
```

Headers required on every call: `Linkedin-Version: YYYYMM` and
`X-Restli-Protocol-Version: 2.0.0`.
— [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api),
[Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api)

**But both pages live under Community Management**, which is a vetted product:

> "Community Management API | Vetted Product with development and standard
> tiers."
> Development Tier: "Initial approval with limited API call volume."
> Standard Tier: "Full access requiring upgrade from Development Tier ... provide
> a screencast video demonstrating each use case."
> — [Community Management Overview](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview)

Development Tier rate limits: 500 requests per app, 100 per member.

Whether `w_member_social` obtained through self-serve Share on LinkedIn is
accepted by the versioned `/rest/posts` and `/rest/videos` endpoints without
Community Management approval is **not stated either way in the docs**. It is the
single most important unanswered question for LinkedIn and it can only be
resolved by trying it with a real token.

### Path C — organization / company page

Requires `w_organization_social`, restricted to members holding ADMINISTRATOR,
DIRECT_SPONSORED_CONTENT_POSTER, or CONTENT_ADMIN on the page, and Community
Management approval. Not self-serve. Out of scope for a solo creator tool.

### Path D — reading back what you posted

`r_member_social` is explicitly closed:

> "`r_member_social` is a **closed** permission. We're not accepting access
> requests at this time due to resource constraints."

So VYREALM **cannot** verify a LinkedIn member post after the fact, cannot fetch
its metrics, and cannot reconcile an ambiguous network failure by looking for the
post. The only proof of success is the `201` and the `x-restli-id` header from
the create call. Persist that header value or lose the record permanently.

### File constraints (and a contradiction)

The Videos API page states two different maxima:

> Spec section: "Length: Three seconds to 30 minutes. File size: Between 75kb and
> 500MB. File format: MP4."
> Schema field `initializeUploadRequest.fileSizeBytes`: "Maximum allowed Videos
> size is 5GB."

Both are on the same page. The conservative reading is **500 MB / 30 min / MP4**
for feed video, with 5 GB likely being the platform ceiling covering ads assets.
Build to 500 MB and treat anything larger as untested.

Upload is multipart in 4 MB parts (`split -b 4194303`), ETags collected per part
and passed to `finalizeUpload` in order. Upload URLs "typically ... expire 30
days from the time an upload is initialized."

### Can a personal account publish?

Yes for text, URL, and image via self-serve Share on LinkedIn — that much is
unambiguous. Video to a personal profile is documented on both the legacy and
modern paths but with an unresolved gating question (Path B above). No LinkedIn
Premium or Company Page is needed for member posts.

---

## 5. The table

**Legend for "Can we post today":**
Today = a solo user, their own accounts, VYREALM installed on their own machine,
using their own developer app where the platform requires one, with no approval
process completed. This is the only scenario VYREALM can currently claim, and the
table is written for it.

| Platform | Can we post today | What is needed for public posting | Honest user-facing wording |
|---|---|---|---|
| **YouTube** (Shorts + long-form) | **Partly.** Upload succeeds; video lands **private** and stays private | YouTube API-project **compliance audit** (no published SLA) to lift the private-only restriction. Separately, Google **OAuth app verification** to escape the 7-day refresh-token expiry of "Testing" status | "Uploads to your channel as a **private** video. Making it public requires a YouTube API audit of this app, which is not complete — you can flip it to public yourself in YouTube Studio. You'll be asked to sign in again roughly every 7 days until Google verifies the app." |
| **YouTube — Shorts specifically** | Same as above | Same as above. There is no Shorts API | "Renders at 9:16 and under 3 minutes, which is what YouTube uses to classify a Short. We can't guarantee the classification — YouTube decides after upload." |
| **Instagram Reels** | **Yes**, to your own account | Nothing, if the user runs their own Meta app and holds a role on it (Standard Access). **App Review + Advanced Access + screencast** only if VYREALM ships one shared app ID serving other people's accounts | "Publishes Reels directly to your Instagram **professional** account (Business or Creator — personal accounts can't publish via Instagram's API). Requires you to create your own Meta developer app, one time. Limit: 100 API posts per 24 hours." |
| **TikTok** — public post | **No** | TikTok **Content Posting API audit** + approval of the `video.publish` scope. Until then every post is forced to `SELF_ONLY`. Passing also requires building TikTok's prescribed consent UI (no-default privacy dropdown, commercial-content toggle, Music Usage Confirmation, manual interaction toggles) | "TikTok does not allow this app to post publicly on your behalf yet — TikTok requires an audit we have not completed. Anything posted directly would be forced to private." |
| **TikTok** — draft path | **Yes** | Nothing beyond the `video.upload` scope. Video lands in the creator's TikTok inbox; they tap through to publish | "Sends the video to your TikTok drafts. You finish and publish it in the TikTok app — tap the inbox notification." |
| **LinkedIn** — personal, text/image/link | **Yes** | Nothing. Self-serve **Share on LinkedIn** product grants `w_member_social` | "Posts to your personal LinkedIn feed." |
| **LinkedIn** — personal, **video** | **Unconfirmed** | Documented on the deprecated Assets + ugcPosts path under self-serve; the modern Videos + Posts API path sits under the vetted **Community Management** product. Not resolvable from docs alone | "LinkedIn video posting is not enabled. LinkedIn restricts video posting to reviewed applications, and we have not confirmed the self-serve route works." — do not claim it until tested. |
| **LinkedIn** — company page | **No** | `w_organization_social` + **Community Management API** approval (Development Tier, then Standard Tier with a screencast) | "Posting to a LinkedIn Company Page requires LinkedIn partner approval, which we don't have." |

### The one-line version, for the UI

> **VYREALM can publish to Instagram Reels and to your LinkedIn feed. It can
> upload to YouTube as a private video, and send drafts to TikTok. It cannot
> publish publicly to TikTok, and cannot make a YouTube video public, because
> those platforms require an approval process this app has not completed.**

### Wording rules that keep VYREALM honest

1. **Never use the bare word "publish" where the result is private or a draft.**
   YouTube is "upload (private)". TikTok is "send to drafts". Those are different
   verbs on purpose.
2. **Never say "one-click to all platforms."** The result differs per platform.
   Say what lands where.
3. **Never say "no setup required" for Instagram.** The user creates a Meta app
   and switches to a professional account. Both are real steps.
4. **Never claim scheduling on a platform where the post is private/draft.**
   Scheduling a video that arrives private is scheduling nothing.
5. **Never claim post-publish verification on LinkedIn.** `r_member_social` is
   closed; VYREALM cannot read back a member post. If a create call times out
   ambiguously, say so rather than guessing.
6. **Say the quota numbers, don't imply infinity.** YouTube 100 uploads/day,
   Instagram 100 posts/24h, TikTok 6 requests/min, LinkedIn 150 member
   requests/day.
7. **State the disclosure obligation the user inherits.** YouTube's Developer
   Policies require express user consent per action (III.E.3.d, III.I.2) and
   final user control over published values (III.C.3). If VYREALM's LLM rewrites
   a title after the user last saw it, that is a consent event.

---

## 6. What this means for the build

Ranked by value per unit of work, given a local-first Windows app:

1. **Instagram Reels via `rupload.facebook.com` is the flagship.** It is the only
   one of the four that publishes publicly, today, from a local file, with no
   approval process. Build this first.
2. **TikTok drafts (`video.upload`) is the honest second.** It ships now and
   requires none of the audit UI. Direct Post can come after an audit, if ever.
3. **YouTube private upload is the honest third.** Useful — it gets the file onto
   the channel with metadata, captions, and thumbnail — but the user finishes in
   Studio. Say so.
4. **LinkedIn text/image now; video only after someone tests it.** Do not write
   LinkedIn video into the feature list on the strength of a 2021-dated doc page.

Two preflight checks belong in `runtime/format-library.mjs`'s `PLATFORM_SPECS`
and `lintPlan`, as coded errors rather than warnings:

- **Instagram**: `moov` at front (`-movflags +faststart`), no edit lists,
  ≤ 300 MB, 3 s–15 min, 23–60 fps, horizontal dimension ≤ 1920, ≤ 25 Mbps,
  AAC ≤ 48 kHz mono/stereo.
- **TikTok**: duration checked against the per-creator
  `max_video_post_duration_sec` from `creator_info` at publish time, never a
  hardcoded constant.

The existing `publishing/index.js` state machine already encodes the right shape
for YouTube (`uploaded_private → processing → scheduled|published`, with an
`UNVERIFIED_API_PROJECT` guard). That guard is correct and should stay. The gap
is that the state machine is YouTube-shaped only; Instagram's container/publish
two-step and TikTok's inbox terminal state do not map onto it cleanly and will
need their own terminal states (`sent_to_drafts` has no `published` successor
VYREALM can observe).

---

## 7. Not verified — do not claim these

Honest list of everything above that is documentation-only or unresolved:

- **No call was made against any live API.** Every endpoint, scope, and limit
  here is read from vendor docs, not observed.
- **Whether `w_member_social` from self-serve Share on LinkedIn is accepted by
  `/rest/posts` and `/rest/videos`** without Community Management approval. The
  docs do not say. This is the biggest open question and needs a token test.
- **LinkedIn's real video ceiling**: the same page says 500 MB and 5 GB. Untested.
- **Whether the legacy LinkedIn Assets + ugcPosts video path still functions**,
  given both APIs are formally superseded.
- **Google's test-user cap for apps in "Testing" status.** The 7-day refresh
  token expiry is quoted from primary docs; the commonly-cited 100-test-user
  limit was *not* found on the pages fetched and is unverified here.
- **YouTube audit turnaround time.** No SLA is published; "as soon as possible"
  is the only commitment in the docs.
- **TikTok's daily post cap.** The API returns `spam_risk_too_many_posts` when
  "The daily post cap from the API is reached for the current user", but the docs
  do not state the number.
- **Whether YouTube's Shorts classification applies identically to API uploads.**
  The 3-minute/vertical rule is stated in YouTube Help for uploads generally; no
  Google page found explicitly confirms it for `videos.insert`. Strongly implied
  by the absence of any Shorts field in the API, but implied is not documented.
- **Instagram's exact behaviour for an over-1920 px vertical render.** The
  "maximum columns: 1920" limit is quoted; whether Meta downscales or rejects was
  not established.
- **Meta Platform Terms on automated posting.** The Terms were read and contain
  no section specifically governing automated or bulk publishing; the operative
  constraints are in the access-level model and App Review, not the Terms.
  Absence of a rule is reported here as absence, not as permission.

---

## Sources

YouTube
- https://developers.google.com/youtube/v3/docs/videos/insert
- https://developers.google.com/youtube/v3/getting-started
- https://developers.google.com/youtube/v3/determine_quota_cost
- https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- https://developers.google.com/youtube/terms/developer-policies
- https://developers.google.com/youtube/terms/api-services-terms-of-service
- https://developers.google.com/identity/protocols/oauth2
- https://support.google.com/youtube/answer/15424877
- https://support.google.com/youtube/answer/10059070

Instagram / Meta
- https://developers.facebook.com/docs/instagram-platform/overview
- https://developers.facebook.com/docs/instagram-platform/content-publishing
- https://developers.facebook.com/docs/instagram-platform/content-publishing/resumable-uploads/
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
- https://developers.facebook.com/docs/instagram-platform/app-review
- https://developers.facebook.com/docs/graph-api/overview/access-levels
- https://developers.facebook.com/terms/

TikTok
- https://developers.tiktok.com/doc/content-posting-api-get-started
- https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
- https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
- https://developers.tiktok.com/doc/content-sharing-guidelines
- https://developers.tiktok.com/doc/tiktok-api-scopes

LinkedIn
- https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api
