/**
 * OVERTIME CONTROLLER — /api/attendance/overtime
 */
const Overtime = require("../models/Overtime");
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const { hasAllAccess } = require("../middleware/auth");
const {
  hasGlobalCompanyAccess,
} = require("../utils/companyScope");
const { listScopeFilter, assertTeamOrCompanyEmployee } = require("../utils/teamScope");
const {
  formatDuration,
  computeOvertimeMinutes,
} = require("../utils/attendanceView");
const { getAssignedShift } = require("../utils/shiftTiming");

const parseOtHours = (otHours, otMinutes) => {
  if (otMinutes != null && otMinutes !== "") {
    return Math.max(0, Math.round(Number(otMinutes) || 0));
  }
  if (otHours == null || otHours === "") return 0;
  const s = String(otHours).trim().toLowerCase();
  const hm = s.match(/^(\d+)\s*h(?:\s*(\d+)\s*m)?$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] || 0);
  if (s.includes(":")) {
    const [h, m] = s.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return n <= 24 ? Math.round(n * 60) : Math.round(n);
};

const listOvertime = async (req, res) => {
  try {
    const {
      status,
      type,
      search,
      from,
      to,
      month,
      employeeId,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {};

    if (!hasAllAccess(req.user)) {
      filter.employee = req.user._id;
    } else if (employeeId) {
      filter.employee = employeeId;
    } else if (!hasGlobalCompanyAccess(req.user)) {
      const scope = listScopeFilter(req.user);
      if (scope === false) {
        return res.status(403).json({ message: "Your profile has no company" });
      }
      if (scope) {
        const users = await User.find(scope).select("_id").lean();
        filter.employee = { $in: users.map((u) => u._id) };
      }
    }

    if (status && status !== "ALL") filter.status = status;
    if (type && type !== "ALL") filter.type = type;

    if (month) {
      filter.date = { $gte: `${month}-01`, $lte: `${month}-31` };
    } else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }

    if (search) {
      const q = String(search).trim();
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const users = await User.find({
        $or: [
          { name: re },
          { "official.employeeCode": re },
          { "official.officialEmail": re },
        ],
      })
        .select("_id")
        .lean();
      const ids = users.map((u) => u._id);
      if (!ids.length) {
        return res.json({
          total: 0,
          page: Number(page),
          limit: Number(limit),
          pages: 1,
          data: [],
        });
      }
      if (filter.employee) {
        const allowed = filter.employee.$in || [filter.employee];
        const allowedSet = new Set(allowed.map(String));
        filter.employee = {
          $in: ids.filter((id) => allowedSet.has(String(id))),
        };
      } else {
        filter.employee = { $in: ids };
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [total, rows] = await Promise.all([
      Overtime.countDocuments(filter),
      Overtime.find(filter)
        .populate(
          "employee",
          "name official.employeeCode official.department official.companyIds"
        )
        .populate("reviewedBy", "name role")
        .populate("submittedBy", "name role")
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
    ]);

    const data = rows.map((r) => ({
      _id: r._id,
      employee: {
        _id: r.employee?._id,
        name: r.employee?.name || "",
        employeeCode: r.employee?.official?.employeeCode || "",
        department: r.employee?.official?.department || "",
      },
      date: r.date,
      otMinutes: r.otMinutes,
      otHours: formatDuration(r.otMinutes),
      type: r.type,
      reason: r.reason,
      status: r.status,
      reviewedBy: r.reviewedBy || null,
      reviewRemarks: r.reviewRemarks || "",
      reviewedAt: r.reviewedAt,
      createdAt: r.createdAt,
    }));

    return res.json({
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.max(1, Math.ceil(total / Number(limit))),
      data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createOvertime = async (req, res) => {
  try {
    const { date, type, reason, otHours, otMinutes, employeeId } = req.body;
    let targetId = req.user._id;

    if (employeeId && employeeId !== String(req.user._id)) {
      if (!hasAllAccess(req.user)) {
        return res
          .status(403)
          .json({ message: "Only admin can submit OT for another employee" });
      }
      const emp = await User.findById(employeeId).select(
        "_id name status official.companyIds"
      );
      if (!emp) return res.status(404).json({ message: "Employee not found" });
      if (!hasGlobalCompanyAccess(req.user)) {
        const errMsg = assertTeamOrCompanyEmployee(req.user, emp);
        if (errMsg) return res.status(403).json({ message: errMsg });
      }
      targetId = emp._id;
    }

    let minutes = parseOtHours(otHours, otMinutes);
    const attendance = await Attendance.findOne({
      employee: targetId,
      date,
    }).lean();

    if (!minutes && attendance) {
      const { shift } = await getAssignedShift(targetId, date);
      minutes = computeOvertimeMinutes(attendance, shift);
    }

    if (!minutes) {
      return res.status(400).json({
        message: "otHours / otMinutes required (or punch must have overtime)",
      });
    }

    const row = await Overtime.create({
      employee: targetId,
      date,
      otMinutes: minutes,
      type: type || "Overtime Pay",
      reason: reason || "",
      status: "Pending",
      attendance: attendance?._id || null,
      submittedBy: req.user._id,
    });

    await row.populate(
      "employee",
      "name official.employeeCode official.department"
    );

    return res.status(201).json({
      message: "Overtime request submitted",
      data: {
        ...row.toObject(),
        otHours: formatDuration(row.otMinutes),
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const reviewOvertime = async (req, res) => {
  try {
    if (!hasAllAccess(req.user)) {
      return res.status(403).json({ message: "Admin only" });
    }

    const { status, reviewRemarks } = req.body;
    const row = await Overtime.findById(req.params.id);
    if (!row) {
      return res.status(404).json({ message: "Overtime request not found" });
    }
    if (row.status !== "Pending") {
      return res.status(400).json({ message: `Already ${row.status}` });
    }

    if (status === "Approved" && row.type === "Comp Off") {
      row.status = "Comp Off Credited";
    } else {
      row.status = status;
    }
    row.reviewRemarks = reviewRemarks || "";
    row.reviewedBy = req.user._id;
    row.reviewedAt = new Date();
    await row.save();

    await row.populate(
      "employee",
      "name official.employeeCode official.department"
    );
    await row.populate("reviewedBy", "name role");

    return res.json({
      message: `Overtime ${row.status}`,
      data: {
        ...row.toObject(),
        otHours: formatDuration(row.otMinutes),
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getOvertime = async (req, res) => {
  try {
    const row = await Overtime.findById(req.params.id)
      .populate(
        "employee",
        "name official.employeeCode official.department official.companyIds"
      )
      .populate("reviewedBy", "name role")
      .populate("submittedBy", "name role");
    if (!row) return res.status(404).json({ message: "Not found" });

    if (
      !hasAllAccess(req.user) &&
      String(row.employee._id) !== String(req.user._id)
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }

    return res.json({
      data: {
        ...row.toObject(),
        otHours: formatDuration(row.otMinutes),
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listOvertime,
  createOvertime,
  reviewOvertime,
  getOvertime,
};
