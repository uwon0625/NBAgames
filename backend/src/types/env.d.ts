declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      AWS_REGION: string;
      AWS_ACCOUNT_ID: string;
      AWS_USER_NAME: string;
      ENVIRONMENT: string;
      DYNAMODB_TABLE_NAME: string;
      S3_BUCKET_NAME: string;
      KAFKA_BROKERS: string;
      REDIS_ENDPOINT: string;
      SECURITY_GROUP_ID: string;
      SUBNET_1: string;
      SUBNET_2: string;
      SUBNET_3: string;
      VPC_ID: string;
      LAMBDA_ROLE_ARN?: string;
    }
  }
}

export {}; 