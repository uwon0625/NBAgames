import dotenv from 'dotenv';
import { 
  EC2Client, 
  CreateSecurityGroupCommand,
  DescribeSecurityGroupsCommand,
  SecurityGroup
} from '@aws-sdk/client-ec2';
import { logger } from '../../src/config/logger';

// Load environment variables from .env file
dotenv.config({ path: '../../.env' });

const ec2 = new EC2Client({ region: process.env.AWS_REGION });

const SECURITY_GROUP_NAME = process.env.SECURITY_GROUP || 'nba-live-security-group';

async function getExistingSecurityGroup(vpcId: string): Promise<SecurityGroup | undefined> {
  try {
    const response = await ec2.send(new DescribeSecurityGroupsCommand({
      Filters: [
        {
          Name: 'group-name',
          Values: [SECURITY_GROUP_NAME]
        },
        {
          Name: 'vpc-id',
          Values: [vpcId]
        }
      ]
    }));

    return response.SecurityGroups?.[0];
  } catch (error) {
    logger.error('Error checking existing security group:', error);
    return undefined;
  }
}

export async function setupSecurityGroups() {
  try {
    const vpcId = process.env.VPC_ID;
    if (!vpcId) {
      throw new Error('VPC_ID environment variable is required');
    }

    // Check if security group already exists
    const existingGroup = await getExistingSecurityGroup(vpcId);
    if (existingGroup) {
      logger.info(`Security group '${SECURITY_GROUP_NAME}' already exists with ID: ${existingGroup.GroupId}`);
      return existingGroup.GroupId;
    }

    // Create new security group if it doesn't exist
    logger.info(`Creating new security group '${SECURITY_GROUP_NAME}'...`);
    const response = await ec2.send(new CreateSecurityGroupCommand({
      GroupName: SECURITY_GROUP_NAME,
      Description: 'Security group for NBA Live application',
      VpcId: vpcId
    }));

    logger.info('Security group created:', response.GroupId);
    return response.GroupId;
  } catch (error) {
    logger.error('Failed to setup security group:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  setupSecurityGroups()
    .catch(() => process.exit(1));
} 