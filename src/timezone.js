/**
 * Country code → IANA timezone + preferred DID
 * Calling window: 10:00–19:30 local only
 */

const GEO = {
  "+1": {
    timezone: "America/New_York",
    did: "+1",
    tier: 1,
  },
  "+44": { timezone: "Europe/London", did: "+44", tier: 1 },
  "+61": { timezone: "Australia/Sydney", did: "+61", tier: 1 },
  "+31": { timezone: "Europe/Berlin", did: "+44", tier: 2 },
  "+49": { timezone: "Europe/Berlin", did: "+44", tier: 2 },
  "+65": { timezone: "Asia/Singapore", did: "+61", tier: 2 },
  "+91": { timezone: "Asia/Kolkata", did: "+1", tier: 3 },
};

function parseCountryCode(phoneOrCode) {
  if (!phoneOrCode) return null;
  const s = String(phoneOrCode).replace(/\s/g, "");
  if (s.startsWith("+")) {
    const codes = Object.keys(GEO).sort((a, b) => b.length - a.length);
    for (const c of codes) {
      if (s.startsWith(c)) return c;
    }
  }
  if (GEO[s]) return s;
  return null;
}

function getGeo(countryCode) {
  return GEO[countryCode] || null;
}

function callingWindow(timezone, now = new Date()) {
  if (!timezone) {
    return { execute_immediately: false, scheduled_time_utc: null, reason: "unknown_timezone" };
  }
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = parseInt(parts.hour === "24" ? "0" : parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const mins = hour * 60 + minute;
  const windowStart = 10 * 60;
  const windowEnd = 19 * 60 + 30;
  if (mins >= windowStart && mins <= windowEnd) {
    return { execute_immediately: true, scheduled_time_utc: null };
  }
  const scheduled = nextLocalTimeUtc(timezone, 10, 30, now);
  return { execute_immediately: false, scheduled_time_utc: scheduled.toISOString() };
}

function nextLocalTimeUtc(timezone, targetHour, targetMinute, from = new Date()) {
  const step = 15 * 60 * 1000;
  for (let i = 0; i < 48 * 4; i++) {
    const t = new Date(from.getTime() + i * step);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(t).map((p) => [p.type, p.value]));
    const h = parseInt(parts.hour === "24" ? "0" : parts.hour, 10);
    const m = parseInt(parts.minute, 10);
    if (h === targetHour && m === targetMinute) return t;
    if (h === targetHour && Math.abs(m - targetMinute) <= 7) return t;
  }
  return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}

function qualifyLead({ childAge, countryCode }) {
  const geo = getGeo(countryCode);
  if (!geo) return { qualified: false, score: 0, reason: "geo_not_targeted" };
  const age = childAge != null ? Number(childAge) : null;
  const ageOk = age == null || (age >= 5 && age <= 16);
  let score = 40;
  if (geo.tier === 1) score += 40;
  else if (geo.tier === 2) score += 25;
  else score += 10;
  if (ageOk && age != null) score += 20;
  if (!ageOk) score -= 30;
  return {
    qualified: score >= 50 && ageOk,
    score: Math.max(0, Math.min(100, score)),
    reason: ageOk ? "ok" : "age_out_of_range",
  };
}

module.exports = {
  GEO,
  parseCountryCode,
  getGeo,
  callingWindow,
  qualifyLead,
  nextLocalTimeUtc,
};
