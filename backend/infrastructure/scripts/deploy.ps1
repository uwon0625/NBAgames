param (
    [switch]$SkipLambdaPackaging
)

# Enable strict mode and stop on errors
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Store original location
$originalLocation = Get-Location

# Enable Terraform logging
$env:TF_LOG = "DEBUG"
$logFile = Join-Path $PSScriptRoot "../terraform/terraform.log"

# Ensure log directory exists
$logDir = Split-Path -Parent $logFile
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

# Clear previous log file if it exists
if (Test-Path $logFile) {
    Clear-Content $logFile
}

function Remove-TerraformLock {
    param (
        [string]$lockId
    )
    
    Write-Host "Attempting to remove Terraform state lock..."
    terraform force-unlock -force $lockId
}

try {
    # Package Lambda functions unless skipped
    if ($SkipLambdaPackaging) {
        Write-Host "Skipping Lambda packaging, using existing packages..." -ForegroundColor Yellow
        
        # Verify that Lambda packages exist
        $requiredLambdas = @(
            "gameUpdateHandler.zip",
            "boxScoreHandler.zip"
        )
        
        $lambdaDir = Join-Path $PSScriptRoot "../lambda/dist/lambdas"
        foreach ($lambda in $requiredLambdas) {
            $lambdaPath = Join-Path $lambdaDir $lambda
            if (-not (Test-Path $lambdaPath)) {
                throw "Required Lambda package not found: $lambdaPath. Run without -SkipLambdaPackaging to create it."
            }
        }
    } else {
        Write-Host "Packaging Lambda functions..."
        & "$PSScriptRoot/package-lambdas.ps1"
        if ($LASTEXITCODE -ne 0) {
            throw "Lambda packaging failed"
        }
    }

    # Run Terraform
    Write-Host "Running Terraform..."
    Push-Location "$PSScriptRoot/../terraform"

    try {
        # Initialize if needed
        if (-not (Test-Path ".terraform")) {
            Write-Host "Initializing Terraform..."
            terraform init 2>&1 | Tee-Object -Append $logFile
            if ($LASTEXITCODE -ne 0) {
                throw "Terraform initialization failed. Check $logFile for details."
            }
        }

        # Plan changes
        Write-Host "Planning Terraform changes..."
        $planOutput = terraform plan -detailed-exitcode 2>&1 | Tee-Object -Append $logFile
        $planExitCode = $LASTEXITCODE

        # Check for lock error
        if ($planOutput -match "Error acquiring the state lock.*ID:\s+([a-f0-9-]+)") {
            $lockId = $matches[1]
            Write-Host "Found stale lock with ID: $lockId"
            $confirmation = Read-Host "Would you like to remove the stale lock? (y/n)"
            if ($confirmation -eq 'y') {
                Remove-TerraformLock -lockId $lockId
                # Retry the plan
                $planOutput = terraform plan -detailed-exitcode 2>&1 | Tee-Object -Append $logFile
                $planExitCode = $LASTEXITCODE
            } else {
                throw "Deployment cancelled due to state lock"
            }
        }

        if ($planExitCode -eq 1) {
            Write-Host "Terraform plan failed. Check $logFile for details." -ForegroundColor Red
            Get-Content $logFile | Select-Object -Last 50
            throw "Terraform plan failed. Full logs available in $logFile"
        }

        # Apply if there are changes
        if ($planExitCode -eq 2) {
            Write-Host "Changes detected. Applying..."
            terraform apply -auto-approve 2>&1 | Tee-Object -Append $logFile
            if ($LASTEXITCODE -ne 0) {
                throw "Terraform apply failed. Check $logFile for details."
            }
        } else {
            Write-Host "No changes to apply"
        }

        Write-Host "Deployment completed successfully" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
}
catch {
    Write-Error "Deployment failed: $_"
    Write-Host "Check the log file for details: $logFile" -ForegroundColor Yellow
    
    # Check if we're in terraform directory for rollback
    if ((Get-Location).Path -like "*\terraform") {
        $confirmation = Read-Host "Would you like to roll back changes? (y/n)"
        if ($confirmation -eq 'y') {
            Write-Host "Rolling back changes..."
            terraform destroy -auto-approve 2>&1 | Tee-Object -Append $logFile
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Rollback failed! Manual intervention may be required. Check $logFile for details."
            } else {
                Write-Host "Rollback completed successfully" -ForegroundColor Yellow
            }
        } else {
            Write-Host "Skipping rollback. Resources may be in an inconsistent state" -ForegroundColor Yellow
        }
    }
    
    exit 1
}
finally {
    # Always return to original location
    Set-Location -Path $originalLocation
    
    # Display log file location
    if (Test-Path $logFile) {
        Write-Host "Terraform logs are available at: $logFile" -ForegroundColor Cyan
    }
} 