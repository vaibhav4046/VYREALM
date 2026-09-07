# VYRELUM desktop shell

The desktop shell in `desktop/main.mjs` starts the existing local control plane as a bundled child process and opens the black-purple VYRELUM UI in a hardened `BrowserWindow`.

- The child engine binds to `127.0.0.1` and stores projects, jobs, releases, and media under the OS user-data directory.
- The renderer has context isolation, no Node integration, and a preload bridge with no filesystem or arbitrary subprocess access.
- Electron network requests are allowlisted to the selected loopback port plus local `file:`, `data:`, `blob:`, and `devtools:` resources. External requests and external window opens are denied.
- A bundled Node sidecar may be placed at `runtime/node` for release builds. In development, Electron's Node runtime is used through `ELECTRON_RUN_AS_NODE=1`; the server's Node built-ins therefore stay in one process model.

## Development

Install the pinned development dependencies in a controlled environment, then run:

```text
npm run build
npm run desktop:dev
```

The repository does not download Electron or installer tooling automatically. `npm run desktop:dev` is available after Electron is installed.

## Packaging

`electron-builder.yml` defines a Windows NSIS installer and a macOS DMG. A release build is:

```text
npm run desktop:dist
```

The executable engine and web assets are unpacked from `app.asar` so the child
Node process can load workers on both operating systems; writable state remains
outside the install directory in the per-user data folder.

Installer signing, notarization, and OS installation have not been run in this workspace. Do not label either platform as verified until an installer is built on that platform, installed through the OS, launched with network access disabled after setup, and exercised through create → direct local planning → editable scene → render → restart/reopen. Intel macOS requires a separate build and test record; Apple Silicon CUDA assumptions must not be reused.

## Runtime onboarding and repair

The shipped app is local-first. A future onboarding screen should call the runtime doctor, show checksums and storage locations, and offer resumable model/runtime downloads only from an explicitly approved manifest. Repair uses `runtime/onboarding.mjs` to verify SHA-256 before replacement and retain the previous file as `.previous` for rollback. The current shell intentionally does not download models, access cloud inference, or request API keys.
