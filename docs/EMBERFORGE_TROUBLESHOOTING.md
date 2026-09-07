# VYREALM troubleshooting

- **Local video runtime missing:** In Settings, choose a local folder with 25 GB free and install the Windows runtime. Setup needs internet; generation uses local files afterward. The app starts ComfyUI itself.
- **Provider start is slow:** First start imports private CUDA/Python packages and initializes its database. Startup fails explicitly on timeout; retry preserves installed files.
- **Model/code changed:** Run the Settings integrity check. Changed files block generation. Reinstall into a new folder while retaining old files/configuration; do not edit hashes to hide a mismatch.
- **`PROVIDER_HISTORY_LOST`:** The provider lost a submitted but incomplete stage. Earlier stages remain on disk. A retry never labels unrelated files as generated.
- **`ENGINE_STORE_IN_USE`:** Another engine owns this project folder. Close that instance first. Do not run source and desktop engines against the same data simultaneously.
- **Queued with no competing project visible:** Another VYREALM workspace may hold the per-user GPU lease. Let its job finish or cancel it through its owner.
- **Visual review required:** Inspect the clip/contact sheet and record notes before assembling generated or enhanced footage. Technical validation cannot certify realism, identity or performance.
- **Audio delivery verification failed:** The bounded loudness/peak correction could not meet its target. Adjust layer gain or extreme transient dynamics, then rerender. Sources and PCM masters remain saved.
- **Piper/Whisper unavailable:** Setup installs the CPU voice/transcription models. Uploaded narration and manually edited captions remain usable. Unavailable models must not be reported as having run.
- **4K is slow or disk is low:** Edit at 720p or 1080p. Measured five-second Real-ESRGAN enhancement took about 18 minutes and retains lossless intermediates. Canvas resizing alone is not AI enhancement.
- **Portable JSON limit:** Each asset must be at most 50 MB and total media at most 300 MB. Larger exports are refused; original project/job folders remain intact. Incomplete imports are rejected instead of dropping footage or audio.
- **Installed version differs:** The older installed app is 1.0.0. Automatic approval review blocked the updated installer launch with “blocked by policy.” Current source-app proof is not installed-app proof. No signing protection was bypassed.
- **macOS, lip-sync or 60 fps interpolation:** These routes are not qualified. Output frame rate or resolution does not prove native generation at that specification.

