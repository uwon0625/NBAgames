#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NbaLiveStack } from '../lib/nba-live-stack';

const app = new cdk.App();
new NbaLiveStack(app, 'NbaLiveStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION || 'us-west-2'
  },
}); 