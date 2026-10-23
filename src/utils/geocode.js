/**
 * Geocoding helpers
 * - reverse: lat/long → address (punch location label)
 * - forward: address → lat/long (branch office for 50m geofence)
 */
const https = require("https");
const http = require("http");

const fetchJson = (url, headers = {}) =>
  new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent": "HRMS-API/1.0 (attendance geolocation)",
          Accept: "application/json",
          ...headers,
        },
        timeout: 8000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw || "{}") });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Geocode request timed out"));
    });
  });

const parseCoord = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<string>} address or empty string
 */
const reverseGeocode = async (latitude, longitude) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";

  const googleKey = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
  if (googleKey) {
    try {
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json` +
        `?latlng=${lat},${lng}&key=${encodeURIComponent(googleKey)}`;
      const { data } = await fetchJson(url);
      if (data?.status === "OK" && data.results?.[0]?.formatted_address) {
        return String(data.results[0].formatted_address);
      }
    } catch {
      /* fall through to Nominatim */
    }
  }

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse` +
      `?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`;
    const { data } = await fetchJson(url);
    return String(data?.display_name || "").trim();
  } catch {
    return "";
  }
};

/**
 * Address text → { latitude, longitude }
 * Google Geocoding if key set; else OpenStreetMap Nominatim.
 */
const forwardGeocode = async (addressQuery) => {
  const q = String(addressQuery || "").trim();
  if (!q) return { latitude: null, longitude: null };

  const googleKey = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
  if (googleKey) {
    try {
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json` +
        `?address=${encodeURIComponent(q)}&key=${encodeURIComponent(googleKey)}`;
      const { data } = await fetchJson(url);
      const loc = data?.results?.[0]?.geometry?.location;
      const latitude = parseCoord(loc?.lat);
      const longitude = parseCoord(loc?.lng);
      if (latitude != null && longitude != null) {
        return { latitude, longitude };
      }
    } catch {
      /* fall through to Nominatim */
    }
  }

  try {
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?format=jsonv2&q=${encodeURIComponent(q)}&limit=1`;
    const { data } = await fetchJson(url);
    const hit = Array.isArray(data) ? data[0] : null;
    const latitude = parseCoord(hit?.lat);
    const longitude = parseCoord(hit?.lon);
    if (latitude != null && longitude != null) {
      return { latitude, longitude };
    }
  } catch {
    /* empty */
  }

  return { latitude: null, longitude: null };
};

/** Build geocode query from company branch address fields */
const branchAddressQuery = (branch = {}) =>
  [branch.address, branch.city, branch.state, branch.pincode]
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join(", ");

/**
 * Fill branch latitude/longitude from address when missing.
 * Used on company create/update.
 */
const enrichBranchesFromAddress = async (branches = []) => {
  const out = [];
  for (const raw of branches || []) {
    const branch = { ...raw };
    const hasLat = parseCoord(branch.latitude) != null;
    const hasLng = parseCoord(branch.longitude) != null;
    if (hasLat && hasLng) {
      out.push(branch);
      continue;
    }
    const query = branchAddressQuery(branch);
    if (!query) {
      out.push(branch);
      continue;
    }
    const coords = await forwardGeocode(query);
    if (coords.latitude != null && coords.longitude != null) {
      branch.latitude = coords.latitude;
      branch.longitude = coords.longitude;
    }
    out.push(branch);
  }
  return out;
};

/**
 * Office GPS for geofence: stored branch lat/long, else geocode address and cache on company.
 * @param {object} branch - attendance branch card (master _id + address fields)
 * @param {{ companyId?: * }} [opts]
 */
const resolveOfficeLocation = async (branch = {}, { companyId } = {}) => {
  let latitude = parseCoord(branch?.latitude);
  let longitude = parseCoord(branch?.longitude);
  if (latitude != null && longitude != null) {
    return { latitude, longitude };
  }

  const query = branchAddressQuery(branch);
  if (!query) {
    return { latitude: null, longitude: null };
  }

  const coords = await forwardGeocode(query);
  latitude = coords.latitude;
  longitude = coords.longitude;

  if (
    latitude != null &&
    longitude != null &&
    companyId &&
    branch?._id
  ) {
    try {
      const Company = require("../models/Company");
      await Company.updateOne(
        { _id: companyId, "branches.branchId": branch._id },
        {
          $set: {
            "branches.$.latitude": latitude,
            "branches.$.longitude": longitude,
          },
        }
      );
    } catch {
      /* cache best-effort */
    }
  }

  return { latitude, longitude };
};

/**
 * Build location from punch / break body.
 * Client sends only lat/long — address always comes from Map API (Google / Nominatim).
 */
const resolvePunchLocation = async (body = {}) => {
  const latitude =
    body.latitude != null && body.latitude !== ""
      ? Number(body.latitude)
      : null;
  const longitude =
    body.longitude != null && body.longitude !== ""
      ? Number(body.longitude)
      : null;

  if (latitude == null || longitude == null) {
    return { latitude: null, longitude: null, address: "" };
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { latitude: null, longitude: null, address: "" };
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { latitude: null, longitude: null, address: "" };
  }

  const address = await reverseGeocode(latitude, longitude);

  return { latitude, longitude, address };
};

module.exports = {
  reverseGeocode,
  forwardGeocode,
  branchAddressQuery,
  enrichBranchesFromAddress,
  resolveOfficeLocation,
  resolvePunchLocation,
};
