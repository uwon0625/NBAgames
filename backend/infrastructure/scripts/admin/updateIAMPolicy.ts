import { 
  IAMClient, 
  CreatePolicyCommand,
  AttachUserPolicyCommand,
  DetachUserPolicyCommand,
  GetPolicyCommand,
  CreatePolicyVersionCommand,
  DeletePolicyVersionCommand,
  ListPolicyVersionsCommand
} from '@aws-sdk/client-iam';
import { logger } from '../../../src/config/logger';
import * as fs from 'fs';
import * as path from 'path';

const iam = new IAMClient({ region: process.env.AWS_REGION });

const POLICY_FILES = [
  { name: 'nba-live-ec2-policy', file: '../../policies/ec2-permissions.json' },
  { name: 'nba-live-kafka-policy', file: '../../policies/kafka-permissions.json' },
  { name: 'nba-live-lambda-policy', file: '../../policies/lambda-permissions.json' },
  { name: 'nba-live-storage-policy', file: '../../policies/storage-permissions.json' },
  { name: 'nba-live-eventbridge-policy', file: '../../policies/eventbridge-permissions.json' }
];

async function updatePolicyVersion(policyArn: string, policyDocument: string) {
  try {
    // List existing versions
    const versions = await iam.send(new ListPolicyVersionsCommand({
      PolicyArn: policyArn
    }));

    // If we have 5 versions (max limit), delete the oldest non-default version
    if (versions.Versions?.length === 5) {
      const oldestNonDefault = versions.Versions
        .filter(v => !v.IsDefaultVersion)
        .sort((a, b) => (a.CreateDate?.getTime() || 0) - (b.CreateDate?.getTime() || 0))[0];

      if (oldestNonDefault.VersionId) {
        await iam.send(new DeletePolicyVersionCommand({
          PolicyArn: policyArn,
          VersionId: oldestNonDefault.VersionId
        }));
      }
    }

    // Create new version and set as default
    await iam.send(new CreatePolicyVersionCommand({
      PolicyArn: policyArn,
      PolicyDocument: policyDocument,
      SetAsDefault: true
    }));

    logger.info(`Updated policy version: ${policyArn}`);
  } catch (error) {
    logger.error(`Failed to update policy version: ${policyArn}`, error);
    throw error;
  }
}

async function createOrUpdatePolicy(policyName: string, policyDocument: string, userName: string, accountId: string) {
  try {
    const policyArn = `arn:aws:iam::${accountId}:policy/${policyName}`;

    try {
      // Check if policy exists
      await iam.send(new GetPolicyCommand({
        PolicyArn: policyArn
      }));

      // Policy exists, update its version
      logger.info(`Updating policy ${policyName} with document:`, policyDocument);
      await updatePolicyVersion(policyArn, policyDocument);
      return policyArn;

    } catch (error: any) {
      // Handle both NoSuchEntity and any other error that indicates policy doesn't exist
      if (error.name === 'NoSuchEntity' || error.message.includes('was not found')) {
        // Policy doesn't exist, create new
        logger.info(`Creating new policy ${policyName} with document:`, policyDocument);
        const createPolicyResponse = await iam.send(new CreatePolicyCommand({
          PolicyName: policyName,
          PolicyDocument: policyDocument
        }));

        if (!createPolicyResponse.Policy?.Arn) {
          throw new Error(`Failed to create policy ${policyName}`);
        }

        logger.info(`Created new policy: ${policyName}`);
        return createPolicyResponse.Policy.Arn;
      }
      throw error;
    }
  } catch (error) {
    logger.error(`Failed to create/update policy ${policyName}:`, error);
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
        path.join(__dirname, policy.file),
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
        
        // Add small delay after detaching
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        logger.debug(`Policy ${policy.name} was not attached`);
      }

      // Attach policy to user
      await iam.send(new AttachUserPolicyCommand({
        UserName: userName,
        PolicyArn: policyArn
      }));

      logger.info(`Policy ${policy.name} attached to user ${userName}`);
      
      // Add small delay after attaching
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    logger.info('All IAM policies updated successfully');
    logger.info('Waiting for policy changes to propagate...');
    await new Promise(resolve => setTimeout(resolve, 15000));

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