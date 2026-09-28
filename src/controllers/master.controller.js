/**
 * Master CRUD — /api/masters (one API)
 * GET: any logged-in user (Employee dropdowns — no Masters permission).
 * Write: admin + Masters → type permission. Save **name** on employee, not _id.
 * Company security: Super Admin/HR → login profile; Global Admin → body.
 */
const mongoose = require("mongoose");
const {
  TYPES,
  getModel,
  isCompanyType,
  toMasterDto,
  findMasterById,
  findMasterByIdLean,
  GENERAL_INFO_DROPDOWNS,
} = require("../models/Master");
const {
  hasGlobalCompanyAccess,
  getUserCompany,
  normalizeCompany,
} = require("../utils/companyScope");

const okId = (id) => mongoose.Types.ObjectId.isValid(id);

/** Block non–Global Admin from another company’s rows */
const assertOwnCompanyRow = (req, type, companyName) => {
  if (hasGlobalCompanyAccess(req.user)) return null;
  if (isCompanyType(type)) {
    return "Only Global Admin can manage company masters";
  }
  const own = getUserCompany(req.user);
  if (!own) return "Your profile has no company";
  if (normalizeCompany(companyName) !== own) {
    return "You can only manage masters for your own company";
  }
  return null;
};

/**
 * GET /api/masters/meta — types + General Info field→type map (ESS dropdown wiring)
 * No Masters permission — any logged-in user.
 */
const listMasterMeta = async (_req, res) => {
  try {
    return res.json({
      types: TYPES,
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
      note: "Save master name strings on employee profile (not _id). nomineeName is free text. Vaccination is not a General Info module.",
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** Escape user text so it is safe inside RegExp */
const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GET /api/masters?type=&status=&search|q=&company=&page=&limit=
 * Query validated by listMasterQuerySchema (type/status/page/limit/search).
 */
const listMasters = async (req, res) => {
  try {
    const { type, status, company, page, limit } = req.query;
    const searchRaw =
      req.query.search ?? req.query.q ?? req.query.query ?? req.query.keyword;
    const search = searchRaw != null ? String(searchRaw).trim() : "";
    const skip = (page - 1) * limit;

    const Model = getModel(type);
    const and = [];

    if (status) and.push({ status });

    let scopedCompany = "";
    if (!hasGlobalCompanyAccess(req.user)) {
      const ownRaw = String(req.user?.official?.company || "").trim();
      const own = normalizeCompany(ownRaw);
      if (!own) {
        return res.status(403).json({ message: "Your profile has no company" });
      }
      scopedCompany = ownRaw;
      if (isCompanyType(type)) {
        and.push({ name: new RegExp(`^${escapeRegex(ownRaw)}$`, "i") });
      } else {
        and.push({ company: new RegExp(`^${escapeRegex(ownRaw)}$`, "i") });
      }
    } else if (company && !isCompanyType(type)) {
      const co = String(company).trim();
      if (co) {
        scopedCompany = co;
        and.push({ company: new RegExp(`^${escapeRegex(co)}$`, "i") });
      }
    }

    if (search) {
      if (
        isCompanyType(type) &&
        scopedCompany &&
        !hasGlobalCompanyAccess(req.user)
      ) {
        if (!scopedCompany.toLowerCase().includes(search.toLowerCase())) {
          return res.json({
            total: 0,
            page,
            limit,
            pages: 1,
            data: [],
            filters: {
              type,
              status: status || "",
              search,
              company: scopedCompany,
            },
          });
        }
      } else {
        and.push({ name: new RegExp(escapeRegex(search), "i") });
      }
    }

    const filter =
      and.length === 0 ? {} : and.length === 1 ? and[0] : { $and: and };

    const [total, rows] = await Promise.all([
      Model.countDocuments(filter),
      Model.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
    ]);

    const data = rows.map((r) => toMasterDto(type, r));

    return res.json({
      total,
      page,
      limit,
      pages: Math.max(Math.ceil(total / limit), 1),
      data,
      filters: {
        type,
        status: status || "",
        search,
        company: scopedCompany || company || "",
      },
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

    if (!hasGlobalCompanyAccess(req.user)) {
      const own = getUserCompany(req.user);
      if (!own) {
        return res.status(403).json({ message: "Your profile has no company" });
      }
      const rowCompany = isCompanyType(found.type)
        ? found.row.name
        : found.row.company;
      if (normalizeCompany(rowCompany) !== own) {
        return res.status(403).json({
          message: "You can only view masters for your own company",
        });
      }
    }

    return res.json({ master: found.row });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * Parent company for department / designation / …
 * Global Admin → from body (required + must exist). Others → login profile only.
 */
const resolveScopedCompany = async (req, bodyCompany) => {
  if (hasGlobalCompanyAccess(req.user)) {
    const co = String(bodyCompany || "").trim();
    if (!co) {
      return {
        error: "company is required (which company this master belongs to)",
        status: 400,
      };
    }
    const exists = await companyMasterExists(co);
    if (!exists) {
      return {
        error: `company "${co}" not found in company master — create company first`,
        status: 400,
      };
    }
    return { company: co };
  }

  const own = String(req.user?.official?.company || "").trim();
  if (!own) {
    return {
      error: "Your profile has no company — cannot manage masters",
      status: 403,
    };
  }

  const sent = String(bodyCompany || "").trim();
  if (sent && normalizeCompany(sent) !== normalizeCompany(own)) {
    return {
      error: "You can only manage masters for your own company",
      status: 403,
    };
  }

  return { company: own };
};

/** Case-insensitive duplicate name within the same collection/company */
const findDuplicateName = async (Model, { name, company, excludeId, isCompany }) => {
  const filter = {
    name: new RegExp(`^${escapeRegex(name)}$`, "i"),
  };
  if (!isCompany) {
    filter.company = new RegExp(`^${escapeRegex(company || "")}$`, "i");
  }
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  return Model.findOne(filter).lean();
};

/** True if a company master row exists with this name */
const companyMasterExists = async (companyName) => {
  const Company = getModel("company");
  const row = await Company.findOne({
    name: new RegExp(`^${escapeRegex(companyName)}$`, "i"),
    status: "Active",
  }).lean();
  return Boolean(row);
};

/** POST /api/masters — company from login (non–Global) or body (Global Admin) */
const createMaster = async (req, res) => {
  try {
    const { type, name, status } = req.body;
    const Model = getModel(type);
    const trimmedName = String(name).trim();

    if (isCompanyType(type) && !hasGlobalCompanyAccess(req.user)) {
      return res.status(403).json({
        message: "Only Global Admin can create company",
      });
    }

    const payload = {
      name: trimmedName,
      status: status || "Active",
      company: "",
    };

    if (!isCompanyType(type)) {
      const resolved = await resolveScopedCompany(req, req.body.company);
      if (resolved.error) {
        return res.status(resolved.status || 400).json({ message: resolved.error });
      }
      payload.company = resolved.company;
    }

    const dup = await findDuplicateName(Model, {
      name: trimmedName,
      company: payload.company,
      isCompany: isCompanyType(type),
    });
    if (dup) {
      return res.status(400).json({
        message: isCompanyType(type)
          ? `Company "${trimmedName}" already exists`
          : `"${trimmedName}" already exists for this company`,
      });
    }

    const created = await Model.create(payload);
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

/** PUT /api/masters/:id — non–Global cannot move row to another company */
const updateMaster = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const found = await findMasterById(req.params.id);
    if (!found) return res.status(404).json({ message: "Not found" });

    const { type, row, Model } = found;

    if (isCompanyType(type) && !hasGlobalCompanyAccess(req.user)) {
      return res.status(403).json({
        message: "Only Global Admin can update company",
      });
    }

    const scopeCompany = isCompanyType(type) ? row.name : row.company;
    const scopeErr = assertOwnCompanyRow(req, type, scopeCompany);
    if (scopeErr) {
      return res.status(403).json({ message: scopeErr });
    }

    if (req.body.name !== undefined) {
      const nextName = String(req.body.name).trim();
      if (!nextName) {
        return res.status(400).json({ message: "name is required" });
      }
      row.name = nextName;
    }
    if (req.body.status !== undefined) row.status = req.body.status;

    if (req.body.company !== undefined && !isCompanyType(type)) {
      if (!hasGlobalCompanyAccess(req.user)) {
        row.company = String(req.user.official?.company || "").trim();
      } else {
        const nextCompany = String(req.body.company || "").trim();
        if (!nextCompany) {
          return res.status(400).json({
            message:
              "company is required (which company this master belongs to)",
          });
        }
        const exists = await companyMasterExists(nextCompany);
        if (!exists) {
          return res.status(400).json({
            message: `company "${nextCompany}" not found in company master — create company first`,
          });
        }
        row.company = nextCompany;
      }
    }

    const dup = await findDuplicateName(Model, {
      name: row.name,
      company: isCompanyType(type) ? "" : row.company,
      excludeId: row._id,
      isCompany: isCompanyType(type),
    });
    if (dup) {
      return res.status(400).json({
        message: isCompanyType(type)
          ? `Company "${row.name}" already exists`
          : `"${row.name}" already exists for this company`,
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

    if (isCompanyType(type) && !hasGlobalCompanyAccess(req.user)) {
      return res.status(403).json({
        message: "Only Global Admin can delete company",
      });
    }

    const scopeCompany = isCompanyType(type) ? row.name : row.company;
    const scopeErr = assertOwnCompanyRow(req, type, scopeCompany);
    if (scopeErr) {
      return res.status(403).json({ message: scopeErr });
    }

    await row.deleteOne();
    return res.json({ message: "Deleted" });
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
