/**
 * Status shown on daily attendance and the employee timesheet.
 * Punch in without punch out is MissedPunch. Present only after punch out.
 * The screen follows punch-out and the regularization request.
 *
 * Pending request → Pending (not Present).
 * Rejected, and the day is not fully punched → Rejected (day stays absent).
 * Approved request, or both punches exist → the shift result (Present, Late, HalfDay, or Absent).
 * Punch in without punch out, and nobody has approved → MissedPunch.
 */
const resolveDisplayedStatus = ({ att, reg, lateStatus } = {}) => {
  const closed = Boolean(att?.punchIn) && Boolean(att?.punchOut);
  const open = Boolean(att?.punchIn) && !att?.punchOut;
  const regStatus = reg?.status || "";
  const shiftStatus = ["Present", "Late", "HalfDay", "Absent", "WeeklyOff", "Holiday", "OnLeave"].includes(
    lateStatus
  )
    ? lateStatus
    : "Present";

  if (open) return "MissedPunch";
  if (regStatus === "Pending") return "Pending";
  if (regStatus === "Rejected" && !closed) return "Rejected";
  if (closed) return shiftStatus;
  return "Absent";
};

module.exports = { resolveDisplayedStatus };
