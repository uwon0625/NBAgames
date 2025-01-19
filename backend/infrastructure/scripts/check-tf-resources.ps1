param (
    [string]$projectName = "nba-live",
    [string]$environment = "dev",
    [switch]$cleanup
)

# AWS CLI check commands for reference
# aws ec2 describe-security-groups --region $REGION --query 'SecurityGroups[].[GroupName,GroupId]' --output table
# aws events list-rules --query 'Rules[].[Name,EventBusName]' --output table
# aws elasticache describe-replication-groups --query 'ReplicationGroups[].[ReplicationGroupId,NodeGroupCount]' --output table
# aws dynamodb list-tables --query 'TableNames' --output table
# aws ec2 describe-instances --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name]' --output table
# aws rds describe-db-instances --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceClass,Engine]' --output table
# aws kafka list-clusters --query 'ClusterInfoList[].[ClusterName,ClusterArn,State]' --output table
# aws s3 ls
# aws lambda list-functions --query 'Functions[].[FunctionName,Description,LoggingConfig.LogGroup]' --output table
# aws cloudformation describe-stacks --query 'Stacks[].[StackName,StackStatus]' --output table

function Write-Header {
    param ([string]$title)
    Write-Host "`n=== $title ===" -ForegroundColor Cyan
}

try {
    Write-Host "Checking AWS resources for project: $projectName-$environment`n" -ForegroundColor Cyan
    
    # 1. Lambda Functions
    Write-Header "Lambda Functions"
    aws lambda list-functions `
        --query "Functions[?contains(FunctionName, '$projectName-') && contains(FunctionName, '-$environment')].[FunctionName,Description,LoggingConfig.LogGroup]" `
        --output table

    # 2. Security Groups
    Write-Header "Security Groups"
    aws ec2 describe-security-groups `
        --query "SecurityGroups[?contains(GroupName, '$projectName-') && contains(GroupName, '-$environment')].[GroupName,GroupId,VpcId]" `
        --output table

    # 3. DynamoDB Tables
    Write-Header "DynamoDB Tables"
    $tables = aws dynamodb list-tables --query "TableNames[?contains(@, '$projectName-') && contains(@, '-$environment')]" --output text
    if ($tables) {
        foreach ($table in $tables.Split()) {
            aws dynamodb describe-table `
                --table-name $table `
                --query "Table.[TableName,TableStatus,TableArn]" `
                --output table
        }
    } else {
        Write-Host "No DynamoDB tables found" -ForegroundColor Gray
    }

    # 4. CloudWatch Log Groups
    Write-Header "CloudWatch Log Groups"
    aws logs describe-log-groups `
        --query "logGroups[?contains(logGroupName, '/aws/lambda/$projectName-') && contains(logGroupName, '-$environment')].[logGroupName,retentionInDays]" `
        --output table

    # 5. IAM Roles
    Write-Header "IAM Roles"
    aws iam list-roles `
        --query "Roles[?contains(RoleName, '$projectName-') && contains(RoleName, '-$environment')].[RoleName,Arn,CreateDate]" `
        --output table

    # 6. EventBridge Rules
    Write-Header "EventBridge Rules"
    aws events list-rules `
        --query "Rules[?contains(Name, '$projectName-') && contains(Name, '-$environment')].[Name,ScheduleExpression,State]" `
        --output table

    # 7. MSK Clusters
    Write-Header "MSK Clusters"
    aws kafka list-clusters `
        --query "ClusterInfoList[?contains(ClusterName, '$projectName-') && contains(ClusterName, '-$environment')].[ClusterName,State]" `
        --output table

    # 8. ElastiCache Clusters
    Write-Header "ElastiCache Clusters"
    aws elasticache describe-cache-clusters `
        --query "CacheClusters[?contains(CacheClusterId, '$projectName-') && contains(CacheClusterId, '-$environment')].[CacheClusterId,CacheNodeType,Engine]" `
        --output table

    # 9. SQS Queues
    Write-Header "SQS Queues"
    aws sqs list-queues `
        --queue-name-prefix "$projectName-" `
        --query "QueueUrls[?contains(@, '$projectName-') && contains(@, '-$environment')]" `
        --output text | ForEach-Object {
            if ($_) {
                $queueUrl = $_
                aws sqs get-queue-attributes `
                    --queue-url $queueUrl `
                    --attribute-names All `
                    --query "[
                        QueueUrl,
                        Attributes.QueueArn,
                        Attributes.ApproximateNumberOfMessages,
                        Attributes.CreatedTimestamp
                    ]" `
                    --output table
            }
        }

    if ($cleanup) {
        Write-Host "`nWould you like to clean up these resources? (y/n)" -ForegroundColor Red
        $confirm = Read-Host
        if ($confirm -eq 'y') {
            Write-Host "`nCleaning up resources..." -ForegroundColor Red
            
            # Add SQS cleanup before Lambda cleanup
            aws sqs list-queues `
                --queue-name-prefix "$projectName-" `
                --query "QueueUrls[?contains(@, '$projectName-') && contains(@, '-$environment')]" `
                --output text | ForEach-Object {
                    if ($_) {
                        Write-Host "Deleting SQS queue: $_" -ForegroundColor Yellow
                        aws sqs delete-queue --queue-url $_
                    }
                }

            # Clean up in reverse order of creation
            # Log Groups
            aws logs describe-log-groups `
                --query "logGroups[?contains(logGroupName, '/aws/lambda/$projectName-') && contains(logGroupName, '-$environment')].logGroupName" `
                --output text | ForEach-Object {
                    if ($_) {
                        Write-Host "Deleting log group: $_" -ForegroundColor Yellow
                        aws logs delete-log-group --log-group-name $_
                    }
                }
            
            # Lambda Functions
            aws lambda list-functions `
                --query "Functions[?contains(FunctionName, '$projectName-') && contains(FunctionName, '-$environment')].FunctionName" `
                --output text | ForEach-Object {
                    if ($_) {
                        Write-Host "Deleting lambda: $_" -ForegroundColor Yellow
                        aws lambda delete-function --function-name $_
                    }
                }
            
            # Run security group cleanup script
            Write-Host "Cleaning up security groups..." -ForegroundColor Yellow
            & "$PSScriptRoot/cleanup-security-groups.ps1" -projectName $projectName -environment $environment
            
            # IAM Roles
            aws iam list-roles `
                --query "Roles[?contains(RoleName, '$projectName-') && contains(RoleName, '-$environment')].RoleName" `
                --output text | ForEach-Object {
                    if ($_) {
                        Write-Host "Cleaning up role: $_" -ForegroundColor Yellow
                        aws iam list-role-policies --role-name $_ --output text | ForEach-Object {
                            aws iam delete-role-policy --role-name $_ --policy-name $_
                        }
                        aws iam delete-role --role-name $_
                    }
                }
            
            Write-Host "Resource cleanup completed" -ForegroundColor Green
        }
    }
}
catch {
    Write-Error "Error checking resources: $_"
    exit 1
} 