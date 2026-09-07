param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'VYREALM\engines'),
  [string]$ConfigDir = (Join-Path $env:APPDATA 'vyrelum\runtime')
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = [IO.Path]::GetFullPath($InstallDir)
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'runtime\neural-runtime.lock.json') -Raw | ConvertFrom-Json
function Checked-Run([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program exited $LASTEXITCODE" }
}
# Setup may use the network; generation subsequently runs entirely offline.
# No global Python, driver, service or execution-policy changes are made here.
$gitCommand = Get-Command git -ErrorAction SilentlyContinue
$uvCommand = Get-Command uv -ErrorAction SilentlyContinue
if (-not $gitCommand -or -not $uvCommand) { throw 'Setup requires Git and uv. Install their official Windows distributions, then rerun this command. No model download has started.' }
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$env:UV_CACHE_DIR = Join-Path $runtimeRoot 'cache\uv'
$comfy = Join-Path $runtimeRoot 'ComfyUI'
if (-not (Test-Path -LiteralPath (Join-Path $comfy '.git'))) { Checked-Run $gitCommand.Source @('clone','--filter=blob:none','https://github.com/Comfy-Org/ComfyUI.git',$comfy) }
Checked-Run $gitCommand.Source @('-C',$comfy,'checkout','--detach',$manifest.comfyui.commit)
$gguf = Join-Path $comfy 'custom_nodes\ComfyUI-GGUF'
if (-not (Test-Path -LiteralPath (Join-Path $gguf '.git'))) { Checked-Run $gitCommand.Source @('clone','--filter=blob:none','https://github.com/city96/ComfyUI-GGUF.git',$gguf) }
Checked-Run $gitCommand.Source @('-C',$gguf,'checkout','--detach',$manifest.ggufNodes.commit)
$python = Join-Path $runtimeRoot 'venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { Checked-Run $uvCommand.Source @('venv',(Join-Path $runtimeRoot 'venv'),'--python','3.12.13') }
Checked-Run $uvCommand.Source @('pip','install','--python',$python,'--index-url','https://download.pytorch.org/whl/cu128','torch==2.8.0+cu128','torchvision==0.23.0+cu128','torchaudio==2.8.0+cu128')
$rest = Get-Content -LiteralPath (Join-Path $projectRoot 'runtime\neural-requirements-windows.lock.txt') | Where-Object { $_ -notmatch '^(torch|torchvision|torchaudio)==' }
$requirements = Join-Path $runtimeRoot 'requirements-pinned.txt'
$rest | Set-Content -LiteralPath $requirements -Encoding utf8
Checked-Run $uvCommand.Source @('pip','install','--python',$python,'-r',$requirements)
Checked-Run $python @((Join-Path $PSScriptRoot 'download-neural-models.py'),'--models',(Join-Path $comfy 'models'))
Checked-Run $python @((Join-Path $PSScriptRoot 'register-neural-runtime.py'),'--root',$runtimeRoot,'--config-dir',$ConfigDir)
Write-Output 'Local video runtime registered. Open VYREALM and choose Run real generation test. The app starts the runtime automatically.'
