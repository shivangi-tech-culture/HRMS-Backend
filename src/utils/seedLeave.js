/**
 * Leave catalog for the finalized policy.
 * Casual Leave (CL) 12, one per month of a calendar quarter. Unused quarter days expire.
 * First 3 months from date of joining are probation: no leave. The completion month counts
 * only when probation ends after the 1st. Earned Leave (EL) is 6 per year after probation.
 * Comp Off is credited per extra working day. Unpaid Leave is 30.
 */
const LeaveType = require("../models/LeaveType");
const LeavePolicy = require("../models/LeavePolicy");
const LeaveRequest = require("../models/LeaveRequest");
const User = require("../models/User");
const { pushTypeToBalances, stampLine, leaveLine, leaveYear } = require("./leaveBalance");

const RETIRED_CODES = ["QL", "SL", "AL", "ML", "PL", "BL"];

const DEFAULT_TYPES = [
  {
    name: "Casual Leave",
    code: "CL",
    paid: true,
    maxDays: 12,
    allocationType: "quarterly",
    quarterlyLimit: 3,
    isUnlimited: false,
    carryForward: false,
  },
  {
    name: "Earned Leave",
    code: "EL",
    paid: true,
    maxDays: 6,
    allocationType: "yearly",
    quarterlyLimit: null,
    isUnlimited: false,
    carryForward: false,
  },
  {
    name: "Comp Off",
    code: "CO",
    paid: true,
    maxDays: null,
    allocationType: "earned",
    quarterlyLimit: null,
    isUnlimited: true,
    carryForward: true,
  },
  {
    name: "Unpaid Leave",
    code: "UL",
    paid: false,
    maxDays: 30,
    allocationType: "yearly",
    quarterlyLimit: null,
    isUnlimited: false,
    carryForward: false,
  },
];

const DEFAULT_POLICIES = [
  ["leaveYearStarts", "Leave year starts", "1 April", "Leave year is April–March. Casual Leave uses calendar quarters."],
  ["allowCarryForward", "Allow carry forward", "Comp Off only", "Casual Leave unused days expire at the end of that quarter."],
  ["maxCarryForwardDays", "Max carry forward days", "Earned Comp Off", "Comp Off has no yearly cap. Balance is only the days credited."],
  ["probationLeave", "Probation", "3 months", "No leave during probation. Probation ends 3 months after the date of joining. If it ends on the 1st, that month has no Casual Leave."],
  ["quarterlyLeave", "Casual Leave", "1 per month, 3 per full quarter", "Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec. Take the quarter's days any time in that quarter. Unused days expire."],
  ["emergencyLeave", "Earned Leave", "6 per year", "After probation, usable any time in the leave year. Separate from Casual Leave."],
  ["compOffEarn", "Comp Off earn rule", "1 extra working day = 1 Comp Off", "One eligible extra working day credits one Comp Off. It is not granted automatically."],
  ["unpaidLeave", "Unpaid Leave", "30 per year", "Salary is deducted. Limit can be changed in Leave Master."],
  ["minNotice", "Min notice for leave", "1 day", "Minimum advance notice required before applying leave."],
  ["sandwichRule", "Sandwich rule", "No", "Weekends/holidays between leave days counted as leave."],
  ["halfDayAllowed", "Half day leave allowed", "Yes", "Employees can apply for half day leave sessions."],
  ["autoApproveSick", "Auto approve sick leave", "No", "There is no separate sick leave type."],
  ["leaveEncashment", "Leave encashment", "No", "Unused Casual Leave expires. It is not encashed."],
];

const typeFields = (type) => ({
  name: type.name,
  paid: type.paid,
  maxDays: type.maxDays,
  allocationType: type.allocationType,
  quarterlyLimit: type.quarterlyLimit,
  isUnlimited: type.isUnlimited,
  carryForward: type.carryForward,
  status: "Active",
  hidden: false,
});

const upsertCommonTypes = async () => {
  let added = 0;
  let updated = 0;
  for (const type of DEFAULT_TYPES) {
    const existing = await LeaveType.findOne({ scope: "common", code: type.code });
    if (!existing) {
      const saved = await LeaveType.create({
        scope: "common",
        companyId: null,
        code: type.code,
        ...typeFields(type),
      });
      added += 1;
      await pushTypeToBalances(saved);
      continue;
    }
    Object.assign(existing, typeFields(type));
    await existing.save();
    updated += 1;
    await pushTypeToBalances(existing);
    const year = leaveYear();
    const users = await User.find({
      leaves: { $elemMatch: { leaveType: existing._id, year } },
    }).select("leaves");
    for (const user of users) {
      const line = leaveLine(user, existing._id, year);
      if (!line) continue;
      stampLine(line, existing);
      user.markModified("leaves");
      await user.save();
    }
  }
  return { added, updated };
};

/** Drop the previous catalog and any company copy of those codes. */
const retireOldTypes = async () => {
  const retired = await LeaveType.find({ code: { $in: RETIRED_CODES } }).select("_id code").lean();
  if (!retired.length) return { removed: 0, pendingCancelled: 0 };
  const ids = retired.map((row) => row._id);
  const cancelled = await LeaveRequest.updateMany(
    { leaveType: { $in: ids }, status: "Pending" },
    {
      $set: {
        status: "Cancelled",
        reviewReason: "Leave type removed by the updated leave policy",
        reviewedAt: new Date(),
      },
    }
  );
  await User.updateMany(
    { $or: [{ "leaves.leaveType": { $in: ids } }, { "leaveAdjustments.leaveType": { $in: ids } }] },
    {
      $pull: {
        leaves: { leaveType: { $in: ids } },
        leaveAdjustments: { leaveType: { $in: ids } },
      },
    }
  );
  const referenced = await LeaveRequest.distinct("leaveType", { leaveType: { $in: ids } });
  const keep = new Set(referenced.map((id) => String(id)));
  const dropIds = ids.filter((id) => !keep.has(String(id)));
  const hideIds = ids.filter((id) => keep.has(String(id)));
  if (hideIds.length) {
    await LeaveType.updateMany({ _id: { $in: hideIds } }, { $set: { status: "Inactive", hidden: true } });
  }
  if (dropIds.length) await LeaveType.deleteMany({ _id: { $in: dropIds } });
  return { removed: retired.length, pendingCancelled: cancelled.modifiedCount || 0 };
};

/** A company copy of QL / EL / CO / UL must follow the same rules, or it would replace the common row. */
const alignCompanyCopies = async () => {
  let aligned = 0;
  for (const type of DEFAULT_TYPES) {
    const rows = await LeaveType.find({ scope: "company", code: type.code });
    for (const row of rows) {
      Object.assign(row, typeFields(type));
      await row.save();
      await pushTypeToBalances(row);
      aligned += 1;
    }
  }
  return aligned;
};

const seedPolicies = async () => {
  let added = 0;
  let updated = 0;
  for (const [key, label, value, description] of DEFAULT_POLICIES) {
    const existing = await LeavePolicy.findOne({ scope: "common", key });
    if (!existing) {
      await LeavePolicy.create({
        scope: "common",
        companyId: null,
        key,
        label,
        value,
        description,
        hidden: false,
      });
      added += 1;
      continue;
    }
    existing.label = label;
    existing.value = value;
    existing.description = description;
    existing.hidden = false;
    await existing.save();
    updated += 1;
  }
  return { added, updated };
};

/** Quarterly Leave (QL) becomes Casual Leave (CL) on the same row, so wallets keep their id. */
const renameQuarterlyToCasual = async () => {
  const rows = await LeaveType.find({ code: "QL" });
  for (const row of rows) {
    const clash = await LeaveType.findOne({
      scope: row.scope,
      companyId: row.companyId || null,
      code: "CL",
      _id: { $ne: row._id },
    });
    if (clash) await LeaveType.deleteOne({ _id: clash._id });
    row.code = "CL";
    row.name = "Casual Leave";
    await row.save();
  }
};

const seedLeaveDefaults = async () => {
  await LeavePolicy.updateMany(
    { companyId: { $ne: null }, scope: { $exists: false } },
    { $set: { scope: "company", hidden: false } }
  );
  await LeavePolicy.syncIndexes();
  await renameQuarterlyToCasual();

  const retired = await retireOldTypes();
  const types = await upsertCommonTypes();
  const companyCopies = await alignCompanyCopies();
  const policies = await seedPolicies();
  return {
    typesAdded: types.added,
    typesUpdated: types.updated,
    typesRemoved: retired.removed,
    companyCopies,
    pendingCancelled: retired.pendingCancelled,
    policiesAdded: policies.added,
    policiesUpdated: policies.updated,
  };
};

module.exports = {
  DEFAULT_TYPES,
  DEFAULT_POLICIES,
  RETIRED_CODES,
  seedPolicies,
  seedLeaveDefaults,
};
