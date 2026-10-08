/**
 * COMPANY CONTROLLER — /api/companies (plain CRUD)
 * Create / Update / Delete: Super Admin and Admin only.
 * List / Get: Super Admin and Admin see every company.
 * HR sees every company on official.companyIds (own + assigned). Others see only their company.
 * GET /:id is the full company — branches → shifts → monthlySchedule + reportingManagers.
 * branches[].branchId / shifts[].shiftId are master ids; responses populate { _id, name, code }.
 */
const mongoose = require("mongoose");
const Company = require("../models/Company");
const User = require("../models/User");
const { getModel } = require("../models/Master");
const {
  escapeRegex,
  hasGlobalCompanyAccess,
  managementCompanyIds,
} = require("../utils/companyScope");
const { MANAGER_ROLES } = require("../utils/teamScope");
const { normalizeDayClock } = require("../utils/shiftTiming");

const { MASTER_POPULATE } = Company;

const normalizeBranches = (branches) =>
  (branches || []).map((branch) => ({
    ...branch,
    shifts: (branch.shifts || []).map((shift) => ({
      ...shift,
      monthlySchedule: (shift.monthlySchedule || []).map((week) => ({
        ...week,
        days: (week.days || []).map((day) => normalizeDayClock(day)),
      })),
    })),
  }));
const okId = (id) => mongoose.Types.ObjectId.isValid(id);

/** 400 message when a branchId / shiftId is not an existing master, else "" */
const missingMasters = async (branches = []) => {
  const branchIds = [...new Set(branches.map((b) => String(b.branchId)))];
  const shiftIds = [
    ...new Set(branches.flatMap((b) => (b.shifts || []).map((s) => String(s.shiftId)))),
  ];
  const [foundBranches, foundShifts] = await Promise.all([
    getModel("branch").find({ _id: { $in: branchIds } }).distinct("_id"),
    getModel("shift").find({ _id: { $in: shiftIds } }).distinct("_id"),
  ]);
  const has = (list) => new Set(list.map(String));
  const okB = has(foundBranches);
  const okS = has(foundShifts);
  const badB = branchIds.filter((id) => !okB.has(id));
  const badS = shiftIds.filter((id) => !okS.has(id));
  if (badB.length) return `Branch master not found: ${badB.join(", ")}`;
  if (badS.length) return `Shift master not found: ${badS.join(", ")}`;
  return "";
};

const canViewCompany = (user, companyId) =>
  hasGlobalCompanyAccess(user) || managementCompanyIds(user).includes(String(companyId));

const nameTaken = async (companyName, excludeId) => {
  const filter = {
    companyName: new RegExp(`^${escapeRegex(companyName)}$`, "i"),
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return Company.findOne(filter).select("_id").lean();
};

const codeTaken = async (companyCode, excludeId) => {
  const filter = {
    companyCode: String(companyCode || "").trim().toUpperCase(),
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return Company.findOne(filter).select("_id").lean();
};

const duplicateMessage = (err) => {
  if (err?.code !== 11000) return null;
  return "Company code already exists";
};

const listCompanies = async (req, res) => {
  try {
    const { isActive, search, page, limit } = req.query;
    const skip = (page - 1) * limit;
    const filter = {};

    if (!hasGlobalCompanyAccess(req.user)) {
      filter._id = { $in: managementCompanyIds(req.user) };
    }
    if (typeof isActive === "boolean") filter.isActive = isActive;

    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ companyName: rx }, { companyCode: rx }];
    }

    const [total, data] = await Promise.all([
      Company.countDocuments(filter),
      Company.find(filter)
        .select(
          "companyName companyCode isActive branches.branchId branches.isActive branches.shifts.shiftId branches.shifts.isActive"
        )
        .sort({ companyName: 1 })
        .skip(skip)
        .limit(limit)
        .populate(MASTER_POPULATE)
        .lean(),
    ]);

    const all = hasGlobalCompanyAccess(req.user);
    return res.json({
      scope: all ? "all" : "assigned",
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getCompany = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid company id" });
    }
    const row = await Company.findById(req.params.id)
      .populate(MASTER_POPULATE)
      .lean();
    if (!row) return res.status(404).json({ message: "Company not found" });
    if (!canViewCompany(req.user, row._id)) {
      return res.status(403).json({ message: "You cannot view this company" });
    }

    const managers = await User.find({
      role: { $in: MANAGER_ROLES },
      status: "Active",
      "official.companyIds": row._id,
    })
      .select("name official.employeeCode official.officialEmail")
      .sort({ name: 1 })
      .lean();

    return res.json({
      data: {
        ...row,
        reportingManagers: managers.map((m) => ({
          _id: m._id,
          name: m.name,
          employeeCode: m.official?.employeeCode || "",
          email: m.official?.officialEmail || "",
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createCompany = async (req, res) => {
  try {
    const companyName = String(req.body.companyName).trim();
    const companyCode = String(req.body.companyCode).trim().toUpperCase();

    if (await nameTaken(companyName)) {
      return res.status(409).json({ message: "Company name already exists" });
    }
    if (await codeTaken(companyCode)) {
      return res.status(409).json({ message: "Company code already exists" });
    }
    const missing = await missingMasters(req.body.branches);
    if (missing) return res.status(400).json({ message: missing });

    const row = await Company.create({
      companyName,
      companyCode,
      isActive: req.body.isActive !== false,
      branches: normalizeBranches(req.body.branches || []),
    });
    await row.populate(MASTER_POPULATE);

    return res.status(201).json({ message: "Company created", data: row });
  } catch (err) {
    const dup = duplicateMessage(err);
    if (dup) return res.status(409).json({ message: dup });
    return res.status(500).json({ message: err.message });
  }
};

const updateCompany = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid company id" });
    }
    const row = await Company.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Company not found" });

    if (req.body.companyName !== undefined) {
      const companyName = String(req.body.companyName).trim();
      if (await nameTaken(companyName, row._id)) {
        return res.status(409).json({ message: "Company name already exists" });
      }
      row.companyName = companyName;
    }

    if (req.body.companyCode !== undefined) {
      const companyCode = String(req.body.companyCode).trim().toUpperCase();
      if (await codeTaken(companyCode, row._id)) {
        return res.status(409).json({ message: "Company code already exists" });
      }
      row.companyCode = companyCode;
    }

    if (req.body.isActive !== undefined) row.isActive = req.body.isActive;
    if (req.body.branches !== undefined) {
      const missing = await missingMasters(req.body.branches);
      if (missing) return res.status(400).json({ message: missing });
      row.branches = normalizeBranches(req.body.branches);
    }

    await row.save();
    await row.populate(MASTER_POPULATE);
    return res.json({ message: "Company updated", data: row });
  } catch (err) {
    const dup = duplicateMessage(err);
    if (dup) return res.status(409).json({ message: dup });
    return res.status(500).json({ message: err.message });
  }
};

const deleteCompany = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid company id" });
    }
    const row = await Company.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Company not found" });

    const users = await User.countDocuments({ "official.companyIds": row._id });
    if (users) {
      return res.status(409).json({
        message: `Company has ${users} user(s). Move them or set isActive: false instead.`,
      });
    }

    await row.deleteOne();
    return res.json({ message: "Company deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany,
};
