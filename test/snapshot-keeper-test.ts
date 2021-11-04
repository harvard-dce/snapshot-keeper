import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as SnapshotKeeper from '../lib/snapshot-keeper-stack';

test('Empty Stack', () => {
  const app = new cdk.App();
  // WHEN
  const props: SnapshotKeeper.SnapshotKeeperStackProps = {
    bucketName: 'test-bucket',
    vpcId: 'vpc-12345',
    snapshotKeeperEnvironment: 'jest',
    envVars: {},
    env: {
      account: '123456789012',
      region: 'us-east-1',
    }
  };
  const stack = new SnapshotKeeper.SnapshotKeeperStack(app, 'MyTestStack', props);
  // THEN
  expectCDK(stack).to(matchTemplate({
    "Resources": {}
  }, MatchStyle.EXACT))
});
