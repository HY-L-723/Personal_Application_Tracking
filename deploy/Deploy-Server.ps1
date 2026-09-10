[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9.-]*$')]
    [string]$ServerAddress,
    [ValidatePattern('^[a-z_][a-z0-9_-]*$')]
    [string]$UserName = 'ubuntu',
    [ValidateRange(1, 65535)]
    [int]$SshPort = 22,
    [ValidateRange(1024, 65535)]
    [int]$AppPort = 3003,
    [switch]$PrepareOnly,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Split-Path -Parent $PSScriptRoot).Replace('\', '/')
$outputDir = Join-Path $projectRoot '.local\deploy'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
Push-Location $projectRoot
try {
    foreach ($tool in @('git', 'ssh', 'scp')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Required tool not found: $tool" }
    }
    $version = & git -c "safe.directory=$projectRoot" rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^[a-f0-9]{40}$') { throw 'Cannot determine the source revision.' }
    $pending = & git -c "safe.directory=$projectRoot" status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the working tree.' }
    if ($pending) { throw 'Please commit project changes first. Only committed source is packaged.' }
    $release = $version.Substring(0, 12) + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $archive = Join-Path $outputDir "application-tracking-$release.tar"
    & git -c "safe.directory=$projectRoot" archive --format=tar "--output=$archive" HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Source packaging failed.' }
    $mode = 'online'
    if ($Offline) {
        $offlineBundle = & (Join-Path $PSScriptRoot 'Prepare-Offline.ps1')
        & tar -rf $archive -C $offlineBundle.BaseDirectory offline-node-base.tar
        if ($LASTEXITCODE -ne 0) { throw 'Cannot add the offline base image to the package.' }
        & tar -rf $archive -C $offlineBundle.DependenciesDirectory production_modules
        if ($LASTEXITCODE -ne 0) { throw 'Cannot add production dependencies to the package.' }
        Write-Host 'Compressing the offline deployment package...'
        $compressedArchive = $archive + '.gz'
        $inputStream = [System.IO.File]::OpenRead($archive)
        try {
            $outputStream = [System.IO.File]::Create($compressedArchive)
            try {
                $gzip = New-Object System.IO.Compression.GZipStream($outputStream, [System.IO.Compression.CompressionMode]::Compress)
                try { $inputStream.CopyTo($gzip) } finally { $gzip.Dispose() }
            } finally { $outputStream.Dispose() }
        } finally { $inputStream.Dispose() }
        $archive = $compressedArchive
        $mode = 'offline'
    }
    Write-Host "Source revision: $version"
    Write-Host "Package: $archive"
    if ($PrepareOnly) { return }
    $target = "${UserName}@${ServerAddress}"
    $remoteArchive = "/tmp/" + [System.IO.Path]::GetFileName($archive)
    Write-Host 'Uploading source. Enter the SSH password when prompted (input is hidden).'
    & scp -P $SshPort $archive "${target}:$remoteArchive"
    if ($LASTEXITCODE -ne 0) { throw 'Upload failed. No deployment was started.' }
    Write-Host 'Connecting to deploy. SSH and sudo may request the password again.'
    $remoteCommand = 'set -eu; release_dir=$(mktemp -d /tmp/application-tracking.XXXXXXXX); tar -xf "{0}" -C "$release_dir"; bash "$release_dir/deploy/run-docker.sh" "{1}" "{2}" "{3}"' -f $remoteArchive, $AppPort, $version, $mode
    & ssh -t -p $SshPort $target $remoteCommand
    if ($LASTEXITCODE -ne 0) { throw 'Deployment did not complete. Keep the terminal output for diagnosis.' }
    Write-Host "Server-side deployment completed: http://${ServerAddress}:$AppPort/"
    Write-Host "If unreachable externally, allow TCP $AppPort in the cloud security group/firewall."
}
finally { Pop-Location }
