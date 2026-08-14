// Country lookup + age-threshold table.
//
// Uses geoip-lite (bundled MaxMind GeoLite2 country DB, ~5 MB). No external
// dependency at runtime; DB refreshes when the npm package is updated.
//
// The threshold table encodes each country's "digital consent" or minimum
// online-service age. Unknown / not-listed countries fall back to the
// strictest EEA value (16). This is deliberate: unknown IP = strictest rule.

import geoip from "geoip-lite";

// GDPR Art. 8 digital-consent age per EEA Member State. See:
// https://gdpr-info.eu/art-8-gdpr/ and per-country implementations.
// Non-EEA countries use their local minimums (COPPA 13 for US, DPA/UK GDPR 13
// for UK, etc.). Anything not listed → DEFAULT_MIN_AGE.
const AGE_THRESHOLD_BY_COUNTRY = {
  // EEA — 16 (GDPR default, strictest)
  DE: 16, NL: 16, IE: 16, LU: 16, MT: 16, HR: 16,
  // EEA — 15
  FR: 15, GR: 15,
  // EEA — 14
  IT: 14, ES: 14, AT: 14, CY: 14, SI: 14,
  // EEA — 13
  BE: 13, DK: 13, SE: 13, FI: 13, EE: 13, PL: 13, PT: 13,
  BG: 13, LV: 13, LT: 13, CZ: 13, HU: 13, SK: 13, RO: 13,
  // Rest of the anglophone / commonly-detected world — 13
  GB: 13, US: 13, CA: 13, AU: 13, NZ: 13, JP: 13, KR: 13, IN: 13,
  BR: 13, MX: 13, AR: 13, CL: 13, CO: 13, PE: 13,
  CH: 16, NO: 13, IS: 13, LI: 16, // EFTA — Switzerland & Liechtenstein align with strict
  ZA: 13, IL: 13, TR: 13, RU: 13, UA: 13,
};

// Strictest known value — applied when we can't classify.
export const DEFAULT_MIN_AGE = 16;

export function countryFromIp(ip) {
  if (!ip || ip === "unknown") return null;
  // geoip-lite doesn't accept IPv4-mapped IPv6 form; unwrap it.
  const clean = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  try {
    const row = geoip.lookup(clean);
    return row?.country || null;
  } catch { return null; }
}

export function ageThresholdForCountry(country) {
  if (!country) return DEFAULT_MIN_AGE;
  const c = String(country).toUpperCase();
  return Object.prototype.hasOwnProperty.call(AGE_THRESHOLD_BY_COUNTRY, c)
    ? AGE_THRESHOLD_BY_COUNTRY[c]
    : DEFAULT_MIN_AGE;
}
