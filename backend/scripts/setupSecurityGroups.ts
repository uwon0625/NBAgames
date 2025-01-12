import { 
  EC2Client, 
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  DescribeSecurityGroupsCommand
} from '@aws-sdk/client-ec2';
import { logger } from '../src/config/logger';
import dotenv from 'dotenv';

dotenv.config();

const ec2 = new EC2Client({ region: process.env.AWS_REGION });

async function setupKafkaSecurityGroups(): Promise<string | undefined> {
  try {
    // First create the MSK security group
    const createSgCommand = new CreateSecurityGroupCommand({
      GroupName: 'msk-security-group',
      Description: 'Security group for MSK cluster',
      VpcId: process.env.VPC_ID, // Make sure this is in your .env file
    });

    const { GroupId } = await ec2.send(createSgCommand);
    
    if (!GroupId) {
      throw new Error('Failed to create security group');
    }

    logger.info(`Created security group: ${GroupId}`);

    // Add inbound rules for Kafka ports
    const ingressRules = [
      // Kafka broker listener
      {
        IpProtocol: 'tcp',
        FromPort: 9092,
        ToPort: 9092,
        IpRanges: [{ CidrIp: '0.0.0.0/0' }] // Consider restricting this in production
      },
      // TLS listener
      {
        IpProtocol: 'tcp',
        FromPort: 9094,
        ToPort: 9094,
        IpRanges: [{ CidrIp: '0.0.0.0/0' }]
      },
      // Zookeeper
      {
        IpProtocol: 'tcp',
        FromPort: 2181,
        ToPort: 2181,
        IpRanges: [{ CidrIp: '0.0.0.0/0' }]
      }
    ];

    // Add each ingress rule
    for (const rule of ingressRules) {
      await ec2.send(new AuthorizeSecurityGroupIngressCommand({
        GroupId,
        IpPermissions: [rule]
      }));
    }

    logger.info('Added inbound rules to security group');

    // Save the security group ID to environment
    process.env.MSK_SECURITY_GROUP_ID = GroupId;

    return GroupId;

  } catch (error: any) {
    if (error.name === 'InvalidGroup.Duplicate') {
      logger.info('Security group already exists, retrieving ID...');
      
      const { SecurityGroups } = await ec2.send(new DescribeSecurityGroupsCommand({
        Filters: [
          {
            Name: 'group-name',
            Values: ['msk-security-group']
          }
        ]
      }));

      if (SecurityGroups && SecurityGroups[0]) {
        process.env.MSK_SECURITY_GROUP_ID = SecurityGroups[0].GroupId;
        return SecurityGroups[0].GroupId;
      }
    }
    
    logger.error('Error setting up security groups:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  setupKafkaSecurityGroups()
    .then(groupId => {
      logger.info('Security group setup complete:', groupId);
    })
    .catch(error => {
      logger.error('Setup failed:', error);
      process.exit(1);
    });
}

export { setupKafkaSecurityGroups }; 