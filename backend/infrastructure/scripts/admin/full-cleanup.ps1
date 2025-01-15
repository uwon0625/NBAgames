Write-Host "Starting full cleanup..." -ForegroundColor Green

# First check if stacks exist
Write-Host "`nChecking for existing stacks..." -ForegroundColor Cyan
$stacksExist = yarn check:stack 2>$null
if ($LASTEXITCODE -eq 0) {
    # Run CloudFormation deletion if stacks exist
    Write-Host "`nRunning CloudFormation deletion..." -ForegroundColor Cyan
    yarn delete:cfn
} else {
    Write-Host "No CloudFormation stacks found to delete" -ForegroundColor Yellow
}

# Then run the cleanup script for any remaining resources
Write-Host "`nRunning cleanup script for remaining resources..." -ForegroundColor Cyan
.\infrastructure\scripts\admin\cleanup-resources.ps1

Write-Host "`nFull cleanup completed!" -ForegroundColor Green 