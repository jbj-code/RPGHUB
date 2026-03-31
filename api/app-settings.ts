import { createClient } from "@supabase/supabase-js";

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

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(200).end();
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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: "Server missing Supabase configuration.", value: null });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
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
  res.status(200).json({ key,  value });
}
