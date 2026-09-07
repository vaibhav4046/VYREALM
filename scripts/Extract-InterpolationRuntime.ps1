param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$base=[IO.Path]::GetFullPath($Destination)
$files=@('LICENSE','rife-ncnn-vulkan.exe','vcomp140.dll','rife-v4.6/flownet.param','rife-v4.6/flownet.bin')
$zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try {
  foreach($name in $files){
    $entry=$zip.GetEntry('rife-ncnn-vulkan-20221029-windows/'+$name)
    if($null -eq $entry){throw "Required runtime entry is missing: $name"}
    $target=[IO.Path]::GetFullPath([IO.Path]::Combine($base,$name.Replace('/',[IO.Path]::DirectorySeparatorChar)))
    if(-not $target.StartsWith($base.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe extraction path'}
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    if(Test-Path -LiteralPath $target){continue}
    $source=$entry.Open()
    try{$dest=[IO.File]::Open($target,[IO.FileMode]::CreateNew);try{$source.CopyTo($dest)}finally{$dest.Dispose()}}finally{$source.Dispose()}
  }
} finally {$zip.Dispose()}
