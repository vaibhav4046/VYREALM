"""Extract reviewed archives with a fixed top-level folder and no path escapes."""
import argparse
from pathlib import Path, PurePosixPath
import stat
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--archive', required=True)
parser.add_argument('--prefix', required=True)
parser.add_argument('--destination', required=True)
args = parser.parse_args()
root = Path(args.destination).resolve()
with zipfile.ZipFile(args.archive) as archive:
    for entry in archive.infolist():
        relative = PurePosixPath(entry.filename)
        if '\\' in entry.filename or not relative.parts or relative.parts[0] != args.prefix or '..' in relative.parts or stat.S_ISLNK(entry.external_attr >> 16):
            raise ValueError('Unsafe archive entry')
        if len(relative.parts) == 1:
            continue
        target = root.joinpath(*relative.parts[1:]).resolve()
        if not target.is_relative_to(root):
            raise ValueError('Archive path escaped destination')
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            data = archive.read(entry)
            if target.exists() and target.read_bytes() != data:
                raise ValueError('Existing runtime code changed; install into a new directory')
            target.write_bytes(data)
