/**
 * PROJECT ROUTES → /api/projects
 * Admin: Work → Projects → view | create | edit | delete | assign
 * Flow: create project for company → assign members → create tasks under project.
 */
const express = require("express");
const {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  assignProjectMembers,
} = require("../controllers/project.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkPermission } = require("../controllers/permission.controller");
const { validate, validateQuery } = require("../middleware/validate");
const {
  createProjectSchema,
  updateProjectSchema,
  listProjectQuerySchema,
  assignProjectSchema,
} = require("../validators/project.validation");

const router = express.Router();

const gate = (action) => [
  protect,
  authorize(...ALL_ACCESS),
  checkPermission("Work", "Projects", action),
];

/**
 * @swagger
 * tags:
 *   - name: Work / Projects
 *     description: |
 *       Company-scoped projects. Create project first, then tasks under it.
 *       POST /:id/assign manages project members (Employees of that company).
 */

router.get("/", ...gate("view"), validateQuery(listProjectQuerySchema), listProjects);
router.post("/", ...gate("create"), validate(createProjectSchema), createProject);
router.post(
  "/:id/assign",
  ...gate("assign"),
  validate(assignProjectSchema),
  assignProjectMembers
);
router.get("/:id", ...gate("view"), getProject);
router.put("/:id", ...gate("edit"), validate(updateProjectSchema), updateProject);
router.delete("/:id", ...gate("delete"), deleteProject);

module.exports = router;
