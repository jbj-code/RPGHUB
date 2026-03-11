import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const { password } = req.body as { password?: string };
  if (!password) {
    res.status(400).send("Missing password");
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).send("Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data, error } = await supabase
    .from("site_settings")
    .select("password_plain")
    .eq("id", "primary")
    .single();

  if (error || !data) {
    res.status(500).send("Site password not configured in Supabase.");
    return;
  }

  if (password === data.password_plain) {
    res.status(200).json({ ok: true });
  } else {
    res.status(401).json({ ok: false });
  }
}

