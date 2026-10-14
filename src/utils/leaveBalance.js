/**
 * Leave wallet for one April–March leave year.
 * Quarterly Leave: 3 days in each calendar quarter (Q1 Jan–Mar … Q4 Oct–Dec). Unused days expire.
 * Emergency and Unpaid: one yearly pool.
 * Comp Off: remaining = days credited in `adjusted` minus used and pending. No yearly cap.
 */
const LeaveType = require("../models/LeaveType");
const LeaveRequest = require("../models/LeaveRequest");
const User = require("../models/User");
const Company = require("../models/Company");
const { EMPLOYEE, normalizeRoleName } = require("../config/roles");

const round = (n) => Math.round((Number(n) || 0) * 2) / 2;

const todayYmd = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const monthStartDayOf = (value) => {
  if (value && typeof value === "object") return monthStartDayOf(value.monthStartDay ?? value.startDay);
  const day = Math.floor(Number(value));
  if (!day || day < 1) return 1;
  return Math.min(28, day);
};

const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Stored company month. Missing end day means 31 when the month starts on 1, otherwise the day before the start. */
const cycleOf = (value, endValue) => {
  const startDay = monthStartDayOf(value);
  const rawEnd = value && typeof value === "object" ? value.monthEndDay ?? value.endDay : endValue;
  const endNum = Math.floor(Number(rawEnd));
  const monthEndDay = !endNum || endNum < 1 ? (startDay === 1 ? 31 : startDay - 1) : Math.min(31, endNum);
  return { monthStartDay: startDay, monthEndDay };
};

const pad2 = (n) => String(n).padStart(2, "0");

const ymdFromParts = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

const shiftMonth = (y, m, delta) => {
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1 };
};

const addDaysYmd = (ymd, days) => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
};

const daysAfter = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/**
 * One company month.
 * Start 1 and end 30 or 31 → the 1st through that month's last day.
 * Start 24 and end 23 → the 24th through the 23rd of the next month.
 */
const companyMonthOf = (ymd, cycle = 1) => {
  const { monthStartDay, monthEndDay } = cycleOf(cycle);
  const [y, m, d] = String(ymd).split("-").map(Number);
  let start = { y, m };
  if (d < monthStartDay) start = shiftMonth(y, m, -1);
  const startYmd = ymdFromParts(start.y, start.m, Math.min(monthStartDay, lastDayOfMonth(start.y, start.m)));
  let endYmd;
  if (monthStartDay === 1 && monthEndDay >= 28) {
    endYmd = ymdFromParts(start.y, start.m, lastDayOfMonth(start.y, start.m));
  } else if (monthEndDay < monthStartDay) {
    const next = shiftMonth(start.y, start.m, 1);
    endYmd = ymdFromParts(next.y, next.m, Math.min(monthEndDay, lastDayOfMonth(next.y, next.m)));
  } else {
    endYmd = ymdFromParts(start.y, start.m, Math.min(monthEndDay, lastDayOfMonth(start.y, start.m)));
  }
  return {
    start: startYmd,
    end: endYmd,
    year: start.y,
    month: start.m,
    quarter: Math.floor((start.m - 1) / 3) + 1,
  };
};

/** April–March, using the company month that contains the date. */
const leaveYear = (ymd = todayYmd(), monthStartDay = 1) => {
  const period = companyMonthOf(ymd, monthStartDay);
  return period.month >= 4 ? period.year : period.year - 1;
};

const yearLabel = (year) => `${year}-${String(year + 1).slice(-2)}`;

const companyOf = (user) => {
  const raw = user?.official?.companyIds || [];
  const id = raw[0];
  return id?._id || id || null;
};

const QUARTER_KEYS = ["q1", "q2", "q3", "q4"];

const emptyQuarters = () => ({ q1: 0, q2: 0, q3: 0, q4: 0 });

/** Quarter of the company month that contains this date. Start day 1 matches Jan–Mar … Oct–Dec. */
const quarterIndex = (ymd, monthStartDay = 1) => companyMonthOf(ymd, monthStartDay).quarter || 0;

const quarterKey = (quarter) => `q${quarter}`;

const eachYmd = (from, to) => {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

/** Inclusive dates of the company quarter that contains `ymd`. Three company months. */
const quarterWindow = (ymd, cycle = 1) => {
  const current = companyMonthOf(ymd, cycle);
  const { monthStartDay } = cycleOf(cycle);
  const startMonth = (current.quarter - 1) * 3 + 1;
  const first = companyMonthOf(ymdFromParts(current.year, startMonth, monthStartDay), cycle);
  const thirdStart = shiftMonth(current.year, startMonth, 2);
  const third = companyMonthOf(ymdFromParts(thirdStart.y, thirdStart.m, monthStartDay), cycle);
  return {
    quarter: current.quarter,
    code: `Q${current.quarter}`,
    label: `${first.start} to ${third.end}`,
    start: first.start,
    end: third.end,
    year: current.year,
  };
};

/**
 * Casual Leave can be applied only inside the company quarter that is open today.
 */
const quarterlyDateError = (from, to, today = todayYmd(), monthStartDay = 1) => {
  const current = quarterWindow(today, monthStartDay);
  if (from >= current.start && to <= current.end) return null;
  const asked = quarterWindow(from < current.start ? from : to, monthStartDay);
  return `Casual Leave for ${from} falls in ${asked.code} (${asked.label}), which is not open. Apply only in the current quarter, ${current.code} (${current.label}).`;
};

/** Split a request into company-quarter day counts. Half day stays on `from`. */
const slicesFor = (from, to, dayType = "Full Day", monthStartDay = 1) => {
  const one = (ymd) => {
    const period = companyMonthOf(ymd, monthStartDay);
    return { quarter: period.quarter, year: period.year };
  };
  if (dayType === "Half Day") {
    const hit = one(from);
    return [{ ...hit, days: 0.5 }];
  }
  const totals = new Map();
  for (const ymd of eachYmd(from, to)) {
    const hit = one(ymd);
    const key = `${hit.year}-${hit.quarter}`;
    const prev = totals.get(key) || { ...hit, days: 0 };
    prev.days += 1;
    totals.set(key, prev);
  }
  return [...totals.values()];
};

const isEarnedType = (type) =>
  !!type && (type.allocationType === "earned" || type.isUnlimited || type.maxDays == null);

const isQuarterlyType = (type) => type?.allocationType === "quarterly";

const toYmd = (value) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
};

/**
 * Probation ends after 3 company months.
 * Joining on the month's first day ends on the next such day, so that month is skipped.
 * Joining later ends on the same day inside the company month 3 periods later.
 * Start day 1: 1 Jan → 1 Apr, 15 Feb → 15 May, 31 Jan → 30 Apr.
 */
const probationEndYmd = (doj, cycle = 1) => {
  const ymd = toYmd(doj);
  if (!ymd) return "";
  const period = companyMonthOf(ymd, cycle);
  const { monthStartDay } = cycleOf(cycle);
  const offset = daysAfter(period.start, ymd);
  const later = shiftMonth(period.year, period.month, 3);
  const target = companyMonthOf(ymdFromParts(later.y, later.m, monthStartDay), cycle);
  if (!offset) return target.start;
  const landed = addDaysYmd(target.start, offset);
  return landed > target.end ? target.end : landed;
};

const periodsInQuarter = (calendarYear, quarter, cycle = 1) => {
  const { monthStartDay } = cycleOf(cycle);
  const startMonth = (quarter - 1) * 3 + 1;
  const periods = [];
  for (let i = 0; i < 3; i += 1) {
    const point = shiftMonth(calendarYear, startMonth, i);
    periods.push(companyMonthOf(ymdFromParts(point.y, point.m, monthStartDay), cycle));
  }
  return periods;
};

/** One Casual Leave for a company month after probation. The opening day of that month does not count. */
const periodGetsCasualLeave = (period, endYmd) => {
  if (!endYmd || !period) return true;
  if (endYmd < period.start) return true;
  return endYmd > period.start && endYmd <= period.end;
};

const quarterAllowanceFor = (type, doj, calendarYear, quarter, monthStartDay = 1) => {
  const full = round(type?.quarterlyLimit || 0);
  if (!isQuarterlyType(type)) return full;
  const end = probationEndYmd(doj, monthStartDay);
  if (!end) return 0;
  return periodsInQuarter(calendarYear, quarter, monthStartDay).filter((period) =>
    periodGetsCasualLeave(period, end)
  ).length;
};

const quarterAllowanceNow = (type, doj, ymd = todayYmd(), monthStartDay = 1) => {
  const period = companyMonthOf(ymd, monthStartDay);
  return quarterAllowanceFor(type, doj, period.year, period.quarter, monthStartDay);
};

/** Q2–Q4 sit in the leave year. Q1 is Jan–Mar of the next calendar year. */
const calendarYearForQuarter = (leaveYearNum, quarter) =>
  quarter === 1 ? Number(leaveYearNum) + 1 : Number(leaveYearNum);

/**
 * Adjusted days are extra Casual Leave (for example a month that was carried in).
 * They can be used once, on top of a quarter's own limit, not once in every quarter.
 */
const spareAdjustment = (line, type, doj, monthStartDay) => {
  const extra = round(line?.adjusted || 0);
  if (extra <= 0) return 0;
  const year = Number(line?.year) || leaveYear();
  const tagged = round((line?.adjustedUsed || 0) + (line?.adjustedPending || 0));
  let implicit = 0;
  for (let quarter = 1; quarter <= 4; quarter += 1) {
    const key = quarterKey(quarter);
    const limit = quarterAllowanceFor(
      type,
      doj,
      calendarYearForQuarter(year, quarter),
      quarter,
      monthStartDay
    );
    const taken = round((line?.quarterUsed?.[key] || 0) + (line?.quarterPending?.[key] || 0));
    implicit = round(implicit + Math.max(0, taken - limit));
  }
  return round(Math.max(0, extra - tagged - implicit));
};

/** Days still applyable in one quarter. Adjusted days sit on top and can be used in any quarter. */
const quarterRoom = (line, type, doj, monthStartDay, calendarYear, quarter, creditQuarter = true) => {
  const key = quarterKey(quarter);
  const limit = quarterAllowanceFor(type, doj, calendarYear, quarter, monthStartDay);
  const used = round(line?.quarterUsed?.[key] || 0);
  const pending = round(line?.quarterPending?.[key] || 0);
  const taken = round(used + pending);
  const spare = spareAdjustment(line, type, doj, monthStartDay);
  const over = round(Math.max(0, taken - limit));
  const own = creditQuarter ? round(Math.max(0, limit - taken)) : 0;
  return {
    limit,
    used,
    pending,
    spare,
    ceiling: round((creditQuarter ? limit : 0) + spare + (creditQuarter ? over : 0)),
    left: round(own + spare),
  };
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Company month YYYY-MM, and the quarter that month belongs to. */
const monthPeriod = (monthKey, monthStartDay = 1) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ""));
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) return null;
  const { monthStartDay: startDay } = cycleOf(monthStartDay);
  const period = companyMonthOf(ymdFromParts(y, m, startDay), monthStartDay);
  const window = quarterWindow(period.start, monthStartDay);
  return {
    month: `${period.year}-${pad2(period.month)}`,
    monthName: `${MONTH_NAMES[period.month - 1]} ${period.year}`,
    quarter: period.quarter,
    quarterCode: `Q${period.quarter}`,
    quarterLabel: window.label,
    start: period.start,
    end: period.end,
  };
};

const parseQuarterCode = (value) => {
  const match = String(value ?? "").trim().toUpperCase().match(/^Q?([1-4])$/);
  return match ? Number(match[1]) : 0;
};

const monthNumberFrom = (value) => {
  const text = String(value ?? "").trim();
  const stamped = /^(\d{4})-(\d{2})$/.exec(text);
  if (stamped) return { year: Number(stamped[1]), month: Number(stamped[2]), explicitYear: true };
  if (/^\d{1,2}$/.test(text)) {
    const month = Number(text);
    return month >= 1 && month <= 12 ? { month, explicitYear: false } : null;
  }
  const lower = text.toLowerCase();
  const exact = MONTH_NAMES.findIndex((name) => name.toLowerCase() === lower);
  if (exact >= 0) return { month: exact + 1, explicitYear: false };
  const short = MONTH_NAMES.findIndex((name) => name.toLowerCase().slice(0, 3) === lower);
  if (short >= 0) return { month: short + 1, explicitYear: false };
  return null;
};

const quarterMonthNames = (leaveYearNum, quarter, monthStartDay) =>
  periodsInQuarter(calendarYearForQuarter(leaveYearNum, quarter), quarter, monthStartDay)
    .map((period) => `${MONTH_NAMES[period.month - 1]} ${period.year}`);

const creditOneMonth = (value, quarter, leaveYearNum, monthStartDay) => {
  const code = `Q${quarter}`;
  const names = quarterMonthNames(leaveYearNum, quarter, monthStartDay);
  const picked = monthNumberFrom(value);
  if (!picked) return { error: `${code} needs one of its months: ${names.join(", ")}` };
  const year = picked.explicitYear ? picked.year : calendarYearForQuarter(leaveYearNum, quarter);
  const credit = monthPeriod(`${year}-${pad2(picked.month)}`, monthStartDay);
  if (!credit || credit.quarter !== quarter || leaveYear(credit.start, monthStartDay) !== Number(leaveYearNum)) {
    const found = credit ? `${credit.monthName} is ${credit.quarterCode}` : "That month is not valid";
    return { error: `${found}. ${code} months are ${names.join(", ")}.` };
  }
  return { credit };
};

/**
 * Casual Leave adjust: quarter Q1–Q4, then month as an array.
 * Each month carries 1 day. Three days means three months, for example July, August, September.
 */
const casualAdjustCredit = (body, leaveYearNum, monthStartDay = 1) => {
  const quarter = parseQuarterCode(body?.quarter);
  if (!quarter) return { error: "Casual Leave adjust needs quarter: Q1, Q2, Q3 or Q4" };
  const raw = body?.month;
  if (!Array.isArray(raw) || !raw.length) {
    return { error: "Casual Leave adjust needs month as an array. Each month carries 1 day." };
  }
  const credits = [];
  const seen = new Set();
  for (const value of raw) {
    const one = creditOneMonth(value, quarter, leaveYearNum, monthStartDay);
    if (one.error) return one;
    if (seen.has(one.credit.month)) {
      return { error: `${one.credit.monthName} is repeated. Each month carries 1 day.` };
    }
    seen.add(one.credit.month);
    credits.push(one.credit);
  }
  return { credits };
};

const adjustmentView = (row, monthStartDay = 1) => {
  const period = monthPeriod(row?.month, monthStartDay);
  return {
    month: period?.month || row?.month || "",
    monthName: period?.monthName || "",
    quarter: period?.quarterCode || (row?.quarter ? `Q${row.quarter}` : ""),
    quarterLabel: period?.quarterLabel || "",
    start: period?.start || "",
    end: period?.end || "",
  };
};

const sliceInOpenQuarter = (slice, open) => slice.quarter === open.quarter && slice.year === open.year;

/** Mark how many days of each slice come from the adjustment pool. */
const tagSlices = (slices, adjustmentDays, monthStartDay = 1) => {
  const open = quarterWindow(todayYmd(), monthStartDay);
  let left = round(adjustmentDays);
  const tagged = slices.map((slice) => ({ ...slice, adjustmentDays: 0 }));
  const order = [
    ...tagged.filter((slice) => !sliceInOpenQuarter(slice, open)),
    ...tagged.filter((slice) => sliceInOpenQuarter(slice, open)),
  ];
  for (const slice of order) {
    const take = round(Math.min(slice.days, Math.max(0, left)));
    slice.adjustmentDays = take;
    left = round(left - take);
  }
  return tagged.map((slice) => ({ ...slice, regularDays: round(slice.days - slice.adjustmentDays) }));
};

/** null when the date is on or after probation ends. */
const probationBlock = (doj, from, cycle = 1) => {
  const end = probationEndYmd(doj, cycle);
  if (!end) return "Date of joining is required before applying leave";
  if (from < end) return `Leave cannot be applied during probation. Probation ends on ${end}.`;
  return null;
};

const casualDatesError = (doj, from, to, monthStartDay = 1) => {
  const end = probationEndYmd(doj, monthStartDay);
  if (!end) return "Date of joining is required before applying leave";
  for (const ymd of eachYmd(from, to)) {
    const period = companyMonthOf(ymd, monthStartDay);
    if (!periodGetsCasualLeave(period, end)) {
      return `Casual Leave is not available for ${ymd}. That company month (${period.start} to ${period.end}) was collapsed because of probation.`;
    }
  }
  return null;
};

const monthStartForCompany = async (companyId) => {
  if (!companyId) return cycleOf(1, 31);
  const row = await Company.findById(companyId).select("monthStartDay monthEndDay").lean();
  return cycleOf({ monthStartDay: row?.monthStartDay, monthEndDay: row?.monthEndDay });
};

const monthStartForUser = async (user) => monthStartForCompany(companyOf(user));

const readQuarters = (bag) => {
  const base = emptyQuarters();
  if (!bag) return base;
  for (const key of QUARTER_KEYS) base[key] = round(bag[key] || 0);
  return base;
};

const ensureQuarters = (line) => {
  line.quarterUsed = readQuarters(line.quarterUsed);
  line.quarterPending = readQuarters(line.quarterPending);
  return line;
};

/** Days the employee can draw from before used and pending. */
const poolOf = (type, line) => {
  if (isEarnedType(type)) return round(line?.adjusted || 0);
  return round((Number(type?.maxDays) || 0) + (line?.adjusted || 0));
};

const lineFromType = (type, year) => {
  const line = {
    leaveType: type._id,
    year,
    adjusted: 0,
    used: 0,
    pending: 0,
    available: 0,
    remaining: 0,
    quarterUsed: emptyQuarters(),
    quarterPending: emptyQuarters(),
  };
  return stampLine(line, type);
};

/**
 * Writes available and remaining on the wallet line.
 * Quarterly remaining is this calendar quarter only.
 * Earned remaining is credited days only.
 */
const stampLine = (line, type, doj, monthStartDay = 1) => {
  if (isQuarterlyType(type)) {
    ensureQuarters(line);
    const today = todayYmd();
    const period = companyMonthOf(today, monthStartDay);
    const room = quarterRoom(line, type, doj, monthStartDay, period.year, period.quarter);
    line.available = room.ceiling;
    line.remaining = room.left;
    return line;
  }
  line.available = poolOf(type, line);
  line.remaining = round(line.available - (line.used || 0) - (line.pending || 0));
  return line;
};

const leaveLine = (user, leaveTypeId, year) =>
  (user?.leaves || []).find(
    (row) => row.year === year && String(row.leaveType) === String(leaveTypeId)
  );

/** Wallet counters follow real Pending and Approved requests. Drop stale used days. */
const rebuildQuarterLine = async (user, type, line, monthStartDay = 1) => {
  if (!user || !type || !line || !isQuarterlyType(type)) return line;
  const year = line.year || leaveYear();
  const start = `${year}-04-01`;
  const end = `${year + 1}-03-31`;
  const rows = await LeaveRequest.find({
    employee: user._id,
    leaveType: type._id,
    status: { $in: ["Pending", "Approved"] },
    to: { $gte: start },
    from: { $lte: end },
  })
    .select("from to dayType status days adjustmentDays")
    .lean();
  const quarterUsed = emptyQuarters();
  const quarterPending = emptyQuarters();
  let used = 0;
  let pending = 0;
  let adjustedUsed = 0;
  let adjustedPending = 0;
  for (const row of rows) {
    const tagged = tagSlices(
      slicesFor(row.from, row.to, row.dayType, monthStartDay),
      row.adjustmentDays || 0,
      monthStartDay
    );
    for (const slice of tagged) {
      const key = quarterKey(slice.quarter);
      if (!QUARTER_KEYS.includes(key)) continue;
      if (row.status === "Approved") {
        quarterUsed[key] = round(quarterUsed[key] + slice.regularDays);
        used = round(used + slice.days);
        adjustedUsed = round(adjustedUsed + slice.adjustmentDays);
      } else {
        quarterPending[key] = round(quarterPending[key] + slice.regularDays);
        pending = round(pending + slice.days);
        adjustedPending = round(adjustedPending + slice.adjustmentDays);
      }
    }
  }
  line.quarterUsed = quarterUsed;
  line.quarterPending = quarterPending;
  line.used = used;
  line.pending = pending;
  line.adjustedUsed = adjustedUsed;
  line.adjustedPending = adjustedPending;
  return line;
};

/** Name and rules come from the type. Counters live on the employee. */
const presentItem = (item, type, doj, monthStartDay = 1) => {
  if (!item || !type) return null;
  const earned = isEarnedType(type);
  const quarterly = isQuarterlyType(type);
  const quarterUsed = readQuarters(item.quarterUsed);
  const quarterPending = readQuarters(item.quarterPending);
  const today = todayYmd();
  const period = companyMonthOf(today, monthStartDay);
  const now = period.quarter;
  const key = quarterKey(now);
  const open = quarterWindow(today, monthStartDay);
  const probationEnds = probationEndYmd(doj, monthStartDay) || null;
  let available;
  let remaining;
  let quarter = null;
  if (quarterly) {
    const room = quarterRoom(item, type, doj, monthStartDay, period.year, now);
    const limit = room.limit;
    available = room.ceiling;
    remaining = room.left;
    quarter = {
      code: `Q${now}`,
      label: open.label,
      start: open.start,
      end: open.end,
      monthStartDay: cycleOf(monthStartDay).monthStartDay,
      monthEndDay: cycleOf(monthStartDay).monthEndDay,
      limit,
      adjusted: round(item.adjusted || 0),
      adjustedRemaining: room.spare,
      used: quarterUsed[key],
      pending: quarterPending[key],
      remaining,
    };
  } else if (earned) {
    available = round(item.adjusted || 0);
    remaining = round(available - item.used - item.pending);
  } else {
    available = round((Number(type.maxDays) || 0) + (item.adjusted || 0));
    remaining = round(available - item.used - item.pending);
  }
  const annualMax = earned ? null : type.maxDays;
  let display = `${item.used}/${available} used`;
  if (quarterly) display = `${quarterUsed[key]}/${available} this quarter`;
  if (earned) display = `${available} earned, ${item.used} used`;
  return {
    leaveType: type._id,
    scope: type.scope,
    name: type.name,
    code: type.code,
    paid: type.paid,
    carryForward: type.carryForward,
    allocationType: type.allocationType || (earned ? "earned" : "yearly"),
    quarterlyLimit: quarterly ? available : type.quarterlyLimit ?? null,
    isUnlimited: !!type.isUnlimited || earned,
    maxDays: annualMax,
    probationEnds,
    total: earned ? available : annualMax,
    available,
    adjusted: item.adjusted,
    adjustedRemaining: quarterly ? quarter?.adjustedRemaining || 0 : 0,
    earned: earned ? available : 0,
    used: item.used,
    pending: quarterly ? quarterPending[key] : item.pending,
    remaining,
    quarter,
    display,
  };
};

const isUnpaidBalance = (row) => row?.paid === false || String(row?.code || "").toUpperCase() === "UL";

/** Casual Leave 12 + Earned Leave 6 = paid annual 18. Comp Off stays outside that number. */
const summarizeBalances = (balances) => {
  const rows = balances || [];
  const paid = rows.filter((row) => row.paid && row.allocationType !== "earned" && !isUnpaidBalance(row));
  const comp = rows.find((row) => row.allocationType === "earned");
  const unpaidRows = rows.filter(isUnpaidBalance);
  const unpaidUsed = round(unpaidRows.reduce((sum, row) => sum + (row.used || 0), 0));
  const unpaidPending = round(unpaidRows.reduce((sum, row) => sum + (row.pending || 0), 0));
  return {
    paidAnnual: round(paid.reduce((sum, row) => sum + (Number(row.maxDays) || 0), 0)),
    paidUsed: round(paid.reduce((sum, row) => sum + (row.used || 0), 0)),
    paidPending: round(paid.reduce((sum, row) => sum + (row.pending || 0), 0)),
    applyableNow: round(paid.reduce((sum, row) => sum + (row.remaining || 0), 0)),
    compOff: {
      earned: comp?.earned || 0,
      used: comp?.used || 0,
      pending: comp?.pending || 0,
      remaining: comp?.remaining || 0,
    },
    unpaid: {
      allotted: round(unpaidRows.reduce((sum, row) => sum + (Number(row.maxDays) || row.available || 0), 0)),
      used: unpaidUsed,
      pending: unpaidPending,
      remaining: round(unpaidRows.reduce((sum, row) => sum + (row.remaining || 0), 0)),
    },
    /** Approved unpaid days are the salary deduction. Pending days are not deducted yet. */
    deduction: {
      days: unpaidUsed,
      pendingDays: unpaidPending,
    },
  };
};

/** True when this date of a request is salary-deducted unpaid leave. Paid days come first. */
const leaveDayUnpaid = (leave, date) => {
  if (!leave || !date) return false;
  const hasSplit = leave.paidDays != null || leave.unpaidDays != null;
  if (!hasSplit) {
    const code = String(leave.leaveType?.code || leave.code || "").toUpperCase();
    return leave.leaveType?.paid === false || leave.paid === false || code === "UL";
  }
  const unpaid = round(leave.unpaidDays || 0);
  const paidDays = round(leave.paidDays || 0);
  if (unpaid <= 0) return false;
  if (leave.dayType === "Half Day") return paidDays <= 0;
  const dates = eachYmd(leave.from, leave.to);
  const index = dates.indexOf(date);
  if (index < 0) return false;
  return index >= paidDays;
};

const findItem = (balance, leaveTypeId) =>
  (balance?.items || []).find((i) => String(i.leaveType) === String(leaveTypeId));

/** Common types, plus this company's own. Same code → company row wins. Hidden company row removes that code. */
const typesForCompany = (rows, companyId) => {
  const hidden = new Set(
    rows
      .filter(
        (row) =>
          row.hidden &&
          row.scope !== "common" &&
          String(row.companyId) === String(companyId)
      )
      .map((row) => row.code)
  );
  const byCode = new Map();
  for (const row of rows) {
    if (row.hidden || hidden.has(row.code)) continue;
    const common = row.scope === "common";
    const mine = !common && String(row.companyId) === String(companyId);
    if (!common && !mine) continue;
    if (!common) byCode.set(row.code, row);
    else if (!byCode.has(row.code)) byCode.set(row.code, row);
  }
  return [...byCode.values()];
};

const activeTypeQuery = (companyIds) => ({
  status: "Active",
  hidden: { $ne: true },
  $or: [
    { scope: "common" },
    { scope: "company", companyId: { $in: companyIds } },
  ],
});

/** Active catalog plus company hide-markers, so a hidden code is not granted again. */
const catalogRows = async (companyIds) => {
  const [active, hidden] = await Promise.all([
    LeaveType.find(activeTypeQuery(companyIds)).lean(),
    LeaveType.find({
      scope: "company",
      companyId: { $in: companyIds },
      hidden: true,
    })
      .select("code companyId scope hidden")
      .lean(),
  ]);
  return [...active, ...hidden];
};

/** Put this year's lines on the employee. Safe to call twice. */
const grantLeaveBalance = async (user) => {
  if (!user || normalizeRoleName(user.role) !== EMPLOYEE) return null;
  const companyId = companyOf(user);
  if (!companyId) return null;
  const year = leaveYear(todayYmd(), await monthStartForCompany(companyId));
  const doc = await User.findById(user._id).select("leaves role official.companyIds");
  if (!doc) return null;
  if (!doc.leaves) doc.leaves = [];
  if (doc.leaves.some((row) => row.year === year)) return doc;

  const rows = await catalogRows([companyId]);
  const types = typesForCompany(rows, companyId);
  doc.leaves.push(...types.map((type) => lineFromType(type, year)));
  await doc.save();
  return doc;
};

const shiftQuarter = (line, slices, direction) => {
  ensureQuarters(line);
  for (const slice of slices) {
    const key = quarterKey(slice.quarter);
    const regular = round(slice.regularDays != null ? slice.regularDays : slice.days);
    const adjusted = round(slice.adjustmentDays || 0);
    if (QUARTER_KEYS.includes(key) && regular) {
      if (direction === "hold") {
        line.quarterPending[key] = round(line.quarterPending[key] + regular);
      } else if (direction === "approve") {
        line.quarterPending[key] = round(Math.max(0, line.quarterPending[key] - regular));
        line.quarterUsed[key] = round(line.quarterUsed[key] + regular);
      } else {
        line.quarterPending[key] = round(Math.max(0, line.quarterPending[key] - regular));
      }
    }
    if (!adjusted) continue;
    if (direction === "hold") {
      line.adjustedPending = round((line.adjustedPending || 0) + adjusted);
    } else if (direction === "approve") {
      line.adjustedPending = round(Math.max(0, (line.adjustedPending || 0) - adjusted));
      line.adjustedUsed = round((line.adjustedUsed || 0) + adjusted);
    } else {
      line.adjustedPending = round(Math.max(0, (line.adjustedPending || 0) - adjusted));
    }
  }
};

/**
 * Apply, approve, reject, or cancel.
 * `slices` is required for Quarterly Leave so each calendar quarter is capped on its own.
 */
const moveLeave = async (employeeId, type, days, direction, slices = [], knownAdjustment = null) => {
  const user = await User.findById(employeeId).select("leaves official.dateOfJoining official.companyIds");
  if (!user) return { error: "Leave balance not found for this type" };
  const monthStartDay = await monthStartForUser(user);
  const year = leaveYear(todayYmd(), monthStartDay);
  const line = leaveLine(user, type._id, year);
  if (!line) return { error: "Leave balance not found for this type" };
  const doj = user.official?.dateOfJoining;
  let adjustmentDays = round(knownAdjustment || 0);

  if (isQuarterlyType(type)) {
    await rebuildQuarterLine(user, type, line, monthStartDay);
    ensureQuarters(line);
    const open = quarterWindow(todayYmd(), monthStartDay);
    let tagged = slices;
    if (direction === "hold") {
      let spareLeft = spareAdjustment(line, type, doj, monthStartDay);
      const planned = [];
      for (const slice of slices) {
        const inOpen = sliceInOpenQuarter(slice, open);
        const room = quarterRoom(line, type, doj, monthStartDay, slice.year, slice.quarter, inOpen);
        const own = inOpen ? round(Math.max(0, room.limit - room.used - room.pending)) : 0;
        const fromQuarter = round(Math.min(slice.days, own));
        const fromAdjust = round(slice.days - fromQuarter);
        if (fromAdjust > spareLeft) {
          if (!inOpen) {
            return {
              error: `Only ${spareLeft} adjusted ${type.name} left. Adjusted days can be used in any quarter. ${open.code} (${open.label}) is the open quarter.`,
            };
          }
          const window = quarterWindow(`${slice.year}-${pad2((slice.quarter - 1) * 3 + 1)}-01`, monthStartDay);
          const extra = spareLeft ? `, plus ${spareLeft} adjusted (usable in any quarter)` : "";
          return {
            error: `Only ${round(own + spareLeft)} ${type.name} left in ${window.code} (${window.label}). This quarter allows ${room.limit} days${extra}.`,
          };
        }
        if (inOpen && !fromQuarter && !fromAdjust) {
          return {
            error: `No ${type.name} in Q${slice.quarter}. Months inside the 3-month probation are not counted.`,
          };
        }
        spareLeft = round(spareLeft - fromAdjust);
        if (inOpen) {
          const key = quarterKey(slice.quarter);
          line.quarterPending[key] = round((line.quarterPending[key] || 0) + fromQuarter);
        }
        planned.push({ ...slice, adjustmentDays: fromAdjust, regularDays: fromQuarter });
      }
      for (const slice of planned) {
        if (sliceInOpenQuarter(slice, open)) {
          const key = quarterKey(slice.quarter);
          line.quarterPending[key] = round(Math.max(0, (line.quarterPending[key] || 0) - slice.regularDays));
        }
      }
      adjustmentDays = round(planned.reduce((sum, slice) => sum + slice.adjustmentDays, 0));
      tagged = planned;
      const yearLeft = round((Number(type.maxDays) || 0) + (line.adjusted || 0) - line.used - line.pending);
      if (days > yearLeft) return { error: `Only ${yearLeft} ${type.name} remaining this leave year` };
    } else {
      tagged = tagSlices(slices, adjustmentDays, monthStartDay);
    }
    shiftQuarter(line, tagged, direction);
  }

  const remaining = isQuarterlyType(type)
    ? round((Number(type.maxDays) || 0) + (line.adjusted || 0) - line.used - line.pending)
    : round(poolOf(type, line) - line.used - line.pending);

  if (!isQuarterlyType(type) && direction === "hold" && remaining < days) {
    if (isEarnedType(type)) {
      return { error: `Only ${remaining} ${type.name} earned. Comp Off is credited per extra working day.` };
    }
    return { error: `Only ${remaining} ${type.name} remaining` };
  }
  if (direction === "hold") {
    line.pending = round(line.pending + days);
  } else if (direction === "approve") {
    line.pending = round(Math.max(0, line.pending - days));
    line.used = round(line.used + days);
  } else {
    line.pending = round(Math.max(0, line.pending - days));
  }
  stampLine(line, type, doj, monthStartDay);
  user.markModified("leaves");
  await user.save();
  return { item: presentItem(line, type, doj, monthStartDay), adjustmentDays: round(adjustmentDays) };
};

/**
 * Add this type id to wallets that do not have it yet.
 * common → every company. company → that company only.
 * Same code as a common type: that company's line switches to the company type.
 */
const pushTypeToBalances = async (type) => {
  if (type.status !== "Active" || type.hidden) return;
  const year = leaveYear();
  const filter = { role: EMPLOYEE, status: "Active" };
  if (type.scope === "company") filter["official.companyIds"] = type.companyId;
  if (type.scope === "common") {
    const hidden = await LeaveType.find({ scope: "company", code: type.code, hidden: true })
      .select("companyId")
      .lean();
    if (hidden.length) filter["official.companyIds"] = { $nin: hidden.map((row) => row.companyId) };
  }
  let commonId = null;
  if (type.scope === "company") {
    const common = await LeaveType.findOne({ scope: "common", code: type.code }).select("_id").lean();
    commonId = common?._id || null;
  }
  const users = await User.find(filter).select("leaves");
  for (const user of users) {
    if (commonId) {
      const switched = leaveLine(user, commonId, year);
      if (switched) {
        switched.leaveType = type._id;
        stampLine(switched, type);
        user.markModified("leaves");
        await user.save();
        continue;
      }
    }
    if (leaveLine(user, type._id, year)) continue;
    if (!user.leaves) user.leaves = [];
    user.leaves.push(lineFromType(type, year));
    await user.save();
  }
};

/**
 * Employees created before types existed get a wallet here.
 * Missing types are pushed onto wallets that already exist.
 */
const ensureCompanyBalances = async (companyIds) => {
  if (!companyIds?.length) return;
  const year = leaveYear();
  const [types, employees] = await Promise.all([
    catalogRows(companyIds),
    User.find({
      role: EMPLOYEE,
      status: "Active",
      "official.companyIds": { $in: companyIds },
    })
      .select("_id official.companyIds leaves role")
      .lean(),
  ]);
  if (!employees.length) return;

  for (const emp of employees) {
    if ((emp.leaves || []).some((row) => row.year === year)) continue;
    await grantLeaveBalance(emp);
  }

  await Promise.all(types.map((type) => pushTypeToBalances(type)));
};

/** Block a lower max when someone has already used more than that. */
const syncTypeOnBalances = async (type) => {
  const year = leaveYear();
  const users = await User.find({
    leaves: { $elemMatch: { leaveType: type._id, year } },
  }).select("leaves");
  for (const user of users) {
    const line = leaveLine(user, type._id, year);
    if (!line) continue;
    if (!isEarnedType(type) && !isQuarterlyType(type)) {
      if (round(poolOf(type, line) - line.used - line.pending) < 0) {
        return {
          ok: false,
          message: `${type.name} is already used more than ${type.maxDays} days`,
        };
      }
    }
    if (isQuarterlyType(type)) {
      ensureQuarters(line);
      const limit = round(type.quarterlyLimit || 0);
      const extra = round(Math.max(0, line.adjusted || 0));
      for (const key of QUARTER_KEYS) {
        if (round(line.quarterUsed[key] + line.quarterPending[key]) > round(limit + extra)) {
          return {
            ok: false,
            message: `${type.name} is already used more than ${limit} days in a quarter`,
          };
        }
      }
    }
  }
  if (type.status === "Active") await pushTypeToBalances(type);
  for (const user of users) {
    const line = leaveLine(user, type._id, year);
    if (!line) continue;
    stampLine(line, type);
    user.markModified("leaves");
    await user.save();
  }
  return { ok: true };
};

module.exports = {
  round,
  todayYmd,
  leaveYear,
  yearLabel,
  companyOf,
  monthStartDayOf,
  cycleOf,
  monthStartForUser,
  monthStartForCompany,
  companyMonthOf,
  presentItem,
  summarizeBalances,
  leaveDayUnpaid,
  eachYmd,
  stampLine,
  findItem,
  grantLeaveBalance,
  moveLeave,
  leaveLine,
  rebuildQuarterLine,
  slicesFor,
  quarterWindow,
  quarterlyDateError,
  probationEndYmd,
  probationBlock,
  casualDatesError,
  quarterAllowanceFor,
  monthPeriod,
  adjustmentView,
  casualAdjustCredit,
  isEarnedType,
  isQuarterlyType,
  poolOf,
  typesForCompany,
  pushTypeToBalances,
  ensureCompanyBalances,
  syncTypeOnBalances,
};
