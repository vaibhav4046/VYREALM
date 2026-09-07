"""Verify an installed pinned runtime and register it for app-managed startup."""
import argparse, hashlib, json, pathlib, subprocess, datetime
parser=argparse.ArgumentParser()
parser.add_argument('--root',required=True)
parser.add_argument('--config-dir',required=True)
args=parser.parse_args()
root=pathlib.Path(args.root).resolve()
manifest=json.loads((pathlib.Path(__file__).resolve().parents[1]/'runtime/neural-runtime.lock.json').read_text())
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(8*1024*1024),b''):h.update(chunk)
    return h.hexdigest()
code=[]
for folder, key in [('ComfyUI','comfyui'),('ComfyUI/custom_nodes/ComfyUI-GGUF','ggufNodes')]:
    repo=root/folder
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
    if commit!=manifest[key]['commit']:raise RuntimeError(f'Pinned commit mismatch: {folder}')
    for name in subprocess.check_output(['git','ls-files'],cwd=repo,text=True).splitlines():
        if name.endswith('.py') or name in ['requirements.txt','LICENSE','LICENSE.txt']:
            path=(repo/name).resolve()
            if not path.is_relative_to(root):raise RuntimeError('Runtime path escaped installation')
            code.append({'path':str(path.relative_to(root)),'sha256':digest(path)})
models=[]
for model in manifest['models']:
    path=root/'ComfyUI/models'/model['destination']
    s=path.stat()
    if s.st_size!=model['bytes'] or digest(path)!=model['sha256']:raise RuntimeError(f'Model checksum mismatch: {path.name}')
    models.append({'path':str(path.relative_to(root)),'bytes':s.st_size,'mtimeMs':s.st_mtime_ns/1e6,'sha256':model['sha256']})
python=root/'venv/Scripts/python.exe'
if not python.is_file():raise RuntimeError('Windows Python runtime missing')
inventory={'schemaVersion':1,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'manifest':manifest,'code':code,'models':models}
(root/'installation.json').write_text(json.dumps(inventory,indent=2))
config_dir=pathlib.Path(args.config_dir).resolve()
config_dir.mkdir(parents=True,exist_ok=True)
(config_dir/'comfyui.json').write_text(json.dumps({'schemaVersion':1,'enabled':True,'root':str(root),'python':str(python)},indent=2))
print(f'Verified and registered {len(models)} models and {len(code)} runtime code files in {config_dir}')
