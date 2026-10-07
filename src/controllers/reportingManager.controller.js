/**
 * REPORTING MANAGER — bulk assign / remove (company-wise)
 *
 * One controller, two routes (same body, same checks, same response):
 *   POST /api/employees/assign-manager   → Employee list screen   (permission: Employee → Employee → assign)
 *   POST /api/users/assign-manager       → Access & Control screen (permission: Administration → Access & Control → assign)
 *
 * WHAT IS "level"?
 *   Every employee can have up to TWO reporting managers, saved on the user:
 *     level 1 → official.reportingHead1 = primary / main reporting manager (the usual one)
 *     level 2 → official.reportingHead2 = secondary / backup reporting manager (optional)
 *   level is optional — when not sent, level 1 (primary manager) is used.
 *   A Reporting Manager's team = employees whose reportingHead1 OR reportingHead2 is that manager.
 *
 * Body: { companyId, managerId, employeeIds: [...], level?: 1 | 2 }
 *   managerId = Reporting Manager _id → set that manager on official.reportingHead{level}
 *   managerId = null                  → remove: clear that level, or BOTH heads when level is not sent
 *
 * Examples:
 *   { companyId, managerId: "RM1", employeeIds: [...] }              → RM1 becomes primary manager (level 1)
 *   { companyId, managerId: "RM2", employeeIds: [...], level: 2 }    → RM2 becomes secondary manager
 *   { companyId, managerId: null,  employeeIds: [...], level: 2 }    → remove only the secondary manager
 *   { companyId, managerId: null,  employeeIds: [...] }              → remove both managers
 *
 * Checks (all-or-nothing — one bad employee and nothing changes):
 *   company exists + active, and the caller may manage it (HR → own companies)
 *   manager is an Active Reporting Manager of that company
 *   every employee exists, has role Employee, belongs to that company, is not the manager
 *   the same manager cannot be both reportingHead1 and reportingHead2
 */
const User = require("../models/User");
const Company = require("../models/Company");
const { EMPLOYEE, normalizeRoleName } = require("../config/roles");
const {
  MANAGER_ROLES, // role names that count as Reporting Manager ("Reporting Manager", legacy "Manager")
  REPORTING_HEAD_POPULATE, // populate reportingHead1/2 → { name, email, employeeCode }
  headRef, // head (id or populated doc) → { _id, name, email, employeeCode } or null
  headId, // head (id or populated doc) → plain string id ("" when empty)
} = require("../utils/teamScope");
const {
  COMPANY_POPULATE, // populate official.companyIds → { _id, companyName }
  companyRefs, // populated companyIds → [{ _id, companyName }]
  hasGlobalCompanyAccess, // true for Super Admin / Admin (all companies)
  userCompanyIds, // user's official.companyIds as string ids
} = require("../utils/companyScope");
const { logEmployeeActivity } = require("../utils/activityLog");

// Fields loaded for each employee (enough for the checks + the response row)
const EMPLOYEE_SELECT =
  "name role status official.officialEmail official.employeeCode official.department official.designation official.companyIds official.reportingHead1 official.reportingHead2";

// One employee row in the response — what the frontend table shows after assign
const toRow = (u) => ({
  _id: u._id,
  name: u.name || "",
  employeeCode: u.official?.employeeCode || "",
  email: u.official?.officialEmail || "",
  department: u.official?.department || "",
  designation: u.official?.designation || "",
  companies: companyRefs(u),
  reportingHead1: headRef(u.official?.reportingHead1), // primary manager (level 1) or null
  reportingHead2: headRef(u.official?.reportingHead2), // secondary manager (level 2) or null
});

/**
 * POST /api/employees/assign-manager
 * POST /api/users/assign-manager
 * Body already validated by Joi (reportingManager.validation.js):
 *   companyId required, managerId required (id or null), employeeIds 1–500 unique ids, level 1 | 2 optional
 */
const assignReportingManager = async (req, res) => {
  try {
    // ── 1. Read the body ────────────────────────────────────────────────
    const { companyId, managerId, employeeIds } = req.body;
    // level: 1 = primary manager (reportingHead1), 2 = secondary (reportingHead2), null = not sent
    const level = req.body.level ? Number(req.body.level) : null;
    // Remove duplicate employee ids, keep them as strings for easy compare
    const ids = [...new Set(employeeIds.map(String))];

    // ── 2. Company check: must exist, be active, and belong to the caller ──
    const company = await Company.findById(companyId).select("companyName isActive").lean();
    if (!company || !company.isActive) {
      return res.status(404).json({ message: "Company not found or inactive" });
    }
    // Super Admin / Admin → any company. HR Manager → only companies in their own official.companyIds
    if (
      !hasGlobalCompanyAccess(req.user) &&
      !userCompanyIds(req.user).includes(String(company._id))
    ) {
      return res.status(403).json({ message: "This company is not assigned to you" });
    }

    // ── 3. Manager check (skipped when managerId is null = remove) ──────
    let manager = null;
    if (managerId) {
      manager = await User.findById(managerId)
        .select("name role status official.officialEmail official.employeeCode official.companyIds")
        .lean();
      // Must exist and have the Reporting Manager role
      if (!manager || !MANAGER_ROLES.includes(normalizeRoleName(manager.role))) {
        return res.status(400).json({ message: "managerId must be a Reporting Manager" });
      }
      // Inactive managers cannot get new team members
      if (manager.status !== "Active") {
        return res.status(400).json({ message: `${manager.name} is inactive` });
      }
      // Manager must work in the selected company
      if (!userCompanyIds(manager).includes(String(company._id))) {
        return res.status(400).json({
          message: `${manager.name} is not a Reporting Manager of ${company.companyName}`,
        });
      }
    }

    // ── 4. Load all employees; any unknown id → 404 with the missing ids ──
    const employees = await User.find({ _id: { $in: ids } }).select(EMPLOYEE_SELECT);
    const found = new Set(employees.map((e) => String(e._id)));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) {
      return res.status(404).json({ message: "Employee(s) not found", employeeIds: missing });
    }

    // ── 5. Check every employee, collect ALL problems (nothing saved yet) ──
    const setLevel = level || 1; // level not sent → primary manager (level 1)
    // The OTHER head field — used to stop the same manager being both heads
    const otherField = `reportingHead${setLevel === 1 ? 2 : 1}`;
    const errors = [];
    for (const emp of employees) {
      let message = null;
      if (normalizeRoleName(emp.role) !== EMPLOYEE) {
        // Only Employee role users report to a manager (not HR / Admin / other managers)
        message = `Only Employee role can have a reporting manager (role: ${emp.role})`;
      } else if (!userCompanyIds(emp).includes(String(company._id))) {
        // Employee must belong to the selected company
        message = `Not an employee of ${company.companyName}`;
      } else if (manager && String(emp._id) === String(manager._id)) {
        // Nobody can be their own manager
        message = "Cannot report to themselves";
      } else if (manager && headId(emp.official?.[otherField]) === String(manager._id)) {
        // e.g. RM1 is already primary (level 1) → cannot also be secondary (level 2)
        message = `${manager.name} is already ${otherField} — same manager cannot be both heads`;
      }
      if (message) errors.push({ employeeId: emp._id, name: emp.name, message });
    }
    // All-or-nothing: one bad employee → 400 with the full list, nobody is updated
    if (errors.length) {
      return res
        .status(400)
        .json({ message: "Nothing was changed — fix these employees", errors });
    }

    // ── 6. Save ─────────────────────────────────────────────────────────
    // Which field(s) to write:
    //   assign (manager sent)        → only reportingHead{level}
    //   remove with level            → only reportingHead{level}
    //   remove without level         → both reportingHead1 and reportingHead2
    const fields = manager || level ? [`reportingHead${setLevel}`] : ["reportingHead1", "reportingHead2"];
    // Assign → manager _id, remove → null. e.g. { "official.reportingHead1": <managerId> }
    const $set = Object.fromEntries(
      fields.map((f) => [`official.${f}`, manager ? manager._id : null])
    );
    // One DB call updates every selected employee
    await User.updateMany({ _id: { $in: ids } }, { $set });

    // ── 7. Activity log — one row per employee (company-wise tracking) ──
    // changes = old manager → new manager per field; ids are turned into names by the log helper
    const summary = manager
      ? `${req.user.name} set Reporting Manager ${setLevel} = ${manager.name}`
      : `${req.user.name} removed Reporting Manager ${fields.length > 1 ? "1 and 2" : setLevel}`;
    await Promise.all(
      employees.map((employee) => {
        const changes = fields
          .map((f) => ({
            field: `official.${f}`,
            label: `Reporting Manager ${f.slice(-1)}`,
            from: employee.official?.[f] ? String(employee.official[f]) : null, // value before updateMany
            to: manager ? String(manager._id) : null,
          }))
          .filter((c) => c.from !== c.to); // skip employees already on this manager
        if (!changes.length) return null;
        return logEmployeeActivity({
          actor: req.user, // who did it
          employee, // whose manager changed
          action: "update",
          section: "official",
          summary: `${summary} — ${employee.name}`,
          changes,
        });
      })
    );

    // ── 8. Reload with names populated so the UI can refresh the rows ────
    const updated = await User.find({ _id: { $in: ids } })
      .select(EMPLOYEE_SELECT)
      .populate([COMPANY_POPULATE, ...REPORTING_HEAD_POPULATE])
      .sort({ name: 1 })
      .lean();

    // ── 9. Response ─────────────────────────────────────────────────────
    return res.json({
      message: manager
        ? `${updated.length} employee(s) now report to ${manager.name} (${fields[0]})`
        : `Reporting manager removed for ${updated.length} employee(s)`,
      company: { _id: company._id, companyName: company.companyName },
      manager: manager ? headRef(manager) : null, // null when removing
      level: manager || level ? setLevel : null, // null when both heads were removed
      count: updated.length,
      employees: updated.map(toRow), // each row shows reportingHead1 / reportingHead2 after the change
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { assignReportingManager };
