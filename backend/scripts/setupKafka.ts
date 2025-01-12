import { 
  KafkaClient, 
  CreateClusterCommand,
  CreateConfigurationCommand,
  GetBootstrapBrokersCommand 
} from '@aws-sdk/client-kafka';
import { logger } from '../src/config/logger';
import dotenv from 'dotenv';
import { setupKafkaSecurityGroups } from './setupSecurityGroups';

dotenv.config();

const kafka = new KafkaClient({ region: process.env.AWS_REGION });

// Validate required environment variables
function validateEnvironment() {
  const required = {
    SUBNET_1: process.env.SUBNET_1,
    SUBNET_2: process.env.SUBNET_2,
    SUBNET_3: process.env.SUBNET_3,
    VPC_ID: process.env.VPC_ID
  };

  const missing = Object.entries(required)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return required as { [K in keyof typeof required]: string };
}

async function setupKafka() {
  try {
    // Validate environment variables first
    const env = validateEnvironment();

    // First set up security groups
    const securityGroupId = await setupKafkaSecurityGroups();
    if (!securityGroupId) {
      throw new Error('Failed to create or get security group ID');
    }

    // Create MSK configuration
    const configResponse = await kafka.send(new CreateConfigurationCommand({
      Name: 'nba-live-kafka-config',
      Description: 'Configuration for NBA Live Updates Kafka cluster',
      KafkaVersions: ['2.8.1'],
      ServerProperties: Buffer.from([
        'auto.create.topics.enable=true',
        'default.replication.factor=3',
        'min.insync.replicas=2'
      ].join('\n'))
    }));

    if (!configResponse.Arn) {
      throw new Error('Failed to get configuration ARN');
    }

    logger.info('Created MSK configuration:', configResponse);

    // Create MSK cluster with security group
    const createClusterResponse = await kafka.send(new CreateClusterCommand({
      ClusterName: 'nba-live-kafka',
      KafkaVersion: '2.8.1',
      NumberOfBrokerNodes: 3,
      BrokerNodeGroupInfo: {
        InstanceType: 'kafka.t3.small',
        ClientSubnets: [
          env.SUBNET_1,
          env.SUBNET_2,
          env.SUBNET_3
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
          ClientBroker: 'TLS',
          InCluster: true
        }
      },
      ConfigurationInfo: {
        Arn: configResponse.Arn,
        Revision: 1
      }
    }));

    if (!createClusterResponse.ClusterArn) {
      throw new Error('Failed to get cluster ARN');
    }

    logger.info('MSK cluster creation initiated:', createClusterResponse);

    // Store the cluster ARN for later use
    const clusterArn = createClusterResponse.ClusterArn;
    process.env.MSK_CLUSTER_ARN = clusterArn;

    // Wait for cluster to become active
    logger.info('Waiting for cluster to become active...');
    await waitForClusterActive(clusterArn);

    // Get broker information
    const brokersResponse = await kafka.send(new GetBootstrapBrokersCommand({
      ClusterArn: clusterArn
    }));

    logger.info('Bootstrap Brokers:', {
      PLAINTEXT: brokersResponse.BootstrapBrokerString,
      TLS: brokersResponse.BootstrapBrokerStringTls,
      IAM: brokersResponse.BootstrapBrokerStringSaslIam
    });

  } catch (error) {
    logger.error('Failed to setup MSK:', error);
    throw error;
  }
}

async function waitForClusterActive(clusterArn: string, maxAttempts = 60) {
  const { DescribeClusterCommand } = await import('@aws-sdk/client-kafka');
  
  for (let i = 0; i < maxAttempts; i++) {
    const describeResponse = await kafka.send(new DescribeClusterCommand({
      ClusterArn: clusterArn
    }));
    
    const state = describeResponse.ClusterInfo?.State;
    
    if (state === 'ACTIVE') {
      logger.info('Cluster is now active');
      return;
    } else if (state === 'FAILED') {
      throw new Error('Cluster creation failed');
    }
    
    logger.info(`Waiting for cluster to become active (attempt ${i + 1}/${maxAttempts})...`);
    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds between checks
  }
  
  throw new Error('Timeout waiting for cluster to become active');
}

setupKafka(); 