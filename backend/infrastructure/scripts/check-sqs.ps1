param (
    [string]$projectName = "nba-live",
    [string]$environment = "dev"
)

$queueName = "$projectName-updates-$environment"

Write-Host "Checking SQS queue status for $queueName..."

# Get queue URL
$queueUrl = aws sqs get-queue-url `
    --queue-name $queueName `
    --query 'QueueUrl' `
    --output text

if ($queueUrl) {
    # Get queue attributes
    aws sqs get-queue-attributes `
        --queue-url $queueUrl `
        --attribute-names All `
        --query 'Attributes.[QueueArn,ApproximateNumberOfMessages,CreatedTimestamp,LastModifiedTimestamp]' `
        --output table

    # Get recent messages (without removing them)
    Write-Host "`nRecent messages:"
    aws sqs receive-message `
        --queue-url $queueUrl `
        --max-number-of-messages 5 `
        --visibility-timeout 1 `
        --wait-time-seconds 1 `
        --query 'Messages[*].[MessageId,Body]' `
        --output table
} else {
    Write-Host "Queue not found. Creating..."
    aws sqs create-queue --queue-name $queueName
} 