param([switch]$Watch)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
# Use existing environment configuration first. Only inherit an already enabled Windows proxy.
if (-not $env:HTTPS_PROXY -and -not $env:HTTP_PROXY -and -not $env:ALL_PROXY) {
  $taskProxy = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
  if ($taskProxy.ProxyEnable -eq 1 -and $taskProxy.ProxyServer) {
    $taskAddress = [string]$taskProxy.ProxyServer
    if ($taskAddress.Contains('=')) {
      $taskParts = @{}
      foreach ($taskPair in $taskAddress.Split(';')) {
        $taskSplit = $taskPair.Split('=', 2)
        if ($taskSplit.Count -eq 2) { $taskParts[$taskSplit[0]] = $taskSplit[1] }
      }
      $taskAddress = if ($taskParts['https']) { $taskParts['https'] } else { $taskParts['http'] }
    }
    if ($taskAddress) {
      if ($taskAddress -notmatch '^\w+://') { $taskAddress = 'http://' + $taskAddress }
      if ($taskAddress -notmatch '^https?://') { throw 'Use an HTTP/HTTPS proxy for Node; SOCKS/PAC requires explicit configuration.' }
      $env:HTTPS_PROXY = $taskAddress
      $env:HTTP_PROXY = $taskAddress
      Write-Host 'Using the existing Windows proxy for OpenAI connections.'
    }
  }
}
# Always keep browser callbacks local, including when an environment proxy is provided.
$taskBypass = @($env:NO_PROXY, '127.0.0.1', 'localhost', '::1') | Where-Object { $_ }
$env:NO_PROXY = $taskBypass -join ','
$taskNodeArgs = @('--use-env-proxy')
if ($Watch) { $taskNodeArgs += '--watch' }
$taskNodeArgs += 'src/server.js'
& node @taskNodeArgs
exit $LASTEXITCODE
