param (
    [string]$projectName = "nba-live",
    [string]$environment = "dev"
)

function Remove-SecurityGroupWithRetry {
    param (
        [string]$groupId,
        [int]$maxAttempts = 5,
        [int]$waitSeconds = 30
    )

    for ($i = 1; $i -le $maxAttempts; $i++) {
        try {
            Write-Host "Attempt $i of $maxAttempts to delete security group $groupId..." -ForegroundColor Yellow
            
            # Double-check for any remaining ENIs
            $enis = aws ec2 describe-network-interfaces --filters "Name=group-id,Values=$groupId" | ConvertFrom-Json
            if ($enis.NetworkInterfaces.Count -gt 0) {
                Write-Host "Found remaining ENIs, cleaning up again..." -ForegroundColor Yellow
                foreach ($eni in $enis.NetworkInterfaces) {
                    if ($eni.Attachment) {
                        Write-Host "Force detaching ENI $($eni.NetworkInterfaceId)..."
                        aws ec2 detach-network-interface --attachment-id $eni.Attachment.AttachmentId --force
                        Start-Sleep -Seconds 10
                    }
                    Write-Host "Deleting ENI $($eni.NetworkInterfaceId)..."
                    aws ec2 delete-network-interface --network-interface-id $eni.NetworkInterfaceId
                    Start-Sleep -Seconds 5
                }
            }

            # Try to delete the security group
            aws ec2 delete-security-group --group-id $groupId
            Write-Host "Successfully deleted security group $groupId" -ForegroundColor Green
            return $true
        }
        catch {
            Write-Host "Attempt $i failed: $_" -ForegroundColor Yellow
            if ($i -lt $maxAttempts) {
                Write-Host "Waiting $waitSeconds seconds before next attempt..." -ForegroundColor Yellow
                Start-Sleep -Seconds $waitSeconds
            }
        }
    }
    
    Write-Host "Failed to delete security group after $maxAttempts attempts" -ForegroundColor Red
    return $false
}

function Remove-LambdaSecurityGroup {
    param (
        [string]$sgPattern
    )

    Write-Host "Looking for security groups matching pattern: $sgPattern" -ForegroundColor Yellow
    
    # Get all security groups matching the pattern
    $sgs = aws ec2 describe-security-groups --filters "Name=group-name,Values=$sgPattern*" | ConvertFrom-Json
    
    foreach ($sg in $sgs.SecurityGroups) {
        Write-Host "Processing security group: $($sg.GroupName) ($($sg.GroupId))" -ForegroundColor Cyan
        
        # First detach from Lambda functions
        Write-Host "Checking Lambda functions using this security group..."
        $functions = @(
            "$projectName-gameUpdateHandler-$environment",
            "$projectName-boxScoreHandler-$environment"
        )
        
        foreach ($function in $functions) {
            try {
                Write-Host "Updating Lambda function $function..."
                aws lambda update-function-configuration `
                    --function-name $function `
                    --vpc-config '{"SecurityGroupIds":[],"SubnetIds":[]}' | Out-Null
                
                Write-Host "Waiting for Lambda function update to complete..."
                Start-Sleep -Seconds 10
            }
            catch {
                Write-Host "Lambda function $function might not exist, continuing..." -ForegroundColor Yellow
            }
        }
        
        # Find and delete ENIs
        Write-Host "Looking for network interfaces..."
        $enis = aws ec2 describe-network-interfaces --filters "Name=group-id,Values=$($sg.GroupId)" | ConvertFrom-Json
        
        foreach ($eni in $enis.NetworkInterfaces) {
            Write-Host "Processing ENI: $($eni.NetworkInterfaceId)"
            
            if ($eni.Attachment) {
                Write-Host "Detaching ENI..."
                aws ec2 detach-network-interface --attachment-id $eni.Attachment.AttachmentId --force
                Write-Host "Waiting for detachment..."
                Start-Sleep -Seconds 10
            }
            
            Write-Host "Deleting ENI..."
            aws ec2 delete-network-interface --network-interface-id $eni.NetworkInterfaceId
            Start-Sleep -Seconds 5
        }
        
        # Replace the security group deletion code with the retry function
        Write-Host "Attempting to delete security group $($sg.GroupId)..."
        $deleted = Remove-SecurityGroupWithRetry -groupId $sg.GroupId
        
        if (-not $deleted) {
            Write-Host "WARNING: Security group $($sg.GroupId) could not be deleted. You may need to delete it manually." -ForegroundColor Red
            Write-Host "You can delete it in the AWS Console or run: aws ec2 delete-security-group --group-id $($sg.GroupId)" -ForegroundColor Yellow
        }
    }
}

try {
    Write-Host "Starting security group cleanup..." -ForegroundColor Yellow
    
    # Clean up Lambda security groups
    Remove-LambdaSecurityGroup -sgPattern "$projectName-lambda-sg-$environment"
    
    Write-Host "Cleanup completed" -ForegroundColor Green
}
catch {
    Write-Host "Error during cleanup: $_" -ForegroundColor Red
    exit 1
} 