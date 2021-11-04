import * as cdk from '@aws-cdk/core';
import { SubnetType, Vpc } from '@aws-cdk/aws-ec2';
import { Runtime } from '@aws-cdk/aws-lambda';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';
import { Rule, RuleTargetInput, Schedule } from '@aws-cdk/aws-events';
import { LambdaFunction as FunctionTarget } from '@aws-cdk/aws-events-targets';
import { Effect, PolicyStatement } from '@aws-cdk/aws-iam';
import * as path from 'path';
import { Topic } from '@aws-cdk/aws-sns';
import { Duration } from '@aws-cdk/core';

interface SnapshotKeeperInterval {
  keeperInterval: number;
  numberToKeep: number;
};

export interface SnapshotKeeperStackProps extends cdk.StackProps {
  vpcId: string;
  DBClusterIdentifier: string;
  intervals: SnapshotKeeperInterval[];
  snsTopicArn?: string;
};

export class SnapshotKeeperStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: SnapshotKeeperStackProps) {
    super(scope, id, props);

    const {
      stackName,
      region,
      account,
    } = cdk.Stack.of(this);

    const {
      vpcId,
      DBClusterIdentifier,
      snsTopicArn,
      intervals,
    } = props;

    const vpc = Vpc.fromLookup(this, 'Vpc', { vpcId }) as Vpc;

    const snapshotKeeperFunciton = new NodejsFunction(this, 'SnapshotKeeperFunction', {
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_NAT },
      functionName: `${stackName}-snapshot-keeper`,
      entry: `${path.resolve(__dirname)}/assets/snapshot-keeper/index.js`,
      runtime: Runtime.NODEJS_14_X,
      handler: 'handler',
      timeout: Duration.seconds(60),
    });

    snapshotKeeperFunciton.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'rds:DescribeDBClusterSnapshots',
      ],
      resources: ["*"],
    }));

    snapshotKeeperFunciton.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'rds:CopyDBClusterSnapshot',
        'rds:CreateDBClusterSnapshot',
        'rds:DeleteDBClusterSnapshot',
        'rds:DescribeDBClusterSnapshotAttributes',
        'rds:AddTagsToResource',
      ],
      resources: ["*"],
    }));

    intervals.forEach((interval: SnapshotKeeperInterval, idx: number) => {
      const { keeperInterval, numberToKeep } = interval;
      const eventTarget = new FunctionTarget(
        snapshotKeeperFunciton,
        {
          event: RuleTargetInput.fromObject({
            keeperInterval,
            numberToKeep,
            DBClusterIdentifier,
            snsTopicArn,
          }),
        }
      )
      new Rule(this, `EventRule${idx}`, {
        description: `executes the snapshot-keeper function every ${keeperInterval}`,
        schedule: Schedule.expression(`rate(${keeperInterval} days)`),
        targets: [eventTarget],
      });
    });

    if (snsTopicArn && snapshotKeeperFunciton.role !== undefined) {
      const sns = Topic.fromTopicArn(this, 'SnsNotifications', snsTopicArn);
      sns.grantPublish(snapshotKeeperFunciton.role);
    }
  }
}
