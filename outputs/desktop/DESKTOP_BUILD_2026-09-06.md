# Windows desktop build evidence (2026-09-07)

`npm run desktop:dist` completed on Windows 11 x64 with Electron 37.2.6, electron-builder 26.0.12, and Vite 7.3.6.

- Installer: `VYREALM-1.0.0-win-x64.exe`
- SHA-256: `464377DBC606A7954C9C337E2A85002017534044E2EF9CE32B86BA588BAF784C`
- Signature: unsigned (`NotSigned`); macOS and Intel Mac remain unverified.

The package includes the Electron shell, loopback sidecar, local FFmpeg/ffprobe, Blender resources, hardware preflight, layered media verifier, ComfyUI provider contract, and durable timeline/produce paths. Provider modules are shipped unpacked under `resources/app.asar.unpacked/runtime/providers`.

The cinematic renderer now produces an art-directed 1920x1080 editable Blender scene with animated camera/object motion, and the timeline renderer applies concise cinematic captions with consistent contrast and safe margins.

The default cinematic route is asset-first; the local neural-video route remains capability-gated because no qualified checkpoint is installed on this laptop. Unsupported neural requests return diagnostics; the renderer does not claim frontier photorealism.




