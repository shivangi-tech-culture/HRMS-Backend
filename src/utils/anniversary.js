/**
 * Work anniversary helpers
 *
 * anniversaryDate = next work-anniversary date from dateOfJoining
 * (same month/day as joining; rolls to next year after it passes).
 * Uses UTC calendar parts so the stored date matches the joining day.
 */
function nextWorkAnniversary(dateOfJoining, fromDate = new Date()) {
  if (!dateOfJoining) return null;

  const doj = new Date(dateOfJoining);
  if (Number.isNaN(doj.getTime())) return null;

  const month = doj.getUTCMonth();
  const day = doj.getUTCDate();

  const today = new Date(fromDate);
  const ty = today.getUTCFullYear();
  const tm = today.getUTCMonth();
  const td = today.getUTCDate();

  // If this year's anniversary already passed, roll to next year
  // (on the anniversary day itself we still show that date)
  let year = ty;
  if (month < tm || (month === tm && day < td)) {
    year = ty + 1;
  }

  return new Date(Date.UTC(year, month, day));
}

/** Set personal.anniversaryDate on a user document from official.dateOfJoining */
function applyAnniversary(user) {
  if (!user) return user;
  const doj = user.official?.dateOfJoining;
  if (!doj) return user;

  user.personal = user.personal || {};
  user.personal.anniversaryDate = nextWorkAnniversary(doj);
  return user;
}

module.exports = { nextWorkAnniversary, applyAnniversary };
