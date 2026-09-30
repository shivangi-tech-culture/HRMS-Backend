/**
 * Make all existing masters GLOBAL (clear company field + drop old indexes).
 * Does NOT wipe master names. Safe to re-run.
 *
 * Run: npm run migrate:masters-global
 */
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { TYPES, COLLECTION_BY_TYPE, getModel } = require("../models/Master");

const run = async () => {
  await connectDB();

  for (const type of TYPES) {
    const collection = COLLECTION_BY_TYPE[type];
    const Model = getModel(type);
    const col = mongoose.connection.collection(collection);

    const cleared = await Model.updateMany({}, { $set: { company: "" } });
    console.log(`${type}: cleared company on ${cleared.modifiedCount} rows`);

    // Drop legacy compound unique indexes (company + name)
    try {
      const indexes = await col.indexes();
      for (const idx of indexes) {
        const keys = Object.keys(idx.key || {});
        if (keys.includes("company") && idx.name !== "_id_") {
          await col.dropIndex(idx.name);
          console.log(`  dropped index ${idx.name}`);
        }
      }
    } catch (e) {
      console.log(`  index cleanup: ${e.message}`);
    }

    // Ensure global unique name index
    try {
      await col.createIndex(
        { name: 1 },
        { unique: true, collation: { locale: "en", strength: 2 } }
      );
      console.log(`  ensured unique name index`);
    } catch (e) {
      console.log(`  name index: ${e.message}`);
    }
  }

  console.log("\nDone — masters are global (no company basis).");
  process.exit(0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
