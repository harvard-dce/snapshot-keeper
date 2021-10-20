#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { SnapshotKeeperStack, SnapshotKeeperStackProps } from '../lib/snapshot-keeper-stack';
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";


function bye(msg: string, exitCode: number): void {
  console.log(msg);
  process.exit(exitCode);
}

const skEnv = process.env.SNAPSHOT_KEEPER_ENVIRONMENT || '';
if (!skEnv) bye('You must set SNAPSHOT_KEEPER_ENVIRONMENT!', 1);

async function getCdkConfig(): Promise<SnapshotKeeperStackProps | undefined> {
  const client = new SSMClient({});
  const configParameterName = `/snapshot-keeper/cdk-config/${skEnv}`;
  const getConfigCommand = new GetParameterCommand({
    Name: configParameterName,
    WithDecryption: true,
  });

  try {
    const resp = await client.send(getConfigCommand);
    if (!resp.Parameter) {
      throw new Error(`Parameter ${configParameterName} not found!`);
    }
    return JSON.parse(resp.Parameter.Value || '{}');
  } catch (error) {
    console.log(error);
  }
}

async function main(): Promise<void> {

  const config = await getCdkConfig();
  if (!config) {
    bye('Failed fetching config', 1);
  } else {
    console.log(config);

    const {
      DBClusterIdentifier,
      vpcId,
      intervals,
      snsTopicArn,
      env,
    } = config;

    const app = new cdk.App();
    new SnapshotKeeperStack(app, `SnapshotKeeperCdk-${skEnv}`, {
      env,
      DBClusterIdentifier,
      vpcId,
      intervals,
      snsTopicArn,
      tags: {
        project: 'MH',
        department: 'DE',
        product: 'snapshot-keeper',
        deploy_environment: skEnv,
      }
    });
  }
}

main();
