/**
 * COMPANY VALIDATION — nested branches → shifts → monthly schedule
 */
const Joi = require("joi");
const { WEEK_DAYS } = require("../models/Company");

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (value) => {
  const [h, m] = String(value).split(":").map(Number);
  return h * 60 + m;
};

const uniqueBy = (field, label) => (items, helpers) => {
  const seen = new Set();
  for (const item of items || []) {
    const key = String(item?.[field] ?? "").trim().toUpperCase();
    if (!key) continue;
    if (seen.has(key)) return helpers.message(`Duplicate ${label}: ${item[field]}`);
    seen.add(key);
  }
  return items;
};

const dayScheduleSchema = Joi.object({
  day: Joi.string().valid(...WEEK_DAYS).required(),
  isOff: Joi.boolean().default(false),
  startTime: Joi.string().trim().allow("").default(""),
  endTime: Joi.string().trim().allow("").default(""),
  breakStartTime: Joi.string().trim().allow("").default(""),
  breakEndTime: Joi.string().trim().allow("").default(""),
}).custom((day, helpers) => {
  const pairError = (start, end, label) => {
    const hasStart = Boolean(start);
    const hasEnd = Boolean(end);
    if (hasStart !== hasEnd) return `${day.day}: ${label} needs both start and end`;
    if (hasStart && (!TIME_RE.test(start) || !TIME_RE.test(end))) {
      return `${day.day}: ${label} must be HH:mm`;
    }
    if (hasStart && toMinutes(end) <= toMinutes(start)) {
      return `${day.day}: ${label} end must be after start`;
    }
    return "";
  };

  if (!day.isOff) {
    if (!TIME_RE.test(day.startTime) || !TIME_RE.test(day.endTime)) {
      return helpers.message(`${day.day}: startTime and endTime are required (HH:mm)`);
    }
    if (toMinutes(day.endTime) <= toMinutes(day.startTime)) {
      return helpers.message(`${day.day}: endTime must be after startTime`);
    }
  } else {
    const shiftErr = pairError(day.startTime, day.endTime, "shift time");
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
    return helpers.message(`${day.day}: break must fall inside shift hours`);
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
        return helpers.message("Duplicate day in a week");
      }
      const missing = WEEK_DAYS.filter((d) => !names.includes(d));
      if (missing.length) {
        return helpers.message(`Week must include all 7 days. Missing: ${missing.join(", ")}`);
      }
      return days;
    })
    .required(),
});

const shiftSchema = Joi.object({
  _id: Joi.string().hex().length(24).optional(),
  shiftName: Joi.string().trim().min(2).max(120).required(),
  shiftCode: Joi.string().trim().uppercase().min(1).max(30).required(),
  monthlySchedule: Joi.array()
    .items(weekScheduleSchema)
    .custom(uniqueBy("weekNumber", "weekNumber"))
    .default([]),
  isActive: Joi.boolean().default(true),
});

const branchSchema = Joi.object({
  _id: Joi.string().hex().length(24).optional(),
  branchName: Joi.string().trim().min(2).max(120).required(),
  branchCode: Joi.string().trim().uppercase().min(1).max(30).required(),
  address: Joi.string().trim().allow("").max(300).default(""),
  city: Joi.string().trim().allow("").max(80).default(""),
  state: Joi.string().trim().allow("").max(80).default(""),
  shifts: Joi.array()
    .items(shiftSchema)
    .custom(uniqueBy("shiftCode", "shiftCode"))
    .default([]),
  isActive: Joi.boolean().default(true),
});

const createCompanySchema = Joi.object({
  companyName: Joi.string().trim().min(2).max(160).required(),
  companyCode: Joi.string().trim().uppercase().min(1).max(20).required(),
  branches: Joi.array()
    .items(branchSchema)
    .custom(uniqueBy("branchCode", "branchCode"))
    .default([]),
  isActive: Joi.boolean().default(true),
}).unknown(false);

const updateCompanySchema = Joi.object({
  companyName: Joi.string().trim().min(2).max(160).optional(),
  companyCode: Joi.string().trim().uppercase().min(1).max(20).optional(),
  branches: Joi.array()
    .items(branchSchema)
    .custom(uniqueBy("branchCode", "branchCode"))
    .optional(),
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
