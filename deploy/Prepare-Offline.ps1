# Prepare a Linux/amd64 base image and platform-independent production dependencies.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$offlineRoot = Join-Path $projectRoot '.local\offline'
$toolsDir = Join-Path $offlineRoot 'tools'
$baseDir = Join-Path $offlineRoot 'base'
New-Item -ItemType Directory -Path $toolsDir, $baseDir -Force | Out-Null

# Pinned official Google go-containerregistry release and its published SHA-256.
# https://github.com/google/go-containerregistry/releases/tag/v0.22.1
$toolArchive = Join-Path $toolsDir 'crane.tar.gz'
$toolHash = '0e073ea8192c3b8442ec8aaf44d53c1050a09084669fae3a6ceb0f2026cf8b21'
if (-not (Test-Path -LiteralPath $toolArchive)) {
    & curl.exe -fL --retry 2 --connect-timeout 15 --max-time 180 'https://github.com/google/go-containerregistry/releases/download/v0.22.1/go-containerregistry_Windows_x86_64.tar.gz' -o $toolArchive | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Cannot download the offline image tool.' }
}
if ((Get-FileHash -LiteralPath $toolArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $toolHash) {
    throw 'Offline image tool checksum mismatch. Do not run the downloaded executable.'
}
& tar -xzf $toolArchive -C $toolsDir crane.exe
if ($LASTEXITCODE -ne 0) { throw 'Cannot extract the verified image tool.' }
$crane = Join-Path $toolsDir 'crane.exe'
$baseArchive = Join-Path $baseDir 'offline-node-base.tar'
if (-not (Test-Path -LiteralPath $baseArchive)) {
    Write-Host 'Downloading the official Node.js Linux/amd64 base image on this computer...'
    & $crane pull --platform linux/amd64 --format legacy node:24-bookworm-slim $baseArchive | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Base image download failed. Keep the output for diagnosis.' }
}
& $crane validate --tarball $baseArchive | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Base image archive failed integrity validation.' }
$manifestText = & tar -xOf $baseArchive manifest.json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read the image archive manifest.' }
$manifest = $manifestText | ConvertFrom-Json
if ($manifest[0].RepoTags -notcontains 'node:24-bookworm-slim') {
    throw 'The offline archive does not contain the expected Node.js image tag.'
}

& node (Join-Path $PSScriptRoot 'check-offline-deps.js') (Join-Path $projectRoot 'package-lock.json')
if ($LASTEXITCODE -ne 0) { throw 'Production dependencies require a Linux-specific build.' }
$depsDir = Join-Path $offlineRoot ('deps-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $depsDir | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json'), (Join-Path $projectRoot 'package-lock.json') -Destination $depsDir
Write-Host 'Preparing production-only dependencies locally...'
& npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix $depsDir | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Production dependency preparation failed.' }
$modules = Join-Path $depsDir 'node_modules'
if (Get-ChildItem -LiteralPath $modules -Recurse -Filter '*.node') {
    throw 'Native Windows modules cannot be included in a Linux deployment.'
}
Copy-Item -LiteralPath $modules -Destination (Join-Path $depsDir 'production_modules') -Recurse
Write-Host 'Offline base image and production dependencies are ready.'
[pscustomobject]@{ BaseDirectory = $baseDir; DependenciesDirectory = $depsDir }
