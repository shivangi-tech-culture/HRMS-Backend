/**
 * ATTENDANCE REPORTS CONTROLLER — /api/reports/attendance
 * UI: Reports → Attendance Reports (+ Attendance module tab)
 */
const fs = require("fs");
const path = require("path");
const AttendanceReport = require("../models/AttendanceReport");
const {
  REPORT_CATALOG,
  REPORT_KEYS,
  FORMATS,
} = require("../models/AttendanceReport");
const { hasAllAccess } = require("../middleware/auth");
const {
  hasGlobalCompanyAccess,
  getAccessibleCompanies,
  canAccessCompany,
  DEFAULT_COMPANY,
} = require("../utils/companyScope");
const {
  resolveRange,
  BUILDERS,
} = require("../utils/attendanceReportData");
const {
  writeExcelReport,
  writePdfReport,
} = require("../utils/attendanceReportFiles");

const displayDate = (d) => {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

/** Primary company label for report docs (empty = all / platform) */
const companyForUser = (user) => {
  if (hasGlobalCompanyAccess(user)) return "";
  return user?.official?.company || DEFAULT_COMPANY;
};

/** Mongo match for report.company scoped to actor */
const reportCompanyMatch = (user) => {
  if (hasGlobalCompanyAccess(user)) return {};
  const accessible = getAccessibleCompanies(user) || [];
  if (!accessible.length) {
    const fallback = companyForUser(user);
    return fallback
      ? {
          company: new RegExp(
            `^${fallback.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            "i"
          ),
        }
      : { company: "__none__" };
  }
  if (accessible.length === 1) {
    return {
      company: new RegExp(
        `^${accessible[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      ),
    };
  }
  return {
    company: {
      $in: accessible.map(
        (c) =>
          new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
      ),
    },
  };
};

/**
 * LIST — GET /api/reports/attendance
 * Catalog + last generated meta (search, format, page, limit)
 */
const listAttendanceReports = async (req, res) => {
  try {
    if (!hasAllAccess(req.user)) {
      return res.status(403).json({ message: "Admin only" });
    }

    const {
      search = "",
      format,
      page = 1,
      limit = 10,
    } = req.query;

    const match = reportCompanyMatch(req.user);

    // Latest generated per key
    const latest = await AttendanceReport.aggregate([
      { $match: match },
      { $sort: { generatedAt: -1 } },
      {
        $group: {
          _id: "$key",
          doc: { $first: "$$ROOT" },
        },
      },
    ]);
    const latestMap = {};
    for (const row of latest) latestMap[row._id] = row.doc;

    let items = REPORT_CATALOG.map((c) => {
      const last = latestMap[c.key];
      return {
        key: c.key,
        name: c.name,
        category: c.category,
        format: last?.format || c.defaultFormat,
        defaultFormat: c.defaultFormat,
        description: c.description,
        lastGenerated: last?.generatedAt || null,
        lastGeneratedDisplay: last?.generatedAt
          ? displayDate(last.generatedAt)
          : "—",
        lastReportId: last?._id || null,
        status: last?.status || "Not Generated",
        rowCount: last?.rowCount ?? null,
        from: last?.from || null,
        to: last?.to || null,
        month: last?.month || null,
      };
    });

    if (search && String(search).trim()) {
      const q = String(search).trim().toLowerCase();
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.category.toLowerCase().includes(q) ||
          i.key.toLowerCase().includes(q)
      );
    }
    if (format && format !== "ALL") {
      const f = String(format).toUpperCase();
      items = items.filter(
        (i) => String(i.format).toUpperCase() === f
      );
    }

    const p = Number(page) || 1;
    const l = Number(limit) || 10;
    const total = items.length;
    const data = items.slice((p - 1) * l, p * l);

    return res.json({
      total,
      page: p,
      limit: l,
      pages: Math.max(1, Math.ceil(total / l) || 1),
      count: data.length,
      formats: FORMATS,
      reports: data,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GENERATE — POST /api/reports/attendance/generate
 * Body: { reportKey, month?, from?, to?, date?, format? }
 */
const generateAttendanceReport = async (req, res) => {
  try {
    if (!hasAllAccess(req.user)) {
      return res.status(403).json({ message: "Admin only" });
    }

    const reportKey = req.body.reportKey || req.body.key;
    if (!REPORT_KEYS.includes(reportKey)) {
      return res.status(400).json({
        message: `reportKey must be one of: ${REPORT_KEYS.join(", ")}`,
      });
    }

    const catalog = REPORT_CATALOG.find((c) => c.key === reportKey);
    let formatRaw = String(req.body.format || catalog.defaultFormat).trim();
    let format = "Excel";
    if (/^pdf$/i.test(formatRaw)) format = "PDF";
    else if (/^(excel|xlsx)$/i.test(formatRaw)) format = "Excel";
    else if (FORMATS.includes(formatRaw)) format = formatRaw;
    else {
      return res.status(400).json({ message: "format must be PDF or Excel" });
    }

    const range = resolveRange(req.body);
    const builder = BUILDERS[reportKey];
    const built = await builder(req.user, range);
    if (built.error) return res.status(403).json({ message: built.error });

    const company =
      companyForUser(req.user) ||
      req.user?.official?.company ||
      DEFAULT_COMPANY;

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = `${reportKey}_${range.from}_${range.to}_${stamp}`;

    let file;
    if (format === "Excel") {
      file = await writeExcelReport(
        baseName,
        built.title,
        built.columns,
        built.rows
      );
    } else {
      file = await writePdfReport(
        baseName,
        built.title,
        built.columns,
        built.rows,
        { company, from: range.from, to: range.to }
      );
    }

    const doc = await AttendanceReport.create({
      key: reportKey,
      name: catalog.name,
      category: catalog.category,
      format,
      company,
      from: range.from,
      to: range.to,
      month: range.month,
      fileName: file.fileName,
      filePath: file.filePath,
      rowCount: built.rows.length,
      generatedBy: req.user._id,
      generatedAt: new Date(),
      status: "Ready",
    });

    await doc.populate("generatedBy", "name role");

    return res.status(201).json({
      message: "Report generated",
      report: {
        _id: doc._id,
        key: doc.key,
        name: doc.name,
        category: doc.category,
        format: doc.format,
        from: doc.from,
        to: doc.to,
        month: doc.month,
        rowCount: doc.rowCount,
        fileName: doc.fileName,
        generatedAt: doc.generatedAt,
        lastGeneratedDisplay: displayDate(doc.generatedAt),
        status: doc.status,
        generatedBy: doc.generatedBy,
        downloadUrl: `/api/reports/attendance/${doc._id}/download`,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * DOWNLOAD — GET /api/reports/attendance/:id/download
 */
const downloadAttendanceReport = async (req, res) => {
  try {
    if (!hasAllAccess(req.user)) {
      return res.status(403).json({ message: "Admin only" });
    }

    const doc = await AttendanceReport.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Report not found" });

    if (!hasGlobalCompanyAccess(req.user)) {
      if (doc.company && !canAccessCompany(req.user, doc.company)) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    if (!doc.filePath || !fs.existsSync(doc.filePath)) {
      return res.status(404).json({
        message: "File missing — please Regenerate the report",
      });
    }

    const abs = path.resolve(doc.filePath);
    return res.download(abs, doc.fileName || path.basename(abs));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * REGENERATE — POST /api/reports/attendance/:id/regenerate
 * Re-runs with same key/range/format (or override body)
 */
const regenerateAttendanceReport = async (req, res) => {
  try {
    if (!hasAllAccess(req.user)) {
      return res.status(403).json({ message: "Admin only" });
    }

    const existing = await AttendanceReport.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Report not found" });
    }

    req.body = {
      reportKey: req.body.reportKey || existing.key,
      format: req.body.format || existing.format,
      month: req.body.month || existing.month,
      from: req.body.from || existing.from,
      to: req.body.to || existing.to,
    };
    return generateAttendanceReport(req, res);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  listAttendanceReports,
  generateAttendanceReport,
  downloadAttendanceReport,
  regenerateAttendanceReport,
};
