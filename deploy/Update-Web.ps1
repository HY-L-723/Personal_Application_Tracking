[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9.-]*$')][string]$ServerAddress,
    [ValidatePattern('^[a-z_][a-z0-9_-]*$')][string]$UserName = 'ubuntu',
    [ValidateRange(1, 65535)][int]$SshPort = 22,
    [ValidateRange(1024, 65535)][int]$AppPort = 3003,
    [ValidatePattern('^[a-f0-9]{40}$')][string]$BaseRevision = '1fd04328328997e50b0f204c2d676b756d95bd23',
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Split-Path -Parent $PSScriptRoot).Replace('\', '/')
Push-Location $projectRoot
try {
    foreach ($tool in @('git', 'ssh', 'scp')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing command: $tool" }
    }
    $revision = & git -c "safe.directory=$projectRoot" rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[a-f0-9]{40}$') { throw 'Cannot read source revision.' }
    $pending = & git -c "safe.directory=$projectRoot" status --porcelain
    if ($LASTEXITCODE -ne 0 -or $pending) { throw 'Commit changes before packaging the update.' }
    & git -c "safe.directory=$projectRoot" diff --exit-code $BaseRevision HEAD -- server scripts package.json package-lock.json Dockerfile
    if ($LASTEXITCODE -ne 0) { throw 'Backend or dependency changes detected. This command only supports UI updates.' }
    $outputDir = Join-Path $projectRoot '.local\deploy'
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    $name = 'application-ui-' + $revision.Substring(0, 12) + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.tar'
    $archive = Join-Path $outputDir $name
    & git -c "safe.directory=$projectRoot" archive --format=tar "--output=$archive" HEAD public deploy/update-web.sh deploy/Dockerfile.web
    if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
    Write-Host "UI update package: $archive"
    Write-Host "Revision: $revision (expected server revision: $BaseRevision)"
    if ($PrepareOnly) { return }
    $target = "${UserName}@${ServerAddress}"
    $remoteArchive = '/tmp/' + $name
    Write-Host 'Uploading the UI update. Enter the SSH password in this terminal when prompted.'
    & scp -P $SshPort $archive "${target}:$remoteArchive"
    if ($LASTEXITCODE -ne 0) { throw 'Upload failed; no update was started.' }
    $command = 'set -eu; release_dir=$(mktemp -d /tmp/application-ui.XXXXXXXX); tar -xf "{0}" -C "$release_dir"; bash "$release_dir/deploy/update-web.sh" "{1}" "{2}" "{3}"' -f $remoteArchive, $AppPort, $revision, $BaseRevision
    & ssh -t -p $SshPort $target $command
    if ($LASTEXITCODE -ne 0) { throw 'Update did not complete. Keep the terminal output for diagnosis.' }
    Write-Host "Update complete: http://${ServerAddress}:$AppPort/#todos"
} finally { Pop-Location }
