/**
 * COMPANY VALIDATION — nested branches → shifts → monthly schedule
 */
const Joi = require("joi");
const { WEEK_DAYS } = require("../models/Company");

const { normalizeHm } = require("../utils/shiftTiming");

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (value) => {
  const norm = normalizeHm(value);
  if (!norm) return NaN;
  const [h, m] = norm.split(":").map(Number);
  return h * 60 + m;
};

const DUPLICATE_MSG = {
  branchId: "This company lists the same branch more than once",
  shiftId: "This branch lists the same shift more than once",
  weekNumber: "This shift lists the same week more than once",
};

const uniqueBy = (field) => (items, helpers) => {
  const seen = new Set();
  for (const item of items || []) {
    const key = String(item?.[field] ?? "").trim().toUpperCase();
    if (!key) continue;
    if (seen.has(key)) {
      return helpers.message(DUPLICATE_MSG[field] || `Duplicate ${field}`);
    }
    seen.add(key);
  }
  return items;
};

const dayLabel = (day) =>
  day ? day.charAt(0).toUpperCase() + day.slice(1) : "This day";

/** 24-hour HH:mm → "3:30 PM", so the message matches the time picker. */
const to12h = (hm) => {
  if (!TIME_RE.test(hm || "")) return hm || "";
  const [hStr, m] = hm.split(":");
  let h = Number(hStr);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
};

const dayScheduleSchema = Joi.object({
  day: Joi.string().valid(...WEEK_DAYS).required(),
  isOff: Joi.boolean().default(false),
  startTime: Joi.string().trim().allow("").default(""),
  endTime: Joi.string().trim().allow("").default(""),
  breakStartTime: Joi.string().trim().allow("").default(""),
  breakEndTime: Joi.string().trim().allow("").default(""),
}).custom((day, helpers) => {
  day.startTime = normalizeHm(day.startTime);
  day.endTime = normalizeHm(day.endTime);
  day.breakStartTime = normalizeHm(day.breakStartTime);
  day.breakEndTime = normalizeHm(day.breakEndTime);

  const name = dayLabel(day.day);
  const pairError = (start, end, label) => {
    const hasStart = Boolean(start);
    const hasEnd = Boolean(end);
    if (hasStart !== hasEnd) {
      return `${name}: enter both ${label} start and ${label} end, or clear both`;
    }
    if (hasStart && (!TIME_RE.test(start) || !TIME_RE.test(end))) {
      return `${name}: ${label} time must look like 3:30 PM`;
    }
    if (hasStart && toMinutes(end) <= toMinutes(start)) {
      return `${name}: ${label} end (${to12h(end)}) must be after ${label} start (${to12h(start)})`;
    }
    return "";
  };

  if (!day.isOff) {
    if (!TIME_RE.test(day.startTime) || !TIME_RE.test(day.endTime)) {
      return helpers.message(`${name}: working start and working end are required`);
    }
    if (toMinutes(day.endTime) <= toMinutes(day.startTime)) {
      return helpers.message(
        `${name}: working end (${to12h(day.endTime)}) must be after working start (${to12h(day.startTime)})`
      );
    }
  } else {
    const shiftErr = pairError(day.startTime, day.endTime, "working");
    if (shiftErr) return helpers.message(shiftErr);
  }

  const breakErr = pairError(day.breakStartTime, day.breakEndTime, "break");
  if (breakErr) return helpers.message(breakErr);

  if (
    !day.isOff &&
    day.breakStartTime &&
    day.breakEndTime &&
    (toMinutes(day.breakStartTime) < toMinutes(day.startTime) ||
      toMinutes(day.breakEndTime) > toMinutes(day.endTime))
  ) {
    return helpers.message(
      `${name}: break (${to12h(day.breakStartTime)} to ${to12h(day.breakEndTime)}) must fall inside working hours (${to12h(day.startTime)} to ${to12h(day.endTime)})`
    );
  }
  return day;
});

const weekScheduleSchema = Joi.object({
  weekNumber: Joi.number().integer().min(1).max(5).required(),
  days: Joi.array()
    .items(dayScheduleSchema)
    .length(7)
    .custom((days, helpers) => {
      const names = days.map((d) => d.day);
      if (new Set(names).size !== names.length) {
        return helpers.message("A week lists the same day more than once");
      }
      const missing = WEEK_DAYS.filter((d) => !names.includes(d));
      if (missing.length) {
        return helpers.message(
          `Each week needs all 7 days. Add ${missing.map(dayLabel).join(", ")}`
        );
      }
      return days;
    })
    .required(),
});

const masterId = (label) =>
  Joi.string().hex().length(24).required().messages({
    "string.hex": `${label} is not valid. Select it again from the list`,
    "string.length": `${label} is not valid. Select it again from the list`,
    "string.empty": `${label} is required`,
    "any.required": `${label} is required`,
  });

const shiftSchema = Joi.object({
  shiftId: masterId("Shift"),
  monthlySchedule: Joi.array()
    .items(weekScheduleSchema)
    .custom(uniqueBy("weekNumber"))
    .default([]),
  isActive: Joi.boolean().default(true),
});

const branchSchema = Joi.object({
  branchId: masterId("Branch"),
  address: Joi.string().trim().allow("").max(300).default(""),
  city: Joi.string().trim().allow("").max(80).default(""),
  state: Joi.string().trim().allow("").max(80).default(""),
  pincode: Joi.string().trim().allow("").max(12).default(""),
  shifts: Joi.array()
    .items(shiftSchema)
    .custom(uniqueBy("shiftId"))
    .default([]),
  isActive: Joi.boolean().default(true),
});

const branchesField = Joi.array()
  .items(branchSchema)
  .custom(uniqueBy("branchId"));

const createCompanySchema = Joi.object({
  companyName: Joi.string().trim().min(2).max(160).required(),
  companyCode: Joi.string().trim().uppercase().min(1).max(20).required(),
  branches: branchesField.default([]),
  monthStartDay: Joi.number().integer().min(1).max(28).default(1),
  monthEndDay: Joi.number().integer().min(1).max(31).default(31),
  isActive: Joi.boolean().default(true),
}).unknown(false);

const updateCompanySchema = Joi.object({
  companyName: Joi.string().trim().min(2).max(160).optional(),
  companyCode: Joi.string().trim().uppercase().min(1).max(20).optional(),
  branches: branchesField.optional(),
  monthStartDay: Joi.number().integer().min(1).max(28).optional(),
  monthEndDay: Joi.number().integer().min(1).max(31).optional(),
  isActive: Joi.boolean().optional(),
})
  .min(1)
  .unknown(false);

const listCompanyQuerySchema = Joi.object({
  isActive: Joi.boolean().optional(),
  search: Joi.string().trim().allow("").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

module.exports = {
  createCompanySchema,
  updateCompanySchema,
  listCompanyQuerySchema,
};
