/**
 * TASK CONTROLLER — /api/tasks
 * Flow: Project (company) → Task (projectId) → Assign assignees.
 * Employee: list own tasks + update status (Done).
 */
const mongoose = require("mongoose");
const Task = require("../models/Task");
const Project = require("../models/Project");
const User = require("../models/User");
const {
  escapeRegex,
  hasGlobalCompanyAccess,
  managementCompanyIds,
  userCompanyIds,
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

const completedYmd = (row) => {
  if (!row.completedAt) return "";
  const d = new Date(row.completedAt);
  if (Number.isNaN(d.getTime())) return "";
  return todayYmdFromDate(d);
};

const todayYmdFromDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const addDaysYmd = (ymdStr, days) => {
  const [y, m, d] = String(ymdStr).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return todayYmdFromDate(
    new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())
  );
};

const weekBucketIndex = (completedDate, windowStart, days) => {
  const [ys, ms, ds] = windowStart.split("-").map(Number);
  const [yc, mc, dc] = completedDate.split("-").map(Number);
  const start = Date.UTC(ys, ms - 1, ds);
  const cur = Date.UTC(yc, mc - 1, dc);
  const diffDays = Math.floor((cur - start) / 86400000);
  if (diffDays < 0 || diffDays >= days) return -1;
  const weekSize = Math.max(1, Math.ceil(days / 5));
  return Math.min(4, Math.floor(diffDays / weekSize));
};

/**
 * GET /api/tasks/me/dashboard
 * Employee Tasks → Dashboard widgets (progress, due summary, health, workload, critical).
 */
const myTaskDashboard = async (req, res) => {
  try {
    const days = Number(req.query.days) || 15;
    const listLimit = Number(req.query.listLimit) || 10;
    const categoryRaw = String(req.query.category || "ALL").trim();
    const category =
      !categoryRaw || categoryRaw.toUpperCase() === "ALL" ? "ALL" : categoryRaw;
    const today = todayYmd();
    const windowStart = addDaysYmd(today, -(days - 1));

    const base = { assignees: req.user._id };
    if (req.query.projectId) base.projectId = req.query.projectId;

    const myRows = await populateTask(
      Task.find(base).sort({ dueDate: 1, createdAt: -1 })
    ).lean();

    const filtered =
      category === "ALL"
        ? myRows
        : myRows.filter((row) => {
            const name =
              row.projectId && typeof row.projectId === "object"
                ? row.projectId.name || ""
                : "";
            return name.toLowerCase() === category.toLowerCase();
          });

    const progress = [0, 0, 0, 0, 0];
    for (const row of filtered) {
      if (row.status !== "Completed") continue;
      const done = completedYmd(row) || (row.updatedAt ? todayYmdFromDate(new Date(row.updatedAt)) : "");
      if (!done || done < windowStart || done > today) continue;
      const idx = weekBucketIndex(done, windowStart, days);
      if (idx >= 0) progress[idx] += 1;
    }
    const taskProgress = progress.map((count, i) => ({
      week: `W${i + 1}`,
      weekNo: i + 1,
      completed: count,
    }));

    const dueSummary = {
      before: 0,
      after: 0,
      onTime: 0,
      inProcess: 0,
      pending: 0,
    };
    for (const row of filtered) {
      if (row.status === "In Progress") {
        dueSummary.inProcess += 1;
        continue;
      }
      if (row.status === "To Do") {
        dueSummary.pending += 1;
        continue;
      }
      if (row.status === "Completed" && row.dueDate) {
        const done = completedYmd(row) || row.dueDate;
        if (done < row.dueDate) dueSummary.before += 1;
        else if (done > row.dueDate) dueSummary.after += 1;
        else dueSummary.onTime += 1;
      }
    }
    const dueTotal =
      dueSummary.before +
      dueSummary.after +
      dueSummary.onTime +
      dueSummary.inProcess +
      dueSummary.pending;

    let completed = 0;
    let onGoing = 0;
    let pending = 0;
    let dueTask = 0;
    for (const row of filtered) {
      if (row.status === "Completed") completed += 1;
      else if (row.status === "In Progress") onGoing += 1;
      else pending += 1;
      if (row.status !== "Completed" && row.dueDate && row.dueDate < today) {
        dueTask += 1;
      }
    }
    const overallHealth = {
      totalTasks: filtered.length,
      completed,
      onGoing,
      pending,
      dueTask,
    };

    const workloadMap = new Map();
    for (const row of filtered) {
      const name =
        row.projectId && typeof row.projectId === "object"
          ? row.projectId.name || "Other"
          : "Other";
      if (!workloadMap.has(name)) {
        workloadMap.set(name, { category: name, completed: 0, overDue: 0, remaining: 0 });
      }
      const bucket = workloadMap.get(name);
      if (row.status === "Completed") bucket.completed += 1;
      else if (row.dueDate && row.dueDate < today) bucket.overDue += 1;
      else bucket.remaining += 1;
    }
    const workload = [...workloadMap.values()].sort((a, b) =>
      a.category.localeCompare(b.category)
    );

    const companyId =
      filtered[0]?.companyId?._id ||
      filtered[0]?.companyId ||
      (req.user.official?.companyIds || [])[0] ||
      null;

    let criticalHealth = { maxAssignTask: [], maxDueTask: [] };
    if (companyId) {
      const companyTasks = await Task.find({ companyId })
        .select("assignees status dueDate")
        .lean();
      const assignCount = new Map();
      const dueCount = new Map();
      for (const row of companyTasks) {
        for (const aid of row.assignees || []) {
          const key = String(aid);
          assignCount.set(key, (assignCount.get(key) || 0) + 1);
          if (row.status !== "Completed" && row.dueDate && row.dueDate < today) {
            dueCount.set(key, (dueCount.get(key) || 0) + 1);
          }
        }
      }
      const ids = [...new Set([...assignCount.keys(), ...dueCount.keys()])];
      const users = ids.length
        ? await User.find({ _id: { $in: ids }, role: "Employee" })
            .select("name official.employeeCode")
            .lean()
        : [];
      const nameOf = new Map(
        users.map((u) => [
          String(u._id),
          {
            _id: u._id,
            name: u.name || "",
            employeeCode: u.official?.employeeCode || "",
            shortName: shortName(u.name || ""),
          },
        ])
      );
      const rank = (map) =>
        [...map.entries()]
          .map(([id, count]) => ({ ...(nameOf.get(id) || { _id: id, name: "", shortName: "" }), count }))
          .filter((row) => row.name)
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
          .slice(0, 5);
      criticalHealth = {
        maxAssignTask: rank(assignCount),
        maxDueTask: rank(dueCount),
      };
    }

    const taskList = filtered.slice(0, listLimit).map((row) => {
      const mapped = mapTask(row);
      return {
        _id: mapped._id,
        title: mapped.title,
        dueDate: mapped.dueDate,
        priority: mapped.priority,
        status: mapped.status,
        displayStatus: mapped.displayStatus,
        project: mapped.projectId?.name || "",
      };
    });

    const categories = [
      "ALL",
      ...new Set(
        myRows
          .map((row) =>
            row.projectId && typeof row.projectId === "object"
              ? row.projectId.name || ""
              : ""
          )
          .filter(Boolean)
      ),
    ];

    return res.json({
      message: "Task dashboard",
      data: {
        filters: { days, category, projectId: req.query.projectId || null },
        categories,
        taskProgress,
        dueTaskSummary: {
          totalDue: dueTotal,
          before: dueSummary.before,
          after: dueSummary.after,
          onTime: dueSummary.onTime,
          inProcess: dueSummary.inProcess,
          pending: dueSummary.pending,
        },
        overallHealth,
        workload,
        criticalHealth,
        taskList,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const shortName = (full) => {
  const parts = String(full || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
};

/**
 * POST /api/tasks/me — Employee Tasks → Dashboard → create
 * Creates a task on a project and assigns the logged-in employee.
 */
const createMyTask = async (req, res) => {
  try {
    const { title, description, projectId, dueDate, priority } = req.body;
    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const mine = new Set(userCompanyIds(req.user));
    if (!mine.has(String(project.companyId))) {
      return res.status(403).json({
        message: "You can only create tasks for projects in your company",
      });
    }

    const row = await Task.create({
      title,
      description: description || "",
      projectId: project._id,
      companyId: project.companyId,
      assignees: [req.user._id],
      assignedBy: req.user._id,
      dueDate: dueDate || "",
      priority: priority || "Medium",
      status: "To Do",
    });

    const populated = await populateTask(Task.findById(row._id)).lean();
    return res.status(201).json({
      message: "Task created",
      data: mapTask(populated),
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
  myTaskDashboard,
  createMyTask,
  updateMyTaskStatus,
};
