/**
 * HOLIDAY CONTROLLER — /api/holidays
 * Catalog: name, date, description, isActive.
 * Assignment: companyIds on the same holiday. Bulk assign adds, removes, or replaces companies.
 */
const mongoose = require("mongoose");
const Holiday = require("../models/Holiday");
const Company = require("../models/Company");
const {
  escapeRegex,
  hasGlobalCompanyAccess,
  managementCompanyIds,
  userCompanyIds,
} = require("../utils/companyScope");

const COMPANY_POPULATE = { path: "companyIds", select: "companyName companyCode" };
const okId = (id) => mongoose.Types.ObjectId.isValid(id);

const duplicateMessage = (err) => {
  if (err?.code !== 11000) return null;
  return "A holiday already exists on this date";
};

const allowedCompanyIds = (user) =>
  hasGlobalCompanyAccess(user) ? null : managementCompanyIds(user);

/** null = every company. Otherwise the actor may only touch these ids. */
const deniedCompany = (user, companyIds) => {
  const allowed = allowedCompanyIds(user);
  if (!allowed) return "";
  const mine = new Set(allowed.map(String));
  const blocked = companyIds.filter((id) => !mine.has(String(id)));
  if (!blocked.length) return "";
  return "You can only assign holidays to your own companies";
};

/** Hide companies the actor cannot see. */
const visibleRow = (user, row) => {
  if (!row || hasGlobalCompanyAccess(user)) return row;
  const mine = new Set(allowedCompanyIds(user).map(String));
  const companyIds = (row.companyIds || []).filter((company) =>
    mine.has(String(company?._id || company))
  );
  return { ...row, companyIds };
};

const missingCompanies = async (companyIds) => {
  const ids = [...new Set(companyIds.map(String))];
  const found = await Company.find({ _id: { $in: ids } }).distinct("_id");
  const has = new Set(found.map(String));
  const bad = ids.filter((id) => !has.has(id));
  return bad.length ? "Selected company was not found. Choose a company from the list" : "";
};

const loadHolidays = async (holidayIds) => {
  const ids = [...new Set(holidayIds.map(String))];
  const rows = await Holiday.find({ _id: { $in: ids } }).select("_id companyIds");
  if (rows.length !== ids.length) {
    const has = new Set(rows.map((row) => String(row._id)));
    const bad = ids.filter((id) => !has.has(id));
    return { error: "Selected holiday was not found" };
  }
  return { rows };
};

/** HR cannot edit a holiday that is also assigned outside their companies. */
const outsideActor = (user, rows) => {
  const allowed = allowedCompanyIds(user);
  if (!allowed) return "";
  const mine = new Set(allowed.map(String));
  const shared = rows.some((row) =>
    (row.companyIds || []).some((id) => !mine.has(String(id)))
  );
  return shared ? "This holiday is assigned to a company you cannot manage" : "";
};

const listHolidays = async (req, res) => {
  try {
    const { companyId, year, from, to, isActive, search, page, limit } = req.query;
    const skip = (page - 1) * limit;
    const filter = {};

    if (companyId) {
      const denied = deniedCompany(req.user, [companyId]);
      if (denied) return res.status(403).json({ message: denied });
      filter.companyIds = companyId;
    } else if (!hasGlobalCompanyAccess(req.user)) {
      filter.companyIds = { $in: allowedCompanyIds(req.user) };
    }

    if (typeof isActive === "boolean") filter.isActive = isActive;
    if (year) {
      filter.date = { $gte: `${year}-01-01`, $lte: `${year}-12-31` };
    } else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (search) filter.name = new RegExp(escapeRegex(search), "i");

    const [total, rows] = await Promise.all([
      Holiday.countDocuments(filter),
      Holiday.find(filter)
        .sort({ date: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .populate(COMPANY_POPULATE)
        .lean(),
    ]);

    return res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      data: rows.map((row) => visibleRow(req.user, row)),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getHoliday = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Holiday is not valid" });
    }
    const row = await Holiday.findById(req.params.id).populate(COMPANY_POPULATE).lean();
    if (!row) return res.status(404).json({ message: "Holiday not found" });
    if (!hasGlobalCompanyAccess(req.user)) {
      const mine = new Set(allowedCompanyIds(req.user).map(String));
      const assigned = (row.companyIds || []).some((company) => mine.has(String(company?._id || company)));
      if (!assigned) return res.status(403).json({ message: "You cannot view this holiday" });
    }
    return res.json({ data: visibleRow(req.user, row) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createHoliday = async (req, res) => {
  try {
    const row = await Holiday.create({
      name: String(req.body.name).trim(),
      date: req.body.date,
      description: req.body.description || "",
      isActive: req.body.isActive !== false,
      companyIds: [],
    });
    return res.status(201).json({ message: "Holiday created", data: row });
  } catch (err) {
    const dup = duplicateMessage(err);
    if (dup) return res.status(409).json({ message: dup });
    return res.status(500).json({ message: err.message });
  }
};

const updateHoliday = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Holiday is not valid" });
    }
    const row = await Holiday.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Holiday not found" });
    const blocked = outsideActor(req.user, [row]);
    if (blocked) return res.status(403).json({ message: blocked });

    if (req.body.name !== undefined) row.name = String(req.body.name).trim();
    if (req.body.date !== undefined) row.date = req.body.date;
    if (req.body.description !== undefined) row.description = req.body.description;
    if (req.body.isActive !== undefined) row.isActive = req.body.isActive;

    await row.save();
    await row.populate(COMPANY_POPULATE);
    return res.json({ message: "Holiday updated", data: visibleRow(req.user, row.toObject()) });
  } catch (err) {
    const dup = duplicateMessage(err);
    if (dup) return res.status(409).json({ message: dup });
    return res.status(500).json({ message: err.message });
  }
};

const deleteHoliday = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Holiday is not valid" });
    }
    const row = await Holiday.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Holiday not found" });
    const blocked = outsideActor(req.user, [row]);
    if (blocked) return res.status(403).json({ message: blocked });
    await row.deleteOne();
    return res.json({ message: "Holiday deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const assignHolidays = async (req, res) => {
  try {
    const { holidayIds, companyIds, mode } = req.body;
    const denied = deniedCompany(req.user, companyIds);
    if (denied) return res.status(403).json({ message: denied });

    const missing = await missingCompanies(companyIds);
    if (missing) return res.status(400).json({ message: missing });

    const loaded = await loadHolidays(holidayIds);
    if (loaded.error) return res.status(404).json({ message: loaded.error });
    if (mode === "replace") {
      const blocked = outsideActor(req.user, loaded.rows);
      if (blocked) return res.status(403).json({ message: blocked });
    }

    const ids = loaded.rows.map((row) => row._id);
    if (mode === "remove") {
      await Holiday.updateMany({ _id: { $in: ids } }, { $pull: { companyIds: { $in: companyIds } } });
    } else if (mode === "replace") {
      await Holiday.updateMany({ _id: { $in: ids } }, { $set: { companyIds } });
    } else {
      await Holiday.updateMany(
        { _id: { $in: ids } },
        { $addToSet: { companyIds: { $each: companyIds } } }
      );
    }

    const data = await Holiday.find({ _id: { $in: ids } })
      .sort({ date: 1 })
      .populate(COMPANY_POPULATE)
      .lean();

    const message =
      mode === "remove"
        ? "Holiday unassigned"
        : mode === "replace"
          ? "Holiday assignment replaced"
          : "Holiday assigned";
    return res.json({
      message,
      data: data.map((row) => visibleRow(req.user, row)),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** Employee self list — holidays assigned to their company. */
const myHolidays = async (req, res) => {
  try {
    const companyIds = userCompanyIds(req.user);
    const { year, from, to, isActive, search, page, limit } = req.query;
    const skip = (page - 1) * limit;
    if (!companyIds.length) {
      return res.json({ total: 0, page, limit, pages: 1, data: [] });
    }

    const filter = { companyIds: { $in: companyIds } };
    if (typeof isActive === "boolean") filter.isActive = isActive;
    else filter.isActive = true;
    if (year) {
      filter.date = { $gte: `${year}-01-01`, $lte: `${year}-12-31` };
    } else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (search) filter.name = new RegExp(escapeRegex(search), "i");

    const [total, rows] = await Promise.all([
      Holiday.countDocuments(filter),
      Holiday.find(filter)
        .select("name date description isActive")
        .sort({ date: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      data: rows,
    });
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
  assignHolidays,
  myHolidays,
};
