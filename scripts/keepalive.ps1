$backendUrl = "https://uchiha-backend-d1n7.onrender.com/api/config"
$logFile = Join-Path $PSScriptRoot "keepalive.log"

function Write-Log($msg) {
    $entry = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $msg"
    Add-Content -Path $logFile -Value $entry
    Write-Host $entry
}

Write-Log "Keepalive started. Pinging $backendUrl every 10 minutes."

while ($true) {
    try {
        $response = Invoke-WebRequest -Uri $backendUrl -UseBasicParsing -TimeoutSec 30
        if ($response.StatusCode -eq 200) {
            Write-Log "Backend is alive (status $($response.StatusCode))"
        } else {
            Write-Log "Backend returned status $($response.StatusCode)"
        }
    } catch {
        Write-Log "Ping failed: $_"
    }

    Start-Sleep -Seconds 600
}
