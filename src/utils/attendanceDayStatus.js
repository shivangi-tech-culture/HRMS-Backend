/**
 * Status shown on daily attendance and the employee timesheet.
 * Punch in without punch out is MissedPunch. Present only after punch out.
 * The screen follows punch-out and the regularization request.
 *
 * Pending request → Pending (not Present).
 * Rejected, and the day is not fully punched → Rejected (day stays absent).
 * Approved, or both punches exist → Present.
 * Punch in without punch out, and nobody has approved → MissedPunch.
 */
const resolveDisplayedStatus = ({ att, reg, lateStatus } = {}) => {
  const closed = Boolean(att?.punchIn) && Boolean(att?.punchOut);
  const open = Boolean(att?.punchIn) && !att?.punchOut;
  const regStatus = reg?.status || "";
  const presentStatus =
    lateStatus && lateStatus !== "Absent" && lateStatus !== "MissedPunch"
      ? lateStatus
      : "Present";

  if (regStatus === "Pending") return "Pending";
  if (regStatus === "Rejected" && !closed) return "Rejected";
  if (closed) return presentStatus;
  if (open) return "MissedPunch";
  return "Absent";
};

module.exports = { resolveDisplayedStatus };
