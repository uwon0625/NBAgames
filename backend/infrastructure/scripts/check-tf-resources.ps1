param (
    [string]$projectName = "nba-live",
    [string]$environment = "dev",
    [switch]$cleanup
)

function Write-ResourceStatus {
    param (
        [string]$resourceType,
        [array]$resources,
        [string]$color = "White"
    )
    Write-Host "`n[$resourceType]" -ForegroundColor $color
    if ($resources.Count -eq 0) {
        Write-Host "  No resources found" -ForegroundColor Gray
    } else {
        $resources | ForEach-Object {
            Write-Host "  - $($_.Id)" -ForegroundColor $color
            if ($_.Name) { Write-Host "    Name: $($_.Name)" -ForegroundColor Gray }
            if ($_.Arn) { Write-Host "    ARN: $($_.Arn)" -ForegroundColor Gray }
        }
    }
}

try {
    Write-Host "Checking AWS resources for project: $projectName-$environment" -ForegroundColor Cyan
    
    # 1. Check Lambda Functions (they reference most other resources)
    $lambdas = aws lambda list-functions | ConvertFrom-Json
    $projectLambdas = $lambdas.Functions | Where-Object {
        $_.FunctionName -like "$projectName-*-$environment"
    }
    Write-ResourceStatus "Lambda Functions" $projectLambdas "Yellow"
    
    # 2. Check Security Groups (often cause issues)
    $sgs = aws ec2 describe-security-groups | ConvertFrom-Json
    $projectSGs = $sgs.SecurityGroups | Where-Object {
        $_.GroupName -like "$projectName-*-$environment*"
    }
    Write-ResourceStatus "Security Groups" $projectSGs "Yellow"
    
    # 3. Check ENIs attached to Security Groups
    foreach ($sg in $projectSGs) {
        $enis = aws ec2 describe-network-interfaces --filters "Name=group-id,Values=$($sg.GroupId)" | ConvertFrom-Json
        Write-ResourceStatus "Network Interfaces for SG $($sg.GroupId)" $enis.NetworkInterfaces "Magenta"
    }
    
    # 4. Check IAM Roles and Policies
    $roles = aws iam list-roles | ConvertFrom-Json
    $projectRoles = $roles.Roles | Where-Object {
        $_.RoleName -like "$projectName-*-$environment*"
    }
    Write-ResourceStatus "IAM Roles" $projectRoles "Green"
    
    # 5. Check DynamoDB Tables
    $tables = aws dynamodb list-tables | ConvertFrom-Json
    $projectTables = $tables.TableNames | Where-Object {
        $_ -like "$projectName-*-$environment*"
    }
    Write-ResourceStatus "DynamoDB Tables" $projectTables "Blue"
    
    # 6. Check MSK Clusters
    $msks = aws kafka list-clusters | ConvertFrom-Json
    $projectMSKs = $msks.ClusterInfoList | Where-Object {
        $_.ClusterName -like "$projectName-*-$environment*"
    }
    Write-ResourceStatus "MSK Clusters" $projectMSKs "Cyan"
    
    # 7. Check ElastiCache Clusters
    $caches = aws elasticache describe-cache-clusters | ConvertFrom-Json
    $projectCaches = $caches.CacheClusters | Where-Object {
        $_.CacheClusterId -like "$projectName-*-$environment*"
    }
    Write-ResourceStatus "ElastiCache Clusters" $projectCaches "DarkYellow"
    
    # 8. Check CloudWatch Log Groups
    $logGroups = aws logs describe-log-groups | ConvertFrom-Json
    $projectLogGroups = $logGroups.LogGroups | Where-Object {
        $_.LogGroupName -like "/aws/lambda/$projectName-*-$environment*"
    }
    Write-ResourceStatus "CloudWatch Log Groups" $projectLogGroups "DarkCyan"

    if ($cleanup) {
        Write-Host "`nWould you like to clean up these resources? (y/n)" -ForegroundColor Red
        $confirm = Read-Host
        if ($confirm -eq 'y') {
            Write-Host "`nCleaning up resources..." -ForegroundColor Red
            
            # Clean up in reverse order of creation
            foreach ($lg in $projectLogGroups) {
                Write-Host "Deleting log group: $($lg.LogGroupName)" -ForegroundColor Yellow
                aws logs delete-log-group --log-group-name $lg.LogGroupName
            }
            
            foreach ($lambda in $projectLambdas) {
                Write-Host "Deleting lambda: $($lambda.FunctionName)" -ForegroundColor Yellow
                aws lambda delete-function --function-name $lambda.FunctionName
            }
            
            # Run the security group cleanup script
            Write-Host "Cleaning up security groups..." -ForegroundColor Yellow
            & "$PSScriptRoot/cleanup-security-groups.ps1" -projectName $projectName -environment $environment
            
            foreach ($role in $projectRoles) {
                Write-Host "Cleaning up role: $($role.RoleName)" -ForegroundColor Yellow
                $policies = aws iam list-role-policies --role-name $role.RoleName | ConvertFrom-Json
                foreach ($policy in $policies.PolicyNames) {
                    aws iam delete-role-policy --role-name $role.RoleName --policy-name $policy
                }
                aws iam delete-role --role-name $role.RoleName
            }
            
            Write-Host "Resource cleanup completed" -ForegroundColor Green
        }
    }
}
catch {
    Write-Error "Error checking resources: $_"
    exit 1
} 