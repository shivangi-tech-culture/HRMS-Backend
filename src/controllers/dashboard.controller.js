/**
 * EMPLOYEE DASHBOARD — GET /api/dashboard/employee
 * Aggregates home widgets for ESS (My Home) without changing other modules.
 * UI: /employee
 */
const Attendance = require("../models/Attendance");
const LeaveRequest = require("../models/LeaveRequest");
const TourDuty = require("../models/TourDuty");
const Holiday = require("../models/Holiday");
const Notification = require("../models/Notification");
const Task = require("../models/Task");
const User = require("../models/User");
const AttendanceRegularization = require("../models/AttendanceRegularization");
const { userCompanyIds } = require("../utils/companyScope");
const { computeProfileCompletion } = require("../utils/profileCompletion");
const { EMPLOYEE } = require("../config/roles");

const ymd = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const addDaysYmd = (ymdStr, days) => {
  const [y, m, d] = ymdStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return ymd(new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
};

const monthBounds = (ref = new Date()) => {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const from = ymd(new Date(y, m, 1));
  const to = ymd(new Date(y, m + 1, 0));
  return { from, to, year: y, month: m + 1 };
};

const greetingPart = (date = new Date()) => {
  const h = date.getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
};

const minutesToHours = (mins) =>
  Math.round(((Number(mins) || 0) / 60) * 100) / 100;

const formatDurationHms = (mins) => {
  const total = Math.max(0, Math.floor(Number(mins) || 0));
  const h = String(Math.floor(total / 60)).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return `${h}:${m}:00`;
};

const weekOfMonth = (dateStr) => {
  const day = Number(String(dateStr).slice(8, 10));
  return Math.min(5, Math.max(1, Math.ceil(day / 7)));
};

const IMPORTANT_LINKS = [
  { label: "Virtual ID Card", path: "/employee/id-card" },
  { label: "Company Policy Handbook", path: "/employee/policies" },
  { label: "Holiday Calendar", path: "/employee/holiday" },
  { label: "Time Sheet", path: "/employee/timesheet" },
  { label: "Leave Policy Guidelines", path: "/employee/leave" },
  { label: "IT Helpdesk & Support", path: "/employee/helpdesk" },
];

/**
 * GET /api/dashboard/employee
 * Permission: Dashboard → My Home → view (Employee)
 */
const employeeDashboard = async (req, res) => {
  try {
    const user = req.user;
    const today = ymd();
    const { from: monthFrom, to: monthTo, year, month } = monthBounds();
    const companyIds = userCompanyIds(user);
    const eventTo = addDaysYmd(today, 30);

    const [
      monthAttendance,
      todayAttendance,
      onTourActive,
      leavePending,
      leaveApprovedMonth,
      otherPending,
      upcomingHolidays,
      unreadNotifications,
      pendingTasks,
      companyPeers,
      fullUser,
    ] = await Promise.all([
      Attendance.find({
        employee: user._id,
        date: { $gte: monthFrom, $lte: monthTo },
      })
        .select(
          "date status workedMinutes overtimeMinutes lateByMinutes earlyByMinutes punchIn punchOut"
        )
        .lean(),
      Attendance.findOne({ employee: user._id, date: today })
        .select(
          "date status workedMinutes overtimeMinutes lateByMinutes earlyByMinutes punchIn punchOut"
        )
        .lean(),
      TourDuty.countDocuments({
        employee: user._id,
        dutyType: "On Tour",
        status: { $in: ["Pending", "Approved"] },
        fromDate: { $lte: today },
        toDate: { $gte: today },
      }),
      LeaveRequest.countDocuments({
        employee: user._id,
        status: "Pending",
      }),
      LeaveRequest.find({
        employee: user._id,
        status: { $in: ["Approved", "Partial"] },
        from: { $lte: monthTo },
        to: { $gte: monthFrom },
      })
        .select("leaveType from to days status dayType")
        .populate("leaveType", "name code")
        .limit(10)
        .lean(),
      AttendanceRegularization.countDocuments({
        employee: user._id,
        status: "Pending",
      }),
      companyIds.length
        ? Holiday.find({
            companyIds: { $in: companyIds },
            isActive: true,
            date: { $gte: today, $lte: eventTo },
          })
            .select("name date description")
            .sort({ date: 1 })
            .limit(8)
            .lean()
        : Promise.resolve([]),
      Notification.countDocuments({ userId: user._id, read: false }),
      Task.find({
        assignees: user._id,
        status: { $ne: "Completed" },
      })
        .select("title description dueDate priority status projectId")
        .populate({ path: "projectId", select: "name" })
        .sort({ dueDate: 1, createdAt: -1 })
        .limit(5)
        .lean(),
      companyIds.length
        ? User.find({
            role: EMPLOYEE,
            status: "Active",
            "official.companyIds": { $in: companyIds },
            _id: { $ne: user._id },
          })
            .select(
              "name personal.dateOfBirth personal.anniversaryDate official.employeeCode official.dateOfJoining"
            )
            .limit(200)
            .lean()
        : Promise.resolve([]),
      User.findById(user._id)
        .select("-password -token -fcmTokens -resetPasswordToken")
        .lean(),
    ]);

    const presentStatuses = new Set([
      "Present",
      "Late",
      "HalfDay",
      "EarlyLeave",
      "Pending",
      "Working",
      "MissedPunch",
      "OnTour",
      "OnDuty",
      "WFH",
    ]);
    const workDays = monthAttendance.filter((r) => presentStatuses.has(r.status)).length;
    const absent = monthAttendance.filter((r) => r.status === "Absent").length;
    const lateByMinutes = monthAttendance.reduce(
      (sum, r) => sum + (Number(r.lateByMinutes) || 0),
      0
    );
    const earlyByMinutes = monthAttendance.reduce(
      (sum, r) => sum + (Number(r.earlyByMinutes) || 0),
      0
    );
    const overtimeMinutes = monthAttendance.reduce(
      (sum, r) => sum + (Number(r.overtimeMinutes) || 0),
      0
    );

    const weeklyMap = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of monthAttendance) {
      const w = weekOfMonth(row.date);
      weeklyMap[w] += Number(row.workedMinutes) || 0;
    }
    const weeklyWorkingHours = [1, 2, 3, 4, 5].map((week) => ({
      week: `Week ${week}`,
      weekNo: week,
      hours: minutesToHours(weeklyMap[week]),
      minutes: weeklyMap[week],
    }));

    const events = [];
    for (const peer of companyPeers) {
      const dob = peer.personal?.dateOfBirth
        ? ymd(new Date(peer.personal.dateOfBirth))
        : "";
      if (dob) {
        const mmdd = dob.slice(5);
        const thisYear = `${year}-${mmdd}`;
        if (thisYear >= today && thisYear <= eventTo) {
          events.push({
            type: "Birthday",
            name: peer.name || "",
            employeeCode: peer.official?.employeeCode || "",
            date: thisYear,
          });
        }
      }
      const ann = peer.personal?.anniversaryDate
        ? ymd(new Date(peer.personal.anniversaryDate))
        : "";
      if (ann && ann >= today && ann <= eventTo) {
        events.push({
          type: "Work Anniversary",
          name: peer.name || "",
          employeeCode: peer.official?.employeeCode || "",
          date: ann,
        });
      }
    }
    events.sort((a, b) => a.date.localeCompare(b.date));

    const taskItems = pendingTasks.map((t) => {
      const due = t.dueDate || "";
      let dueLabel = due;
      if (due === today) dueLabel = "Due today";
      else if (due && due < today) dueLabel = `Overdue · ${due}`;
      return {
        _id: t._id,
        title: t.title,
        category: t.projectId?.name || "Task",
        dueDate: due,
        dueLabel,
        priority: t.priority,
        status: t.status,
        displayStatus:
          t.status !== "Completed" && due && due < today ? "Over Due" : t.status,
      };
    });

    const profile = fullUser
      ? computeProfileCompletion(fullUser)
      : { percent: 0, shouldSendReminder: true };

    const workedToday = Number(todayAttendance?.workedMinutes) || 0;

    return res.json({
      message: "Employee dashboard",
      data: {
        greeting: {
          name: user.name || "",
          part: greetingPart(),
          text: `Good ${greetingPart()}, ${user.name || "there"}. Have a productive day.`,
        },
        summary: {
          attendance: workDays,
          onTour: onTourActive,
          leaves: leavePending > 0 ? leavePending : null,
          leavesLabel: leavePending > 0 ? String(leavePending).padStart(2, "0") : "-NA-",
          others: otherPending,
        },
        attendanceToday: {
          date: today,
          status: todayAttendance?.status || "Absent",
          punchedIn: Boolean(todayAttendance?.punchIn),
          punchedOut: Boolean(todayAttendance?.punchOut),
          totalHours: formatDurationHms(workedToday),
          productionHours: minutesToHours(workedToday),
          lateByMinutes: Number(todayAttendance?.lateByMinutes) || 0,
          earlyByMinutes: Number(todayAttendance?.earlyByMinutes) || 0,
        },
        monthlyStats: {
          year,
          month,
          from: monthFrom,
          to: monthTo,
          workDays,
          absent,
          delayedShortLeave: 0,
          lateByMinutes,
          lateByLabel:
            lateByMinutes > 0 ? `${lateByMinutes} Minutes` : "0 Minutes",
          overTime: formatDurationHms(overtimeMinutes),
          earlyByMinutes,
          earlyByLabel:
            earlyByMinutes > 0 ? `${earlyByMinutes} Minutes` : "0",
        },
        weeklyWorkingHours,
        pendingTasks: {
          count: taskItems.length,
          items: taskItems,
        },
        leavesHolidays: {
          leaves: leaveApprovedMonth.map((row) => ({
            _id: row._id,
            name: row.leaveType?.name || "Leave",
            code: row.leaveType?.code || "",
            from: row.from,
            to: row.to,
            days: row.days,
            status: row.status,
          })),
          holidays: upcomingHolidays.map((h) => ({
            _id: h._id,
            name: h.name,
            date: h.date,
            description: h.description || "",
          })),
        },
        events: events.slice(0, 10),
        notifications: { unreadCount: unreadNotifications },
        profileCompletion: {
          percent: profile.percentage ?? 0,
          shouldSendReminder: Boolean(profile.shouldSendReminder),
        },
        importantLinks: IMPORTANT_LINKS,
        feed: {
          updates: [],
          jobsCount: 0,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { employeeDashboard };
