#!/bin/bash

# Load environment variables
source ../.env

# Set variables
POLICY_NAME="nba-live-dev-permissions"
USER_NAME="dev3"
ACCOUNT_ID="886436930781"

echo "Creating comprehensive permissions policy..."

# Create the policy
POLICY_ARN=$(aws iam create-policy \
  --policy-name $POLICY_NAME \
  --policy-document file://policies/dev-permissions.json \
  --query 'Policy.Arn' \
  --output text)

if [ $? -eq 0 ]; then
  echo "Policy created successfully: $POLICY_ARN"
else
  # If policy already exists, get its ARN
  POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"
  echo "Using existing policy: $POLICY_ARN"
fi

# Remove existing policy if attached
aws iam detach-user-policy \
  --user-name $USER_NAME \
  --policy-arn $POLICY_ARN

# Attach the new policy
echo "Attaching policy to user $USER_NAME..."
aws iam attach-user-policy \
  --user-name $USER_NAME \
  --policy-arn $POLICY_ARN

if [ $? -eq 0 ]; then
  echo "Permissions updated successfully"
  echo "Running permissions test..."
  cd ..
  yarn test-permissions
else
  echo "Failed to attach policy"
  exit 1
fi 