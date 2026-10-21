/**
 * Two published breaks: Lunch (fixed minutes) and a flexible break with no daily count.
 * Any other policy stays hidden until it is published, and only 2 can be published.
 */
const BreakPolicy = require("../models/BreakPolicy");

const MAX_PUBLISHED = 2;

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
    .limit(MAX_PUBLISHED)
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

const publishedCount = (exceptId) => {
  const filter = { companyId: null, published: true, name: { $nin: [null, ""] } };
  if (exceptId) filter._id = { $ne: exceptId };
  return BreakPolicy.countDocuments(filter);
};

module.exports = {
  MAX_PUBLISHED,
  seedBreakPolicies,
  publishedPolicies,
  findPublishedByName,
  publishedCount,
};
