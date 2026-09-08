"""Synthesise one narration WAV per format hook line, locally with Piper.

The hook line is what a viewer reads AND hears. Generating it locally keeps the
whole pipeline offline: no TTS API, no key, no per-character billing.

Usage:
  python scripts/write-format-narration.py --hooks runtime/assets/format-hooks.json \
      --voice D:/VYREALM-runtime/audio-models/piper/en_US-ljspeech-high.onnx \
      --out runtime/assets/narration
"""
import argparse, json, os, pathlib, sys, wave

os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')

ap = argparse.ArgumentParser()
ap.add_argument('--hooks', required=True)
ap.add_argument('--voice', required=True)
ap.add_argument('--out', required=True)
args = ap.parse_args()

voice_path = pathlib.Path(args.voice)
if not voice_path.exists():
    print(f'VOICE_MISSING {voice_path}', file=sys.stderr)
    sys.exit(2)

hooks_doc = json.loads(pathlib.Path(args.hooks).read_text(encoding='utf-8'))
hooks = hooks_doc.get('hooks', {})
out_dir = pathlib.Path(args.out)
out_dir.mkdir(parents=True, exist_ok=True)

from piper import PiperVoice, SynthesisConfig

voice = PiperVoice.load(str(voice_path), use_cuda=False)
# length_scale just over 1 slows delivery slightly; the default reads rushed
# against a 15s cut where the caption also has to be readable.
synthesis = SynthesisConfig(length_scale=1.05, noise_scale=0.5, noise_w_scale=0.7)

manifest = {'schemaVersion': 1, 'voice': voice_path.name, 'engine': 'piper-local', 'items': {}}
ok = 0
for format_id, entry in hooks.items():
    line = str(entry.get('line', '')).strip()
    if not line:
        continue
    target = out_dir / f'{format_id}.wav'
    try:
        with wave.open(str(target), 'wb') as wav:
            voice.synthesize_wav(line, wav, synthesis)
        with wave.open(str(target), 'rb') as wav:
            seconds = wav.getnframes() / float(wav.getframerate())
            rate = wav.getframerate()
        manifest['items'][format_id] = {
            'path': target.name,
            'text': line,
            'seconds': round(seconds, 3),
            'sampleRate': rate,
        }
        ok += 1
        print(f'{format_id}: {seconds:.2f}s  {line}')
    except Exception as exc:  # noqa: BLE001 - report and continue, one bad line must not stop the batch
        print(f'{format_id}: FAILED {exc}', file=sys.stderr)

manifest['count'] = ok
(out_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(f'\n{ok} narration files -> {out_dir}')
