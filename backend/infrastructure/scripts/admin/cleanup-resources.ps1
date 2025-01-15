Write-Host "Starting AWS resources cleanup..." -ForegroundColor Green

# 1. Clean up EventBridge Rules
Write-Host "`nCleaning up EventBridge rules..." -ForegroundColor Cyan
$rulesOutput = aws events list-rules --name-prefix "nba-" --query 'Rules[].Name' --output text
if ($rulesOutput -and $rulesOutput -ne "None") {
    foreach ($rule in $rulesOutput.Split()) {
        Write-Host "Removing targets for rule: $rule" -ForegroundColor Yellow
        aws events remove-targets --rule $rule --ids $(aws events list-targets-by-rule --rule $rule --query 'Targets[].Id' --output text) 2>$null
        Write-Host "Deleting rule: $rule" -ForegroundColor Yellow
        aws events delete-rule --name $rule 2>$null
    }
}

# 2. Clean up MSK Cluster
Write-Host "`nCleaning up MSK cluster..." -ForegroundColor Cyan
$mskClusters = aws kafka list-clusters --query 'ClusterInfoList[?contains(ClusterName, `nba-live-kafka`)].{ARN:ClusterArn,Name:ClusterName,State:State}' --output json | ConvertFrom-Json
foreach ($cluster in $mskClusters) {
    Write-Host "Found MSK cluster: $($cluster.Name) (State: $($cluster.State))" -ForegroundColor Yellow
    if ($cluster.State -ne "DELETING") {
        Write-Host "Deleting MSK cluster: $($cluster.ARN)" -ForegroundColor Yellow
        aws kafka delete-cluster --cluster-arn $cluster.ARN 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Waiting for MSK cluster deletion..." -ForegroundColor Yellow
            do {
                Start-Sleep -Seconds 30
                $status = aws kafka describe-cluster --cluster-arn $cluster.ARN --query 'ClusterInfo.State' --output text 2>$null
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "Cluster status: $status"
                } else {
                    Write-Host "Cluster deleted"
                    break
                }
            } while ($status -eq "DELETING")
        }
    }
}

# 3. Clean up Redis Cluster
Write-Host "`nCleaning up Redis cluster..." -ForegroundColor Cyan
$environment = "dev"  # Or get from environment variable
$clusterId = "nba-live-redis-$environment"
Write-Host "Looking for Redis cluster: $clusterId" -ForegroundColor Yellow
$redisCluster = aws elasticache describe-cache-clusters --query "CacheClusters[?CacheClusterId=='$clusterId'].CacheClusterId" --output text
if ($redisCluster -and $redisCluster -ne "None") {
    Write-Host "Deleting Redis cluster: $redisCluster" -ForegroundColor Yellow
    aws elasticache delete-cache-cluster --cache-cluster-id $redisCluster 2>$null
    Write-Host "Waiting for Redis cluster deletion..." -ForegroundColor Yellow
    do {
        Start-Sleep -Seconds 30
        $status = aws elasticache describe-cache-clusters --cache-cluster-id $redisCluster --query 'CacheClusters[0].CacheClusterStatus' --output text 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Cluster status: $status"
        } else {
            Write-Host "Cluster deleted"
            break
        }
    } while ($status -eq "deleting")
} else {
    Write-Host "No Redis cluster found to delete" -ForegroundColor Yellow
}

# 4. Clean up Security Groups
Write-Host "`nCleaning up security groups..." -ForegroundColor Cyan
$sgOutput = aws ec2 describe-security-groups --filters "Name=group-name,Values=nba-live-*" --query 'SecurityGroups[].GroupId' --output text
if ($sgOutput -and $sgOutput -ne "None") {
    foreach ($sg in $sgOutput.Split()) {
        Write-Host "Deleting security group: $sg" -ForegroundColor Yellow
        aws ec2 delete-security-group --group-id $sg 2>$null
    }
} else {
    Write-Host "No security groups found to delete" -ForegroundColor Yellow
}

# 5. Clean up S3 Buckets
Write-Host "`nCleaning up S3 buckets..." -ForegroundColor Cyan
$bucket = "nba-live-artifacts-886436930781-dev"
$bucketExists = aws s3api head-bucket --bucket $bucket 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Emptying bucket: $bucket" -ForegroundColor Yellow
    aws s3 rm s3://$bucket --recursive
    Write-Host "Deleting bucket: $bucket" -ForegroundColor Yellow
    aws s3api delete-bucket --bucket $bucket
} else {
    Write-Host "No S3 bucket found to delete" -ForegroundColor Yellow
}

Write-Host "`nCleanup completed!" -ForegroundColor Green 