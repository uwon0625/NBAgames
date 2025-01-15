import { 
  KafkaClient, 
  CreateClusterCommand,
  GetBootstrapBrokersCommand,
  CreateConfigurationCommand,
  ListClustersCommand,
  DescribeClusterCommand,
  DeleteClusterCommand,
  ListConfigurationsCommand
} from '@aws-sdk/client-kafka';
import { 
  KMSClient, 
  CreateKeyCommand, 
  CreateAliasCommand,
  DescribeKeyCommand 
} from '@aws-sdk/client-kms';
import { EC2Client, DescribeSecurityGroupsCommand } from '@aws-sdk/client-ec2';
import { logger } from '../../src/config/logger';
import dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs';

const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const kafka = new KafkaClient({ region: process.env.AWS_REGION });
const kms = new KMSClient({ region: process.env.AWS_REGION });
const ec2 = new EC2Client({ region: process.env.AWS_REGION });

// Add function to get security group ID
async function getSecurityGroupId(groupName: string): Promise<string> {
  try {
    const response = await ec2.send(new DescribeSecurityGroupsCommand({
      Filters: [
        {
          Name: 'group-name',
          Values: [groupName]
        }
      ]
    }));

    const securityGroup = response.SecurityGroups?.[0];
    if (!securityGroup?.GroupId) {
      throw new Error(`Security group '${groupName}' not found`);
    }

    return securityGroup.GroupId;
  } catch (error) {
    logger.error('Error getting security group ID:', error);
    throw error;
  }
}

async function createKMSKey() {
  try {
    // Create KMS key
    const createKeyResponse = await kms.send(new CreateKeyCommand({
      Description: 'KMS key for MSK cluster encryption',
      KeyUsage: 'ENCRYPT_DECRYPT',
      Origin: 'AWS_KMS',
      MultiRegion: false,
      Tags: [{
        TagKey: 'Purpose',
        TagValue: 'MSK-Encryption'
      }]
    }));

    const keyId = createKeyResponse.KeyMetadata?.KeyId;
    if (!keyId) throw new Error('Failed to create KMS key');

    // Create an alias for the key
    const aliasName = 'alias/msk-encryption-key';
    await kms.send(new CreateAliasCommand({
      AliasName: aliasName,
      TargetKeyId: keyId
    }));

    logger.info(`Created KMS key with ID: ${keyId}`);
    return keyId;
  } catch (error: any) {
    if (error.name === 'AlreadyExistsException') {
      // If alias exists, get the key ID
      const describeKeyResponse = await kms.send(new DescribeKeyCommand({
        KeyId: 'alias/msk-encryption-key'
      }));
      return describeKeyResponse.KeyMetadata?.KeyId;
    }
    throw error;
  }
}

// Add function to check if cluster exists
async function getExistingCluster(clusterName: string) {
  try {
    const response = await kafka.send(new ListClustersCommand({}));
    const cluster = response.ClusterInfoList?.find(
      cluster => cluster.ClusterName === clusterName
    );

    if (cluster) {
      // Get detailed cluster information
      const details = await kafka.send(new DescribeClusterCommand({
        ClusterArn: cluster.ClusterArn
      }));
      return details.ClusterInfo;
    }
    return null;
  } catch (error) {
    logger.error('Error checking existing cluster:', error);
    throw error;
  }
}

// Add function to check if configuration exists
async function getExistingConfiguration(configName: string) {
  try {
    const response = await kafka.send(new ListConfigurationsCommand({}));
    return response.Configurations?.find(
      config => config.Name === configName
    );
  } catch (error) {
    logger.error('Error checking existing configuration:', error);
    throw error;
  }
}

// Add wait function to check cluster state
async function waitForClusterActive(clusterArn: string, maxAttempts = 90): Promise<boolean> {
  logger.info('Waiting for cluster to become active...');
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await kafka.send(new DescribeClusterCommand({
      ClusterArn: clusterArn
    }));

    const state = response.ClusterInfo?.State;
    logger.info(`Cluster state: ${state} (attempt ${attempt + 1}/${maxAttempts})`);

    if (state === 'ACTIVE') {
      return true;
    }

    if (state === 'FAILED') {
      throw new Error('Cluster creation failed');
    }

    // Wait 1 minute before next check
    await new Promise(resolve => setTimeout(resolve, 60000));
  }

  throw new Error('Timeout waiting for cluster to become active');
}

async function waitForClusterDeletion(clusterArn: string): Promise<void> {
  const maxAttempts = 90;
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const response = await kafka.send(new DescribeClusterCommand({
        ClusterArn: clusterArn
      }));
      
      if (!response.ClusterInfo) {
        // Cluster no longer exists
        return;
      }

      logger.info(`Cluster state: ${response.ClusterInfo.State} (attempt ${attempts + 1}/${maxAttempts})`);
      
      if (response.ClusterInfo.State === 'DELETING') {
        await new Promise(resolve => setTimeout(resolve, 60000));
        attempts++;
        continue;
      }
    } catch (error: any) {
      if (error.name === 'NotFoundException') {
        // Cluster has been deleted
        return;
      }
      throw error;
    }
  }

  throw new Error('Timeout waiting for cluster deletion');
}

async function updateBrokerEndpoints(clusterArn: string): Promise<void> {
  try {
    // Get the broker endpoints
    const brokersResponse = await kafka.send(new GetBootstrapBrokersCommand({
      ClusterArn: clusterArn
    }));

    const brokers = brokersResponse.BootstrapBrokerString;
    if (!brokers) {
      throw new Error('Failed to get broker endpoints');
    }

    logger.info(`Got broker endpoints: ${brokers}`);

    // Update .env file
    const envPath = path.resolve(__dirname, '../../.env');
    let envContent = fs.readFileSync(envPath, 'utf8');

    // Replace or add KAFKA_BROKERS
    if (envContent.includes('KAFKA_BROKERS=')) {
      envContent = envContent.replace(
        /KAFKA_BROKERS=.*/,
        `KAFKA_BROKERS=${brokers}`
      );
    } else {
      envContent += `\nKAFKA_BROKERS=${brokers}`;
    }

    fs.writeFileSync(envPath, envContent);
    logger.info(`Updated .env with Kafka broker endpoints: ${brokers}`);

  } catch (error) {
    logger.error('Failed to update broker endpoints:', error);
    throw error;
  }
}

export async function setupKafka() {
  try {
    const clusterName = process.env.MSK_CLUSTER_NAME || 'nba-live-kafka';
    const securityGroupName = process.env.SECURITY_GROUP_NAME || 'nba-live-security-group';

    // Get security group ID first
    const securityGroupId = await getSecurityGroupId(securityGroupName);
    logger.info(`Got security group ID: ${securityGroupId}`);

    logger.info('Environment variables:', {
      clusterName,
      vpcId: process.env.VPC_ID,
      subnet1: process.env.SUBNET_1,
      securityGroupId,
      envPath: path.resolve(__dirname, '../.env')
    });

    // Check if cluster exists
    const existingClusters = await kafka.send(new ListClustersCommand({
      ClusterNameFilter: clusterName
    }));

    if (existingClusters.ClusterInfoList && existingClusters.ClusterInfoList.length > 0) {
      const cluster = existingClusters.ClusterInfoList[0];
      logger.info(`MSK cluster '${clusterName}' already exists`);

      if (cluster.State === 'DELETING') {
        logger.info('Cluster exists but is in DELETING state');
        logger.info('Waiting for deletion to complete...');
        await waitForClusterDeletion(cluster.ClusterArn!);
        logger.info('Cluster deletion completed');
      } else if (cluster.State === 'ACTIVE') {
        // Update broker endpoints in .env
        await updateBrokerEndpoints(cluster.ClusterArn!);
        return;
      }
    }

    // Validate required parameters
    if (!process.env.SUBNET_1 || !process.env.SUBNET_2 || !process.env.SUBNET_3) {
      throw new Error('Missing required subnet IDs');
    }

    // Create new cluster
    logger.info('Creating new MSK cluster...');
    const createResponse = await kafka.send(new CreateClusterCommand({
      ClusterName: clusterName,
      KafkaVersion: '3.4.0',
      NumberOfBrokerNodes: 3,
      BrokerNodeGroupInfo: {
        InstanceType: 'kafka.t3.small',
        ClientSubnets: [
          process.env.SUBNET_1,
          process.env.SUBNET_2,
          process.env.SUBNET_3
        ],
        SecurityGroups: [securityGroupId],
        StorageInfo: {
          EbsStorageInfo: {
            VolumeSize: 100
          }
        }
      },
      EncryptionInfo: {
        EncryptionInTransit: {
          ClientBroker: 'PLAINTEXT',
          InCluster: true
        }
      }
    }));

    if (!createResponse.ClusterArn) {
      throw new Error('Failed to get cluster ARN from create response');
    }

    logger.info('Waiting for cluster to become active...');
    await waitForClusterActive(createResponse.ClusterArn);
    
    // Update broker endpoints in .env
    await updateBrokerEndpoints(createResponse.ClusterArn);

  } catch (error) {
    logger.error('Failed to setup MSK:', error);
    throw error;
  }
}

// Add cleanup function
export async function cleanupKafka() {
  try {
    const clusterName = process.env.MSK_CLUSTER_NAME;
    if (!clusterName) {
      throw new Error('MSK_CLUSTER_NAME environment variable is required');
    }

    const existingCluster = await getExistingCluster(clusterName);
    
    if (existingCluster) {
      logger.info(`Deleting MSK cluster '${clusterName}'...`);
      await kafka.send(new DeleteClusterCommand({
        ClusterArn: existingCluster.ClusterArn
      }));
      logger.info('MSK cluster deletion initiated');
    } else {
      logger.info(`No MSK cluster found with name '${clusterName}'`);
    }
  } catch (error) {
    logger.error('Failed to cleanup MSK:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  const command = process.argv[2];
  if (command === 'cleanup') {
    cleanupKafka()
      .catch(() => process.exit(1));
  } else {
    setupKafka()
      .catch(() => process.exit(1));
  }
} 