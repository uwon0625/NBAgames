import { 
  IAMClient, 
  CreatePolicyCommand,
  AttachUserPolicyCommand,
  DetachUserPolicyCommand,
  GetPolicyCommand
} from '@aws-sdk/client-iam';
import { logger } from '../../backend/src/config/logger';
import * as fs from 'fs';
import * as path from 'path';

const iam = new IAMClient({ region: process.env.AWS_REGION });

const POLICY_FILES = [
  { name: 'nba-live-ec2-policy', file: 'ec2-permissions.json' },
  { name: 'nba-live-kafka-policy', file: 'kafka-permissions.json' },
  { name: 'nba-live-lambda-policy', file: 'lambda-permissions.json' },
  { name: 'nba-live-storage-policy', file: 'storage-permissions.json' }
];

async function createOrUpdatePolicy(policyName: string, policyDocument: string, userName: string, accountId: string) {
  try {
    // Try to create new policy
    const createPolicyResponse = await iam.send(new CreatePolicyCommand({
      PolicyName: policyName,
      PolicyDocument: policyDocument
    }));

    logger.info(`Created new policy: ${policyName}`);
    return createPolicyResponse.Policy?.Arn;

  } catch (error: any) {
    if (error.name === 'EntityAlreadyExists') {
      // Policy exists, get its ARN
      const policyArn = `arn:aws:iam::${accountId}:policy/${policyName}`;
      logger.info(`Policy ${policyName} already exists`);
      return policyArn;
    }
    throw error;
  }
}

async function updateIAMPolicy() {
  try {
    const userName = process.env.AWS_USER_NAME || 'dev3';
    const accountId = process.env.AWS_ACCOUNT_ID;

    if (!accountId) {
      throw new Error('AWS_ACCOUNT_ID environment variable is required');
    }

    // Process each policy file
    for (const policy of POLICY_FILES) {
      const policyDocument = fs.readFileSync(
        path.join(__dirname, '..', 'policies', policy.file),
        'utf-8'
      );

      // Create or update the policy
      const policyArn = await createOrUpdatePolicy(
        policy.name,
        policyDocument,
        userName,
        accountId
      );

      if (!policyArn) {
        throw new Error(`Failed to get policy ARN for ${policy.name}`);
      }

      // Detach existing policy if it exists
      try {
        await iam.send(new DetachUserPolicyCommand({
          UserName: userName,
          PolicyArn: policyArn
        }));
      } catch (error) {
        logger.debug(`Policy ${policy.name} was not attached`);
      }

      // Attach policy to user
      await iam.send(new AttachUserPolicyCommand({
        UserName: userName,
        PolicyArn: policyArn
      }));

      logger.info(`Policy ${policy.name} attached to user ${userName}`);
    }

    logger.info('All IAM policies updated successfully');

  } catch (error) {
    logger.error('Failed to update IAM policies:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  updateIAMPolicy()
    .catch(() => process.exit(1));
}

export { updateIAMPolicy }; 