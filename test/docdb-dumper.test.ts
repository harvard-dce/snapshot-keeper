import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as DocdbDumper from '../lib/docdb-dumper-stack';

test('Empty Stack', () => {
  const app = new cdk.App();
  // WHEN
  const props: DocdbDumper.DocdbDumperStackProps = {
    bucketName: 'test-bucket',
    vpcId: 'vpc-12345',
    docdbDumperEnvironment: 'jest',
    envVars: {},
    env: {
      account: '123456789012',
      region: 'us-east-1',
    }
  };
  const stack = new DocdbDumper.DocdbDumperStack(app, 'MyTestStack', props);
  // THEN
  expectCDK(stack).to(matchTemplate({
    "Resources": {}
  }, MatchStyle.EXACT))
});
