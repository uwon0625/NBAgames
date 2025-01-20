# Run in lambda directory
Push-Location (Join-Path $PSScriptRoot "../lambda")
try {
    # List production dependencies
    yarn list --prod --json > dependencies.json
    
    # Get package size
    $zipPath = Join-Path "dist/lambdas" "gameUpdateHandler.zip"
    if (Test-Path $zipPath) {
        $size = (Get-Item $zipPath).Length / 1MB
        Write-Host "Package size: $($size.ToString('N2')) MB"
    }
} finally {
    Pop-Location
} 