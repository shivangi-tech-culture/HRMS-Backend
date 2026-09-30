/**
 * Reverse geocode — lat/long → human address via Map API
 * Prefer Google Geocoding if GOOGLE_MAPS_API_KEY is set; else OpenStreetMap Nominatim (free).
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
 * Build location from punch body.
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

module.exports = { reverseGeocode, resolvePunchLocation };
