import { Template } from 'aws-cdk-lib/assertions';
import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { resolve } from 'path';

// Helper function to convert CloudFormation YAML to JSON
function convertYamlToJson(yamlContent: string): any {
  try {
    // First load the YAML
    const parsed = yaml.load(yamlContent) as { [key: string]: any };
    
    // Convert any Ref to proper format
    if (parsed.Outputs?.TableName?.Value?.['Ref']) {
      parsed.Outputs.TableName.Value = {
        Ref: parsed.Outputs.TableName.Value['Ref']
      };
    }
    
    return parsed;
  } catch (error) {
    console.error('Error parsing YAML:', error);
    throw error;
  }
}

describe('NBA Live Infrastructure', () => {
  let template: Template;

  beforeAll(() => {
    const templatePath = resolve(__dirname, '../template.yaml');
    const yamlContent = readFileSync(templatePath, 'utf8');
    const jsonContent = convertYamlToJson(yamlContent);
    template = Template.fromJSON(jsonContent);
  });

  describe('DynamoDB Table', () => {
    test('is created with correct configuration', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'nba-games',
        AttributeDefinitions: [
          { AttributeName: 'date', AttributeType: 'S' },
          { AttributeName: 'type', AttributeType: 'S' }
        ],
        KeySchema: [
          { AttributeName: 'date', KeyType: 'HASH' },
          { AttributeName: 'type', KeyType: 'RANGE' }
        ],
        BillingMode: 'PAY_PER_REQUEST',
        TimeToLiveSpecification: {
          AttributeName: 'ttl',
          Enabled: true
        }
      });
    });

    test('has correct deletion policy', () => {
      template.hasResource('AWS::DynamoDB::Table', {
        DeletionPolicy: 'Retain'
      });
    });
  });

  describe('CloudFormation Stack', () => {
    test('has correct outputs', () => {
      template.hasOutput('TableName', {
        Description: 'Name of the DynamoDB table'
      });
    });

    test('has no IAM roles or policies', () => {
      template.resourceCountIs('AWS::IAM::Role', 0);
      template.resourceCountIs('AWS::IAM::Policy', 0);
    });
  });
}); 