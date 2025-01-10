# Check specific S3 bucket permissions
Write-Host "Checking S3 bucket permissions..."
$BUCKET_NAME = "nba-live-886436930781-dev"
aws s3api get-bucket-location --bucket $BUCKET_NAME
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Can access S3 bucket: $BUCKET_NAME"
} else {
    Write-Host "✗ Cannot access S3 bucket: $BUCKET_NAME"
}

# Check DynamoDB table permissions
Write-Host "`nChecking DynamoDB table permissions..."
$TABLE_NAME = "nba_games"
aws dynamodb describe-table --table-name $TABLE_NAME --region us-east-1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Can access DynamoDB table: $TABLE_NAME"
} else {
    Write-Host "✗ Cannot access DynamoDB table: $TABLE_NAME"
}

# Check DynamoDB GSI permissions
Write-Host "`nChecking DynamoDB GSI permissions..."
aws dynamodb query `
    --table-name $TABLE_NAME `
    --index-name StatusLastUpdatedIndex `
    --key-condition-expression "#s = :status" `
    --expression-attribute-names '{"#s":"status"}' `
    --expression-attribute-values '{":status":{"S":"LIVE"}}' `
    --region us-east-1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Can query DynamoDB GSI"
} else {
    Write-Host "✗ Cannot query DynamoDB GSI"
}

# Display current AWS identity
Write-Host "`nCurrent AWS identity:"
aws sts get-caller-identity 