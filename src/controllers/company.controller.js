/**
 * COMPANY CONTROLLER — /api/companies
 * Super Admin and Admin only. Company CRUD is under Administration.
 */
const mongoose = require("mongoose");
const Company = require("../models/Company");
const User = require("../models/User");
const {
  escapeRegex,
  hasGlobalCompanyAccess,
  userCompanyIds,
} = require("../utils/companyScope");

const okId = (id) => mongoose.Types.ObjectId.isValid(id);

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

    if (typeof isActive === "boolean") filter.isActive = isActive;

    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ companyName: rx }, { companyCode: rx }];
    }

    const [total, data] = await Promise.all([
      Company.countDocuments(filter),
      Company.find(filter).sort({ companyName: 1 }).skip(skip).limit(limit),
    ]);

    return res.json({
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
    const row = await Company.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Company not found" });
    return res.json({ data: row });
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

    const row = await Company.create({
      companyName,
      companyCode,
      isActive: req.body.isActive !== false,
      branches: req.body.branches || [],
    });

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
    if (req.body.branches !== undefined) row.branches = req.body.branches;

    await row.save();
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

const listCompanyBranches = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid company id" });
    }
    const row = await Company.findById(req.params.id)
      .select("companyName companyCode isActive branches")
      .lean();
    if (!row) return res.status(404).json({ message: "Company not found" });

    if (!hasGlobalCompanyAccess(req.user)) {
      const mine = userCompanyIds(req.user);
      if (!mine.includes(String(row._id))) {
        return res.status(403).json({ message: "You cannot view this company" });
      }
    }

    const branches = (row.branches || [])
      .filter((b) => b.isActive !== false)
      .map((b) => ({
        _id: b._id,
        branchName: b.branchName,
        branchCode: b.branchCode,
        city: b.city || "",
        state: b.state || "",
        shifts: (b.shifts || [])
          .filter((s) => s.isActive !== false)
          .map((s) => ({
            _id: s._id,
            shiftName: s.shiftName,
            shiftCode: s.shiftCode,
          })),
      }));

    return res.json({
      data: {
        companyId: row._id,
        companyName: row.companyName,
        companyCode: row.companyCode,
        branches,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const listCompanyBranchShifts = async (req, res) => {
  try {
    if (!okId(req.params.id) || !okId(req.params.branchId)) {
      return res.status(400).json({ message: "Invalid company or branch id" });
    }
    const row = await Company.findById(req.params.id)
      .select("companyName companyCode branches")
      .lean();
    if (!row) return res.status(404).json({ message: "Company not found" });

    if (!hasGlobalCompanyAccess(req.user)) {
      const mine = userCompanyIds(req.user);
      if (!mine.includes(String(row._id))) {
        return res.status(403).json({ message: "You cannot view this company" });
      }
    }

    const branch = (row.branches || []).find(
      (b) => String(b._id) === String(req.params.branchId) && b.isActive !== false
    );
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    const shifts = (branch.shifts || [])
      .filter((s) => s.isActive !== false)
      .map((s) => ({
        _id: s._id,
        shiftName: s.shiftName,
        shiftCode: s.shiftCode,
      }));

    return res.json({
      data: {
        companyId: row._id,
        companyName: row.companyName,
        branch: {
          _id: branch._id,
          branchName: branch.branchName,
          branchCode: branch.branchCode,
        },
        shifts,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listCompanies,
  getCompany,
  listCompanyBranches,
  listCompanyBranchShifts,
  createCompany,
  updateCompany,
  deleteCompany,
};
