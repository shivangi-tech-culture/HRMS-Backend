/**
 * PROJECT CONTROLLER — /api/projects
 * Flow: create project for a company → assign members → create tasks under it.
 */
const mongoose = require("mongoose");
const Project = require("../models/Project");
const Company = require("../models/Company");
const User = require("../models/User");
const {
  escapeRegex,
  hasGlobalCompanyAccess,
  managementCompanyIds,
  userCompanyIds,
  assertSameCompanyEmployee,
} = require("../utils/companyScope");
const { EMPLOYEE, normalizeRoleName } = require("../config/roles");

const okId = (id) => mongoose.Types.ObjectId.isValid(id);
const USER_SELECT = "name role official.employeeCode official.companyIds";
const COMPANY_SELECT = "companyName companyCode";

const allowedCompanyIds = (user) =>
  hasGlobalCompanyAccess(user) ? null : managementCompanyIds(user);

const denyCompany = (user, companyId) => {
  const allowed = allowedCompanyIds(user);
  if (!allowed) return "";
  if (!allowed.map(String).includes(String(companyId))) {
    return "You can only manage projects for your own companies";
  }
  return "";
};

const mapUser = (u) => {
  if (!u || typeof u !== "object") return u || null;
  return {
    _id: u._id,
    name: u.name || "",
    employeeCode: u.official?.employeeCode || "",
  };
};

const mapProject = (row) => {
  const company =
    row.companyId && typeof row.companyId === "object" ? row.companyId : null;
  const createdBy =
    row.createdBy && typeof row.createdBy === "object" ? row.createdBy : null;
  return {
    _id: row._id,
    name: row.name,
    description: row.description || "",
    status: row.status,
    companyId: company
      ? {
          _id: company._id,
          companyName: company.companyName,
          companyCode: company.companyCode,
        }
      : row.companyId || null,
    members: (row.members || []).map(mapUser),
    createdBy: createdBy
      ? { _id: createdBy._id, name: createdBy.name || "" }
      : row.createdBy || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

const populateProject = (query) =>
  query
    .populate({ path: "companyId", select: COMPANY_SELECT })
    .populate({ path: "members", select: USER_SELECT })
    .populate({ path: "createdBy", select: "name" });

const loadEmployeesInCompany = async (actor, companyId, employeeIds) => {
  const ids = [...new Set(employeeIds.map(String))];
  const users = await User.find({ _id: { $in: ids } }).select(USER_SELECT);
  if (users.length !== ids.length) {
    return { error: "One or more employees were not found" };
  }
  for (const user of users) {
    if (normalizeRoleName(user.role) !== EMPLOYEE) {
      return { error: "Only Employees can be project members" };
    }
    if (!userCompanyIds(user).includes(String(companyId))) {
      return { error: "Every member must belong to the project company" };
    }
    const actorErr = assertSameCompanyEmployee(actor, user);
    if (actorErr) return { error: actorErr };
  }
  return { users, ids };
};

const applyMemberMode = (current, incoming, mode) => {
  const set = new Set((current || []).map(String));
  if (mode === "replace") return incoming.map(String);
  if (mode === "remove") {
    for (const id of incoming) set.delete(String(id));
    return [...set];
  }
  for (const id of incoming) set.add(String(id));
  return [...set];
};

const listProjects = async (req, res) => {
  try {
    const { companyId, status, search, page, limit } = req.query;
    const skip = (page - 1) * limit;
    const filter = {};

    if (companyId) {
      const denied = denyCompany(req.user, companyId);
      if (denied) return res.status(403).json({ message: denied });
      filter.companyId = companyId;
    } else if (!hasGlobalCompanyAccess(req.user)) {
      const ids = allowedCompanyIds(req.user);
      if (!ids?.length) {
        return res.status(403).json({ message: "Your profile has no company" });
      }
      filter.companyId = { $in: ids };
    }

    if (status && status !== "ALL") filter.status = status;
    if (search) filter.name = new RegExp(escapeRegex(search), "i");

    const [total, rows] = await Promise.all([
      Project.countDocuments(filter),
      populateProject(
        Project.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      ).lean(),
    ]);

    return res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      data: rows.map(mapProject),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getProject = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Project is not valid" });
    }
    const row = await populateProject(Project.findById(req.params.id)).lean();
    if (!row) return res.status(404).json({ message: "Project not found" });

    const companyId = row.companyId?._id || row.companyId;
    const denied = denyCompany(req.user, companyId);
    if (denied) return res.status(403).json({ message: "You cannot view this project" });

    return res.json({ data: mapProject(row) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createProject = async (req, res) => {
  try {
    const { name, description, companyId, status, memberIds } = req.body;

    const denied = denyCompany(req.user, companyId);
    if (denied) return res.status(403).json({ message: denied });

    const company = await Company.findById(companyId).select("_id");
    if (!company) return res.status(404).json({ message: "Company not found" });

    let members = [];
    if (memberIds?.length) {
      const loaded = await loadEmployeesInCompany(req.user, companyId, memberIds);
      if (loaded.error) return res.status(400).json({ message: loaded.error });
      members = loaded.ids;
    }

    const row = await Project.create({
      name: String(name).trim(),
      description: description || "",
      companyId,
      status: status || "Active",
      members,
      createdBy: req.user._id,
    });

    const populated = await populateProject(Project.findById(row._id)).lean();
    return res.status(201).json({ message: "Project created", data: mapProject(populated) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const updateProject = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Project is not valid" });
    }
    const row = await Project.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Project not found" });

    const denied = denyCompany(req.user, row.companyId);
    if (denied) return res.status(403).json({ message: denied });

    if (req.body.name != null) row.name = String(req.body.name).trim();
    if (req.body.description != null) row.description = req.body.description;
    if (req.body.status != null) row.status = req.body.status;

    await row.save();
    const populated = await populateProject(Project.findById(row._id)).lean();
    return res.json({ message: "Project updated", data: mapProject(populated) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const deleteProject = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Project is not valid" });
    }
    const row = await Project.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Project not found" });

    const denied = denyCompany(req.user, row.companyId);
    if (denied) return res.status(403).json({ message: denied });

    const Task = require("../models/Task");
    const taskCount = await Task.countDocuments({ projectId: row._id });
    if (taskCount) {
      return res.status(409).json({
        message: `Cannot delete project — ${taskCount} task(s) still linked. Delete or move tasks first`,
      });
    }

    await row.deleteOne();
    return res.json({ message: "Project deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** Add / remove / replace project members (Employees of that company). */
const assignProjectMembers = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Project is not valid" });
    }
    const row = await Project.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Project not found" });

    const denied = denyCompany(req.user, row.companyId);
    if (denied) return res.status(403).json({ message: denied });

    const loaded = await loadEmployeesInCompany(
      req.user,
      row.companyId,
      req.body.employeeIds
    );
    if (loaded.error) return res.status(400).json({ message: loaded.error });

    row.members = applyMemberMode(row.members, loaded.ids, req.body.mode || "add");
    await row.save();

    const populated = await populateProject(Project.findById(row._id)).lean();
    return res.json({ message: "Project members updated", data: mapProject(populated) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  assignProjectMembers,
  denyCompany,
  allowedCompanyIds,
  loadEmployeesInCompany,
  applyMemberMode,
  mapProject,
  populateProject,
};
