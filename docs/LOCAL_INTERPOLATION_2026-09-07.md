# Local 60 fps delivery qualification

VYREALM's `interpolate` worker converts reviewed 24/30 fps exports to 60 fps with RIFE v4.6. It is post-processing, not native 60 fps video generation. The editable timeline and original source files remain saved.

## Measured Windows result

- Laptop: Lenovo LOQ, RTX 3050 6 GB, 16 GB RAM. Windows x64 only was tested.
- Input: the original Rainline edit, 1920×1080, 24 fps, 360 frames, 15 seconds. Its three source clips were generated locally at 1024×576 by Wan2.2 TI2V 5B Q4. Source generation is documented separately in `VYREALM_RAINLINE_EVIDENCE.json`.
- First interpolation: job `f6714a87-1376-41e6-90a2-8c647b77e12d`, 314.336 seconds, 0.473 GiB sampled whole-device NVIDIA memory peak. This peak is for interpolation, not the original Wan generation, which reached 5.85 GiB. All three 300-frame segments passed technical checks. Visual review rejected a caption morph at frame 86.
- Repair: job `99200737-d638-436a-a4d0-cc33548517bd`, 46.564 seconds. RIFE frames were reused with ledger verification. The first shot was re-encoded with original caption-transition samples at frames 86/87. Shots two and three reused their encoded segments. No original neural shot or RIFE model inference was repeated for this repair.
- Accepted output: `outputs/desktop/VYREALM_RAINLINE_TRAILER_1080P_60FPS.mp4`, SHA-256 `a6914b5f74c4f898f4a3697ef89e06f1c9f61ba580188842758fb0611eb99813`. 900 decoded frames, 60 fps, 1920×1080, exactly 15.000 seconds of video and audio. The AAC bitstream matches the original export (SHA-256 `5d67050037738adbf5bb3b96730ea33ed0ed65d45f75887cc7e433f84517eace`), retaining its measured −14.38 LUFS / −2.11 dBTP.
- Review: one-second contact sheet, additional in-between samples and the exact cut pairs were inspected. Caption ghosting was corrected. The source's restrained motion, rear tracking and incomplete shelter-entry action remain limitations. No numerical realism score or hosted-model parity is claimed.
- Portable project: revision 30, 47 embedded assets, 276,492,201 bytes. Original project, 24 fps export, rejected attempt and prior revisions remain available.

The CPU route passed a one-second 128×72 fixture with two separate shots, audio preservation and cached retry: 3.762 seconds initially and 0.565 seconds on retry. This is not a full-resolution CPU speed claim. The fixture is explicitly a test pattern, not catalogue content.

## Timing and integrity

Pinned upstream `src/main.cpp` uses `inputCount / outputCount` to map frame positions and names output files starting at 1. A 120-frame shot therefore becomes exactly 300 frames without endpoint stretching. The implementation clamps to the terminal original frame. VYREALM processes saved timeline cuts separately and detects additional hard cuts with FFmpeg scene score >0.45. The initial adapter rejects cuts or durations that cannot align exactly with its 60 fps grid.

Burned caption changes need special treatment: the few in-between frames spanning a cue boundary use the preceding original sample. This preserves crisp letters and original source timing, with source-frame quantization, instead of morphing text. Burned text with no recorded SRT cannot receive this protection automatically and still needs visual inspection.

Each job verifies the source hash, runtime/model hashes, frame count, decoded frames, resolution, duration and original audio bitstream. Generated, imported and upscaled source lineage is retained under edited/interpolated output provenance. Reusing intermediates is recorded explicitly. Jobs share the existing single GPU lease. Failed interpolation does not overwrite a prior working export with a blocked result.

## Setup and use

1. Settings → choose a local installation folder → **Install local 60 fps tools**. Setup downloads the official pinned archive (431,540,241 bytes), extracts approximately 17 MB of selected files, verifies SHA-256 and runs tiny CPU/Vulkan probes. No keys or subscriptions are used. Later rendering is local.
2. Render and review a 24/30 fps export at 1080p or below.
3. Choose **Interpolate export to 60 fps**, or use MCP `interpolate_video` with the saved project revision. The CPU option is explicit. Progress appears in Jobs.
4. Inspect the result and record the review. Edits require a fresh timeline export before another interpolation. A rejected interpolation can reuse verified matching intermediate stages when repaired.

The source-app Settings journey installed the runtime in a new folder and automatically selected Vulkan device 1, the RTX 3050; device 0 is Intel UHD Graphics. Setup job: `47d4715b-ceef-417d-89cc-bd1d5828e4b6`. This is separate from installing the VYREALM desktop package.

## Pinned upstream sources and redistribution scope

- [RIFE NCNN Vulkan source](https://github.com/nihui/rife-ncnn-vulkan/tree/a7532fc3f9f8f008cd6eecd6f2ffe2a9698e0cf7), release [20221029](https://github.com/nihui/rife-ncnn-vulkan/releases/tag/20221029).
- [Exact-version timing implementation](https://github.com/nihui/rife-ncnn-vulkan/blob/a7532fc3f9f8f008cd6eecd6f2ffe2a9698e0cf7/src/main.cpp).
- [MIT license](https://github.com/nihui/rife-ncnn-vulkan/blob/a7532fc3f9f8f008cd6eecd6f2ffe2a9698e0cf7/LICENSE), retained in `runtime/notices/RIFE-NCNN-Vulkan-MIT.txt` and the downloaded runtime.

The release archive hash was measured from the official HTTPS download; upstream supplied no asset digest. `runtime/interpolation.lock.json` pins that observed hash and every selected artifact. The archive's Microsoft `vcomp140.dll` has separate Microsoft terms and a valid Microsoft Authenticode signature on this machine. The installer bundles the adapter, download manifest and notices; it does not vendor the RIFE executable, model or Microsoft DLL. Setup obtains them from the unmodified upstream release. A redistribution decision for those third-party binary files must not rely solely on RIFE's MIT notice.

macOS, 4K RIFE inference, 4K/60 fps combined delivery, lip-sync and general semantic motion quality are not qualified by these tests. Existing Real-ESRGAN proof remains a separate five-second 4K/24 fps sample.
