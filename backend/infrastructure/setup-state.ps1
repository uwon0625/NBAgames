# AWS S3 bucket for Terraform state
$BUCKET_NAME = "nba-live-terraform-state"
$REGION = "us-east-1"

Write-Host "Creating S3 bucket for Terraform state..."

# Create S3 bucket
aws s3api create-bucket --bucket $BUCKET_NAME --region $REGION

# Enable versioning
aws s3api put-bucket-versioning `
    --bucket $BUCKET_NAME `
    --versioning-configuration Status=Enabled

# Enable encryption
aws s3api put-bucket-encryption `
    --bucket $BUCKET_NAME `
    --server-side-encryption-configuration '{
        "Rules": [
            {
                "ApplyServerSideEncryptionByDefault": {
                    "SSEAlgorithm": "AES256"
                }
            }
        ]
    }'

# Block public access
aws s3api put-public-access-block `
    --bucket $BUCKET_NAME `
    --public-access-block-configuration '{
        "BlockPublicAcls": true,
        "IgnorePublicAcls": true,
        "BlockPublicPolicy": true,
        "RestrictPublicBuckets": true
    }'

# Create DynamoDB table for state locking
Write-Host "Creating DynamoDB table for state locking..."

aws dynamodb create-table `
    --table-name terraform-state-lock `
    --attribute-definitions AttributeName=LockID,AttributeType=S `
    --key-schema AttributeName=LockID,KeyType=HASH `
    --billing-mode PAY_PER_REQUEST `
    --region $REGION

Write-Host "DynamoDB table created successfully."

Write-Host "S3 bucket created and configured successfully."
Write-Host "You can now run 'terraform init'" 