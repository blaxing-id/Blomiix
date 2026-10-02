import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import {
  DEMO_PREMIUM_KEY,
  FREE_PANEL_LIMIT,
  FREE_SCRIPT_LIMIT,
  MAX_SOURCE_BYTES,
  PREMIUM_PANEL_LIMIT,
  PREMIUM_SCRIPT_LIMIT,
} from "@/lib/constants";
import { parseDuration, formatDuration } from "@/lib/kingmor-format";

export type ScriptRow = {
  id: string;
  name: string;
  enabled: boolean;
  free_mode: boolean;
  created_at: string;
  updated_at: string;
};

export type ScriptDetail = ScriptRow & { source: string };

export type PremiumState = {
  active: boolean;
  expiry: string | null;
  since: string | null;
};

export { parseDuration, formatDuration };

function randomHex(bytes: number) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateId() {
  return randomHex(7);
}

function pickChars(len: number, alphabet: string) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join("");
}

function generateScriptKey() {
  return pickChars(40, "abcdefghijklmnopqrstuvwxyz0123456789");
}

function generatePremiumKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const block = () => pickChars(4, chars);
  return `KM-${block()}-${block()}-${block()}`;
}

export async function getPremiumState(userId: string): Promise<PremiumState> {
  const sql = await getSql();
  const rows = await sql<{ expiry: string | null; since: string }>`
    select expiry, since from premium where user_id = ${userId}
  `;
  const entry = rows[0];
  if (!entry) return { active: false, expiry: null, since: null };
  if (entry.expiry && new Date(entry.expiry) < new Date()) {
    return { active: false, expiry: entry.expiry, since: entry.since };
  }
  return { active: true, expiry: entry.expiry, since: entry.since };
}

export function scriptLimit(premium: boolean) {
  return premium ? PREMIUM_SCRIPT_LIMIT : FREE_SCRIPT_LIMIT;
}

export function panelLimit(premium: boolean) {
  return premium ? PREMIUM_PANEL_LIMIT : FREE_PANEL_LIMIT;
}

async function ensureDemoKey() {
  const sql = await getSql();
  const existing = await sql<{ key: string }>`
    select key from premium_keys where key = ${DEMO_PREMIUM_KEY}
  `;
  if (existing.length === 0) {
    await sql`
      insert into premium_keys (key, duration_ms, label, created_by)
      values (${DEMO_PREMIUM_KEY}, ${30 * 86400000}, ${"Preview 30-day license"}, ${"system"})
    `;
  }
}

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await ensureDemoKey();
    const sql = await getSql();
    const premium = await getPremiumState(context.userId);
    const scripts = await sql<ScriptRow>`
      select id, name, enabled, free_mode, created_at, updated_at
      from scripts
      where user_id = ${context.userId}
      order by created_at desc
    `;
    const keys = await sql<{ count: number }>`
      select count(*)::int as count from script_keys where owner_user_id = ${context.userId}
    `;
    const demo = await sql<{ redeemed_by: string | null }>`
      select redeemed_by from premium_keys where key = ${DEMO_PREMIUM_KEY}
    `;
    return {
      premium,
      maxScripts: scriptLimit(premium.active),
      scripts,
      keyCount: keys[0]?.count ?? 0,
      demoKey: !premium.active && !demo[0]?.redeemed_by ? DEMO_PREMIUM_KEY : null,
    };
  });

export const getScriptSource = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<ScriptDetail>`
      select id, name, enabled, free_mode, source, created_at, updated_at
      from scripts where id = ${data.id} and user_id = ${context.userId}
    `;
    const script = rows[0];
    if (!script) throw new Error("Script not found");
    const keys = await sql<{ key: string }>`
      select key from script_keys
      where script_id = ${data.id} and bound_user_id = ${context.userId}
      order by created_at asc
      limit 1
    `;
    return { script, ownerKey: keys[0]?.key ?? null };
  });

export const createScript = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ name: z.string().min(1).max(100), source: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    if (data.source.length > MAX_SOURCE_BYTES) throw new Error("File too large. Maximum 10MB.");
    const sql = await getSql();
    const premium = await getPremiumState(context.userId);
    const countRows = await sql<{ count: number }>`
      select count(*)::int as count from scripts where user_id = ${context.userId}
    `;
    const count = countRows[0]?.count ?? 0;
    const max = scriptLimit(premium.active);
    if (count >= max) {
      throw new Error(
        premium.active
          ? `Premium limit reached (${max} scripts). Delete one to add another.`
          : `Free plan is limited to ${max} scripts. Redeem a Premium key to unlock ${PREMIUM_SCRIPT_LIMIT}.`,
      );
    }
    const id = generateId();
    const name = data.name.trim().slice(0, 100);
    await sql`
      insert into scripts (id, user_id, name, source)
      values (${id}, ${context.userId}, ${name}, ${data.source})
    `;
    const ownerKey = generateScriptKey();
    await sql`
      insert into script_keys (key, script_id, owner_user_id, bound_user_id, bound_username)
      values (${ownerKey}, ${id}, ${context.userId}, ${context.userId}, ${"owner"})
    `;
    return { id, name, ownerKey };
  });

export const updateScript = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.string(),
      name: z.string().min(1).max(100).optional(),
      source: z.string().min(1).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const existing = await sql<{ id: string }>`
      select id from scripts where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!existing[0]) throw new Error("Script not found");
    if (data.source && data.source.length > MAX_SOURCE_BYTES) {
      throw new Error("File too large. Maximum 10MB.");
    }
    if (data.name) {
      await sql`
        update scripts set name = ${data.name.trim().slice(0, 100)}, updated_at = now()
        where id = ${data.id} and user_id = ${context.userId}
      `;
    }
    if (data.source) {
      await sql`
        update scripts set source = ${data.source}, updated_at = now()
        where id = ${data.id} and user_id = ${context.userId}
      `;
    }
    return { ok: true };
  });

export const toggleScript = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{ enabled: boolean }>`
      select enabled from scripts where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!rows[0]) throw new Error("Script not found");
    const next = !rows[0].enabled;
    await sql`
      update scripts set enabled = ${next}, updated_at = now()
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return { enabled: next };
  });

export const toggleFreeMode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const premium = await getPremiumState(context.userId);
    if (!premium.active) throw new Error("Free mode is a Premium feature.");
    const sql = await getSql();
    const rows = await sql<{ free_mode: boolean }>`
      select free_mode from scripts where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!rows[0]) throw new Error("Script not found");
    const next = !rows[0].free_mode;
    await sql`
      update scripts set free_mode = ${next}, updated_at = now()
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return { freeMode: next };
  });

export const deleteScript = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{ id: string }>`
      delete from scripts where id = ${data.id} and user_id = ${context.userId}
      returning id
    `;
    if (!rows[0]) throw new Error("Script not found");
    return { ok: true };
  });

export const redeemPremiumKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ key: z.string().min(4) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const code = data.key.trim().toUpperCase();
    const rows = await sql<{
      key: string;
      duration_ms: number | null;
      redeemed_by: string | null;
    }>`
      select key, duration_ms, redeemed_by from premium_keys where key = ${code}
    `;
    const entry = rows[0];
    if (!entry) throw new Error("Invalid license key.");
    if (entry.redeemed_by) throw new Error("This license key has already been redeemed.");
    const durationMs = entry.duration_ms === null ? null : Number(entry.duration_ms);
    const expiry = durationMs === null ? null : new Date(Date.now() + durationMs).toISOString();
    const current = await getPremiumState(context.userId);
    if (current.active && current.expiry === null) {
      throw new Error("You already have lifetime Premium.");
    }
    await sql`
      update premium_keys
      set redeemed_by = ${context.userId}, redeemed_at = now()
      where key = ${code} and redeemed_by is null
    `;
    const existing = await sql<{ user_id: string }>`
      select user_id from premium where user_id = ${context.userId}
    `;
    if (existing[0]) {
      await sql`
        update premium set expiry = ${expiry}, updated_at = now()
        where user_id = ${context.userId}
      `;
    } else {
      await sql`insert into premium (user_id, expiry) values (${context.userId}, ${expiry})`;
    }
    return { ok: true, expiry, duration: formatDuration(durationMs) };
  });

export const createPremiumKeys = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ duration: z.string().min(1), amount: z.number().int().min(1).max(20) }))
  .handler(async ({ context, data }) => {
    const parsed = parseDuration(data.duration);
    if (!parsed) throw new Error("Invalid duration. Use 7d, 30d, 90d, 1y, or lifetime.");
    const sql = await getSql();
    const keys: { key: string; duration: string }[] = [];
    for (let i = 0; i < data.amount; i += 1) {
      const key = generatePremiumKey();
      await sql`
        insert into premium_keys (key, duration_ms, label, created_by)
        values (${key}, ${parsed.ms}, ${parsed.label}, ${context.userId})
      `;
      keys.push({ key, duration: parsed.label });
    }
    return { keys };
  });

export const listIssuedPremiumKeys = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return sql<{
      key: string;
      duration_ms: number | null;
      created_at: string;
      redeemed_by: string | null;
      redeemed_at: string | null;
    }>`
      select key, duration_ms, created_at, redeemed_by, redeemed_at
      from premium_keys
      where created_by = ${context.userId}
      order by created_at desc
      limit 40
    `;
  });

export function checkApiSecret(request: Request) {
  const secret = process.env.API_SECRET;
  if (!secret) return false;
  const provided = request.headers.get("x-api-secret");
  return Boolean(provided && provided === secret);
}

export async function loadScriptById(id: string) {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    name: string;
    source: string;
    enabled: boolean;
    free_mode: boolean;
    user_id: string;
  }>`
    select id, name, source, enabled, free_mode, user_id from scripts where id = ${id}
  `;
  return rows[0] ?? null;
}

export async function findScriptKey(scriptId: string, key: string) {
  const sql = await getSql();
  const rows = await sql<{
    key: string;
    hwid: string | null;
    expiry: string | null;
    bound_user_id: string | null;
    bound_username: string | null;
  }>`
    select key, hwid, expiry, bound_user_id, bound_username
    from script_keys
    where script_id = ${scriptId} and key = ${key}
  `;
  return rows[0] ?? null;
}

export async function bindHwid(scriptId: string, key: string, hwid: string) {
  const sql = await getSql();
  await sql`
    update script_keys set hwid = ${hwid}
    where script_id = ${scriptId} and key = ${key} and hwid is null
  `;
}

export async function listScriptsForOwner(ownerId: string) {
  const sql = await getSql();
  return sql<{ id: string; name: string; enabled: boolean; user_id: string }>`
    select id, name, enabled, user_id from scripts where user_id = ${ownerId}
  `;
}

export async function countPanels(ownerId: string) {
  const sql = await getSql();
  const rows = await sql<{ count: number }>`
    select count(*)::int as count from panels where user_id = ${ownerId}
  `;
  return rows[0]?.count ?? 0;
}

export async function setPremiumForUser(userId: string, expiry: string | null, remove?: boolean) {
  const sql = await getSql();
  if (remove) {
    await sql`delete from premium where user_id = ${userId}`;
    return { removed: true };
  }
  const existing = await sql<{ user_id: string }>`
    select user_id from premium where user_id = ${userId}
  `;
  if (existing[0]) {
    await sql`update premium set expiry = ${expiry}, updated_at = now() where user_id = ${userId}`;
  } else {
    await sql`insert into premium (user_id, expiry) values (${userId}, ${expiry})`;
  }
  return { premium: true, expiry };
}

export async function issuePremiumKeys(opts: {
  duration: string;
  amount: number;
  createdBy: string;
}) {
  const parsed = parseDuration(opts.duration);
  if (!parsed) throw new Error("Invalid duration");
  const sql = await getSql();
  const keys: string[] = [];
  for (let i = 0; i < opts.amount; i += 1) {
    const key = generatePremiumKey();
    keys.push(key);
    await sql`
      insert into premium_keys (key, duration_ms, label, created_by)
      values (${key}, ${parsed.ms}, ${parsed.label}, ${opts.createdBy})
    `;
  }
  return { keys, duration: parsed.label };
}

export { generateScriptKey };

