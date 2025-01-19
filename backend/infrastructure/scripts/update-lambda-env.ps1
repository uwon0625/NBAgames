param (
    [string]$projectName = "nba-live",
    [string]$environment = "dev"
)

# Get or create SQS queue
$queueUrl = aws sqs get-queue-url `
    --queue-name "$projectName-updates-$environment" `
    --query 'QueueUrl' `
    --output text

if (-not $queueUrl) {
    $queueUrl = aws sqs create-queue `
        --queue-name "$projectName-updates-$environment" `
        --query 'QueueUrl' `
        --output text
}

# Update Lambda functions
aws lambda update-function-configuration `
    --function-name "$projectName-game-update-$environment" `
    --environment "Variables={
        SQS_QUEUE_URL=$queueUrl,
        USE_SQS=true,
        USE_MSK=false
    }"

aws lambda update-function-configuration `
    --function-name "$projectName-box-score-$environment" `
    --environment "Variables={
        SQS_QUEUE_URL=$queueUrl,
        USE_SQS=true,
        USE_MSK=false
    }"

Write-Host "Lambda environment variables updated successfully" 