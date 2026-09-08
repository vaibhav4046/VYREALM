"""Download only the pinned public model files; resume and verify before promotion."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--models', required=True)
parser.add_argument('--manifest', default=str(Path(__file__).parents[1] / 'runtime' / 'neural-runtime.lock.json'))
args = parser.parse_args()
root = Path(args.models).resolve()
root.mkdir(parents=True, exist_ok=True)
manifest = json.loads(Path(args.manifest).read_text(encoding='utf-8'))

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

for model in manifest['models']:
    target = (root / model['destination']).resolve()
    if not target.is_relative_to(root):
        raise ValueError('Destination is outside the model store')
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size == model['bytes'] and digest(target) == model['sha256']:
        print('Verified existing ' + target.name, flush=True)
        continue
    partial = target.with_suffix(target.suffix + '.part')
    offset = partial.stat().st_size if partial.exists() else 0
    if shutil.disk_usage(root).free < model['bytes'] - offset + 2 * 1024**3:
        raise RuntimeError('Insufficient disk space; retaining partial download')
    url = f"https://huggingface.co/{model['repository']}/resolve/{model['revision']}/{model['file']}"
    for attempt in range(3):
        try:
            offset = partial.stat().st_size if partial.exists() else 0
            headers = {'User-Agent': 'VYREALM-model-setup/1.0'}
            if offset:
                headers['Range'] = f'bytes={offset}-'
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
                if offset and response.status != 206:
                    offset = 0
                with partial.open('ab' if offset else 'wb') as f:
                    last = time.monotonic()
                    while chunk := response.read(4 * 1024 * 1024):
                        f.write(chunk)
                        offset += len(chunk)
                        if offset > model['bytes']:
                            raise ValueError('Response exceeded the pinned file size')
                        if time.monotonic() - last > 20:
                            print(f"{target.name}: {offset / model['bytes']:.0%}", flush=True)
                            last = time.monotonic()
            if partial.stat().st_size != model['bytes'] or digest(partial) != model['sha256']:
                raise ValueError('Model integrity mismatch; partial file retained and never loaded')
            os.replace(partial, target)
            print('Downloaded and SHA-256 verified ' + target.name, flush=True)
            break
        except (OSError, TimeoutError) as error:
            if attempt == 2:
                raise
            print(f'Resumable download retry: {error}', flush=True)
            time.sleep(2)
