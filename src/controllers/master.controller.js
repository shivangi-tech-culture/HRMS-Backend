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

/** GET /api/masters?type=&status=&search=&company= */
const listMasters = async (req, res) => {
  try {
    const { type, status, search } = req.query;

    if (!type) {
      return res.status(400).json({
        message: `type is required: ${TYPES.join(", ")}`,
      });
    }
    if (!TYPES.includes(type)) {
      return res.status(400).json({
        message: `type must be: ${TYPES.join(", ")}`,
      });
    }

    const Model = getModel(type);
    const filter = {};

    if (status) filter.status = status;
    if (search) filter.name = new RegExp(String(search).trim(), "i");

    if (!hasGlobalCompanyAccess(req.user)) {
      const own = getUserCompany(req.user);
      if (!own) {
        return res.status(403).json({ message: "Your profile has no company" });
      }
      const esc = own.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (isCompanyType(type)) {
        filter.name = new RegExp(`^${esc}$`, "i");
      } else {
        filter.company = new RegExp(`^${esc}$`, "i");
      }
    } else if (req.query.company && !isCompanyType(type)) {
      const co = String(req.query.company).trim();
      filter.company = new RegExp(
        `^${co.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      );
    }

    let rows = await Model.find(filter).sort({ name: 1 }).lean();
    rows = rows.map((r) => toMasterDto(type, r));

    return res.json({ count: rows.length, data: rows });
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
 * Global Admin → from body (required). Others → from login profile only (secure).
 */
const resolveScopedCompany = (req, bodyCompany) => {
  if (hasGlobalCompanyAccess(req.user)) {
    const co = String(bodyCompany || "").trim();
    if (!co) {
      return {
        error: "company is required (which company this master belongs to)",
      };
    }
    return { company: co };
  }

  const own = String(req.user?.official?.company || "").trim();
  if (!own) {
    return {
      error: "Your profile has no company — cannot manage masters",
    };
  }

  // Frontend must not target another company
  const sent = String(bodyCompany || "").trim();
  if (sent && normalizeCompany(sent) !== normalizeCompany(own)) {
    return {
      error: "You can only manage masters for your own company",
    };
  }

  return { company: own };
};

/** POST /api/masters — company from login (non–Global) or body (Global Admin) */
const createMaster = async (req, res) => {
  try {
    const { type, name, status } = req.body;
    const Model = getModel(type);

    if (isCompanyType(type) && !hasGlobalCompanyAccess(req.user)) {
      return res.status(403).json({
        message: "Only Global Admin can create company",
      });
    }

    const payload = {
      name: String(name).trim(),
      status: status || "Active",
      company: "",
    };

    if (!isCompanyType(type)) {
      const resolved = resolveScopedCompany(req, req.body.company);
      if (resolved.error) {
        return res
          .status(resolved.error.includes("required") ? 400 : 403)
          .json({ message: resolved.error });
      }
      payload.company = resolved.company;
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

    const { type, row } = found;

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

    if (req.body.name !== undefined) row.name = String(req.body.name).trim();
    if (req.body.status !== undefined) row.status = req.body.status;

    if (req.body.company !== undefined && !isCompanyType(type)) {
      if (!hasGlobalCompanyAccess(req.user)) {
        // Keep locked to login company — ignore move attempts
        row.company = String(req.user.official?.company || "").trim();
      } else {
        const nextCompany = String(req.body.company || "").trim();
        if (!nextCompany) {
          return res.status(400).json({
            message:
              "company is required (which company this master belongs to)",
          });
        }
        row.company = nextCompany;
      }
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
  listMasters,
  getMaster,
  createMaster,
  updateMaster,
  deleteMaster,
};
