export function parseDuration(input: string): { ms: number | null; label: string } | null {
  const raw = input.trim().toLowerCase();
  if (raw === "lifetime" || raw === "forever" || raw === "0") {
    return { ms: null, label: "Lifetime" };
  }
  const year = raw.match(/^(\d+)\s*y$/);
  if (year) {
    const n = Number(year[1]);
    return { ms: n * 365 * 86400000, label: `${n} year${n === 1 ? "" : "s"}` };
  }
  const m = raw.match(/^(\d+)\s*(s|m|h|d|w)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || "d") as "s" | "m" | "h" | "d" | "w";
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[unit];
  return { ms: n * mult, label: `${n}${unit}` };
}

export function formatDuration(ms: number | null) {
  if (ms === null) return "Lifetime";
  if (ms >= 31536000000) return `${(ms / 31536000000).toFixed(0)} year(s)`;
  if (ms >= 86400000) return `${(ms / 86400000).toFixed(0)} day(s)`;
  if (ms >= 3600000) return `${(ms / 3600000).toFixed(0)} hour(s)`;
  if (ms >= 60000) return `${(ms / 60000).toFixed(0)} minute(s)`;
  return `${Math.round(ms / 1000)} second(s)`;
}
