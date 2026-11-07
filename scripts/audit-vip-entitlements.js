'use strict';

// Read-only entitlement audit. This script never writes to MongoDB.
// Run with MONGO_URI set to a read-only production credential.
const mongoose = require('mongoose');
const { buildVipEntitlementAudit } = require('../utils/vipEntitlementAudit');

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required; no database was contacted. Use a read-only MongoDB credential.');
  }
  await mongoose.connect(process.env.MONGO_URI, {
    readPreference: 'secondaryPreferred',
    readConcern: { level: 'majority' },
    serverSelectionTimeoutMS: 10000
  });
  console.log(JSON.stringify(await buildVipEntitlementAudit(), null, 2));
}

main()
  .catch(error => {
    console.error(`VIP audit failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
