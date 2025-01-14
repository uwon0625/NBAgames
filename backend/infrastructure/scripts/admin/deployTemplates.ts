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
  StackEvent
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

async function waitForStackDeletion(stackName: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await cloudformation.send(new DescribeStacksCommand({
        StackName: stackName
      }));
      const stack = response.Stacks?.[0];
      if (!stack) return true;

      const status = stack.StackStatus;
      logger.info(`Stack ${stackName} status: ${status}`);

      if (status === 'DELETE_FAILED') {
        // Force delete with retained resources
        const retainedResources = await getRetainedResources(stack);
        await cloudformation.send(new DeleteStackCommand({
          StackName: stackName,
          RetainResources: retainedResources
        }));
      } else if (!status?.includes('DELETE_IN_PROGRESS')) {
        return true;
      }
    } catch (error: any) {
      if (error.name === 'ValidationError' && error.message.includes('does not exist')) {
        return true;
      }
      throw error;
    }

    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
  }

  throw new Error(`Timeout waiting for stack ${stackName} deletion`);
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

async function logStackFailure(stackName: string) {
  const events = await getStackEvents(stackName);
  const failureEvents = events
    .filter(event => 
      event.ResourceStatus?.includes('FAILED') ||
      event.ResourceStatus === 'ROLLBACK_COMPLETE'
    )
    .sort((a, b) => 
      (a.Timestamp?.getTime() || 0) - (b.Timestamp?.getTime() || 0)
    );

  if (failureEvents.length > 0) {
    logger.error('Stack failure events:');
    failureEvents.forEach(event => {
      logger.error(`${event.ResourceStatus}: ${event.ResourceStatusReason || 'No reason provided'}`);
      logger.error(`Resource: ${event.LogicalResourceId}`);
      logger.error('---');
    });
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

async function deployStacks() {
  const environment = process.env.ENVIRONMENT || 'dev';

  // Deploy bootstrap stack first
  const bootstrapStackName = `nba-live-bootstrap-${environment}`;
  await deployTemplate(bootstrapStackName, 'bootstrap-template.yaml', [
    {
      ParameterKey: 'Environment',
      ParameterValue: environment
    }
  ]);

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
  const mainStackName = `nba-live-${environment}`;
  await deployTemplate(mainStackName, 'template.yaml', [
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
      ParameterKey: 'NBABaseUrl',
      ParameterValue: process.env.NBA_API_URL || 'https://cdn.nba.com/static/json/liveData'
    },
    {
      ParameterKey: 'ArtifactsBucketName',
      ParameterValue: artifactsBucketName
    }
  ]);
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

// Handle command line arguments
async function main() {
  const command = process.argv[2];
  const environment = process.env.ENVIRONMENT || 'dev';

  switch (command) {
    case 'deploy':
      if (await shouldCleanupFirst()) {
        logger.info('Cleaning up existing stacks first...');
        // Delete stacks in reverse order
        await deleteStack(`nba-live-${environment}`);
        await deleteStack(`nba-live-bootstrap-${environment}`);
        // Wait longer for deletion to complete
        logger.info('Waiting for deletions to complete...');
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
      await deployStacks();
      break;

    case 'delete':
      await deleteStack(`nba-live-${environment}`);
      await deleteStack(`nba-live-bootstrap-${environment}`);
      break;

    default:
      logger.error('Invalid command. Use "deploy" or "delete"');
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Deployment failed:', error);
    process.exit(1);
  });
} 