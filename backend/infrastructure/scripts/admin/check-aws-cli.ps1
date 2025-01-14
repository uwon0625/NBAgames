Write-Host "Checking AWS CLI permissions..." -ForegroundColor Green

# Check AWS CLI configuration
Write-Host "`n1. AWS CLI Configuration:" -ForegroundColor Cyan
aws configure list
aws sts get-caller-identity

# Check S3 permissions
Write-Host "`n2. S3 Permissions:" -ForegroundColor Cyan
Write-Host "Listing buckets..." -ForegroundColor Yellow
aws s3 ls
Write-Host "Checking specific bucket..." -ForegroundColor Yellow
aws s3 ls s3://nba-live-886436930781-dev 2>&1

# Check DynamoDB permissions
Write-Host "`n3. DynamoDB Permissions:" -ForegroundColor Cyan
Write-Host "Listing tables..." -ForegroundColor Yellow
aws dynamodb list-tables --region us-east-1
Write-Host "Describing specific table..." -ForegroundColor Yellow
aws dynamodb describe-table --table-name nba_games --region us-east-1 2>&1

# Check Lambda permissions
Write-Host "`n4. Lambda Permissions:" -ForegroundColor Cyan
Write-Host "Listing functions..." -ForegroundColor Yellow
aws lambda list-functions --region us-east-1
Write-Host "Checking specific function..." -ForegroundColor Yellow
aws lambda get-function --function-name nba-live-gameUpdateHandler --region us-east-1 2>&1

# Check IAM permissions
Write-Host "`n5. IAM Permissions:" -ForegroundColor Cyan
Write-Host "Getting current user..." -ForegroundColor Yellow
aws iam get-user
Write-Host "Listing policies..." -ForegroundColor Yellow
aws iam list-attached-user-policies --user-name dev3 2>&1

# Check EventBridge permissions
Write-Host "`n6. EventBridge Permissions:" -ForegroundColor Cyan
Write-Host "Listing rules..." -ForegroundColor Yellow
aws events list-rules --region us-east-1 2>&1

# Check CloudWatch Logs permissions
Write-Host "`n7. CloudWatch Logs Permissions:" -ForegroundColor Cyan
Write-Host "Listing log groups..." -ForegroundColor Yellow
aws logs describe-log-groups --region us-east-1 2>&1

Write-Host "`nPermissions check complete!" -ForegroundColor Green 