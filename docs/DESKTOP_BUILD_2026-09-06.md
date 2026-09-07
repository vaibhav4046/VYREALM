# Windows desktop build evidence (2026-09-06)

The pinned desktop dependencies were installed with `npm install --ignore-scripts`:

- Electron `37.2.6`
- electron-builder `26.0.12`
- Vite resolved from the declared range to `7.3.6`

`npm run desktop:dist` completed on Windows 11 x64 and produced:

```text
release/VYRELUM-1.0.0-win-x64.exe
size: 882,662,597 bytes
sha256: B66A90A6770E7068060D08C79C754F722419C0A7A7B1C4732B3DE67EC211CF61
```

The unpacked payload contains `resources/app.asar.unpacked/capabilities/registry.mjs` and the bundled production engine. A fresh packaged launch (PID 38364) remained responsive with the VYRELUM window title, started the local control plane on `127.0.0.1:50897`, and returned HTTP 200 from `/api/session`. The sidecar emitted only Electron's experimental `node:sqlite` warning.

This is a build and launch smoke check. `Get-AuthenticodeSignature` reports `NotSigned`, and the installer has not been installed through Windows Installer in this workspace. macOS (including Intel macOS) has no build or test evidence and remains unverified. The 882 MB artifact includes the packaged Blender runtime; model onboarding still requires an approved, checksum-verified runtime asset before neural-video capability can be qualified.

The same packaged sidecar then accepted an unseen brief, completed a local Ollama director job (`succeeded`, one scene, four timeline entries), and completed an editable scene render (`succeeded`, promoted MP4, `.blend`, and poster assets). This validates the shipped Windows runtime path; it does not qualify neural video or macOS support.
