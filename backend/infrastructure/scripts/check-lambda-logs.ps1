param (
    [string]$projectName = "nba-live",
    [string]$environment = "dev",
    [string]$function = "game-update",
    [switch]$tail
)

$functionName = "$projectName-$function-$environment"
$logGroupName = "/aws/lambda/$functionName"

if ($tail) {
    Write-Host "Tailing logs for $functionName..."
    aws logs tail $logGroupName --follow
} else {
    Write-Host "Getting recent logs for $functionName..."
    aws logs get-log-events `
        --log-group-name $logGroupName `
        --log-stream-name (aws logs describe-log-streams `
            --log-group-name $logGroupName `
            --order-by LastEventTime `
            --descending `
            --max-items 1 `
            --query 'logStreams[0].logStreamName' `
            --output text) `
        --limit 25 `
        --query 'events[*].[timestamp,message]' `
        --output table
} 