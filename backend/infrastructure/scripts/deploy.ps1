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
    # Change to terraform directory
    Set-Location -Path (Join-Path $PSScriptRoot "..\terraform")
    
    if (-not $SkipLambdaPackaging) {
        # Package Lambda functions first
        Write-Host "Packaging Lambda functions..." -ForegroundColor Cyan
        & (Join-Path $PSScriptRoot "package-lambdas.ps1")
        if ($LASTEXITCODE -ne 0) {
            throw "Lambda packaging failed"
        }
    }

    if ($Destroy) {
        Write-Host "Destroying infrastructure..." -ForegroundColor Yellow
        terraform destroy -auto-approve
    } else {
        # Initialize and apply Terraform
        Write-Host "Initializing Terraform..." -ForegroundColor Cyan
        terraform init
        if ($LASTEXITCODE -ne 0) { throw "Terraform init failed" }

        Write-Host "Planning Terraform changes..." -ForegroundColor Cyan
        terraform plan -out=tfplan
        if ($LASTEXITCODE -ne 0) { throw "Terraform plan failed" }

        Write-Host "Applying Terraform changes..." -ForegroundColor Cyan
        terraform apply tfplan
        if ($LASTEXITCODE -ne 0) { throw "Terraform apply failed" }
    }

    Write-Host "Deployment completed successfully" -ForegroundColor Green
} catch {
    Write-Error $_.Exception.Message
    exit 1
} finally {
    # Return to original location
    Set-Location -Path $originalLocation
} 