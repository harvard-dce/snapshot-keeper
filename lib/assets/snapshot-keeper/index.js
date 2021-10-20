'use strict';

const {
  RDSClient,
  DescribeDBClusterSnapshotsCommand,
  CopyDBClusterSnapshotCommand,
  DeleteDBClusterSnapshotCommand,
  waitUntilDBClusterSnapshotAvailable,
} = require('@aws-sdk/client-rds');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { assert } = require('console');

const client = new RDSClient({ region: process.env.AWS_REGION });

exports.handler = async (event, context) => {

  console.log(`EVENT: ${JSON.stringify(event, null, 2)}`);
  console.log(`CONTEXT: ${JSON.stringify(context, null, 2)}`);

  try {
    assert(event.DBClusterIdentifier);
    assert(event.keeperInterval);
  } catch (err) {
    return logFailure(`Invalid event input: ${err.message}`);
  }

  const keeperInterval = event.keeperInterval.toString();
  const DBClusterIdentifier = event.DBClusterIdentifier;
  console.log(`Looking for automated snapshots for ${DBClusterIdentifier}`);

  // for assembling our notification message
  const snsTopicArn = event.snsTopicArn;
  const notificationMsg = [`Lambda request id: ${context.awsRequestId}`];
  const addToNotificationMsg = (msg) => {
    console.log(msg);
    notificationMsg.push(msg);
  };

  // only configurable for testing purposes
  const sourceSnapshotIndex = event.sourceSnapshotIndex || 0;

  let automatedSnapshots, copyTargetId;
  try {
    // get all of the automated snapshots. these are the ones created by the RDS service.
    automatedSnapshots = await getSortedSnapshots(DBClusterIdentifier, 'automated');

    // we're going to make a copy of the most recent one
    const mostRecentSnapshotId = automatedSnapshots[sourceSnapshotIndex].DBClusterSnapshotIdentifier;
    const mostRecentSnapshotTags = automatedSnapshots[sourceSnapshotIndex].TagList;
    copyTargetId = mostRecentSnapshotId.replace(/^rds:/, `sk${keeperInterval}-`);

    const newTagList = [
      {
        Key: "snapshot-keeper-interval",
        Value: keeperInterval,
      },
      {
        Key: "snapshot-keeper-source-id",
        Value: mostRecentSnapshotId,
      },
      // the copy snapshot command does not support both new tags and copyTags=true
      // so we include the existing tags with our new tags
      ...mostRecentSnapshotTags,
    ];

    console.log(`Copying most recent automated snapshot: ${mostRecentSnapshotId} to ${copyTargetId}`);
    await copySnapshot(mostRecentSnapshotId, copyTargetId, newTagList);

    addToNotificationMsg(`Copied ${mostRecentSnapshotId} to ${copyTargetId}`);

  } catch (err) {
    if (err.name === 'DBClusterSnapshotAlreadyExistsFault') {
      addToNotificationMsg(`The snapshot ${copyTargetId} already exists`)
    } else {
      return logFailure(err);
    }
  }

  const numberToKeep = parseInt(event.numberToKeep);

  if (isNaN(numberToKeep)) {
    addToNotificationMsg('keeping everything!');
  } else if (numberToKeep === 0) {
    // not sure how/why we'd get here but just to be safe...
    addToNotificationMsg('delete everything? nope!');
  } else {
    // get all of the manually created snapshots (including any copy we just made)
    const manualSnapshots = await getSortedSnapshots(DBClusterIdentifier, 'manual');

    // get the ids of the ones we want to delete
    const snapshotsIdsToDelete = getSnapshotIdsToDelete(manualSnapshots, keeperInterval, numberToKeep);

    if (!snapshotsIdsToDelete.length) {
      addToNotificationMsg('Nothing to delete!');
    } else {
      try {
        addToNotificationMsg(`Keeping ${numberToKeep}, deleting ${snapshotsIdsToDelete.length}`);
        const deleted = await deleteSnapshots(snapshotsIdsToDelete);
        addToNotificationMsg([
          'Deleted:',
          ...snapshotsIdsToDelete.map((id) => `  ${id}`),
        ].join('\n'));
      } catch (err) {
        return logFailure(err);
      }
    }
  }

  if (snsTopicArn) {
    const snsClient = new SNSClient({region: process.env.AWS_REGION});
    const publishCommand = new PublishCommand({
      TopicArn: snsTopicArn,
      Subject: `[snapshot-keeper] ${DBClusterIdentifier}, interval: ${keeperInterval}`,
      Message: notificationMsg.join('\n'),
    });
    try {
      await snsClient.send(publishCommand);
    } catch (err) {
      return logFailure(err);
    }
  }
  console.log('done!');
};

/**
 * returns an array of snapshots sorted by create time, most recent first
 * @param {string} DBClusterIdentifier
 * @param {string} SnapshotType
 * @returns {Array<object>}
 */
const getSortedSnapshots = async (DBClusterIdentifier, SnapshotType) => {
  const describeSnapshotsCommand = new DescribeDBClusterSnapshotsCommand({
    DBClusterIdentifier,
    SnapshotType,
  });

  const snapshotResp = await client.send(describeSnapshotsCommand);

  if (!snapshotResp.DBClusterSnapshots || snapshotResp.DBClusterSnapshots.length === 0) {
    throw new Error(`No ${snapshotType} snapshots found for ${DBClusterIdentifier}`);
  }

  return snapshotResp.DBClusterSnapshots.sort((a, b) => {
    return (a.SnapshotCreateTime < b.SnapshotCreateTime) ? 1 : -1;
  });
};

/**
 * creates a copy of a snapshot
 * @param {string} SourceDBClusterSnapshotIdentifier
 * @param {string} TargetDBClusterSnapshotIdentifier
 * @param {Array<object>} Tags
 */
const copySnapshot = async (SourceDBClusterSnapshotIdentifier, TargetDBClusterSnapshotIdentifier, Tags) => {

  const copySnapshotCommand = new CopyDBClusterSnapshotCommand({
    SourceDBClusterSnapshotIdentifier,
    TargetDBClusterSnapshotIdentifier,
    Tags,
  });

  await client.send(copySnapshotCommand);

  // wait for it to be available because we need to include it in our count of ones to retain
  console.log('Waiting for snapshot copy to complete...');
  await waitUntilDBClusterSnapshotAvailable({ client }, {
    DBClusterSnapshotIdentifier: TargetDBClusterSnapshotIdentifier,
  });
};


/**
 * Takes an array of snapshots, filters to only those that match our snapshot-keeper interval,
 * and returns the list of snapshot ids for deletion
 * @param {Array<object>} sortedSnapshots
 * @param {string} keeperInterval
 * @param {number} numberToKeep
 * @returns Array<string>
 */
const getSnapshotIdsToDelete = (sortedSnapshots, keeperInterval, numberToKeep) => {
  // only ever delete snapshots created by snapshot-keeper and that match our interval
  const skSnapshots = sortedSnapshots.filter((snapshot) => {
    const tags = snapshot.TagList;
    if (!tags || tags.length === 0) {
      return false;
    }
    return tags.some((tag) => (
      tag.Key === 'snapshot-keeper-interval' && tag.Value === keeperInterval
    ));
  });
  // we just need the snapshot ids
  const snapshotIds = skSnapshots.map((snapshot) => snapshot.DBClusterSnapshotIdentifier);

  // assumes the snapshots are ordered most recent first
  // slice off the first x ids, where x is the number of snapshots to retain
  // e.g. ["a1", "b2", "c3", "d4", "e5"].slice(3) would return ["d4", "e5"] to delete
  return snapshotIds.slice(numberToKeep);
};

/**
 * Deletes the snapshots represented in an array of snapshot ids
 * @param {Array<string>} snapshotIds
 * @returns Promise
 */
const deleteSnapshots = async (snapshotIds) => {
  const deletions = snapshotIds.map((id) => {
    const deleteCommand = new DeleteDBClusterSnapshotCommand({
      DBClusterSnapshotIdentifier: id,
    });
    return client.send(deleteCommand)
      .catch((err) => {
        console.error(`deletion of ${id} failed: `, err);
      });
  });
  return Promise.allSettled(deletions);
};


const logFailure = (err) => {
  console.error(err);
  return err;
}
