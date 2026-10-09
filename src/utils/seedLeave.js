/**
 * Default leave catalog from the Leave Types and Leave Policies screens.
 * Inserts missing rows only. Does not change a type or policy that already exists.
 */
const LeaveType = require("../models/LeaveType");
const LeavePolicy = require("../models/LeavePolicy");
const { pushTypeToBalances } = require("./leaveBalance");

const DEFAULT_TYPES = [
  { name: "Casual Leave", code: "CL", paid: true, maxDays: 12, carryForward: false },
  { name: "Sick Leave", code: "SL", paid: true, maxDays: 10, carryForward: false },
  { name: "Annual Leave", code: "AL", paid: true, maxDays: 18, carryForward: true },
  { name: "Comp Off", code: "CO", paid: true, maxDays: 5, carryForward: true },
  { name: "Unpaid Leave", code: "UL", paid: false, maxDays: 30, carryForward: false },
  { name: "Maternity Leave", code: "ML", paid: true, maxDays: 180, carryForward: false },
  { name: "Paternity Leave", code: "PL", paid: true, maxDays: 15, carryForward: false },
  { name: "Bereavement Leave", code: "BL", paid: true, maxDays: 5, carryForward: false, status: "Inactive" },
];

const DEFAULT_POLICIES = [
  ["leaveYearStarts", "Leave year starts", "1 April", "Start date of the leave accrual year."],
  ["allowCarryForward", "Allow carry forward", "Yes", "Unused annual leave can be carried to next year."],
  ["maxCarryForwardDays", "Max carry forward days", "10 days", "Maximum annual leave days allowed to carry forward."],
  ["minNotice", "Min notice for leave", "1 day", "Minimum advance notice required before applying leave."],
  ["sandwichRule", "Sandwich rule", "No", "Weekends/holidays between leave days counted as leave."],
  ["halfDayAllowed", "Half day leave allowed", "Yes", "Employees can apply for half day leave sessions."],
  ["autoApproveSick", "Auto approve sick leave", "No", "Sick leave still requires manager approval."],
  ["leaveEncashment", "Leave encashment", "Yes", "Allow encashment of unused leave at year end."],
];

const seedPolicies = async () => {
  let added = 0;
  for (const [key, label, value, description] of DEFAULT_POLICIES) {
    const result = await LeavePolicy.updateOne(
      { scope: "common", key },
      {
        $setOnInsert: {
          scope: "common",
          companyId: null,
          key,
          label,
          value,
          description,
          hidden: false,
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount) added += 1;
  }
  return added;
};

const seedLeaveDefaults = async () => {
  await LeavePolicy.updateMany(
    { companyId: { $ne: null }, scope: { $exists: false } },
    { $set: { scope: "company", hidden: false } }
  );
  await LeavePolicy.syncIndexes();

  let typesAdded = 0;
  for (const type of DEFAULT_TYPES) {
    const result = await LeaveType.updateOne(
      { scope: "common", code: type.code },
      {
        $setOnInsert: {
          scope: "common",
          companyId: null,
          name: type.name,
          code: type.code,
          paid: type.paid,
          maxDays: type.maxDays,
          carryForward: type.carryForward,
          status: type.status || "Active",
        },
      },
      { upsert: true }
    );
    if (!result.upsertedId) continue;
    typesAdded += 1;
    const saved = await LeaveType.findById(result.upsertedId);
    if (saved) await pushTypeToBalances(saved);
  }

  const policiesAdded = await seedPolicies();
  return { typesAdded, policiesAdded };
};

module.exports = {
  DEFAULT_TYPES,
  DEFAULT_POLICIES,
  seedPolicies,
  seedLeaveDefaults,
};
