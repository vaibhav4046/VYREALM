# Handoff

Start the full local engine with:

```bash
npm install
npm run dev
```

Open `http://localhost:4173/`. The server serves the studio and exposes authenticated `/api/state`, `/api/projects`, `/api/assets`, and `/api/jobs`. Create/open/save/edit/import/export all operate on SQLite-backed project revisions. Scene jobs invoke Blender + FFmpeg and promote validated MP4/poster/BLEND assets; direct jobs invoke the cached loopback Ollama director. See `REPAIR_AUDIT.md` for qualified evidence and explicit remaining gates.
