/**
 * Master routes → /api/masters
 * One API for admin + employee (no separate routes).
 * GET: logged-in only — no Masters permission (Employee web app dropdowns).
 * POST/PUT/DELETE: admin + Masters → {type} → create|edit|delete
 * Employee profile stores master **name** strings (not _id).
 */
const express = require("express");
const {
  listMasters,
  getMaster,
  createMaster,
  updateMaster,
  deleteMaster,
} = require("../controllers/master.controller");
const { protect, authorize, ALL_ACCESS } = require("../middleware/auth");
const { checkMasterPermission } = require("../controllers/permission.controller");
const { validate } = require("../middleware/validate");
const {
  createMasterSchema,
  updateMasterSchema,
} = require("../validators/master.validation");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Admin / Masters
 *     description: |
 *       type picks collection. Employee forms save **name** (not _id).
 *       GET open to any logged-in user (own company). Write = Masters permission by type.
 */

/**
 * @swagger
 * /api/masters:
 *   get:
 *     tags: [Admin / Masters]
 *     summary: List masters by type (no permission — login only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [company, department, designation, division, employeeGroup]
 *       - in: query
 *         name: company
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [Active, Inactive] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: Master list }
 *   post:
 *     tags: [Admin / Masters]
 *     summary: Create master (Masters → type → create)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, name]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [company, department, designation, division, employeeGroup]
 *               name: { type: string }
 *               status: { type: string, enum: [Active, Inactive] }
 *               company: { type: string }
 *     responses:
 *       201: { description: Created }
 */
// GET — public for logged-in Employee + Admin (dropdowns); company scope in controller
router.get("/", protect, authorize(...ALL_ACCESS, "Employee"), listMasters);
router.post(
  "/",
  protect,
  authorize(...ALL_ACCESS),
  checkMasterPermission("create"),
  validate(createMasterSchema),
  createMaster
);

/**
 * @swagger
 * /api/masters/{id}:
 *   get:
 *     tags: [Admin / Masters]
 *     summary: Get one master (no permission — login only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Master }
 *   put:
 *     tags: [Admin / Masters]
 *     summary: Update master (Masters → type → edit)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               status: { type: string, enum: [Active, Inactive] }
 *               company: { type: string }
 *     responses:
 *       200: { description: Updated }
 *   delete:
 *     tags: [Admin / Masters]
 *     summary: Delete master (Masters → type → delete)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 */
router.get("/:id", protect, authorize(...ALL_ACCESS, "Employee"), getMaster);
router.put(
  "/:id",
  protect,
  authorize(...ALL_ACCESS),
  checkMasterPermission("edit"),
  validate(updateMasterSchema),
  updateMaster
);
router.delete(
  "/:id",
  protect,
  authorize(...ALL_ACCESS),
  checkMasterPermission("delete"),
  deleteMaster
);

module.exports = router;
