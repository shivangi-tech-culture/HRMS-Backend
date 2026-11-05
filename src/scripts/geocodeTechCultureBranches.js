/**
 * Fetch lat/long from branch address for TechCulture AI company.
 * Saves onto Company.branches[].latitude / longitude for 50m punch geofence.
 *
 * Run: node src/scripts/geocodeTechCultureBranches.js
 */
require("dotenv").config();
const connectDB = require("../config/db");
const Company = require("../models/Company");
const {
  branchAddressQuery,
  forwardGeocode,
} = require("../utils/geocode");
const { getModel } = require("../models/Master");

const NAME_RE = /tech\s*culture/i;

(async () => {
  await connectDB();

  const companies = await Company.find({
    $or: [
      { companyName: NAME_RE },
      { companyCode: NAME_RE },
    ],
  });

  if (!companies.length) {
    const all = await Company.find().select("companyName companyCode").lean();
    console.log("TechCulture company not found. Companies in DB:");
    for (const c of all) console.log(`  - ${c.companyCode} | ${c.companyName}`);
    process.exit(1);
  }

  const BranchMaster = getModel("branch");

  for (const company of companies) {
    console.log(`\n=== ${company.companyCode} | ${company.companyName} ===`);
    let changed = 0;

    for (let i = 0; i < (company.branches || []).length; i++) {
      const branch = company.branches[i];
      const master = branch.branchId
        ? await BranchMaster.findById(branch.branchId).select("name code").lean()
        : null;
      const label = master
        ? `${master.name} (${master.code || "-"})`
        : String(branch.branchId || `index ${i}`);

      const query = branchAddressQuery(branch);
      console.log(`\nBranch: ${label}`);
      console.log(`  address: ${query || "(empty)"}`);
      console.log(
        `  before:  lat=${branch.latitude ?? "null"}  lng=${branch.longitude ?? "null"}`
      );

      if (!query) {
        console.log("  skip — no address/city/state/pincode");
        continue;
      }

      const coords = await forwardGeocode(query);
      if (coords.latitude == null || coords.longitude == null) {
        console.log("  FAIL — Map API could not geocode this address");
        continue;
      }

      company.branches[i].latitude = coords.latitude;
      company.branches[i].longitude = coords.longitude;
      changed += 1;
      console.log(
        `  after:   lat=${coords.latitude}  lng=${coords.longitude}`
      );

      // Nominatim asks ~1 req/sec
      await new Promise((r) => setTimeout(r, 1100));
    }

    if (changed) {
      company.markModified("branches");
      await company.save();
      console.log(`\nSaved ${changed} branch coordinate(s) on ${company.companyCode}.`);
    } else {
      console.log("\nNo coordinates saved.");
    }
  }

  console.log(
    "\nDone. Use these lat/lng (±50m) in punch-in / punch-out / break body to test."
  );
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
