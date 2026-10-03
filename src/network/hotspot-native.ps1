$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$native = $null
$failure = 'nativeError'
function Send-Hotspot($value) {
    [Console]::WriteLine(($value | ConvertTo-Json -Depth 4 -Compress))
}
function Assert-LocalOnly {
    # Sharing and bridging remain conservative conflicts. Forwarding on OTHER interfaces is allowed.
    $sharing = New-Object -ComObject HNetCfg.HNetShare
    foreach ($connection in $sharing.EnumEveryConnection) {
        if ($sharing.INetSharingConfigurationForINetConnection($connection).SharingEnabled) {
            throw 'sharingActive'
        }
    }
    if (@(Get-NetAdapterBinding -AllBindings | Where-Object { $_.ComponentID -eq 'ms_bridge' -and $_.Enabled }).Count) { throw 'sharingActive' }
}
try {
    # $hotspotSource is supplied by the trusted Node helper, never by the renderer.
    $references = @('System.dll', 'System.Core.dll')
    $references += @('System.Runtime','System.Threading.Tasks','System.Collections','System.Runtime.InteropServices.WindowsRuntime') | ForEach-Object {
        [Reflection.Assembly]::Load("$_, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a").Location
    }
    $references += @('Windows.Foundation', 'Windows.Devices', 'Windows.Networking', 'Windows.Security') | ForEach-Object {
        Join-Path "$env:SystemRoot\System32\WinMetadata" "$_.winmd"
    }
    # CodeDOM accepts WinMD references without Add-Type trying to load them as CLR assemblies.
    $compiler = New-Object Microsoft.CSharp.CSharpCodeProvider
    $parameters = New-Object System.CodeDom.Compiler.CompilerParameters
    $parameters.GenerateInMemory = $true
    $parameters.ReferencedAssemblies.AddRange([string[]]$references)
    $compiled = $compiler.CompileAssemblyFromSource($parameters, [string[]]$hotspotSource)
    if ($compiled.Errors.HasErrors) { throw 'nativeError' }
    $nativeType = $compiled.CompiledAssembly.GetType('LocalHotspot')
    if ($hotspotInputProbe) {
        $probe = [Activator]::CreateInstance($nativeType)
        $probe.WatchInput()
        Send-Hotspot @{type='inputWatching'}
        while (!$probe.StopRequested) { Start-Sleep -Milliseconds 100 }
        $probe.Dispose()
        Send-Hotspot @{type='inputStopped'}; exit 0
    }
    if ($hotspotCompileOnly) {
        $compiled.CompiledAssembly.GetType('HotspotIsolation').GetMethod('ValidateLayout').Invoke($null, @()) | Out-Null
        $probe = [Activator]::CreateInstance($nativeType)
        $null = $probe.Addresses()
        $probe.Dispose()
        Send-Hotspot @{type='compiled'}; exit 0
    }
    $request = [Console]::ReadLine() | ConvertFrom-Json
    if ($request.ssid -notmatch '^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$' -or
        $request.password -notmatch '^[\x21-\x7e]{8,63}$') { throw 'invalid' }
    if (![IO.Path]::IsPathRooted($request.executable) -or !(Test-Path -LiteralPath $request.executable -PathType Leaf) -or
        [IO.Path]::GetExtension($request.executable) -ne '.exe') { throw 'invalid' }
    foreach ($port in @($request.dnsPort, $request.httpsPort, $request.httpPort)) {
        if ($port -isnot [int] -or $port -lt 1 -or $port -gt 65535) { throw 'invalid' }
    }
    Assert-LocalOnly
    $native = [Activator]::CreateInstance($nativeType)
    if (@($native.Addresses()).Count) { throw 'sharingActive' }
    $native.Start($request.ssid, $request.password, $request.executable, $request.dnsPort, $request.httpsPort, $request.httpPort)
    $request = $null
    # Framework Console.In.ReadLineAsync blocks synchronously; read on a CLR worker.
    $native.WatchInput()
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    $nextCheck = [DateTime]::MinValue
    $started = $false
    $address = ''
    while ($true) {
        if ($native.StopRequested) { break } # stop command or parent EOF
        $notice = $native.Next()
        while ($null -ne $notice) {
            if ($notice.type -eq 'publisher' -and $notice.status -in @('Aborted','Stopped')) { throw 'radioUnavailable' }
            if ($notice.type -eq 'isolationError') { throw 'isolationFailed' }
            if ($notice.type -in @('peer','disconnected','peerError')) { Send-Hotspot $notice }
            $notice = $native.Next()
        }
        if ([DateTime]::UtcNow -ge $nextCheck) {
            Assert-LocalOnly
            $native.VerifyIsolation()
            $nextCheck = [DateTime]::UtcNow.AddSeconds(2)
            if ($native.Status -eq 'Started') {
                if (!$started) { Send-Hotspot @{type='started'; isolated=$true}; $started=$true }
                $addresses = @($native.Addresses())
                if ($addresses.Count -gt 1) { throw 'addressAmbiguous' }
                $current = if ($addresses.Count -eq 1) { $addresses[0] } else { '' }
                if ($current -ne $address) { $address=$current; Send-Hotspot @{type='address'; address=$address} }
                Send-Hotspot @{type='health'}
            }
        }
        if (!$started -and [DateTime]::UtcNow -gt $deadline) { throw 'radioUnavailable' }
        Start-Sleep -Milliseconds 100
    }
} catch {
    $cause = $_.Exception
    while ($cause.InnerException) { $cause = $cause.InnerException }
    if ($cause.Message -in @('sharingActive','invalid','radioUnavailable','addressAmbiguous','isolationFailed')) {
        $failure=$cause.Message
    }
    # Do not emit compiler/COM errors or raw exceptions which could contain credentials.
    Send-Hotspot @{type='error'; key=$failure}
} finally {
    if ($native) { $native.Dispose() }
}
