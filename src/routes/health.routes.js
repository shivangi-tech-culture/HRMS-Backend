/**
 * Health check — is API + MongoDB up?
 *
 * GET /api/health  (public, no token)
 */
const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Health
 *     description: API + MongoDB health check (no auth)
 */

/**
 * @swagger
 * /:
 *   get:
 *     tags: [Health]
 *     summary: API root
 *     description: Simple check that the server is running (no token).
 *     responses:
 *       200:
 *         description: API is working
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RootResponse'
 *             example:
 *               success: true
 *               status: ok
 *               message: HRMS API is working
 *               name: HRMS API
 *               version: "1.0.0"
 */

/**
 * @swagger
 * /api/health:
 *   get:
 *     tags: [Health]
 *     summary: Health check
 *     description: |
 *       Public — no token needed.
 *       Checks API + MongoDB.
 *       - HTTP 200 → healthy
 *       - HTTP 503 → MongoDB down
 *     responses:
 *       200:
 *         description: Healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 *             example:
 *               success: true
 *               status: ok
 *               message: HRMS API is healthy
 *               mongodb: connected
 *       503:
 *         description: MongoDB not connected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 *             example:
 *               success: false
 *               status: down
 *               message: MongoDB is not connected
 *               mongodb: disconnected
 */
router.get("/", (req, res) => {
  const dbReady = mongoose.connection.readyState === 1;

  if (dbReady) {
    return res.status(200).json({
      success: true,
      status: "ok",
      message: "HRMS API is healthy",
      mongodb: "connected",
    });
  }

  return res.status(503).json({
    success: false,
    status: "down",
    message: "MongoDB is not connected",
    mongodb: "disconnected",
  });
});

module.exports = router;
