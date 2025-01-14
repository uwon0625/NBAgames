Write-Host "Starting AWS resources cleanup..." -ForegroundColor Green

# 1. Clean up EventBridge Rules
Write-Host "`nCleaning up EventBridge rules..." -ForegroundColor Cyan
$rulesOutput = aws events list-rules --name-prefix "nba-" --query 'Rules[].Name' --output text
if ($rulesOutput -and $rulesOutput -ne "None") {
    foreach ($rule in $rulesOutput.Split()) {
        if ($rule) {
            # Get and remove targets first
            $targetsOutput = aws events list-targets-by-rule --rule $rule --query 'Targets[].Id' --output text
            if ($targetsOutput -and $targetsOutput -ne "None") {
                Write-Host "Removing targets for rule: $rule" -ForegroundColor Yellow
                aws events remove-targets --rule $rule --ids $targetsOutput
            }
            
            # Now delete the rule
            Write-Host "Deleting rule: $rule" -ForegroundColor Yellow
            aws events delete-rule --name $rule
        }
    }
} else {
    Write-Host "No EventBridge rules found" -ForegroundColor Yellow
}

# 2. Clean up Lambda Functions
Write-Host "`nCleaning up Lambda functions..." -ForegroundColor Cyan
$functionsOutput = aws lambda list-functions --query "Functions[?contains(FunctionName, 'nba-live')].FunctionName" --output text
if ($functionsOutput -and $functionsOutput -ne "None") {
    foreach ($function in $functionsOutput.Split()) {
        if ($function) {
            Write-Host "Deleting function: $function" -ForegroundColor Yellow
            aws lambda delete-function --function-name $function
        }
    }
} else {
    Write-Host "No Lambda functions found" -ForegroundColor Yellow
}

# 3. Clean up DynamoDB Tables
Write-Host "`nCleaning up DynamoDB tables..." -ForegroundColor Cyan
$tablesOutput = aws dynamodb list-tables --query "TableNames[?contains(@, 'nba_')]" --output text
if ($tablesOutput -and $tablesOutput -ne "None") {
    foreach ($table in $tablesOutput.Split()) {
        if ($table) {
            Write-Host "Deleting table: $table" -ForegroundColor Yellow
            aws dynamodb delete-table --table-name $table
        }
    }
} else {
    Write-Host "No DynamoDB tables found" -ForegroundColor Yellow
}

# 4. Clean up S3 Buckets
Write-Host "`nCleaning up S3 buckets..." -ForegroundColor Cyan
$bucket = "nba-live-886436930781-dev"

# Check if bucket exists first
$bucketExists = aws s3api head-bucket --bucket $bucket 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Emptying bucket: $bucket" -ForegroundColor Yellow
    aws s3 rm s3://$bucket --recursive
    
    Write-Host "Deleting bucket: $bucket" -ForegroundColor Yellow
    aws s3api delete-bucket --bucket $bucket
} else {
    Write-Host "Bucket $bucket does not exist" -ForegroundColor Yellow
}

Write-Host "`nCleanup completed!" -ForegroundColor Green 