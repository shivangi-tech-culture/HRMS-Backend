/**
 * Activity log helper — write who edited which employee (never throws to API).
 * Shape mirrors User: nested employee{} + actor{} for easy UI.
 */
const ActivityLog = require("../models/ActivityLog");

const personFromUser = (user = {}, roleFallback = "") => ({
  id: user._id,
  name: user.name || "",
  officialEmail: user.official?.officialEmail || "",
  employeeCode: user.official?.employeeCode || "",
  role: user.role || roleFallback || "",
  company: user.official?.company || "",
  department: user.official?.department || "",
  designation: user.official?.designation || "",
});

/**
 * Persist one activity row. Failures are logged only — create/update still succeed.
 */
const logEmployeeActivity = async ({
  actor,
  employee,
  action,
  section = "",
  summary = "",
  changes = [],
  meta = {},
}) => {
  try {
    if (!actor?._id || !employee?._id || !action) return null;

    const employeeRef = personFromUser(employee);
    const actorRef = personFromUser(actor);

    return await ActivityLog.create({
      employee: employeeRef,
      actor: actorRef,
      action,
      section: section || "",
      summary:
        summary ||
        `${actorRef.name || "Someone"} ${action} ${employeeRef.name || "employee"}`,
      changes: Array.isArray(changes) ? changes : [],
      meta: meta || {},
      company: employeeRef.company || "",
    });
  } catch (err) {
    console.error("Activity log failed:", err.message);
    return null;
  }
};

module.exports = { logEmployeeActivity, personFromUser };
