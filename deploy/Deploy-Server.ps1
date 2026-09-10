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
    [switch]$PrepareOnly
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
    Write-Host "Source revision: $version"
    Write-Host "Package: $archive"
    if ($PrepareOnly) { return }
    $target = "${UserName}@${ServerAddress}"
    $remoteArchive = "/tmp/application-tracking-$release.tar"
    Write-Host 'Uploading source. Enter the SSH password when prompted (input is hidden).'
    & scp -P $SshPort $archive "${target}:$remoteArchive"
    if ($LASTEXITCODE -ne 0) { throw 'Upload failed. No deployment was started.' }
    Write-Host 'Connecting to deploy. SSH and sudo may request the password again.'
    $remoteCommand = 'set -eu; release_dir=$(mktemp -d /tmp/application-tracking.XXXXXXXX); tar -xf "{0}" -C "$release_dir"; bash "$release_dir/deploy/run-docker.sh" "{1}" "{2}"' -f $remoteArchive, $AppPort, $version
    & ssh -t -p $SshPort $target $remoteCommand
    if ($LASTEXITCODE -ne 0) { throw 'Deployment did not complete. Keep the terminal output for diagnosis.' }
    Write-Host "Server-side deployment completed: http://${ServerAddress}:$AppPort/"
    Write-Host "If unreachable externally, allow TCP $AppPort in the cloud security group/firewall."
}
finally { Pop-Location }
