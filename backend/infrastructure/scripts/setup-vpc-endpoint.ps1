param (
    [string]$projectName = "nba-live",
    [string]$environment = "dev"
)

# Create VPC endpoint for MSK
aws ec2 create-vpc-endpoint `
    --vpc-id $env:VPC_ID `
    --vpc-endpoint-type Interface `
    --service-name "com.amazonaws.$env:AWS_REGION.kafka" `
    --subnet-ids $env:SUBNET_1 $env:SUBNET_2 $env:SUBNET_3 `
    --security-group-ids (aws ec2 describe-security-groups `
        --query "SecurityGroups[?GroupName=='$projectName-msk-$environment'].GroupId" `
        --output text)

# Update Lambda VPC config
aws lambda update-function-configuration `
    --function-name "$projectName-game-update-$environment" `
    --vpc-config "SubnetIds=$env:SUBNET_1,$env:SUBNET_2,$env:SUBNET_3,SecurityGroupIds=$env:SECURITY_GROUP_ID" 