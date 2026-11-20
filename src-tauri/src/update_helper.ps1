# Runs in a separate, non-elevated process, surviving the application's exit.
# $config is supplied as base64 JSON by the native, verified-download handler.
$ErrorActionPreference = 'Stop'
$parent = $null
$installer = $null
$packageLock = $null
$launched = $false
function Write-Status($state, $message, $code) {
    $record = @{id=$config.id;version=$config.version;state=$state;message=$message;code=$code;reported=$false;package=$config.package}
    $json = ConvertTo-Json -Compress -InputObject $record
    $temporary = $config.status + '.tmp'
    [IO.File]::WriteAllText($temporary, $json, (New-Object Text.UTF8Encoding($false)))
    if ([IO.File]::Exists($config.status)) { [IO.File]::Replace($temporary, $config.status, $null) }
    else { [IO.File]::Move($temporary, $config.status) }
}
try {
    $parent = [Diagnostics.Process]::GetProcessById($config.parent)
    if ($parent.MainModule.FileName -ine $config.executable) { throw 'Update parent executable does not match' }
    $file = Get-Item -LiteralPath $config.package -Force
    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -ne $config.size) { throw 'Update package has changed' }
    $packageLock = [IO.File]::Open($config.package, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    # Get-FileHash is not available in every inbox PowerShell/module setup.
    # Hash the locked stream using .NET instead of depending on that cmdlet.
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { $actualHash = [BitConverter]::ToString($algorithm.ComputeHash($packageLock)).Replace('-', '') }
    finally { $algorithm.Dispose() }
    if ($actualHash -ine $config.digest) { throw 'Update package SHA-256 verification failed' }
    # A previous helper must not overwrite a newer installation receipt.
    Write-Status 'starting' '' 0
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $config.program
    $start.Arguments = $config.arguments
    $start.WorkingDirectory = [IO.Path]::GetDirectoryName($config.package)
    $start.UseShellExecute = $true
    if ($config.elevate) { $start.Verb = 'runas' }
    $installer = New-Object Diagnostics.Process
    $installer.StartInfo = $start
    if (-not $installer.Start()) { throw 'Unable to start the update installer' }
    $launched = $true
    Write-Status 'started' '' 0
    $installer.WaitForExit()
    $code = $installer.ExitCode
    if ($code -eq 0 -or $code -eq 3010) {
        $actual = [Diagnostics.FileVersionInfo]::GetVersionInfo($config.executable).ProductVersion
        if ($actual -notmatch ('^' + [Regex]::Escape($config.version) + '(?:\.0)?(?:$|\s|[-+])')) { throw ('Installed application version does not match ' + $config.version) }
        Write-Status 'installed' '' $code
    }
    elseif ($code -eq 1602 -or ($config.kind -eq 'nsis' -and $code -eq 1)) { Write-Status 'canceled' 'Installation canceled' $code }
    else { Write-Status 'failed' ('Installer exited with code ' + $code) $code }
} catch {
    $code = 0
    $cause = $_.Exception
    while ($cause.InnerException) { $cause = $cause.InnerException }
    if ($cause -is [ComponentModel.Win32Exception]) { $code = $cause.NativeErrorCode }
    $state = 'failed'
    if ($code -eq 1223) { $state = 'canceled' }
    Write-Status $state ([string]$cause.Message).Substring(0,[Math]::Min(600,([string]$cause.Message).Length)) $code
}
if ($packageLock) { $packageLock.Dispose() }
# Launch from the helper's ordinary user token, including after a failed or
# canceled install. Do not pass AUTOLAUNCHAPP or NSIS /R to an elevated installer.
if ($parent -and $launched) {
    try {
        $alreadyExited = $parent.HasExited
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        while (-not $alreadyExited -and -not [IO.File]::Exists($config.ack) -and [DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds 50
        }
        $acknowledged = $alreadyExited -or [IO.File]::Exists($config.ack)
        if ($acknowledged -and $parent.WaitForExit(30000) -and [IO.File]::Exists($config.executable)) {
            Start-Process -FilePath $config.executable -WorkingDirectory ([IO.Path]::GetDirectoryName($config.executable)) | Out-Null
        }
        if ([IO.File]::Exists($config.ack)) { [IO.File]::Delete($config.ack) }
    } catch {}
}
