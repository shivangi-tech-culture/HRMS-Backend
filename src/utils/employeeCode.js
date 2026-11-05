/**
 * Employee code = company code + auto increment, per company.
 * TC → TC001, TC002. The next company starts again at 001.
 * Preview (add page) does not consume a number. Create does.
 */
const User = require("../models/User");
const Company = require("../models/Company");
const EmployeeCodeSeq = require("../models/EmployeeCodeSeq");
const { escapeRegex } = require("./companyScope");

const PAD = 3;

const formatEmployeeCode = (companyCode, sequence) =>
  `${companyCode}${String(sequence).padStart(PAD, "0")}`;

/** Highest numeric suffix already stored for this company code (any role). */
const maxUsedSequence = async (companyCode) => {
  const prefix = String(companyCode || "").trim().toUpperCase();
  if (!prefix) return 0;
  const rx = new RegExp(`^${escapeRegex(prefix)}(\\d+)$`);
  const rows = await User.find({ "official.employeeCode": rx })
    .select("official.employeeCode")
    .lean();
  let max = 0;
  for (const row of rows) {
    const code = String(row.official?.employeeCode || "");
    const n = parseInt(code.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
};

/** Active company by _id or companyCode. */
const findActiveCompany = async (companyIdOrCode) => {
  const key = String(companyIdOrCode || "").trim();
  if (!key) return null;
  const filter = /^[a-fA-F0-9]{24}$/.test(key)
    ? { _id: key, isActive: true }
    : { companyCode: key.toUpperCase(), isActive: true };
  return Company.findOne(filter).select("companyName companyCode").lean();
};

/**
 * Next code for the add-employee page. Does not reserve the number.
 * Uses the higher of saved codes and the counter, so a manual code is not reused.
 */
const previewEmployeeCode = async (company) => {
  const prefix = company.companyCode;
  const [dataMax, counter] = await Promise.all([
    maxUsedSequence(prefix),
    EmployeeCodeSeq.findOne({ companyId: company._id }).select("seq companyCode").lean(),
  ]);
  const counterSeq =
    counter && counter.companyCode === prefix ? Number(counter.seq) || 0 : 0;
  const sequence = Math.max(dataMax, counterSeq) + 1;
  return {
    companyId: company._id,
    companyName: company.companyName,
    companyCode: prefix,
    sequence,
    employeeCode: formatEmployeeCode(prefix, sequence),
  };
};

/**
 * Reserve the next code for this company. Safe when two creates run together.
 */
const allocateEmployeeCode = async (companyId) => {
  const company = await Company.findOne({ _id: companyId, isActive: true })
    .select("companyName companyCode")
    .lean();
  if (!company) {
    return { ok: false, status: 400, message: "Company not found or inactive" };
  }

  const prefix = company.companyCode;
  const dataMax = await maxUsedSequence(prefix);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await EmployeeCodeSeq.updateOne(
        { companyId: company._id },
        { $setOnInsert: { companyCode: prefix, seq: 0 } },
        { upsert: true }
      );
      break;
    } catch (err) {
      if (err.code !== 11000 || attempt === 2) throw err;
    }
  }
  await EmployeeCodeSeq.updateOne(
    { companyId: company._id, companyCode: { $ne: prefix } },
    { $set: { companyCode: prefix, seq: dataMax } }
  );
  await EmployeeCodeSeq.updateOne(
    { companyId: company._id, companyCode: prefix, seq: { $lt: dataMax } },
    { $set: { seq: dataMax } }
  );

  const doc = await EmployeeCodeSeq.findOneAndUpdate(
    { companyId: company._id, companyCode: prefix },
    { $inc: { seq: 1 } },
    { new: true }
  );
  if (!doc) {
    return { ok: false, status: 500, message: "Could not generate employee code" };
  }

  return {
    ok: true,
    companyId: company._id,
    companyName: company.companyName,
    companyCode: prefix,
    sequence: doc.seq,
    employeeCode: formatEmployeeCode(prefix, doc.seq),
  };
};

module.exports = {
  PAD,
  formatEmployeeCode,
  findActiveCompany,
  previewEmployeeCode,
  allocateEmployeeCode,
};
