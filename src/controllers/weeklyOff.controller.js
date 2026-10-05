/**
 * WEEKLY OFF CONTROLLER — /api/weekly-offs
 * Work → Weekly Off
 */
const mongoose = require("mongoose");
const WeeklyOff = require("../models/WeeklyOff");
const {
  escapeRegex,
  resolveCompany,
  assertOwnCompany,
  hasGlobalCompanyAccess,
  companyNamesForUser,
} = require("../utils/workScope");

const okId = (id) => mongoose.Types.ObjectId.isValid(id);

/** Derive default off days from workingDays count (Sun+Sat for 5-day, Sun for 6-day) */
const defaultOffDays = (workingDays) => {
  const n = Number(workingDays) || 5;
  if (n >= 6) return [0];
  return [0, 6];
};

const listWeeklyOffs = async (req, res) => {
  try {
    const { status, company, search, page, limit } = req.query;
    const skip = (page - 1) * limit;
    const filter = {};
    if (status) filter.status = status;
    if (!hasGlobalCompanyAccess(req.user)) {
      const names = await companyNamesForUser(req.user);
      if (!names.length) {
        return res.status(403).json({ message: "Your profile has no company" });
      }
      filter.company =
        names.length === 1
          ? new RegExp(`^${escapeRegex(names[0])}$`, "i")
          : { $in: names.map((name) => new RegExp(`^${escapeRegex(name)}$`, "i")) };
    } else if (company) {
      filter.company = new RegExp(`^${escapeRegex(company)}$`, "i");
    }
    if (search) {
      filter.$or = [
        { name: new RegExp(escapeRegex(search), "i") },
        { code: new RegExp(escapeRegex(search), "i") },
      ];
    }
    const [total, data] = await Promise.all([
      WeeklyOff.countDocuments(filter),
      WeeklyOff.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
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

const getWeeklyOff = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const row = await WeeklyOff.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Weekly off policy not found" });
    const err = await assertOwnCompany(req, row.company);
    if (err) return res.status(403).json({ message: err });
    return res.json({ data: row });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createWeeklyOff = async (req, res) => {
  try {
    const company = await resolveCompany(req, req.body.company);
    if (!company) return res.status(400).json({ message: "company is required" });
    const workingDays = req.body.workingDays ?? 5;
    const offDays = req.body.offDays?.length
      ? req.body.offDays
      : defaultOffDays(workingDays);
    const row = await WeeklyOff.create({
      ...req.body,
      name: String(req.body.name).trim(),
      code: String(req.body.code).trim().toUpperCase(),
      company,
      workingDays,
      offDays,
    });
    return res
      .status(201)
      .json({ message: "Weekly off policy created", data: row });
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: "Weekly off code already exists for this company" });
    }
    return res.status(500).json({ message: err.message });
  }
};

const updateWeeklyOff = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const row = await WeeklyOff.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Weekly off policy not found" });
    const err = await assertOwnCompany(req, row.company);
    if (err) return res.status(403).json({ message: err });
    if (!hasGlobalCompanyAccess(req.user)) delete req.body.company;

    Object.assign(row, req.body);
    if (req.body.name) row.name = String(req.body.name).trim();
    if (req.body.code != null) {
      row.code = String(req.body.code).trim().toUpperCase();
    }
    if (req.body.workingDays != null && !req.body.offDays) {
      row.offDays = defaultOffDays(req.body.workingDays);
    }
    await row.save();
    return res.json({ message: "Weekly off policy updated", data: row });
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: "Weekly off code already exists for this company" });
    }
    return res.status(500).json({ message: err.message });
  }
};

const deleteWeeklyOff = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const row = await WeeklyOff.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Weekly off policy not found" });
    const err = await assertOwnCompany(req, row.company);
    if (err) return res.status(403).json({ message: err });
    await row.deleteOne();
    return res.json({ message: "Weekly off policy deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listWeeklyOffs,
  getWeeklyOff,
  createWeeklyOff,
  updateWeeklyOff,
  deleteWeeklyOff,
};
