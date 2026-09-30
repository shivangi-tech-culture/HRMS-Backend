/**
 * official.shift helpers — validate Shift id for employee official{}
 */
const mongoose = require("mongoose");
const Shift = require("../models/Shift");
const { normalizeCompany } = require("./companyScope");

const SHIFT_MANAGERS = ["Super Admin", "Admin", "HR Manager"];
const canManageShift = (user) => {
  const { normalizeRoleName } = require("../config/roles");
  return SHIFT_MANAGERS.includes(normalizeRoleName(user?.role));
};

/** Validate Active shift for company */
const resolveOfficialShift = async (shiftId, companyName) => {
  if (shiftId === undefined) return { skip: true };
  if (shiftId === null || shiftId === "") return { shiftId: null };

  if (!mongoose.Types.ObjectId.isValid(shiftId)) {
    return { status: 400, error: "official.shift must be a valid Shift id" };
  }

  const shift = await Shift.findById(shiftId);
  if (!shift || shift.status !== "Active") {
    return { status: 404, error: "Active shift not found" };
  }

  const empCo = normalizeCompany(companyName);
  if (empCo && normalizeCompany(shift.company) !== empCo) {
    return {
      status: 400,
      error: "Shift belongs to a different company than the employee",
    };
  }

  return { shiftId: shift._id, shift };
};

module.exports = {
  SHIFT_MANAGERS,
  canManageShift,
  resolveOfficialShift,
};
