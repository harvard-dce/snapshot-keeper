#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { DocdbDumperStack, DocdbDumperStackProps } from '../lib/docdb-dumper-stack';
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";


function bye(msg: string, exitCode: number): void {
  console.log(msg);
  process.exit(exitCode);
}

const docdbDumperEnvironment = process.env.DOCDB_DUMPER_ENVIRONMENT || '';
if (!docdbDumperEnvironment) bye('You must set DOCDB_DUMPER_ENVIRONMENT!', 1);

async function getCdkConfig(): Promise<DocdbDumperStackProps | undefined> {
  const client = new SSMClient({});
  const configParameterName = `/docdb-dumper/cdk-config/${docdbDumperEnvironment}`;
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

    const app = new cdk.App();
    new DocdbDumperStack(app, `DocdbDumperCdk-${docdbDumperEnvironment}`, {
      ...config,
      docdbDumperEnvironment,
      tags: {
        project: 'Staff Stuff',
        department: 'DE',
        environment: docdbDumperEnvironment,
      }
    });
  }
}

main();
