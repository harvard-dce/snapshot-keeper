'use strict'

const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const stream = require('stream');
const path = require('path');
const dayjs = require('dayjs');
const { exec, spawn } = require('child_process');

const {
  S3_BUCKET,
  MONGO_HOST,
  MONGO_PORT = '27017',
  MONGO_USERNAME,
  MONGO_PASSWORD,
  MONGO_DATABASE,
  MONGO_OPTIONS = '',
  MONGO_QUERY = '',
  MONGO_ENABLE_GZIP = false,
  MONGO_COLLECTIONS,
  MONGOEXPORT_PATH = path.join(__dirname, 'mongoexport'),
  DATE_FORMAT = 'YYYYMMDD_HHmmssSSS',
} = process.env;

const s3client = new S3Client({ region: process.env.AWS_REGION });

const makeMongoexportCommand = (collection) => {
  return [
    MONGOEXPORT_PATH, [
      '--quiet',
      '--db', MONGO_DATABASE,
      '--collection', collection,
      '--host', `${MONGO_HOST}:${MONGO_PORT}`,
      '--username', MONGO_USERNAME,
      '--password', MONGO_PASSWORD,
      ...MONGO_OPTIONS.split(/(\s+)/),
    ]
  ]
  // return `${MONGOEXPORT_PATH} --quiet ` +
  //   `--db ${MONGO_DATABASE} -c ${collection} ` +
  //   `--host ${MONGO_HOST}:${MONGO_PORT} ` +
  //   `--username ${MONGO_USERNAME} --password ${MONGO_PASSWORD} ` +
  //   `${MONGO_OPTIONS} ${MONGO_ENABLE_GZIP ? '--gzip' : ''} `;
}

const export2s3 = async (mongoexportCommand, s3Key) => {

  const uploadParams = {
    Key: s3Key,
    Body: passThru,
    Bucket: S3_BUCKET,
    ContentType: (MONGO_ENABLE_GZIP) ? 'application/zip' : 'application/json',
    ServerSideEncryption: 'AES256',
    StorageClass: 'STANDARD',
  };

  const execOptions = {
    maxBuffer: 1024 * 1024 * 100,
   };
  const mongoexport = spawn(...mongoexportCommand, execOptions);
  const pipeline = mongoexport.stdout.pipe(passThru);

  pipeline.on('error', (err) => {
    console.log(`mongo failed: ${error}`);
  });

  pipeline.on('close', () => {
    console.log('upload successful');
  })

  try {
    const upload = new Upload({
      params: uploadParams,
      client: s3client,
      queueSize: 3,
    });
    await upload.done();
  } catch (e) {
    console.log(e);
  }
};

exports.handler = async function(_event, _context, _cb) {
  console.log(`docdb-exporter export to S3 bucket '${S3_BUCKET}' is starting`)
  const fileExtension = MONGO_ENABLE_GZIP ? 'zip' : 'json';

  const collections = MONGO_COLLECTIONS.split(',').reduce((acc, coll) => {
    if (coll.trim() !== '') {
      acc.push(coll.trim());
    }
    return acc;
  }, []);

  for (let i = 0; i < collections.length; i++) {
    const s3Key = `${dayjs().format(DATE_FORMAT)}_${collections[i]}.${fileExtension}`;
    await export2s3(makeMongoexportCommand(collections[i]), s3Key);
  }
};

async function main() {
  await exports.handler();
}

main();
