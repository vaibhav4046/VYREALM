# Original local sound design

The sound-design worker accepts this request through the existing durable job path:

```json
{
  "preset": "epic-dawn-v1",
  "durationSeconds": 30,
  "seed": 713
}
```

It writes `sound-design.wav`, stereo 48 kHz / 16-bit PCM, and a result with exact cue sample ranges and hashes. The existing `rain-tension-v1` remains the default if no preset is supplied.

The epic preset uses original local DSP: quiet filtered dry wind, a harmonic conch-like call, low resonant drum hits, brief leather/cloth textures, and a restrained warm harmonic motif. These are synthesized approximations, not recorded instruments, sampled orchestral music or neural music generation. No network, samples or model weights are involved.

The 30-second timing follows `production-script.json`: the opening call starts at 0.7 s; a low drum at 7.7 s; close leather at 10.35 s and cloth at 12.35 s; a quiet passage from 10–14.8 s; a warm motif from 15.2 s; a second restrained dip from 15.4–19.5 s; a returning drum at 21.3 s; one stronger impact at 25.15 s; and a final call from 25.55 s. The last sounds fade within the requested duration. Timings scale with preview duration.

Custom `cues` replace the defaults. Each has `id`, `kind` (`wind`, `drum`, `conch`, `cloth` or `motif`), `at`, `duration`, optional `gain` (0–1), optional `pan` (-1 left to +1 right), and optional `frequencyHz` (40–1200 Hz for tonal cues). `quietWindows` replace the default dips with `{ "start": 10, "end": 14.8, "gain": 0.28 }` entries. Dips affect the atmosphere and tonal bed while close cloth detail remains audible. Invalid ranges, duplicate cue IDs and excessive event counts fail validation.

The epic renderer allocates only the final PCM byte buffer and a bounded cue list; it does not allocate full-duration float stems. A sample limiter has a transparent range below 0.7 and a maximum near 0.85. This is headroom protection, not final loudness normalization. Mix the narration and soundtrack together, then measure integrated LUFS and true peak on the final film. Listening review remains required before accepting the audio.

`node --test runtime/sound-design.test.mjs` tests unchanged rain behavior, reproducibility, sample-exact cue boundaries, channel panning, quiet passages, invalid input, overload clipping prevention, and a complete 30-second WAV decoded by FFmpeg.
