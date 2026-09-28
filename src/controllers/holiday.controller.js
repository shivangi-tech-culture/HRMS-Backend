/**
 * HOLIDAY CONTROLLER — /api/holidays
 * Work → Holiday Calendar
 */
const mongoose = require("mongoose");
const Holiday = require("../models/Holiday");
const {
  escapeRegex,
  resolveCompany,
  assertOwnCompany,
  hasGlobalCompanyAccess,
} = require("../utils/workScope");

const okId = (id) => mongoose.Types.ObjectId.isValid(id);

const listHolidays = async (req, res) => {
  try {
    const { year, type, status, company, search, page, limit } = req.query;
    const skip = (page - 1) * limit;
    const filter = {};

    if (status) filter.status = status;
    if (type && type !== "All") filter.type = type;
    if (year) {
      filter.year = Number(year);
    }

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
      filter.name = new RegExp(escapeRegex(search), "i");
    }

    const [total, data] = await Promise.all([
      Holiday.countDocuments(filter),
      Holiday.find(filter).sort({ date: 1 }).skip(skip).limit(limit),
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

const getHoliday = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid holiday id" });
    }
    const row = await Holiday.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Holiday not found" });
    const err = assertOwnCompany(req, row.company);
    if (err) return res.status(403).json({ message: err });
    return res.json({ data: row });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createHoliday = async (req, res) => {
  try {
    const company = resolveCompany(req, req.body.company);
    if (!company) return res.status(400).json({ message: "company is required" });
    const year = Number(String(req.body.date).slice(0, 4));
    const row = await Holiday.create({
      ...req.body,
      name: String(req.body.name).trim(),
      company,
      year,
    });
    return res.status(201).json({ message: "Holiday created", data: row });
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: "Holiday already exists for this date" });
    }
    return res.status(500).json({ message: err.message });
  }
};

const updateHoliday = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid holiday id" });
    }
    const row = await Holiday.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Holiday not found" });
    const err = assertOwnCompany(req, row.company);
    if (err) return res.status(403).json({ message: err });
    if (!hasGlobalCompanyAccess(req.user)) delete req.body.company;

    Object.assign(row, req.body);
    if (req.body.name) row.name = String(req.body.name).trim();
    if (req.body.date) row.year = Number(String(req.body.date).slice(0, 4));
    await row.save();
    return res.json({ message: "Holiday updated", data: row });
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: "Holiday already exists for this date" });
    }
    return res.status(500).json({ message: err.message });
  }
};

const deleteHoliday = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid holiday id" });
    }
    const row = await Holiday.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Holiday not found" });
    const err = assertOwnCompany(req, row.company);
    if (err) return res.status(403).json({ message: err });
    await row.deleteOne();
    return res.json({ message: "Holiday deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listHolidays,
  getHoliday,
  createHoliday,
  updateHoliday,
  deleteHoliday,
};
