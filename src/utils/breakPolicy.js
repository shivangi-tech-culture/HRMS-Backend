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
    description:
      "Fixed minutes from policy (change anytime, e.g. 30 → 45). Remaining = policy minutes − used today.",
  },
  {
    name: "Tea Break",
    minutes: 15,
    flexible: false,
    published: true,
    description: "Fixed tea minutes from policy. Used after Lunch remaining is 0.",
  },
  {
    name: "Day Break",
    minutes: null,
    flexible: true,
    published: true,
    description:
      "Needs RM/HR approval first (day-request). Approved minutes (10/15/…) then employee can start.",
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
