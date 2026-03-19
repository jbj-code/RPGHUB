import { useState, useEffect, useMemo } from "react";
import type { Theme } from "../theme";
import { PAGE_LAYOUT } from "../theme";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";

type EmailCrmProps = { theme: Theme };

export type CrmContactRow = {
  id: string;
  email: string;
  full_name: string | null;
  company: string | null;
  job_title: string | null;
  phone: string | null;
  last_contact_at: string | null;
  synced_by_email: string | null;
  created_at: string;
  updated_at: string;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function EmailCrm({ theme: t }: EmailCrmProps) {
  const [rows, setRows] = useState<CrmContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      if (!isSupabaseConfigured || !supabase) {
        if (!cancelled) {
          setError(
            "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file (Project Settings → API in Supabase), then restart the dev server."
          );
          setRows([]);
          setLoading(false);
        }
        return;
      }
      const { data, error: err } = await supabase
        .from("crm_contacts")
        .select(
          "id,email,full_name,company,job_title,phone,last_contact_at,synced_by_email,created_at,updated_at"
        )
        .order("last_contact_at", { ascending: false });

      if (cancelled) return;
      if (err) {
        setError(err.message);
        setRows([]);
      } else {
        setRows((data as CrmContactRow[]) ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.email,
        r.full_name,
        r.company,
        r.job_title,
        r.phone,
        r.synced_by_email,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query]);

  const pageStyle: React.CSSProperties = {
    maxWidth: PAGE_LAYOUT.maxWidth,
    width: "100%",
    margin: "0 auto",
    fontFamily: t.typography.fontFamily,
    color: t.colors.text,
    minHeight: 400,
  };

  const titleStyle: React.CSSProperties = {
    fontWeight: t.typography.headingWeight,
    fontSize: "1.5rem",
    color: t.colors.text,
    marginBottom: t.spacing(PAGE_LAYOUT.titleMarginBottom),
  };

  const descStyle: React.CSSProperties = {
    color: t.colors.textMuted,
    fontSize: t.typography.baseFontSize,
    lineHeight: 1.5,
    marginBottom: t.spacing(PAGE_LAYOUT.descMarginBottom),
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing(4),
    marginBottom: t.spacing(4),
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    border: `1px solid ${t.colors.border}`,
    overflow: "auto",
  };

  const thStyle: React.CSSProperties = {
    textAlign: "left",
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: t.colors.secondary,
    padding: `${t.spacing(2)} ${t.spacing(2)}`,
    borderBottom: `1px solid ${t.colors.border}`,
    whiteSpace: "nowrap",
  };

  const tdStyle: React.CSSProperties = {
    padding: `${t.spacing(2)} ${t.spacing(2)}`,
    fontSize: "0.875rem",
    borderBottom: `1px solid ${t.colors.border}`,
    verticalAlign: "top",
  };

  const missingTable =
    error &&
    (error.toLowerCase().includes("relation") ||
      error.toLowerCase().includes("does not exist") ||
      error.includes("PGRST"));

  return (
    <section className="email-crm-page" style={pageStyle}>
      <h2 style={titleStyle}>Email CRM</h2>
      <p style={descStyle}>
        Contacts extracted from team email (names, companies, titles, phones). Data lives in
        Supabase — run the SQL in <code style={{ fontSize: "0.85em" }}>supabase/crm_contacts.sql</code>{" "}
        and add sample rows; later a sync job will upsert from Outlook.
      </p>

      {loading && (
        <p style={{ color: t.colors.textMuted }}>Loading contacts…</p>
      )}

      {!loading && error && (
        <div
          style={{
            ...cardStyle,
            borderColor: t.colors.danger,
            backgroundColor: "rgba(185,28,28,0.06)",
          }}
        >
          <strong style={{ color: t.colors.danger }}>Could not load contacts</strong>
          <p style={{ margin: `${t.spacing(2)} 0 0`, color: t.colors.text, fontSize: "0.9rem" }}>
            {error}
          </p>
          {missingTable && (
            <p style={{ margin: `${t.spacing(2)} 0 0`, fontSize: "0.875rem", color: t.colors.textMuted }}>
              Open Supabase → SQL Editor, paste the contents of{" "}
              <strong>supabase/crm_contacts.sql</strong>, run it, then refresh this page.
            </p>
          )}
        </div>
      )}

      {!loading && !error && (
        <>
          <div style={{ marginBottom: t.spacing(3), display: "flex", flexWrap: "wrap", gap: t.spacing(2) }}>
            <input
              type="search"
              placeholder="Search name, email, company…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter contacts"
              style={{
                flex: "1 1 240px",
                maxWidth: 400,
                padding: `${t.spacing(2)} ${t.spacing(3)}`,
                borderRadius: t.radius.md,
                border: `1px solid ${t.colors.border}`,
                fontSize: t.typography.baseFontSize,
                fontFamily: t.typography.fontFamily,
                backgroundColor: t.colors.surface,
                color: t.colors.text,
              }}
            />
            <span style={{ alignSelf: "center", fontSize: "0.85rem", color: t.colors.textMuted }}>
              {filtered.length} of {rows.length} shown
            </span>
          </div>

          {rows.length === 0 ? (
            <div style={cardStyle}>
              <p style={{ margin: 0, color: t.colors.textMuted }}>
                No contacts yet. Run the sample insert in <strong>supabase/crm_contacts.sql</strong> or add
                rows in the Supabase Table Editor.
              </p>
            </div>
          ) : (
            <div style={cardStyle}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Company</th>
                    <th style={thStyle}>Title</th>
                    <th style={thStyle}>Phone</th>
                    <th style={thStyle}>Last contact</th>
                    <th style={thStyle}>Synced by</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td style={tdStyle}>{r.full_name || "—"}</td>
                      <td style={tdStyle}>
                        <a
                          href={`mailto:${r.email}`}
                          style={{ color: t.colors.primary, wordBreak: "break-all" }}
                        >
                          {r.email}
                        </a>
                      </td>
                      <td style={tdStyle}>{r.company || "—"}</td>
                      <td style={tdStyle}>{r.job_title || "—"}</td>
                      <td style={tdStyle}>{r.phone || "—"}</td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                        {formatWhen(r.last_contact_at)}
                      </td>
                      <td style={{ ...tdStyle, fontSize: "0.8rem", color: t.colors.textMuted }}>
                        {r.synced_by_email || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && rows.length > 0 && (
                <p style={{ margin: t.spacing(3), color: t.colors.textMuted, textAlign: "center" }}>
                  No matches for “{query}”.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
