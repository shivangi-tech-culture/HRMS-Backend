/**
 * Turn Joi errors into short messages a screen can show.
 * `errors` stays a list of strings. `fields` is the same text plus the body path.
 */

const CONTAINERS = new Set(["branches", "shifts", "monthlySchedule", "days"]);

/** Field key → words a screen can show. Used by every module. */
const LABELS = {
  companyName: "Company name",
  companyCode: "Company code",
  companyId: "Company",
  companyIds: "Companies",
  branchId: "Branch",
  shiftId: "Shift",
  employeeId: "Employee",
  employeeIds: "Employees",
  leaveTypeId: "Leave type",
  holidayIds: "Holidays",
  managerId: "Reporting manager",
  roleId: "Role",
  officialEmail: "Official email",
  personalEmail: "Personal email",
  employeeCode: "Employee code",
  monthStartDay: "Month start day",
  monthEndDay: "Month end day",
  punchInTime: "Punch in time",
  punchOutTime: "Punch out time",
  from: "From date",
  to: "To date",
  dateOfBirth: "Date of birth",
  aadhaarNo: "Aadhaar number",
  panNo: "PAN",
  mobileNo: "Mobile number",
  drivingLicenseNo: "Driving license",
  passportNo: "Passport number",
  profileUrl: "Profile photo",
  dayType: "Day type",
  maxDays: "Maximum days",
  allocationType: "Allocation",
  quarterlyLimit: "Quarterly limit",
  carryForward: "Carry forward",
  isUnlimited: "Unlimited",
  isActive: "Active",
  workMode: "Work mode",
  attendanceStatus: "Attendance status",
  password: "Password",
  latitude: "Latitude",
  longitude: "Longitude",
  pincode: "Pincode",
  accountNo: "Account number",
  ifscCode: "IFSC",
};

const phrase = (message) => {
  let text = message
    .replace(/ is not allowed to be empty/g, " is required")
    .replace(/ length must be at least (\d+) characters long/g, " must be at least $1 characters")
    .replace(
      / length must be less than or equal to (\d+) characters long/g,
      " must be at most $1 characters"
    )
    .replace(/ length must be 24 characters long/g, " is not valid. Select it again from the list")
    .replace(/ must only contain hexadecimal characters/g, " is not valid. Select it again from the list")
    .replace(/ must be larger than or equal to /g, " must be at least ")
    .replace(/ must be less than or equal to /g, " must be at most ")
    .replace(/ must be a boolean/g, " must be true or false")
    .replace(/ fails to match the required pattern.*/g, " format is not valid")
    .replace(/ is not allowed$/g, " is not a recognized field");

  text = text.replace(/ must be one of \[([^\]]+)\]/g, (_, list) => {
    const items = list.split(",").map((item) => item.trim()).filter(Boolean);
    if (items.length <= 3) {
      const last = items[items.length - 1];
      const head = items.slice(0, -1).join(", ");
      return ` must be ${head ? `${head} or ${last}` : last}`;
    }
    return ` must be one of: ${items.join(", ")}`;
  });

  return text.replace(/\s+/g, " ").trim().replace(/\.+$/, "");
};

const labelOf = (key) => {
  if (LABELS[key]) return LABELS[key];
  const spaced = String(key)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** Put the field name on messages that only say "must be…" or "date must be…". */
const attachLabel = (key, message) => {
  if (!key || CONTAINERS.has(key)) return message;
  const label = labelOf(key);
  const lower = message.toLowerCase();
  const raw = key.toLowerCase();
  if (lower.startsWith(raw)) return label + message.slice(key.length);
  if (lower.startsWith(label.toLowerCase())) return message;
  if (/^(date|month) must be /i.test(message) && raw !== "date" && raw !== "month") {
    return `${label} must be ${message.replace(/^(date|month) must be /i, "")}`;
  }
  if (/^(must |cannot )/i.test(message)) return `${label} ${message}`;
  return message;
};

const lastKey = (path) => {
  const parts = Array.isArray(path) ? path : [];
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (typeof parts[i] === "string") return parts[i];
  }
  return "";
};

const indexAfter = (path, name) => {
  const parts = Array.isArray(path) ? path : [];
  const i = parts.indexOf(name);
  if (i === -1) return null;
  const n = parts[i + 1];
  return typeof n === "number" ? n : null;
};

const toBracket = (path) => {
  let out = "";
  for (const part of Array.isArray(path) ? path : []) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out ? `.${part}` : String(part);
  }
  return out || "body";
};

/** Point at the input the message is about. Custom day checks sit on the day object. */
const leafPath = (path, message) => {
  const base = toBracket(path);
  const key = lastKey(path);
  if (key && !CONTAINERS.has(key)) return base;
  if (/break end/i.test(message)) return `${base}.breakEndTime`;
  if (/break/i.test(message)) return `${base}.breakStartTime`;
  if (/working end/i.test(message)) return `${base}.endTime`;
  if (/working start|working hours|use a time/i.test(message)) return `${base}.startTime`;
  return base;
};

const polish = (detail) => {
  const key = lastKey(detail.path);
  let message = attachLabel(key, phrase(String(detail.message || "").replace(/"/g, "")));
  if (!message) return "This value is not valid";
  return message.charAt(0).toUpperCase() + message.slice(1);
};

const withPlace = (place, message) => {
  if (!place) return message;
  if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday):/.test(message)) {
    return `${place}, ${message}`;
  }
  return `${place}: ${message}`;
};

const formatValidationErrors = (details) => {
  const groups = new Map();

  for (const detail of details || []) {
    const path = Array.isArray(detail.path) ? detail.path : [];
    const message = polish(detail);
    const loc = {
      branch: indexAfter(path, "branches"),
      shift: indexAfter(path, "shifts"),
      week: indexAfter(path, "monthlySchedule"),
    };
    const key = `${loc.branch ?? ""}|${loc.shift ?? ""}|${message}`;
    if (!groups.has(key)) groups.set(key, { loc, message, paths: [], weeks: [] });
    const group = groups.get(key);
    group.paths.push(path);
    if (loc.week != null) group.weeks.push(loc.week + 1);
  }

  const list = [...groups.values()];
  const branches = new Set(list.map((g) => g.loc.branch).filter((n) => n != null));
  const shifts = new Set(list.map((g) => g.loc.shift).filter((n) => n != null));
  const showBranch = branches.size > 1 || [...branches].some((n) => n > 0);
  const showShift = shifts.size > 1 || [...shifts].some((n) => n > 0);

  const errors = [];
  const fields = [];

  for (const group of list) {
    const place = [];
    if (showBranch && group.loc.branch != null) place.push(`Branch ${group.loc.branch + 1}`);
    if (showShift && group.loc.shift != null) place.push(`Shift ${group.loc.shift + 1}`);
    const text = withPlace(place.join(", "), group.message);
    if (errors.includes(text)) continue;
    errors.push(text);

    const paths = [...new Set(group.paths.map((p) => leafPath(p, group.message)))];
    const field = { path: paths[0], message: text };
    if (paths.length > 1) field.paths = paths;
    const weeks = [...new Set(group.weeks)].sort((a, b) => a - b);
    if (weeks.length) field.weeks = weeks;
    fields.push(field);
  }

  const message =
    errors.length === 0
      ? "Please check the form and try again"
      : errors.length === 1
        ? errors[0]
        : errors.join(". ");

  return { message, errors, fields };
};

module.exports = { formatValidationErrors };
