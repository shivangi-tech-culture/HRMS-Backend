/**
 * Master CRUD — /api/masters
 * All master rows are GLOBAL (shared across companies).
 * Company is not a master — use /api/companies.
 */
const mongoose = require("mongoose");
const {
  TYPES,
  getModel,
  toMasterDto,
  findMasterById,
  findMasterByIdLean,
  GENERAL_INFO_DROPDOWNS,
} = require("../models/Master");

const okId = (id) => mongoose.Types.ObjectId.isValid(id);

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GET /api/masters/meta
 */
const listMasterMeta = async (_req, res) => {
  try {
    return res.json({
      types: TYPES,
      global: true,
      note: "Masters are global dropdowns. Company is not a master — create and list it at GET/POST /api/companies (Super Admin and Admin). Users store official.companyIds.",
      companyModule: "/api/companies",
      generalInfoModules: [
        "personal",
        "official",
        "other",
        "education",
        "accounts",
        "family",
        "nominees",
        "experience",
        "visas",
      ],
      dropdowns: GENERAL_INFO_DROPDOWNS,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/masters?type=&status=&search=&page=&limit=
 * No company filter — global catalog.
 */
const listMasters = async (req, res) => {
  try {
    const { type, status, page, limit } = req.query;
    const searchRaw =
      req.query.search ?? req.query.q ?? req.query.query ?? req.query.keyword;
    const search = searchRaw != null ? String(searchRaw).trim() : "";
    const skip = (page - 1) * limit;

    const Model = getModel(type);
    const and = [];

    if (status) and.push({ status });
    if (search) {
      and.push({ name: new RegExp(escapeRegex(search), "i") });
    }

    const filter = and.length ? { $and: and } : {};
    const [total, rows] = await Promise.all([
      Model.countDocuments(filter),
      Model.find(filter)
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return res.json({
      total,
      page,
      limit,
      pages: Math.max(Math.ceil(total / limit), 1),
      type,
      global: true,
      masters: rows.map((r) => toMasterDto(type, r)),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** GET /api/masters/:id */
const getMaster = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const found = await findMasterByIdLean(req.params.id);
    if (!found) return res.status(404).json({ message: "Not found" });
    return res.json({ master: found.row });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** Case-insensitive duplicate name (global) */
const findDuplicateName = async (Model, { name, excludeId }) => {
  const filter = {
    name: new RegExp(`^${escapeRegex(name)}$`, "i"),
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return Model.findOne(filter).lean();
};

/** POST /api/masters */
const createMaster = async (req, res) => {
  try {
    const { type, name, status } = req.body;
    const Model = getModel(type);
    const trimmedName = String(name).trim();

    const dup = await findDuplicateName(Model, { name: trimmedName });
    if (dup) {
      return res.status(400).json({
        message: `"${trimmedName}" already exists`,
      });
    }

    const created = await Model.create({
      name: trimmedName,
      status: status || "Active",
      company: "",
    });

    return res.status(201).json({
      message: "Created",
      master: toMasterDto(type, created),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: "Already exists" });
    }
    return res.status(500).json({ message: err.message });
  }
};

/** PUT /api/masters/:id */
const updateMaster = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const found = await findMasterById(req.params.id);
    if (!found) return res.status(404).json({ message: "Not found" });

    const { type, row, Model } = found;

    if (req.body.name !== undefined) {
      const nextName = String(req.body.name).trim();
      if (!nextName) {
        return res.status(400).json({ message: "name is required" });
      }
      row.name = nextName;
    }
    if (req.body.status !== undefined) row.status = req.body.status;

    // Ignore company — masters are global
    row.company = "";

    const dup = await findDuplicateName(Model, {
      name: row.name,
      excludeId: row._id,
    });
    if (dup) {
      return res.status(400).json({
        message: `"${row.name}" already exists`,
      });
    }

    await row.save();
    return res.json({
      message: "Updated",
      master: toMasterDto(type, row),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: "Already exists" });
    }
    return res.status(500).json({ message: err.message });
  }
};

/** DELETE /api/masters/:id */
const deleteMaster = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const found = await findMasterById(req.params.id);
    if (!found) return res.status(404).json({ message: "Not found" });

    const { type, row } = found;

    await row.deleteOne();
    return res.json({ message: "Deleted", id: req.params.id, type });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listMasterMeta,
  listMasters,
  getMaster,
  createMaster,
  updateMaster,
  deleteMaster,
};
