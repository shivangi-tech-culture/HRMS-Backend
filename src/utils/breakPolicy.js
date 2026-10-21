/**
 * Break policies: Lunch (fixed minutes) and flexible breaks with no daily count.
 * Employees only see published policies. Any number can be published.
 */
const BreakPolicy = require("../models/BreakPolicy");

const DEFAULTS = [
  {
    name: "Lunch Break",
    minutes: 30,
    flexible: false,
    published: true,
    description: "Fixed lunch time. Unused minutes stay and can be taken later the same day.",
  },
  {
    name: "Day Break",
    minutes: null,
    flexible: true,
    published: true,
    description: "Take 5 or 10 minutes whenever needed. No limit on how many times.",
  },
];

const seedBreakPolicies = async () => {
  try {
    await BreakPolicy.syncIndexes();
  } catch (err) {
    /* old key index is replaced by the name index */
  }

  await BreakPolicy.updateMany(
    { name: { $in: [null, ""] } },
    { $set: { published: false } }
  );

  let added = 0;
  for (const rule of DEFAULTS) {
    const existing = await BreakPolicy.findOne({ companyId: null, name: rule.name });
    if (existing) continue;
    await BreakPolicy.create({ companyId: null, ...rule });
    added += 1;
  }
  return { added };
};

const publishedPolicies = () =>
  BreakPolicy.find({ companyId: null, published: true, name: { $nin: [null, ""] } })
    .sort({ flexible: 1, name: 1 })
    .lean();

const findPublishedByName = (name) => {
  const clean = String(name || "").trim();
  if (!clean) return null;
  return BreakPolicy.findOne({
    companyId: null,
    published: true,
    name: new RegExp(`^${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  });
};

module.exports = {
  seedBreakPolicies,
  publishedPolicies,
  findPublishedByName,
};
