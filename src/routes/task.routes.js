/**
 * TASK ROUTES → /api/tasks
 * Admin: Work → Tasks → view | create | edit | delete | assign
 * Employee: Tasks → To Do Tasks → view | edit (own status)
 * Employee: Tasks → Dashboard → view | create
 * Flow: Project exists → create task (projectId) → Assign assignees.
 */
const express = require("express");
const {
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
} = require("../controllers/task.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate, validateQuery } = require("../middleware/validate");
const { EMPLOYEE, normalizeRoleName } = require("../config/roles");
const {
  createTaskSchema,
  updateTaskSchema,
  listTaskQuerySchema,
  myTaskQuerySchema,
  myTaskDashboardQuerySchema,
  createMyTaskSchema,
  employeeStatusSchema,
  assignTaskSchema,
} = require("../validators/task.validation");

const router = express.Router();

const gate = (action) => [
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Tasks", action),
];

const employeeOnly = (req, res, next) => {
  if (normalizeRoleName(req.user.role) !== EMPLOYEE) {
    return res.status(403).json({ message: "Employee only" });
  }
  return next();
};

/**
 * @swagger
 * tags:
 *   - name: Work / Tasks
 *     description: |
 *       Tasks belong to a Project (company-scoped).
 *       Create with projectId; use POST /:id/assign for assignees.
 *       Employee: GET /me + PATCH /me/:id/status + GET /me/dashboard.
 */

/** Must be registered before /me/:id so "dashboard" is not treated as an id. */
router.get(
  "/me/dashboard",
  protect,
  employeeOnly,
  checkPermission("Tasks", "Dashboard", "view"),
  validateQuery(myTaskDashboardQuerySchema),
  myTaskDashboard
);

router.post(
  "/me",
  protect,
  employeeOnly,
  checkPermission("Tasks", "Dashboard", "create"),
  validate(createMyTaskSchema),
  createMyTask
);

router.get(
  "/me",
  protect,
  employeeOnly,
  checkPermission("Tasks", "To Do Tasks", "view"),
  validateQuery(myTaskQuerySchema),
  myTasks
);

router.patch(
  "/me/:id/status",
  protect,
  employeeOnly,
  checkPermission("Tasks", "To Do Tasks", "edit"),
  validate(employeeStatusSchema),
  updateMyTaskStatus
);

router.get("/", ...gate("view"), validateQuery(listTaskQuerySchema), listTasks);
router.post("/", ...gate("create"), validate(createTaskSchema), createTask);
router.post("/:id/assign", ...gate("assign"), validate(assignTaskSchema), assignTask);
router.get("/:id", ...gate("view"), getTask);
router.put("/:id", ...gate("edit"), validate(updateTaskSchema), updateTask);
router.delete("/:id", ...gate("delete"), deleteTask);

module.exports = router;
