/**
 * TASK CONTROLLER — /api/tasks
 * Flow: Project (company) → Task (projectId) → Assign assignees.
 * Employee: list own tasks + update status (Done).
 */
const mongoose = require("mongoose");
const Task = require("../models/Task");
const Project = require("../models/Project");
const {
  escapeRegex,
  hasGlobalCompanyAccess,
  managementCompanyIds,
} = require("../utils/companyScope");
const {
  denyCompany,
  loadEmployeesInCompany,
  applyMemberMode,
} = require("./project.controller");

const okId = (id) => mongoose.Types.ObjectId.isValid(id);

const USER_SELECT = "name role official.employeeCode official.companyIds";
const COMPANY_SELECT = "companyName companyCode";
const PROJECT_SELECT = "name status companyId";

const todayYmd = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const displayStatus = (row) => {
  if (row.status === "Completed") return "Completed";
  if (row.dueDate && row.dueDate < todayYmd()) return "Over Due";
  return row.status;
};

const mapUser = (u) => {
  if (!u || typeof u !== "object") return u || null;
  return {
    _id: u._id,
    name: u.name || "",
    employeeCode: u.official?.employeeCode || "",
  };
};

const mapTask = (row) => {
  const project =
    row.projectId && typeof row.projectId === "object" ? row.projectId : null;
  const assignedBy =
    row.assignedBy && typeof row.assignedBy === "object" ? row.assignedBy : null;
  const company =
    row.companyId && typeof row.companyId === "object" ? row.companyId : null;
  return {
    _id: row._id,
    title: row.title,
    description: row.description || "",
    projectId: project
      ? { _id: project._id, name: project.name, status: project.status }
      : row.projectId || null,
    companyId: company
      ? {
          _id: company._id,
          companyName: company.companyName,
          companyCode: company.companyCode,
        }
      : row.companyId || null,
    assignees: (row.assignees || []).map(mapUser),
    assignedBy: assignedBy
      ? { _id: assignedBy._id, name: assignedBy.name || "" }
      : row.assignedBy
        ? null
        : { _id: null, name: "System" },
    dueDate: row.dueDate || "",
    priority: row.priority,
    status: row.status,
    displayStatus: displayStatus(row),
    completedAt: row.completedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

const allowedCompanyIds = (user) =>
  hasGlobalCompanyAccess(user) ? null : managementCompanyIds(user);

const populateTask = (query) =>
  query
    .populate({ path: "projectId", select: PROJECT_SELECT })
    .populate({ path: "assignees", select: USER_SELECT })
    .populate({ path: "assignedBy", select: "name" })
    .populate({ path: "companyId", select: COMPANY_SELECT });

const statusClauses = (status) => {
  if (!status || status === "ALL") return [];
  if (status === "Over Due") {
    return [
      { status: { $ne: "Completed" } },
      { dueDate: { $ne: "", $lt: todayYmd() } },
    ];
  }
  const clauses = [{ status }];
  if (status === "To Do" || status === "In Progress") {
    clauses.push({ $or: [{ dueDate: "" }, { dueDate: { $gte: todayYmd() } }] });
  }
  return clauses;
};

const searchClause = (search) => {
  if (!search) return null;
  const re = new RegExp(escapeRegex(search), "i");
  return { $or: [{ title: re }, { description: re }] };
};

const mergeFilter = (base, status, search) => {
  const and = [...statusClauses(status)];
  const s = searchClause(search);
  if (s) and.push(s);
  if (!and.length) return base;
  return { ...base, $and: and };
};

const loadProjectForActor = async (actor, projectId) => {
  if (!okId(projectId)) return { error: "Project is not valid" };
  const project = await Project.findById(projectId);
  if (!project) return { error: "Project not found", status: 404 };
  const denied = denyCompany(actor, project.companyId);
  if (denied) return { error: denied, status: 403 };
  return { project };
};

const listTasks = async (req, res) => {
  try {
    const { companyId, projectId, assignee, status, priority, search, page, limit } =
      req.query;
    const skip = (page - 1) * limit;
    const base = {};

    if (companyId) {
      const denied = denyCompany(req.user, companyId);
      if (denied) return res.status(403).json({ message: denied });
      base.companyId = companyId;
    } else if (!hasGlobalCompanyAccess(req.user)) {
      const ids = allowedCompanyIds(req.user);
      if (!ids?.length) {
        return res.status(403).json({ message: "Your profile has no company" });
      }
      base.companyId = { $in: ids };
    }

    if (projectId) base.projectId = projectId;
    if (assignee) base.assignees = assignee;
    if (priority) base.priority = priority;
    const filter = mergeFilter(base, status, search);

    const [total, rows] = await Promise.all([
      Task.countDocuments(filter),
      populateTask(
        Task.find(filter).sort({ dueDate: 1, createdAt: -1 }).skip(skip).limit(limit)
      ).lean(),
    ]);

    return res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      data: rows.map(mapTask),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getTask = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Task is not valid" });
    }
    const row = await populateTask(Task.findById(req.params.id)).lean();
    if (!row) return res.status(404).json({ message: "Task not found" });

    const companyId = row.companyId?._id || row.companyId;
    const denied = denyCompany(req.user, companyId);
    if (denied) return res.status(403).json({ message: "You cannot view this task" });

    return res.json({ data: mapTask(row) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createTask = async (req, res) => {
  try {
    const { title, description, projectId, companyId, assignees, dueDate, priority, status } =
      req.body;

    const loaded = await loadProjectForActor(req.user, projectId);
    if (loaded.error) {
      return res.status(loaded.status || 400).json({ message: loaded.error });
    }
    const project = loaded.project;

    if (companyId && String(companyId) !== String(project.companyId)) {
      return res.status(400).json({
        message: "companyId must match the project's company",
      });
    }

    let assigneeIds = [];
    if (assignees?.length) {
      const people = await loadEmployeesInCompany(
        req.user,
        project.companyId,
        assignees
      );
      if (people.error) return res.status(400).json({ message: people.error });
      assigneeIds = people.ids;
    }

    const finalStatus = status || "To Do";
    const row = await Task.create({
      title: String(title).trim(),
      description: description || "",
      projectId: project._id,
      companyId: project.companyId,
      assignees: assigneeIds,
      assignedBy: req.user._id,
      dueDate: dueDate || "",
      priority: priority || "Medium",
      status: finalStatus,
      completedAt: finalStatus === "Completed" ? new Date() : null,
    });

    const populated = await populateTask(Task.findById(row._id)).lean();
    return res.status(201).json({ message: "Task created", data: mapTask(populated) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const updateTask = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Task is not valid" });
    }
    const row = await Task.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Task not found" });

    const denied = denyCompany(req.user, row.companyId);
    if (denied) return res.status(403).json({ message: denied });

    if (req.body.projectId) {
      const loaded = await loadProjectForActor(req.user, req.body.projectId);
      if (loaded.error) {
        return res.status(loaded.status || 400).json({ message: loaded.error });
      }
      row.projectId = loaded.project._id;
      row.companyId = loaded.project.companyId;
    }

    if (req.body.assignees) {
      const people = await loadEmployeesInCompany(
        req.user,
        row.companyId,
        req.body.assignees
      );
      if (people.error) return res.status(400).json({ message: people.error });
      row.assignees = people.ids;
      row.assignedBy = req.user._id;
    }

    if (req.body.title != null) row.title = String(req.body.title).trim();
    if (req.body.description != null) row.description = req.body.description;
    if (req.body.dueDate != null) row.dueDate = req.body.dueDate;
    if (req.body.priority != null) row.priority = req.body.priority;
    if (req.body.status != null) {
      row.status = req.body.status;
      row.completedAt =
        req.body.status === "Completed" ? row.completedAt || new Date() : null;
    }

    await row.save();
    const populated = await populateTask(Task.findById(row._id)).lean();
    return res.json({ message: "Task updated", data: mapTask(populated) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const deleteTask = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Task is not valid" });
    }
    const row = await Task.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Task not found" });

    const denied = denyCompany(req.user, row.companyId);
    if (denied) return res.status(403).json({ message: denied });

    await row.deleteOne();
    return res.json({ message: "Task deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** Assign Employees to a task (same company as task/project). */
const assignTask = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Task is not valid" });
    }
    const row = await Task.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Task not found" });

    const denied = denyCompany(req.user, row.companyId);
    if (denied) return res.status(403).json({ message: denied });

    const people = await loadEmployeesInCompany(
      req.user,
      row.companyId,
      req.body.assigneeIds
    );
    if (people.error) return res.status(400).json({ message: people.error });

    row.assignees = applyMemberMode(
      row.assignees,
      people.ids,
      req.body.mode || "add"
    );
    row.assignedBy = req.user._id;
    await row.save();

    const populated = await populateTask(Task.findById(row._id)).lean();
    return res.json({ message: "Task assignees updated", data: mapTask(populated) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const myTasks = async (req, res) => {
  try {
    const { projectId, status, priority, search, page, limit } = req.query;
    const skip = (page - 1) * limit;
    const base = { assignees: req.user._id };
    if (projectId) base.projectId = projectId;
    if (priority) base.priority = priority;
    const filter = mergeFilter(base, status, search);

    const [total, rows] = await Promise.all([
      Task.countDocuments(filter),
      populateTask(
        Task.find(filter).sort({ dueDate: 1, createdAt: -1 }).skip(skip).limit(limit)
      ).lean(),
    ]);

    return res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      data: rows.map(mapTask),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const updateMyTaskStatus = async (req, res) => {
  try {
    if (!okId(req.params.id)) {
      return res.status(400).json({ message: "Task is not valid" });
    }
    const row = await Task.findById(req.params.id);
    if (!row) return res.status(404).json({ message: "Task not found" });

    const mine = (row.assignees || []).some(
      (id) => String(id) === String(req.user._id)
    );
    if (!mine) {
      return res.status(403).json({ message: "You can only update your own tasks" });
    }

    row.status = req.body.status;
    row.completedAt = req.body.status === "Completed" ? new Date() : null;
    await row.save();

    const populated = await populateTask(Task.findById(row._id)).lean();
    return res.json({ message: "Task status updated", data: mapTask(populated) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  assignTask,
  myTasks,
  updateMyTaskStatus,
};
