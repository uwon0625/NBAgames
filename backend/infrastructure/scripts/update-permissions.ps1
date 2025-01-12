# Load environment variables from .env file
$envContent = Get-Content -Path (Join-Path $PSScriptRoot "../../.env") -ErrorAction SilentlyContinue
if ($null -eq $envContent) {
    Write-Host "Warning: .env file not found, using default values"
} else {
    foreach ($line in $envContent) {
        if ($line -match '^([^=]+)=(.*)$') {
            $key = $matches[1]
            $value = $matches[2]
            [Environment]::SetEnvironmentVariable($key, $value)
        }
    }
}

# Set variables
$POLICY_NAME = "nba-live-dev-permissions"
$USER_NAME = "dev3"
$ACCOUNT_ID = "886436930781"
$POLICY_JSON_PATH = Join-Path $PSScriptRoot "../policies/dev-permissions.json"

Write-Host "Checking IAM permissions..."

# Test if we can create policies
$canCreatePolicy = $false
try {
    aws iam get-user
    if ($LASTEXITCODE -eq 0) {
        $canCreatePolicy = $true
    }
} catch {
    Write-Host "Limited IAM permissions detected, using alternative approach"
}

if ($canCreatePolicy) {
    try {
        # Create the policy
        $POLICY_ARN = aws iam create-policy `
            --policy-name $POLICY_NAME `
            --policy-document file://$POLICY_JSON_PATH `
            --query 'Policy.Arn' `
            --output text

        if ($LASTEXITCODE -eq 0) {
            Write-Host "Policy created successfully: $POLICY_ARN"
        }
    } catch {
        # If policy already exists, get its ARN
        $POLICY_ARN = "arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"
        Write-Host "Using existing policy: $POLICY_ARN"
    }

    # Remove existing policy if attached
    try {
        aws iam detach-user-policy `
            --user-name $USER_NAME `
            --policy-arn $POLICY_ARN
        Write-Host "Detached existing policy (if any)"
    } catch {
        Write-Host "No existing policy to detach"
    }

    # Attach the new policy
    Write-Host "Attaching policy to user $USER_NAME..."
    aws iam attach-user-policy `
        --user-name $USER_NAME `
        --policy-arn $POLICY_ARN
} else {
    # Alternative approach: Display instructions
    Write-Host "Please ask your AWS administrator to:"
    Write-Host "1. Create a policy using this JSON:"
    Write-Host "   $POLICY_JSON_PATH"
    Get-Content $POLICY_JSON_PATH | Write-Host
    Write-Host "`n2. Attach the policy to user: $USER_NAME"
    Write-Host "`nThen run the permissions test manually using:"
    Write-Host "yarn test-permissions"
    exit 0
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "Permissions updated successfully"
    Write-Host "Running permissions test..."
    Push-Location ..
    yarn test-permissions
    Pop-Location
} else {
    Write-Host "Failed to attach policy"
    exit 1
} 