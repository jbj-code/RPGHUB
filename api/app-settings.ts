import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Single server entry for reading public config rows from `app_settings`.
 * Add keys to ALLOWED_KEYS as you add new rows — avoids one route per setting.
 */
const ALLOWED_KEYS = new Set([
  "home_todos_url",
  // e.g. "home_some_other_doc_url",
]);

function normalizeKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim();
  if (!k || !/^[a-z0-9_]{1,64}$/.test(k)) return null;
  return k;
}

const VALUE_MAX_LEN = 4096;

function normalizeSettingValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > VALUE_MAX_LEN) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return v;
  } catch {
    return null;
  }
}

async function verifySitePassword(
  supabase: SupabaseClient,
  password: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("site_settings")
    .select("password_plain")
    .eq("id", "primary")
    .single();
  if (error || !data) return false;
  return typeof data.password_plain === "string" && password === data.password_plain;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: "Server missing Supabase configuration.", value: null });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (req.method === "POST") {
    const body = req.body ?? {};
    const key = normalizeKey(body.key);
    const value = normalizeSettingValue(body.value);
    const password = typeof body.password === "string" ? body.password : "";

    if (!key || !ALLOWED_KEYS.has(key)) {
      res.status(400).json({ error: "Invalid or disallowed key." });
      return;
    }
    if (!value) {
      res.status(400).json({ error: "Enter a valid http(s) URL." });
      return;
    }
    if (!password) {
      res.status(400).json({ error: "Site password required." });
      return;
    }

    const okPwd = await verifySitePassword(supabase, password);
    if (!okPwd) {
      res.status(401).json({ error: "Incorrect password." });
      return;
    }

    const { error: upErr } = await supabase
      .from("app_settings")
      .upsert({ key, value }, { onConflict: "key" });

    if (upErr) {
      console.error("app-settings upsert:", key, upErr.message);
      res.status(500).json({ error: "Could not save setting." });
      return;
    }

    res.status(200).json({ ok: true, key, value });
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const key = normalizeKey(req.query?.key);
  if (!key || !ALLOWED_KEYS.has(key)) {
    res.status(400).json({
      error: "Missing or disallowed key. Use ?key=<allowed_setting_id>",
      value: null,
    });
    return;
  }

  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    console.error("app-settings:", key, error.message);
    res.status(500).json({ error: "Could not load setting.", value: null });
    return;
  }

  const raw = data?.value;
  const value =
    typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
  res.status(200).json({ key, value });
}
