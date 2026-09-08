"""Register only code matching pinned archives and models matching pinned hashes."""
import argparse, datetime, hashlib, json, os
from pathlib import Path, PurePosixPath
import zipfile

parser=argparse.ArgumentParser();parser.add_argument('--root',required=True);parser.add_argument('--config-dir',required=True);args=parser.parse_args()
root=Path(args.root).resolve();app=Path(__file__).resolve().parents[1]
bootstrap=json.loads((app/'runtime/bootstrap.lock.json').read_text());manifest=json.loads((app/'runtime/neural-runtime.lock.json').read_text())
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(8*1024*1024),b''):h.update(chunk)
    return h.hexdigest()
code=[]
for item in bootstrap['archives']:
    path=root/'.downloads'/f"{item['id']}.zip"
    if digest(path)!=item['sha256']:raise ValueError('Runtime archive integrity mismatch')
    with zipfile.ZipFile(path) as archive:
        for entry in archive.infolist():
            parts=PurePosixPath(entry.filename).parts
            if not parts or parts[0]!=item['prefix'] or '..' in parts:raise ValueError('Archive prefix mismatch')
            if entry.is_dir() or len(parts)<2:continue
            target=(root/item['destination']).joinpath(*parts[1:]).resolve()
            if not target.is_relative_to(root):raise ValueError('Runtime path escaped installation')
            if target.suffix=='.py' or target.name in ['requirements.txt','LICENSE','LICENSE.txt']:
                expected=hashlib.sha256(archive.read(entry)).hexdigest()
                if digest(target)!=expected:raise ValueError('Installed runtime code changed: '+target.name)
                code.append({'path':str(target.relative_to(root)),'sha256':expected})
models=[]
for item in manifest['models']:
    path=(root/'ComfyUI/models'/item['destination']).resolve()
    if not path.is_relative_to(root):raise ValueError('Model path escaped installation')
    info=path.stat()
    if info.st_size!=item['bytes'] or digest(path)!=item['sha256']:raise ValueError('Model integrity mismatch')
    models.append({'path':str(path.relative_to(root)),'bytes':info.st_size,'mtimeMs':info.st_mtime_ns/1e6,'sha256':item['sha256']})
python=root/'venv/Scripts/python.exe'
if not python.is_file():raise ValueError('Local Python runtime missing')
inventory={'schemaVersion':1,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'manifest':manifest,'bootstrap':bootstrap,'code':code,'models':models}
(root/'installation.json').write_text(json.dumps(inventory,indent=2))
config_dir=Path(args.config_dir).resolve();config_dir.mkdir(parents=True,exist_ok=True)
destination=config_dir/'comfyui.json'
if destination.exists():(config_dir/'comfyui.json.previous').write_bytes(destination.read_bytes())
temporary=config_dir/'comfyui.json.pending';temporary.write_text(json.dumps({'schemaVersion':1,'enabled':True,'root':str(root),'python':str(python)},indent=2));os.replace(temporary,destination)
print(f'Verified {len(code)} code files and {len(models)} models. Local runtime registered.',flush=True)
