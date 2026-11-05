/**
 * Punch geofence — employee must be within PUNCH_RADIUS_METERS of branch GPS.
 */
const PUNCH_RADIUS_METERS = 50;
const EARTH_RADIUS_M = 6371000;

const toRad = (deg) => (Number(deg) * Math.PI) / 180;

/** Great-circle distance in meters (Haversine). */
const distanceMeters = (lat1, lon1, lat2, lon2) => {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(Number(lat2) - Number(lat1));
  const Δλ = toRad(Number(lon2) - Number(lon1));
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
};

const parseCoord = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** e.g. 12023 → "12023 m (12.02 km)" */
const formatDistanceLabel = (meters) => {
  const m = Math.round(Number(meters) || 0);
  const km = (m / 1000).toFixed(2);
  return `${m} m (${km} km)`;
};

/**
 * @param {{ latitude?: *, longitude?: * }} punchLoc - client GPS
 * @param {{ latitude?: *, longitude?: * } | null} officeLoc - branch GPS
 * @param {number} [radiusMeters]
 * @returns {{ ok: boolean, message?: string, distanceMeters?: number, distanceKm?: number }}
 */
const assertWithinPunchRadius = (
  punchLoc = {},
  officeLoc = {},
  radiusMeters = PUNCH_RADIUS_METERS
) => {
  const officeLat = parseCoord(officeLoc?.latitude);
  const officeLng = parseCoord(officeLoc?.longitude);
  if (officeLat == null || officeLng == null) {
    return {
      ok: false,
      message:
        "Branch address could not be located. Ask HR to set a valid branch address (city / pincode).",
    };
  }

  const punchLat = parseCoord(punchLoc?.latitude);
  const punchLng = parseCoord(punchLoc?.longitude);
  if (punchLat == null || punchLng == null) {
    return {
      ok: false,
      message: "latitude and longitude are required",
    };
  }

  const meters = Math.round(distanceMeters(punchLat, punchLng, officeLat, officeLng));
  const km = Number((meters / 1000).toFixed(2));
  if (meters > radiusMeters) {
    return {
      ok: false,
      message: `You are ${formatDistanceLabel(meters)} from the office. Punch is allowed within ${radiusMeters} m.`,
      distanceMeters: meters,
      distanceKm: km,
    };
  }

  return { ok: true, distanceMeters: meters, distanceKm: km };
};

module.exports = {
  PUNCH_RADIUS_METERS,
  distanceMeters,
  assertWithinPunchRadius,
};
