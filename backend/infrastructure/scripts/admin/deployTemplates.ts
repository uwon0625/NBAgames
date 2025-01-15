import { 
  CloudFormationClient, 
  CreateStackCommand,
  UpdateStackCommand,
  DescribeStacksCommand,
  DeleteStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
  DescribeStackResourceDriftsCommand,
  Stack,
  DescribeStackEventsCommand,
  StackEvent,
  CreateStackCommandInput
} from '@aws-sdk/client-cloudformation';
import { logger } from '../../../src/config/logger';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { 
  IAMClient,
  ListAttachedRolePoliciesCommand,
  DetachRolePolicyCommand,
  ListRolePoliciesCommand,
  DeleteRolePolicyCommand,
  DeleteRoleCommand
} from '@aws-sdk/client-iam';
import { KafkaClient, GetBootstrapBrokersCommand, ListClustersCommand } from '@aws-sdk/client-kafka';
import { ElastiCacheClient, DescribeCacheClustersCommand } from '@aws-sdk/client-elasticache';

// Load environment variables
dotenv.config();

const cloudformation = new CloudFormationClient({ region: process.env.AWS_REGION });

async function getRetainedResources(stack: Stack): Promise<string[]> {
  try {
    const driftResponse = await cloudformation.send(new DescribeStackResourceDriftsCommand({
      StackName: stack.StackName
    }));

    return (driftResponse.StackResourceDrifts || [])
      .map(drift => drift.LogicalResourceId)
      .filter((id): id is string => id !== undefined);
  } catch (error) {
    logger.warn('Failed to get resource drifts, proceeding without retained resources');
    return [];
  }
}

async function waitForStackDeletion(stackName: string, maxAttempts = 60) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await cloudformation.send(new DescribeStacksCommand({
        StackName: stackName
      }));
      
      const stack = response.Stacks?.[0];
      if (!stack) {
        return; // Stack no longer exists
      }

      if (stack.StackStatus === 'DELETE_COMPLETE') {
        return;
      }

      if (stack.StackStatus === 'DELETE_FAILED') {
        throw new Error(`Stack deletion failed: ${stack.StackStatusReason}`);
      }

      logger.info(`Waiting for stack deletion... Status: ${stack.StackStatus}`);
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds between checks
    } catch (error: any) {
      if (error.name === 'ValidationError' && error.message.includes('does not exist')) {
        return; // Stack has been deleted
      }
      throw error;
    }
  }

  throw new Error(`Timeout waiting for stack ${stackName} to be deleted`);
}

async function cleanupIAMRole(environment: string) {
  const iamClient = new IAMClient({ region: process.env.AWS_REGION });
  const roleName = `nba-live-cfn-role-${environment}`;

  try {
    // First detach all policies
    const attachedPolicies = await iamClient.send(new ListAttachedRolePoliciesCommand({
      RoleName: roleName
    }));

    for (const policy of attachedPolicies.AttachedPolicies || []) {
      await iamClient.send(new DetachRolePolicyCommand({
        RoleName: roleName,
        PolicyArn: policy.PolicyArn
      }));
    }

    // Delete inline policies
    const inlinePolicies = await iamClient.send(new ListRolePoliciesCommand({
      RoleName: roleName
    }));

    for (const policyName of inlinePolicies.PolicyNames || []) {
      await iamClient.send(new DeleteRolePolicyCommand({
        RoleName: roleName,
        PolicyName: policyName
      }));
    }

    // Finally delete the role
    await iamClient.send(new DeleteRoleCommand({
      RoleName: roleName
    }));

    logger.info(`Successfully cleaned up IAM role: ${roleName}`);
  } catch (error: any) {
    if (error.name !== 'NoSuchEntityException') {
      logger.error(`Failed to cleanup IAM role ${roleName}:`, error);
      throw error;
    }
  }
}

async function deleteStack(stackName: string) {
  try {
    const environment = process.env.ENVIRONMENT || 'dev';
    
    // If this is the bootstrap stack, cleanup IAM role first
    if (stackName.includes('bootstrap')) {
      await cleanupIAMRole(environment);
    }

    logger.info(`Deleting stack: ${stackName}`);
    await cloudformation.send(new DeleteStackCommand({
      StackName: stackName
    }));
    logger.info(`Stack ${stackName} deletion initiated`);
    
    // Wait for deletion to complete
    await waitForStackDeletion(stackName);
    logger.info(`Stack ${stackName} deleted successfully`);
  } catch (error) {
    logger.error(`Failed to delete stack ${stackName}:`, error);
    throw error;
  }
}

async function getStackEvents(stackName: string): Promise<StackEvent[]> {
  try {
    const response = await cloudformation.send(new DescribeStackEventsCommand({
      StackName: stackName
    }));
    return response.StackEvents || [];
  } catch (error) {
    logger.error('Failed to get stack events:', error);
    return [];
  }
}

async function getStackFailureEvents(stackName: string): Promise<string> {
  try {
    const events = await getStackEvents(stackName);
    
    const failureEvents = events
      .filter(event => event.ResourceStatus?.includes('FAILED'))
      .map(event => ({
        resource: event.LogicalResourceId,
        status: event.ResourceStatus,
        reason: event.ResourceStatusReason,
        timestamp: event.Timestamp
      }));

    return JSON.stringify(failureEvents, null, 2);
  } catch (error) {
    logger.error('Failed to get stack failure events:', error);
    return 'Failed to get stack events';
  }
}

async function logStackFailure(stackName: string) {
  const failureEvents = await getStackFailureEvents(stackName);
  if (failureEvents) {
    logger.error('Stack failure events:', failureEvents);
  }
}

async function deployTemplate(stackName: string, templatePath: string, parameters: any[] = []) {
  try {
    const templateFilePath = path.resolve(
      __dirname,
      '../../',
      templatePath
    );

    logger.info(`Reading template from: ${templateFilePath}`);
    
    const templateBody = fs.readFileSync(templateFilePath, 'utf8');

    // Check if stack exists
    let stackExists = false;
    let stackStatus: string | undefined;
    
    try {
      const response = await cloudformation.send(new DescribeStacksCommand({
        StackName: stackName
      }));
      stackExists = Boolean(response.Stacks && response.Stacks.length > 0);
      stackStatus = response.Stacks?.[0]?.StackStatus;
      logger.info(`Stack ${stackName} exists with status: ${stackStatus}`);
    } catch (error: any) {
      if (error.name !== 'ValidationError') {
        throw error;
      }
      stackExists = false;
    }

    // Handle problematic states
    if (stackStatus && (
      stackStatus.includes('ROLLBACK') || 
      stackStatus.includes('DELETE_FAILED') ||
      stackStatus.includes('UPDATE_ROLLBACK_FAILED')
    )) {
      logger.info(`Stack ${stackName} is in ${stackStatus} state. Attempting cleanup...`);
      await deleteStack(stackName);
      stackExists = false;
      // Wait a bit after deletion
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Don't update if stack is in progress
    if (stackStatus?.includes('IN_PROGRESS')) {
      throw new Error(`Stack ${stackName} is in ${stackStatus} state. Please wait for it to complete.`);
    }

    if (stackExists) {
      // Update existing stack
      logger.info(`Updating stack: ${stackName}`);
      const updateCommand = new UpdateStackCommand({
        StackName: stackName,
        TemplateBody: templateBody,
        Parameters: parameters,
        Capabilities: ['CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND']
      });

      try {
        await cloudformation.send(updateCommand);
        logger.info(`Waiting for stack ${stackName} to update...`);
        await waitUntilStackUpdateComplete(
          { client: cloudformation, maxWaitTime: 900 },
          { StackName: stackName }
        );
      } catch (error) {
        // Log stack events on failure
        await logStackFailure(stackName);
        throw error;
      }
    } else {
      // Create new stack
      logger.info(`Creating stack: ${stackName}`);
      const createCommand = new CreateStackCommand({
        StackName: stackName,
        TemplateBody: templateBody,
        Parameters: parameters,
        Capabilities: ['CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND']
      });

      await cloudformation.send(createCommand);
      logger.info(`Waiting for stack ${stackName} to create...`);
      
      try {
        await waitUntilStackCreateComplete(
          { client: cloudformation, maxWaitTime: 900 },
          { StackName: stackName }
        );
      } catch (error) {
        // Log stack events on failure
        await logStackFailure(stackName);
        throw error;
      }
    }

    logger.info(`Stack ${stackName} deployed successfully`);
  } catch (error) {
    logger.error(`Failed to deploy stack ${stackName}:`, error);
    throw error;
  }
}

async function checkExistingResources(stackName: string): Promise<boolean> {
  try {
    const response = await cloudformation.send(new DescribeStacksCommand({
      StackName: stackName
    }));
    return Boolean(response.Stacks && response.Stacks.length > 0);
  } catch (error: any) {
    if (error.name === 'ValidationError') {
      return false;
    }
    throw error;
  }
}

async function createStack(stackName: string, templateBody: string, parameters: any[] = []) {
  try {
    logger.info(`Creating stack: ${stackName}`);

    const input: CreateStackCommandInput = {
      StackName: stackName,
      TemplateBody: templateBody,
      Parameters: parameters,
      Capabilities: ['CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
      Tags: [
        { Key: 'Project', Value: 'NBA-Live' },
        { Key: 'Environment', Value: process.env.ENVIRONMENT || 'dev' }
      ]
    };

    await cloudformation.send(new CreateStackCommand(input));
    logger.info(`Waiting for stack ${stackName} to create...`);

    // Increase maxWaitTime and wait interval
    const waiter = waitUntilStackCreateComplete(
      { client: cloudformation, maxWaitTime: 3600 }, // Increased from default to 1 hour
      { StackName: stackName }
    );

    await waiter;
    logger.info(`Stack ${stackName} created successfully`);
  } catch (error: any) {
    if (error.name === 'AlreadyExistsException') {
      logger.info(`Stack ${stackName} already exists`);
      return;
    }

    // Add more detailed error logging
    if (error.name === 'TimeoutError') {
      logger.warn(`Stack ${stackName} creation is taking longer than expected but may still complete successfully`);
      logger.info('You can check the stack status in AWS Console');
      return;
    }

    logger.error('Stack failure events:', await getStackFailureEvents(stackName));
    throw new Error(`Failed to create stack ${stackName}: ${error}`);
  }
}

async function updateStack(stackName: string, templateBody: string, parameters: any[] = []) {
  try {
    const command = new UpdateStackCommand({
      StackName: stackName,
      TemplateBody: templateBody,
      Parameters: parameters,
      Capabilities: ['CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND']
    });

    await cloudformation.send(command);
    logger.info(`Waiting for stack ${stackName} to update...`);
    await waitUntilStackUpdateComplete(
      { client: cloudformation, maxWaitTime: 900 },
      { StackName: stackName }
    );
    logger.info(`Stack ${stackName} updated successfully`);
  } catch (error: any) {
    if (error.message?.includes('No updates are to be performed')) {
      logger.info(`No updates needed for stack ${stackName}`);
    } else {
      throw error;
    }
  }
}

async function updateKafkaBrokers(environment: string) {
  try {
    // Check if MSK is enabled
    const isMskEnabled = process.env.ENABLE_MSK === 'true';
    if (!isMskEnabled) {
      logger.info('MSK is not enabled, skipping broker endpoint update');
      
      // Update .env with local Kafka settings
      const envPath = path.resolve(__dirname, '../../../.env');
      let envContent = fs.readFileSync(envPath, 'utf8');
      
      // Set local Kafka broker
      const localBroker = 'localhost:9092';
      if (envContent.includes('KAFKA_BROKERS=')) {
        envContent = envContent.replace(
          /KAFKA_BROKERS=.*/,
          `KAFKA_BROKERS=${localBroker}`
        );
      } else {
        envContent += `\nKAFKA_BROKERS=${localBroker}`;
      }
      
      fs.writeFileSync(envPath, envContent);
      logger.info(`Updated .env with local Kafka broker: ${localBroker}`);
      return;
    }

    const kafka = new KafkaClient({ region: process.env.AWS_REGION });
    
    // Get the MSK cluster ARN from CloudFormation outputs
    const stack = await cloudformation.send(new DescribeStacksCommand({
      StackName: `nba-live-${environment}`
    }));
    
    const clusterArn = stack.Stacks?.[0]?.Outputs?.find(
      output => output.OutputKey === 'MSKClusterArn'
    )?.OutputValue;

    if (!clusterArn) {
      logger.info('MSK cluster ARN not found in stack outputs, using local Kafka');
      return;
    }

    // Get the broker endpoints
    const brokersResponse = await kafka.send(new GetBootstrapBrokersCommand({
      ClusterArn: clusterArn
    }));

    const brokers = brokersResponse.BootstrapBrokerString;
    if (!brokers) {
      throw new Error('Failed to get Kafka broker endpoints');
    }

    // Update .env file
    const envPath = path.resolve(__dirname, '../../../.env');
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
    logger.info(`Updated .env with Kafka broker endpoints: KAFKA_BROKERS=${brokers}`);

  } catch (error) {
    logger.warn('Failed to update Kafka brokers, using local configuration');
    // Don't throw error, just log warning
  }
}

async function waitForRedisCluster(environment: string): Promise<void> {
  const elasticache = new ElastiCacheClient({ region: process.env.AWS_REGION });
  const maxAttempts = 30; // 15 minutes (30 * 30 seconds)
  let attempts = 0;

  const clusterId = `nba-live-redis-${environment}`;
  logger.info(`Waiting for Redis cluster: ${clusterId}`);

  while (attempts < maxAttempts) {
    try {
      const response = await elasticache.send(new DescribeCacheClustersCommand({
        CacheClusterId: clusterId,
        ShowCacheNodeInfo: true
      }));

      const cluster = response.CacheClusters?.[0];
      if (cluster?.CacheClusterStatus === 'available') {
        logger.info(`Redis cluster ${clusterId} is now available`);
        return;
      }

      logger.info(`Redis cluster status: ${cluster?.CacheClusterStatus} (${attempts + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
      attempts++;
    } catch (error: any) {
      if (error.name === 'CacheClusterNotFoundFault') {
        logger.info(`Waiting for Redis cluster to be created (${attempts + 1}/${maxAttempts})`);
      } else {
        logger.warn('Error checking Redis cluster status:', error);
      }
      await new Promise(resolve => setTimeout(resolve, 30000));
      attempts++;
    }
  }

  throw new Error('Timeout waiting for Redis cluster to become available');
}

async function updateRedisEndpoint(environment: string) {
  try {
    // Get the Redis endpoint from CloudFormation outputs
    const stack = await cloudformation.send(new DescribeStacksCommand({
      StackName: `nba-live-${environment}`
    }));
    
    const redisEndpoint = stack.Stacks?.[0]?.Outputs?.find(
      output => output.OutputKey === 'RedisEndpoint'
    )?.OutputValue;

    const redisPort = stack.Stacks?.[0]?.Outputs?.find(
      output => output.OutputKey === 'RedisPort'
    )?.OutputValue;

    if (!redisEndpoint || !redisPort) {
      logger.warn('Redis endpoint not found in stack outputs, using local Redis');
      return;
    }

    // Update .env file
    const envPath = path.resolve(__dirname, '../../../.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    // Update Redis endpoint
    const redisUrl = `${redisEndpoint}:${redisPort}`;
    if (envContent.includes('REDIS_ENDPOINT=')) {
      envContent = envContent.replace(
        /REDIS_ENDPOINT=.*/,
        `REDIS_ENDPOINT=${redisUrl}`
      );
    } else {
      envContent += `\nREDIS_ENDPOINT=${redisUrl}`;
    }
    
    fs.writeFileSync(envPath, envContent);
    logger.info(`Updated .env with Redis endpoint: REDIS_ENDPOINT=${redisUrl}`);

  } catch (error) {
    logger.warn('Failed to update Redis endpoint, using local configuration');
    // Don't throw error, just log warning
  }
}

async function deployStacks() {
  const environment = process.env.ENVIRONMENT || 'dev';
  const bootstrapStackName = `nba-live-bootstrap-${environment}`;
  const mainStackName = `nba-live-${environment}`;

  try {
    // Deploy bootstrap stack first
    logger.info(`Reading template from: ${path.resolve(__dirname, '../../bootstrap-template.yaml')}`);
    const bootstrapTemplate = fs.readFileSync(
      path.resolve(__dirname, '../../bootstrap-template.yaml'),
      'utf8'
    );

    const bootstrapParams = [
      {
        ParameterKey: 'Environment',
        ParameterValue: environment
      }
    ];

    // Check if bootstrap stack exists
    const bootstrapExists = await checkExistingResources(bootstrapStackName);
    if (bootstrapExists) {
      logger.info(`Stack ${bootstrapStackName} already exists, updating...`);
      await updateStack(bootstrapStackName, bootstrapTemplate, bootstrapParams);
    } else {
      logger.info(`Creating stack: ${bootstrapStackName}`);
      await createStack(bootstrapStackName, bootstrapTemplate, bootstrapParams);
    }

    // Get the artifacts bucket name from bootstrap stack
    const bootstrapStack = await cloudformation.send(new DescribeStacksCommand({
      StackName: bootstrapStackName
    }));
    
    const artifactsBucketName = bootstrapStack.Stacks?.[0]?.Outputs?.find(
      output => output.OutputKey === 'ArtifactsBucketName'
    )?.OutputValue;

    if (!artifactsBucketName) {
      throw new Error('Failed to get artifacts bucket name from bootstrap stack');
    }

    // Deploy main stack
    logger.info(`Reading template from: ${path.resolve(__dirname, '../../template.yaml')}`);
    const mainTemplate = fs.readFileSync(
      path.resolve(__dirname, '../../template.yaml'),
      'utf8'
    );

    const mainStackParams = [
      {
        ParameterKey: 'Environment',
        ParameterValue: environment
      },
      {
        ParameterKey: 'VpcId',
        ParameterValue: process.env.VPC_ID
      },
      {
        ParameterKey: 'SubnetIds',
        ParameterValue: [
          process.env.SUBNET_1,
          process.env.SUBNET_2,
          process.env.SUBNET_3
        ].join(',')
      },
      {
        ParameterKey: 'ArtifactsBucketName',
        ParameterValue: artifactsBucketName
      }
    ];

    // Check if main stack exists
    const mainExists = await checkExistingResources(mainStackName);
    if (mainExists) {
      logger.info(`Stack ${mainStackName} already exists, updating...`);
      await updateStack(mainStackName, mainTemplate, mainStackParams);
    } else {
      logger.info(`Creating stack: ${mainStackName}`);
      await createStack(mainStackName, mainTemplate, mainStackParams);
    }

    // Wait for MSK cluster to be active
    logger.info('Waiting for MSK cluster to be active...');
    await waitForMSKCluster(environment);
    
    // Wait for Redis cluster to be available
    logger.info('Waiting for Redis cluster to be available...');
    await waitForRedisCluster(environment);
    
    // Update endpoints in .env
    logger.info('Updating service endpoints...');
    await updateKafkaBrokers(environment);
    await updateRedisEndpoint(environment);

    logger.info('Deployment completed successfully');
  } catch (error) {
    logger.error('Deployment failed:', error);
    throw error;
  }
}

async function waitForMSKCluster(environment: string): Promise<void> {
  const kafka = new KafkaClient({ region: process.env.AWS_REGION });
  const maxAttempts = 60; // 30 minutes (30 * 60 seconds)
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const clusters = await kafka.send(new ListClustersCommand({}));
      const cluster = clusters.ClusterInfoList?.find(c => 
        c.ClusterName === `nba-live-kafka-${environment}`
      );

      if (cluster?.State === 'ACTIVE') {
        logger.info('MSK cluster is now active');
        return;
      }

      logger.info(`Waiting for MSK cluster to be active (${attempts + 1}/${maxAttempts})...`);
      await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
      attempts++;
    } catch (error) {
      logger.warn('Error checking MSK cluster status:', error);
      attempts++;
    }
  }

  throw new Error('Timeout waiting for MSK cluster to become active');
}

async function shouldCleanupFirst(): Promise<boolean> {
  const response = await cloudformation.send(new DescribeStacksCommand({}));
  const stacks = response.Stacks || [];
  
  // Check if any of our stacks exist
  const existingStacks = stacks.filter(stack => 
    stack.StackName &&
    stack.StackStatus &&
    stack.StackName.startsWith('nba-live-') && 
    !stack.StackStatus.includes('DELETE_')
  );

  if (existingStacks.length > 0) {
    logger.info('Found existing stacks:', existingStacks.map(s => 
      `${s.StackName || 'Unknown'} (${s.StackStatus || 'Unknown'})`
    ));
    return true;
  }

  return false;
}

async function deleteStacks() {
  const environment = process.env.ENVIRONMENT || 'dev';
  const mainStackName = `nba-live-${environment}`;
  const bootstrapStackName = `nba-live-bootstrap-${environment}`;

  try {
    // Check if main stack exists
    const mainExists = await checkExistingResources(mainStackName);
    if (mainExists) {
      logger.info('Deleting main stack...');
      await deleteStack(mainStackName);
    } else {
      logger.info('Main stack does not exist, skipping deletion');
    }

    // Check if bootstrap stack exists
    const bootstrapExists = await checkExistingResources(bootstrapStackName);
    if (bootstrapExists) {
      logger.info('Deleting bootstrap stack...');
      await deleteStack(bootstrapStackName);
    } else {
      logger.info('Bootstrap stack does not exist, skipping deletion');
    }

    logger.info('Stack deletion completed');
  } catch (error) {
    logger.error('Failed to delete stacks:', error);
    throw error;
  }
}

async function getStackStatus(stackName: string): Promise<string | undefined> {
  try {
    const response = await cloudformation.send(new DescribeStacksCommand({
      StackName: stackName
    }));

    const stack = response.Stacks?.[0];
    if (!stack) {
      logger.info(`Stack ${stackName} not found`);
      return 'STACK_NOT_FOUND';
    }

    logger.info(`Stack ${stackName} status: ${stack.StackStatus}`);
    return stack.StackStatus;
  } catch (error: any) {
    if (error.name === 'ValidationError' && error.message.includes('does not exist')) {
      logger.info(`Stack ${stackName} does not exist`);
      return 'STACK_NOT_FOUND';
    }
    logger.error(`Error getting stack status for ${stackName}:`, error);
    throw error;
  }
}

// Handle command line arguments
async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'deploy':
      await deployStacks();
      break;
    case 'delete':
      await deleteStacks();
      break;
    case 'status':
      const status = await getStackStatus('nba-live-dev');
      logger.info(`Stack nba-live-dev status: ${status}`);
      break;
    case 'failures':
      const failureEvents = await getStackFailureEvents('nba-live-dev');
      logger.info('Stack failure events:', failureEvents);
      break;
    default:
      logger.error('Invalid command. Use: deploy, delete, or status');
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Deployment failed:', error);
    process.exit(1);
  });
} 