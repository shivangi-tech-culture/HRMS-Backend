/**
 * Set TechCulture AI branch office to Kailash Building (KG Marg).
 * Run: node src/scripts/setKailashOffice.js
 */
require("dotenv").config();
const connectDB = require("../config/db");
const Company = require("../models/Company");
const { getModel } = require("../models/Master");

const NAME_RE = /tech\s*culture/i;

const OFFICE = {
  address: "1212 KAILASH BUILDING KG MARG NEW DELHI CENTRAL DELHI DELHI 110001 INDIA",
  city: "New Delhi",
  state: "Delhi",
  pincode: "110001",
  latitude: 28.6293453,
  longitude: 77.2222984,
};

(async () => {
  await connectDB();

  const companies = await Company.find({
    $or: [{ companyName: NAME_RE }, { companyCode: NAME_RE }],
  });

  if (!companies.length) {
    console.log("TechCulture company not found");
    process.exit(1);
  }

  const BranchMaster = getModel("branch");

  for (const company of companies) {
    console.log(`\n=== ${company.companyCode} | ${company.companyName} ===`);

    for (let i = 0; i < (company.branches || []).length; i++) {
      const branch = company.branches[i];
      const master = branch.branchId
        ? await BranchMaster.findById(branch.branchId).select("name code").lean()
        : null;
      const label = master
        ? `${master.name} (${master.code || "-"})`
        : String(branch.branchId || i);

      company.branches[i].address = OFFICE.address;
      company.branches[i].city = OFFICE.city;
      company.branches[i].state = OFFICE.state;
      company.branches[i].pincode = OFFICE.pincode;
      company.branches[i].latitude = OFFICE.latitude;
      company.branches[i].longitude = OFFICE.longitude;

      console.log(`\nBranch: ${label}`);
      console.log(`  address: ${OFFICE.address}`);
      console.log(`  lat: ${OFFICE.latitude}  lng: ${OFFICE.longitude}`);
    }

    company.markModified("branches");
    await company.save();
    console.log(`\nSaved ${company.branches.length} branch(es) on ${company.companyCode}.`);
  }

  console.log("\nDone. Punch within 50m of 28.6293453, 77.2222984");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
