# NBA Live Infrastructure Setup

This guide explains how to set up the AWS infrastructure for the NBA Live application.

## Prerequisites

1. AWS CLI installed and configured
2. AWS Account with appropriate permissions
3. Environment variables set up

## Environment Setup

1. Create `.env` file from example:

```bash
cp .env.example .env
```

2. Update `.env` with your credentials:

```env
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_ACCOUNT_ID=your_account_id_here

# Stack Configuration
STACK_NAME=nba-live
ENVIRONMENT=development
```

## DynamoDB Table Deployment

1. Deploy the DynamoDB table:

```bash
npm run deploy
```

This creates:
- Table Name: nba-games
- Partition Key: date (String)
- Sort Key: type (String)
- TTL Field: ttl

2. Verify deployment:

```bash
npm run describe
```

## Testing the Setup

1. Test writing to DynamoDB:

```bash
# Windows CMD
aws dynamodb put-item --table-name nba-games --item "{\"date\":{\"S\":\"2025-01-02\"},\"type\":{\"S\":\"test\"},\"ttl\":{\"N\":\"1704235200\"}}"

# PowerShell
aws dynamodb put-item --table-name nba-games --item '{\"date\":{\"S\":\"2025-01-02\"},\"type\":{\"S\":\"test\"},\"ttl\":{\"N\":\"1704235200\"}}'
```

2. Test reading from DynamoDB:

```bash
# Windows CMD
aws dynamodb get-item --table-name nba-games --key "{\"date\":{\"S\":\"2025-01-02\"},\"type\":{\"S\":\"test\"}}"

# PowerShell
aws dynamodb get-item --table-name nba-games --key '{\"date\":{\"S\":\"2025-01-02\"},\"type\":{\"S\":\"test\"}}'
```

## Files Overview

- `template.yaml`: CloudFormation template for DynamoDB table
- `.env`: Environment variables (not in git)
- `.env.example`: Example environment variables
- `package.json`: NPM scripts for deployment

## Required IAM Permissions

The IAM user needs these permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "dynamodb:CreateTable",
                "dynamodb:DeleteTable",
                "dynamodb:DescribeTable",
                "dynamodb:PutItem",
                "dynamodb:GetItem",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem",
                "cloudformation:CreateStack",
                "cloudformation:DeleteStack",
                "cloudformation:DescribeStacks",
                "cloudformation:UpdateStack",
                "cloudformation:ListStacks"
            ],
            "Resource": "*"
        }
    ]
}
```

## Cleanup

To remove all resources:

```bash
aws cloudformation delete-stack --stack-name nba-live --region us-east-1
```
