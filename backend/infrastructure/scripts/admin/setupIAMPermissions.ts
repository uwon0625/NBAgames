import { 
  IAMClient, 
  CreatePolicyCommand,
  AttachUserPolicyCommand,
  GetPolicyCommand
} from '@aws-sdk/client-iam';
import { logger } from '../../../src/config/logger';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const iam = new IAMClient({ region: process.env.AWS_REGION });

async function setupIAMPermissions() {
  try {
    const policyName = 'nba-live-cloudformation-admin';
    const userName = process.env.AWS_USER_NAME;

    if (!userName) {
      throw new Error('AWS_USER_NAME environment variable is required');
    }

    // Read policy document
    const policyDocument = fs.readFileSync(
      path.resolve(__dirname, '../../policies/cloudformation-admin-policy.json'),
      'utf8'
    );

    // Create policy if it doesn't exist
    let policyArn: string;
    try {
      const createPolicyResponse = await iam.send(new CreatePolicyCommand({
        PolicyName: policyName,
        PolicyDocument: policyDocument
      }));
      policyArn = createPolicyResponse.Policy!.Arn!;
      logger.info(`Created policy: ${policyArn}`);
    } catch (error: any) {
      if (error.name === 'EntityAlreadyExists') {
        // Get existing policy ARN
        const accountId = process.env.AWS_ACCOUNT_ID;
        policyArn = `arn:aws:iam::${accountId}:policy/${policyName}`;
        logger.info(`Using existing policy: ${policyArn}`);
      } else {
        throw error;
      }
    }

    // Attach policy to user
    await iam.send(new AttachUserPolicyCommand({
      UserName: userName,
      PolicyArn: policyArn
    }));

    logger.info(`Successfully attached policy to user ${userName}`);
  } catch (error) {
    logger.error('Failed to setup IAM permissions:', error);
    throw error;
  }
}

if (require.main === module) {
  setupIAMPermissions().catch(() => process.exit(1));
} 