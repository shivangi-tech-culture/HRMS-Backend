/**
 * WORK TIMING CONTROLLER — /api/work-timings
 * Work → Work Timings
 */
const mongoose = require("mongoose");
const WorkTiming = require("../models/WorkTiming");
const {
  escapeRegex,
  resolveCompany,
  assertOwnCompany,
  hasGlobalCompanyAccess,
} = require("../utils/workScope");

const okId = (id) => mongoose.Types.ObjectId.isValid(id);

const listWorkTimings = async (req, res) => {
  try {
    const { status, company, search, page, limit } = req.query;
    const skip = (page - 1) * limit;
    const filter = {};
    if (status) filter.status = status;
    if (!hasGlobalCompanyAccess(req.user)) {
      const own = String(req.user?.official?.company || "").trim();
      if (!own) {
        return res.status(403).json({ message: "Your profile has no company" });
      }
      filter.company = new RegExp(`^${escapeRegex(own)}$`, "i");
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
      WorkTiming.countDocuments(filter),
      WorkTiming.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
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

const getWorkTiming = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const row = await WorkTiming.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Work timing not found" });
    const err = assertOwnCompany(req, row.company);
    if (err) return res.status(403).json({ message: err });
    return res.json({ data: row });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createWorkTiming = async (req, res) => {
  try {
    const company = resolveCompany(req, req.body.company);
    if (!company) return res.status(400).json({ message: "company is required" });
    const row = await WorkTiming.create({
      ...req.body,
      name: String(req.body.name).trim(),
      code: String(req.body.code).trim().toUpperCase(),
      company,
    });
    return res.status(201).json({ message: "Work timing created", data: row });
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: "Work timing code already exists for this company" });
    }
    return res.status(500).json({ message: err.message });
  }
};

const updateWorkTiming = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const row = await WorkTiming.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Work timing not found" });
    const err = assertOwnCompany(req, row.company);
    if (err) return res.status(403).json({ message: err });
    if (!hasGlobalCompanyAccess(req.user)) delete req.body.company;
    Object.assign(row, req.body);
    if (req.body.name) row.name = String(req.body.name).trim();
    if (req.body.code != null) {
      row.code = String(req.body.code).trim().toUpperCase();
    }
    await row.save();
    return res.json({ message: "Work timing updated", data: row });
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: "Work timing code already exists for this company" });
    }
    return res.status(500).json({ message: err.message });
  }
};

const deleteWorkTiming = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const row = await WorkTiming.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Work timing not found" });
    const err = assertOwnCompany(req, row.company);
    if (err) return res.status(403).json({ message: err });
    await row.deleteOne();
    return res.json({ message: "Work timing deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listWorkTimings,
  getWorkTiming,
  createWorkTiming,
  updateWorkTiming,
  deleteWorkTiming,
};
