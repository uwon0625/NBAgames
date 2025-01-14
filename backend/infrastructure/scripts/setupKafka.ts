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
async function waitForClusterActive(clusterArn: string, maxAttempts = 60): Promise<boolean> {
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

    // Wait 30 seconds before next check
    await new Promise(resolve => setTimeout(resolve, 30000));
  }

  throw new Error('Timeout waiting for cluster to become active');
}

export async function setupKafka() {
  try {
    const clusterName = process.env.MSK_CLUSTER_NAME;
    const vpcId = process.env.VPC_ID;
    const subnet1 = process.env.SUBNET_1;
    const subnet2 = process.env.SUBNET_2;
    const subnet3 = process.env.SUBNET_3;
    const securityGroupName = process.env.SECURITY_GROUP;
    logger.info('Environment variables:', {
      clusterName,
      vpcId,
      subnet1,
      securityGroupName,
      envPath
    });

    // Validate all required environment variables
    if (!clusterName || !vpcId || !subnet1 || !subnet2 || !subnet3 || !securityGroupName) {
      throw new Error(
        'Missing required environment variables. Please ensure the following are set:\n' +
        '- MSK_CLUSTER_NAME\n' +
        '- VPC_ID\n' +
        '- SUBNET_1\n' +
        '- SUBNET_2\n' +
        '- SUBNET_3\n' +
        '- SECURITY_GROUP'
      );
    }

    // Check if cluster already exists
    const existingCluster = await getExistingCluster(clusterName);
    if (existingCluster) {
      logger.info(`MSK cluster '${clusterName}' already exists`);
      
      // Wait for cluster to be active even if it exists
      if (existingCluster.State !== 'ACTIVE') {
        logger.info(`Cluster exists but is in ${existingCluster.State} state`);
        if (!existingCluster.ClusterArn) {
          throw new Error('Existing cluster ARN not found');
        }
        await waitForClusterActive(existingCluster.ClusterArn);
      }
      
      // Get bootstrap brokers
      const brokersResponse = await kafka.send(new GetBootstrapBrokersCommand({
        ClusterArn: existingCluster.ClusterArn!
      }));

      const brokers = brokersResponse.BootstrapBrokerString;
      if (brokers) {
        logger.info('Bootstrap brokers:', brokers);
      }

      return existingCluster.ClusterArn;
    }

    // Get the security group ID
    const securityGroupId = await getSecurityGroupId(securityGroupName);
    logger.info(`Using security group: ${securityGroupName} (${securityGroupId})`);

    // Create or get KMS key
    const kmsKeyId = await createKMSKey();
    logger.info('Using KMS key:', kmsKeyId);

    // Create MSK configuration
    const configName = `${clusterName}-config`;
    const existingConfig = await getExistingConfiguration(configName);
    
    let configArn: string | undefined;
    if (existingConfig) {
      logger.info(`Using existing configuration: ${configName}`);
      configArn = existingConfig.Arn;
    } else {
      const serverProperties = Buffer.from(`
        auto.create.topics.enable=true
        default.replication.factor=3
        min.insync.replicas=2
        num.partitions=3
      `.trim());

      const configResponse = await kafka.send(new CreateConfigurationCommand({
        Name: configName,
        ServerProperties: serverProperties
      }));
      configArn = configResponse.Arn;
      logger.info(`Created new configuration: ${configName}`);
    }

    if (!configArn) {
      throw new Error('Failed to get or create configuration');
    }

    // Create MSK cluster
    const createClusterResponse = await kafka.send(new CreateClusterCommand({
      ClusterName: clusterName,
      KafkaVersion: '2.8.1',
      NumberOfBrokerNodes: 3,
      BrokerNodeGroupInfo: {
        InstanceType: 'kafka.t3.small',
        ClientSubnets: [subnet1, subnet2, subnet3],
        StorageInfo: {
          EbsStorageInfo: {
            VolumeSize: 100
          }
        },
        SecurityGroups: [securityGroupId]
      },
      EncryptionInfo: {
        EncryptionAtRest: {
          DataVolumeKMSKeyId: kmsKeyId
        },
        EncryptionInTransit: {
          ClientBroker: 'TLS',
          InCluster: true
        }
      },
      ConfigurationInfo: {
        Arn: configArn,
        Revision: 1
      },
      EnhancedMonitoring: 'DEFAULT'
    }));

    const clusterArn = createClusterResponse.ClusterArn;
    if (!clusterArn) {
      throw new Error('Failed to get cluster ARN');
    }

    logger.info('MSK cluster creation initiated:', clusterArn);
    logger.info('Waiting for cluster to become active (this may take 15-20 minutes)...');

    // Wait for cluster to become active
    await waitForClusterActive(clusterArn);
    
    // Now get bootstrap brokers
    const brokersResponse = await kafka.send(new GetBootstrapBrokersCommand({
      ClusterArn: clusterArn
    }));

    const brokers = brokersResponse.BootstrapBrokerString;
    if (brokers) {
      logger.info('Bootstrap brokers:', brokers);
      // You might want to save this to your .env file or elsewhere
    }

    logger.info('MSK setup completed successfully');
    return clusterArn;
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