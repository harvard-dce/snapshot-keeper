import * as cdk from '@aws-cdk/core';
import { SubnetType, Vpc } from '@aws-cdk/aws-ec2';
import { Function, Code, Runtime } from '@aws-cdk/aws-lambda';
import { Bucket } from '@aws-cdk/aws-s3';
import * as path from 'path';

export interface DocdbDumperStackProps extends cdk.StackProps {
  docdbDumperEnvironment: string;
  bucketName: string;
  vpcId: string;
  envVars: { [key: string]: string };
};

export class DocdbDumperStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: DocdbDumperStackProps) {
    super(scope, id, props);

    const stackName: string = cdk.Stack.of(this).stackName;

    const {
      docdbDumperEnvironment,
      bucketName = `${stackName}-docdb-dumper-bucket`,
      vpcId,
      envVars = {},
    } = props;

    const vpc = Vpc.fromLookup(this, 'Vpc', { vpcId }) as Vpc;

    const bucket = new Bucket(this, 'DumpBucket', {
      bucketName,
    });

    const func = new Function(this, 'Funciton', {
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_NAT },
      code: Code.fromAsset(path.join(__dirname, 'function')),
      runtime: Runtime.NODEJS_14_X,
      handler: 'index.handler',
      environment: {
        S3_BUCKET: bucket.bucketName,
        ...envVars,
      },
    });
  }
}
