param (
    [switch]$SkipLambdaPackaging,
    [switch]$Destroy,
    [switch]$CleanupSecurityGroups
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

function Remove-SecurityGroup {
    param (
        [string]$sgId
    )
    
    Write-Host "Attempting to force delete security group $sgId..." -ForegroundColor Yellow
    
    try {
        # First, delete the Lambda functions that might be using the ENIs
        Write-Host "Deleting Lambda functions first..."
        aws lambda delete-function --function-name nba-live-gameUpdateHandler-dev
        aws lambda delete-function --function-name nba-live-boxScoreHandler-dev
    } catch {
        Write-Host "Lambda functions might already be deleted, continuing..." -ForegroundColor Yellow
    }
    
    # Wait a bit for Lambda to clean up its ENIs
    Write-Host "Waiting for Lambda ENIs to be cleaned up..."
    Start-Sleep -Seconds 30
    
    # Remove all security group rules first
    try {
        Write-Host "Removing security group rules..."
        $rules = aws ec2 describe-security-group-rules --filters "Name=group-id,Values=$sgId" | ConvertFrom-Json
        foreach ($rule in $rules.SecurityGroupRules) {
            if ($rule.IsEgress) {
                aws ec2 revoke-security-group-egress --group-id $sgId --security-group-rule-ids $rule.SecurityGroupRuleId
            } else {
                aws ec2 revoke-security-group-ingress --group-id $sgId --security-group-rule-ids $rule.SecurityGroupRuleId
            }
        }
    } catch {
        Write-Host "Failed to remove security group rules, continuing..." -ForegroundColor Yellow
    }
    
    # List network interfaces using this security group
    $enis = aws ec2 describe-network-interfaces --filters "Name=group-id,Values=$sgId" | ConvertFrom-Json
    
    if ($enis.NetworkInterfaces) {
        Write-Host "Found network interfaces using security group. Detaching..." -ForegroundColor Yellow
        foreach ($eni in $enis.NetworkInterfaces) {
            if ($eni.Attachment) {
                Write-Host "Detaching ENI $($eni.NetworkInterfaceId)..."
                aws ec2 detach-network-interface --attachment-id $eni.Attachment.AttachmentId --force
                
                # Wait for detachment to complete
                Start-Sleep -Seconds 10
            }
            Write-Host "Deleting ENI $($eni.NetworkInterfaceId)..."
            aws ec2 delete-network-interface --network-interface-id $eni.NetworkInterfaceId
        }
    }
}

if ($CleanupSecurityGroups) {
    Write-Host "Cleaning up security groups..." -ForegroundColor Yellow
    & "$PSScriptRoot/cleanup-security-groups.ps1"
    if ($LASTEXITCODE -ne 0) {
        throw "Security group cleanup failed"
    }
}

try {
    if ($Destroy) {
        Write-Host "Destroying existing infrastructure..." -ForegroundColor Yellow
        Push-Location "$PSScriptRoot/../terraform"
        try {
            # First attempt normal destroy
            $destroyOutput = terraform destroy -auto-approve 2>&1 | Tee-Object -Append $logFile
            
            # Check if security group is stuck
            if ($destroyOutput -match "aws_security_group\.lambda: Still destroying... \[id=([^\]]+)\]") {
                $sgId = $matches[1]
                Write-Host "Security group deletion is stuck. Attempting cleanup..." -ForegroundColor Yellow
                
                # Force cleanup security group
                Remove-SecurityGroup -sgId $sgId
                
                # Retry destroy
                Write-Host "Retrying terraform destroy..." -ForegroundColor Yellow
                terraform destroy -auto-approve 2>&1 | Tee-Object -Append $logFile
            }
            
            if ($LASTEXITCODE -ne 0) {
                throw "Terraform destroy failed. Check $logFile for details."
            }
            Write-Host "Infrastructure destroyed successfully" -ForegroundColor Green
            
            # If only destroying, exit here
            if (-not $PSBoundParameters.ContainsKey('SkipLambdaPackaging')) {
                return
            }
        }
        finally {
            Pop-Location
        }
    }

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