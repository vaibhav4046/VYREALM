"""Install pinned CPU audio models without promoting unverified downloads."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import urllib.request


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def install_model(root, item, open_url=urllib.request.urlopen):
    root = Path(root).resolve()
    target = (root / item['destination']).resolve()
    if not target.is_relative_to(root):
        raise ValueError('Model destination is outside the audio store')
    target.parent.mkdir(parents=True, exist_ok=True)
    valid = lambda path: path.stat().st_size == item['bytes'] and sha256(path) == item['sha256']
    if target.exists():
        if not valid(target):
            raise ValueError(f'Existing {target.name} failed integrity; retained for explicit repair')
        return target
    partial = target.with_name(target.name + '.part')
    if partial.exists() and valid(partial):
        os.replace(partial, target)
        return target
    offset = partial.stat().st_size if partial.exists() else 0
    if offset >= item['bytes']:
        raise ValueError('Invalid complete partial download retained; explicit repair required')
    url = f"https://huggingface.co/{item['repository']}/resolve/{item['revision']}/{item['file']}"
    request = urllib.request.Request(url, headers={'Range': f'bytes={offset}-'} if offset else {})
    with open_url(request, timeout=60) as response:
        if response.status == 206:
            if not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-'):
                raise ValueError('Resume response starts at the wrong byte')
        elif response.status == 200:
            offset = 0
        else:
            raise ValueError(f'Unexpected download status {response.status}')
        with partial.open('ab' if offset else 'wb') as stream:
            while chunk := response.read(1024 * 1024):
                offset += len(chunk)
                if offset > item['bytes']:
                    raise ValueError('Download exceeds pinned byte length')
                stream.write(chunk)
    if not valid(partial):
        raise ValueError('Model checksum mismatch; partial retained, never loaded')
    os.replace(partial, target)
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--python', required=True)
    parser.add_argument('--config-dir', required=True)
    parser.add_argument('--manifest', default=str(Path(__file__).parents[1] / 'runtime' / 'audio-models.lock.json'))
    args = parser.parse_args()
    root, python, config_dir = Path(args.root).resolve(), Path(args.python).resolve(), Path(args.config_dir).resolve()
    if not python.is_file():
        raise ValueError('Install the audio Python runtime before registering models')
    manifest = json.loads(Path(args.manifest).read_text(encoding='utf-8'))
    files = []
    for item in manifest['models']:
        target = install_model(root, item)
        files.append({'path': str(target), 'sha256': item['sha256']})
        print('Verified ' + target.name, flush=True)
    config = {'schemaVersion': 1, 'python': str(python), 'voice': str(root / 'piper/en_US-ljspeech-high.onnx'), 'whisper': str(root / 'whisper-tiny.en'), 'files': files}
    config_dir.mkdir(parents=True, exist_ok=True)
    temporary = config_dir / 'audio.json.pending'
    if (config_dir / 'audio.json').exists():
        (config_dir / 'audio.json.previous').write_bytes((config_dir / 'audio.json').read_bytes())
    temporary.write_text(json.dumps(config, indent=2), encoding='utf-8')
    os.replace(temporary, config_dir / 'audio.json')


if __name__ == '__main__':
    main()
