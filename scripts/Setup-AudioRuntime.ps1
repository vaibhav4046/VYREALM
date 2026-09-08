param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'VYREALM\audio'),
  [string]$ConfigDir = '',
  [string]$ModelDir = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ConfigDir) { $ConfigDir = if ($env:VYRELUM_RUNTIME_DIR) { $env:VYRELUM_RUNTIME_DIR } else { Join-Path $projectRoot 'data\runtime' } }
$audioRoot = [IO.Path]::GetFullPath($InstallDir)
$audioConfigDir = [IO.Path]::GetFullPath($ConfigDir)
if ($audioRoot -eq [IO.Path]::GetPathRoot($audioRoot) -or $audioRoot.StartsWith('\\')) { throw 'Choose a local audio runtime folder, not a drive root or network share.' }
if (-not $ModelDir) { $ModelDir = Join-Path $audioRoot 'models' }
if (Test-Path -LiteralPath (Join-Path $audioConfigDir 'audio.json')) { throw 'An audio configuration already exists and was left unchanged. Choose a new -ConfigDir to set up separately.' }
New-Item -ItemType Directory -Force $audioRoot | Out-Null
$bootstrap = Get-Content -LiteralPath (Join-Path $projectRoot 'runtime\bootstrap.lock.json') -Raw | ConvertFrom-Json
$uv = Join-Path $projectRoot ('runtime\' + $bootstrap.uv.path)
if (-not (Test-Path -LiteralPath $uv)) {
  $uvRoot = Join-Path $audioRoot 'bootstrap'
  $archive = Join-Path $audioRoot 'uv-pinned.zip'
  if (-not (Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri $bootstrap.uv.archiveUrl -OutFile $archive }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower() -ne $bootstrap.uv.archiveSha256) { throw 'The uv download did not match its pinned checksum. It was not extracted.' }
  Expand-Archive -LiteralPath $archive -DestinationPath $uvRoot -Force
  $uv = Join-Path $uvRoot 'uv.exe'
}
if ((Get-FileHash -LiteralPath $uv -Algorithm SHA256).Hash.ToLower() -ne $bootstrap.uv.sha256) { throw 'The uv helper did not match its pinned checksum.' }
function Invoke-AudioTool([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Audio setup command failed with exit $LASTEXITCODE." }
}
$env:UV_CACHE_DIR = Join-Path $audioRoot 'cache'
$python = Join-Path $audioRoot 'venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { Invoke-AudioTool $uv @('--no-config','venv',(Join-Path $audioRoot 'venv'),'--python','3.12.13') }
Invoke-AudioTool $uv @('--no-config','pip','install','--only-binary',':all:','--python',$python,'--index-url','https://pypi.org/simple','-r',(Join-Path $projectRoot 'runtime\audio-requirements-windows.lock.txt'))
Invoke-AudioTool $uv @('--no-config','pip','check','--python',$python)
Invoke-AudioTool $python @((Join-Path $PSScriptRoot 'install-audio-models.py'),'--root',([IO.Path]::GetFullPath($ModelDir)),'--python',$python,'--config-dir',$audioConfigDir)
$proof = Join-Path $audioRoot ('verification-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $proof | Out-Null
$voiceRequest = Join-Path $proof 'voice-request.json'
[IO.File]::WriteAllText($voiceRequest,(@{operation='voiceover';text='Someone is following me.'}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
$config = Join-Path $audioConfigDir 'audio.json'
Invoke-AudioTool $python @((Join-Path $projectRoot 'workers\audio-local.py'),'--request',$voiceRequest,'--output',(Join-Path $proof 'voice'),'--config',$config)
$transcriptRequest = Join-Path $proof 'transcript-request.json'
[IO.File]::WriteAllText($transcriptRequest,(@{operation='transcribe';inputPath=(Join-Path $proof 'voice\narration.wav')}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
Invoke-AudioTool $python @((Join-Path $projectRoot 'workers\audio-local.py'),'--request',$transcriptRequest,'--output',(Join-Path $proof 'transcript'),'--config',$config)
Write-Output "Audio runtime configured and exercised with real narration/transcription. Configuration: $config"
Write-Output "Restart VYREALM using runtime directory: $audioConfigDir"
Write-Output "Verification files: $proof"
