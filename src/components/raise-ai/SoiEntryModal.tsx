// SoiEntryModal.tsx
// Spreadsheet-style schedule-of-investments entry (UI prototype — no Supabase yet).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ClipboardEvent, FocusEvent } from "react";
import type { Theme } from "../../theme";
import {
  THEME_DROPDOWN_OPTION_CLASS,
  getDropdownOptionStyle,
  getDropdownPanelStyle,
  getDropdownTriggerStyle,
  getFieldInputStyle,
  getGridCellInputStyle,
  getModalBackdropStyle,
  getPrimaryActionButtonStyle,
  getPrimaryButtonStyle,
  getTableHeaderCellStyle,
  shadows,
  zIndex,
} from "../../theme";

export type SoiHoldingRow = {
  id: string;
  companyName: string;
  cost: number;
  fairValue: number;
  investmentDate: string;
  roundType: string;
  shares: string;
  industry: string;
  website: string;
  country: string;
  category: string;
  /** Computed on save for fund schedules (fair value / total fair value). */
  pctOfFund?: number;
};

export type SoiScheduleBatch = {
  id: string;
  targetType: "fund" | "direct";
  fundId: string;
  fundName: string;
  currency: string;
  reportingYear: number;
  reportingQuarter: 1 | 2 | 3 | 4;
  /** Standardized label, e.g. 2025-Q3 */
  reportingPeriod: string;
  /** Quarter-end date derived from year + quarter */
  asOfDate: string;
  auditStatus: "unaudited" | "audited";
  holdings: SoiHoldingRow[];
  savedAt: string;
};

export type RaiseFundOption = { id: string; name: string; currency: string };

type SoiEntryModalProps = {
  theme: Theme;
  open: boolean;
  targetType: "fund" | "direct";
  onClose: () => void;
  funds: RaiseFundOption[];
  onSave: (batch: SoiScheduleBatch) => void | Promise<void>;
};

type RowDraft = Omit<SoiHoldingRow, "id">;
type ColumnKey = keyof RowDraft;
type SavePhase = "idle" | "saving" | "success";

type GridColumn = {
  key: ColumnKey;
  label: string;
  required?: boolean;
  width: number;
  type?: "text" | "money";
};

const FUND_START_ROWS = 10;
const DIRECT_START_ROWS = 3;

const GRID_COLUMNS: GridColumn[] = [
  { key: "companyName", label: "Company", required: true, width: 168, type: "text" },
  { key: "cost", label: "Cost", required: true, width: 108, type: "money" },
  { key: "fairValue", label: "Fair value", required: true, width: 108, type: "money" },
  { key: "investmentDate", label: "Investment date", width: 118, type: "text" },
  { key: "roundType", label: "Round / type", width: 128, type: "text" },
  { key: "shares", label: "Shares", width: 88, type: "text" },
  { key: "industry", label: "Industry", width: 120, type: "text" },
  { key: "website", label: "Website", width: 120, type: "text" },
  { key: "country", label: "Country", width: 96, type: "text" },
  { key: "category", label: "Category", width: 112, type: "text" },
];

const EMPTY_ROW: RowDraft = {
  companyName: "",
  cost: 0,
  fairValue: 0,
  investmentDate: "",
  roundType: "",
  shares: "",
  industry: "",
  website: "",
  country: "",
  category: "",
};

const CSV_TEMPLATE_HEADERS = GRID_COLUMNS.map((c) => c.label).join(",");
const CSV_TEMPLATE_SAMPLE =
  'Example Co,500000,750000,01/15/2024,SAFE,,Enterprise Software,https://example.com,USA,Core';

const AUDIT_OPTIONS = [
  { value: "unaudited", label: "Unaudited" },
  { value: "audited", label: "Audited" },
];

const QUARTER_OPTIONS = [
  { value: "1", label: "Q1" },
  { value: "2", label: "Q2" },
  { value: "3", label: "Q3" },
  { value: "4", label: "Q4" },
];

type DropdownOption = { value: string; label: string };

function SoiDropdown(props: {
  theme: Theme;
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
  dropdownKey: string;
  openId: string | null;
  setOpenId: (id: string | null) => void;
}) {
  const { theme: t, value, options, onChange, dropdownKey, openId, setOpenId } = props;
  const open = openId === dropdownKey;
  const display = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => setOpenId(open ? null : dropdownKey)}
        style={{ ...getDropdownTriggerStyle(t), width: "100%", margin: 0 }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>
          {display}
        </span>
        <span className="material-symbols-outlined" style={{ fontSize: 18, flexShrink: 0 }} aria-hidden>
          expand_more
        </span>
      </button>
      {open && (
        <>
          <div
            role="presentation"
            style={{ position: "fixed", inset: 0, zIndex: zIndex.dropdownPortalBackdrop }}
            onClick={() => setOpenId(null)}
          />
          <div style={{ ...getDropdownPanelStyle(t, "down"), zIndex: zIndex.dropdownPortal, minWidth: "100%" }}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={THEME_DROPDOWN_OPTION_CLASS}
                onClick={() => {
                  onChange(o.value);
                  setOpenId(null);
                }}
                style={getDropdownOptionStyle(t, value === o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function makeId(): string {
  return crypto.randomUUID?.() ?? `soi-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyRows(count: number): SoiHoldingRow[] {
  return Array.from({ length: count }, () => ({ id: makeId(), ...EMPTY_ROW }));
}

function parseMoneyInput(raw: string): number {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function formatMoneyDisplay(n: number): string {
  if (!n) return "";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function quarterEndDate(year: number, quarter: 1 | 2 | 3 | 4): string {
  const monthDay: Record<1 | 2 | 3 | 4, string> = { 1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31" };
  return `${year}-${monthDay[quarter]}`;
}

export function formatReportingPeriod(year: number, quarter: number): string {
  return `${year}-Q${quarter}`;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_ALIASES: Partial<Record<ColumnKey, string[]>> = {
  companyName: ["company", "companyname", "investment", "name"],
  cost: ["cost", "costbasis", "amountinvested"],
  fairValue: ["fairvalue", "fmv", "value", "currentvalue"],
  investmentDate: ["investmentdate", "invdate", "invtdat", "date"],
  roundType: ["round", "roundtype", "securitytype", "type"],
  shares: ["shares", "quantity", "units"],
  industry: ["industry", "sector"],
  website: ["website", "url"],
  country: ["country", "geography"],
  category: ["category", "bucket"],
};

function mapHeaderToKey(header: string): ColumnKey | null {
  const n = normalizeHeader(header);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [ColumnKey, string[]][]) {
    if (aliases.some((a) => n.includes(a) || a.includes(n))) return key;
  }
  return null;
}

function splitCsvLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseDelimitedRows(text: string): RowDraft[] {
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  let startIdx = 0;
  const colOrder: (ColumnKey | null)[] = [];
  const firstCells = splitCsvLine(lines[0]!);
  const mapped = firstCells.map((c) => mapHeaderToKey(c.replace(/^"|"$/g, "").trim()));
  const headerHits = mapped.filter(Boolean).length;

  if (headerHits >= 2) {
    colOrder.push(...mapped);
    startIdx = 1;
  } else {
    colOrder.push(...GRID_COLUMNS.map((c) => c.key));
  }

  const out: RowDraft[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const clean = splitCsvLine(lines[i]!).map((c) => c.replace(/^"|"$/g, "").trim());
    const row: RowDraft = { ...EMPTY_ROW };
    colOrder.forEach((key, idx) => {
      if (!key) return;
      const val = clean[idx] ?? "";
      if (key === "cost" || key === "fairValue") row[key] = parseMoneyInput(val);
      else row[key] = val;
    });
    if (row.companyName.trim() || row.cost > 0 || row.fairValue > 0) out.push(row);
  }
  return out;
}

function draftsToRows(drafts: RowDraft[]): SoiHoldingRow[] {
  return drafts.map((d) => ({ id: makeId(), ...d }));
}

function rowHasRequiredData(row: SoiHoldingRow): boolean {
  return Boolean(row.companyName.trim()) && row.cost > 0 && row.fairValue >= 0;
}

/** % of fund from each row's fair value share of the schedule total. */
function attachPctOfFund(holdings: SoiHoldingRow[]): SoiHoldingRow[] {
  const totalFv = holdings.reduce((s, r) => s + r.fairValue, 0);
  if (totalFv <= 0) return holdings;
  return holdings.map((r) => ({
    ...r,
    pctOfFund: Math.round((r.fairValue / totalFv) * 10000) / 100,
  }));
}

function downloadCsvTemplate(): void {
  const csv = `${CSV_TEMPLATE_HEADERS}\n${CSV_TEMPLATE_SAMPLE}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "raise-ai-holdings-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function MoneyCell(props: {
  theme: Theme;
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const { theme: t, value, onChange, placeholder, ariaLabel } = props;
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");

  const display = focused ? draft : formatMoneyDisplay(value);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      placeholder={placeholder}
      aria-label={ariaLabel}
      style={getGridCellInputStyle(t, { textAlign: "right" })}
      onFocus={(e: FocusEvent<HTMLInputElement>) => {
        setFocused(true);
        setDraft(value ? String(value) : "");
        e.target.select();
      }}
      onBlur={() => {
        onChange(parseMoneyInput(draft));
        setFocused(false);
      }}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))}
    />
  );
}

function SaveOverlay({ theme: t, phase }: { theme: Theme; phase: "saving" | "success" }) {
  return (
    <div className="raise-ai-save-overlay" aria-live="polite">
      {phase === "saving" ? (
        <>
          <span className="raise-ai-save-spinner" aria-hidden />
          <p style={{ margin: `${t.spacing(3)} 0 0`, color: t.colors.textMuted, fontSize: "0.9rem" }}>
            Saving schedule…
          </p>
        </>
      ) : (
        <>
          <span
            className="material-symbols-outlined raise-ai-save-check"
            style={{ fontSize: 56, color: t.colors.primary }}
            aria-hidden
          >
            check_circle
          </span>
          <p style={{ margin: `${t.spacing(3)} 0 0`, color: t.colors.text, fontSize: "0.9rem", fontWeight: 600 }}>
            Saved
          </p>
        </>
      )}
    </div>
  );
}

export function SoiEntryModal({ theme: t, open, targetType, onClose, funds, onSave }: SoiEntryModalProps) {
  const currentYear = new Date().getFullYear();
  const [fundId, setFundId] = useState(funds[0]?.id ?? "");
  const [reportingYear, setReportingYear] = useState(String(currentYear));
  const [reportingQuarter, setReportingQuarter] = useState("2");
  const [auditStatus, setAuditStatus] = useState<"unaudited" | "audited">("unaudited");
  const [rows, setRows] = useState<SoiHoldingRow[]>(() =>
    emptyRows(targetType === "fund" ? FUND_START_ROWS : DIRECT_START_ROWS)
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [savePhase, setSavePhase] = useState<SavePhase>("idle");
  const [importGeneration, setImportGeneration] = useState(0);
  const csvInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setRows(emptyRows(targetType === "fund" ? FUND_START_ROWS : DIRECT_START_ROWS));
    setFormError(null);
    setSavePhase("idle");
    setImportGeneration(0);
    setFundId(funds[0]?.id ?? "");
    setReportingYear(String(currentYear));
    setReportingQuarter("2");
  }, [open, targetType, funds, currentYear]);

  const primaryBtn = getPrimaryActionButtonStyle(t);
  const secondaryBtn: CSSProperties = {
    ...getPrimaryButtonStyle(t),
    backgroundColor: "transparent",
    color: t.colors.primary,
    border: `1px solid ${t.colors.primary}`,
  };

  const fieldLabel: CSSProperties = {
    display: "block",
    fontSize: "0.75rem",
    fontWeight: 600,
    color: t.colors.textMuted,
    marginBottom: t.spacing(1),
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };

  const selectedFund = useMemo(() => funds.find((f) => f.id === fundId), [fundId, funds]);
  const currency = targetType === "fund" ? (selectedFund?.currency ?? "USD") : "USD";

  const fundOptions = useMemo(() => funds.map((f) => ({ value: f.id, label: f.name })), [funds]);

  const gridColumns = useMemo(
    () =>
      GRID_COLUMNS.map((col) => {
        if (col.type !== "money") return col;
        return { ...col, label: `${col.label} (${currency})` };
      }),
    [currency]
  );

  const updateCell = useCallback((rowId: string, key: ColumnKey, raw: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        if (key === "cost" || key === "fairValue") return { ...row, [key]: parseMoneyInput(raw) };
        return { ...row, [key]: raw };
      })
    );
  }, []);

  const addBlankRow = useCallback(() => {
    setRows((prev) => [...prev, ...emptyRows(1)]);
  }, []);

  const removeRow = useCallback((rowId: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== rowId)));
  }, []);

  const applyImport = useCallback(
    (drafts: RowDraft[]) => {
      if (!drafts.length) {
        setFormError("Nothing to import — use headers: Company, Cost, Fair value.");
        return;
      }
      const padded = [...draftsToRows(drafts)];
      const minRows = targetType === "fund" ? FUND_START_ROWS : DIRECT_START_ROWS;
      while (padded.length < minRows) padded.push({ id: makeId(), ...EMPTY_ROW });
      setRows(padded);
      setImportGeneration((g) => g + 1);
      setFormError(null);
    },
    [targetType]
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      const text = e.clipboardData.getData("text/plain");
      if (!text.includes("\t") && !text.includes(",")) return;
      e.preventDefault();
      applyImport(parseDelimitedRows(text));
    },
    [applyImport]
  );

  const handleCsvFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => applyImport(parseDelimitedRows(String(reader.result ?? "")));
      reader.readAsText(file);
    },
    [applyImport]
  );

  const handleSave = useCallback(async () => {
    setFormError(null);
    const year = parseInt(reportingYear, 10);
    const quarter = parseInt(reportingQuarter, 10) as 1 | 2 | 3 | 4;
    if (!Number.isFinite(year) || year < 1990 || year > 2100) {
      setFormError("Enter a valid reporting year.");
      return;
    }
    if (![1, 2, 3, 4].includes(quarter)) {
      setFormError("Select a reporting quarter.");
      return;
    }
    if (targetType === "fund" && !fundId) {
      setFormError("Select a fund.");
      return;
    }
    const valid = rows.filter(rowHasRequiredData);
    if (!valid.length) {
      setFormError("Add at least one row with company, cost, and fair value.");
      return;
    }

    const holdings =
      targetType === "fund" ? attachPctOfFund(valid) : valid;

    const batch: SoiScheduleBatch = {
      id: makeId(),
      targetType,
      fundId: targetType === "fund" ? fundId : "direct",
      fundName: targetType === "fund" ? (selectedFund?.name ?? "") : "Direct investments",
      currency,
      reportingYear: year,
      reportingQuarter: quarter,
      reportingPeriod: formatReportingPeriod(year, quarter),
      asOfDate: quarterEndDate(year, quarter),
      auditStatus,
      holdings,
      savedAt: new Date().toISOString(),
    };

    setSavePhase("saving");
    try {
      await new Promise((r) => setTimeout(r, 700));
      await onSave(batch);
      setSavePhase("success");
      await new Promise((r) => setTimeout(r, 900));
      setRows(emptyRows(targetType === "fund" ? FUND_START_ROWS : DIRECT_START_ROWS));
      onClose();
    } catch {
      setSavePhase("idle");
      setFormError("Save failed — try again.");
    }
  }, [
    auditStatus,
    currency,
    fundId,
    onClose,
    onSave,
    reportingQuarter,
    reportingYear,
    rows,
    selectedFund?.name,
    targetType,
  ]);

  if (!open) return null;

  const title = targetType === "fund" ? "Fund holdings" : "Direct holdings";

  return (
    <div
      className="raise-ai-modal-backdrop"
      style={{
        ...getModalBackdropStyle(t, zIndex.modalBackdrop),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: t.spacing(4),
      }}
      onClick={savePhase === "idle" ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-labelledby="soi-grid-title"
        aria-modal="true"
        className="raise-ai-modal-panel raise-ai-soi-dialog"
        style={{
          backgroundColor: t.colors.surface,
          borderRadius: t.radius.lg,
          border: `1px solid ${t.colors.border}`,
          boxShadow: shadows.modal,
          width: "100%",
          maxWidth: targetType === "fund" ? 1180 : 960,
          maxHeight: "min(88vh, 900px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          zIndex: zIndex.modal,
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
        onPaste={savePhase === "idle" ? handlePaste : undefined}
      >
        {savePhase !== "idle" && <SaveOverlay theme={t} phase={savePhase} />}

        <div
          style={{
            padding: `${t.spacing(4)} ${t.spacing(5)}`,
            borderBottom: `1px solid ${t.colors.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: t.spacing(3),
            opacity: savePhase !== "idle" ? 0.15 : 1,
            pointerEvents: savePhase !== "idle" ? "none" : "auto",
          }}
        >
          <div>
            <h3 id="soi-grid-title" style={{ margin: 0, fontSize: "1.125rem", fontWeight: t.typography.headingWeight }}>
              {title}
            </h3>
            <p style={{ margin: `${t.spacing(1)} 0 0`, color: t.colors.textMuted, fontSize: "0.875rem", lineHeight: 1.5 }}>
              Paste or upload CSV — % of fund is computed on save. Download the template for correct columns.
            </p>
          </div>
          <button
            type="button"
            className="material-symbols-outlined"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", color: t.colors.textMuted, fontSize: 24 }}
          >
            close
          </button>
        </div>

        <div
          style={{
            padding: t.spacing(5),
            overflowY: "auto",
            flex: 1,
            opacity: savePhase !== "idle" ? 0.15 : 1,
            pointerEvents: savePhase !== "idle" ? "none" : "auto",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: t.spacing(3),
              marginBottom: t.spacing(4),
            }}
          >
            {targetType === "fund" && (
              <div style={{ gridColumn: "span 2" }}>
                <span style={fieldLabel}>Fund</span>
                <SoiDropdown
                  theme={t}
                  value={fundId}
                  options={fundOptions}
                  onChange={setFundId}
                  dropdownKey="soi-fund"
                  openId={openId}
                  setOpenId={setOpenId}
                />
              </div>
            )}
            <div>
              <span style={fieldLabel}>Year</span>
              <input
                type="text"
                inputMode="numeric"
                value={reportingYear}
                onChange={(e) => setReportingYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="2026"
                style={getFieldInputStyle(t)}
              />
            </div>
            <div>
              <span style={fieldLabel}>Quarter</span>
              <SoiDropdown
                theme={t}
                value={reportingQuarter}
                options={QUARTER_OPTIONS}
                onChange={setReportingQuarter}
                dropdownKey="soi-quarter"
                openId={openId}
                setOpenId={setOpenId}
              />
            </div>
            <div>
              <span style={fieldLabel}>Statement status</span>
              <SoiDropdown
                theme={t}
                value={auditStatus}
                options={AUDIT_OPTIONS}
                onChange={(v) => setAuditStatus(v as "unaudited" | "audited")}
                dropdownKey="soi-audit"
                openId={openId}
                setOpenId={setOpenId}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: t.spacing(2), marginBottom: t.spacing(3) }}>
            <button type="button" onClick={downloadCsvTemplate} style={{ ...secondaryBtn, fontSize: "0.875rem" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: "middle", marginRight: 4 }} aria-hidden>
                download
              </span>
              CSV template
            </button>
            <button type="button" onClick={() => csvInputRef.current?.click()} style={{ ...secondaryBtn, fontSize: "0.875rem" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: "middle", marginRight: 4 }} aria-hidden>
                upload_file
              </span>
              Upload CSV
            </button>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                handleCsvFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>

          {formError && (
            <p style={{ color: t.colors.danger, fontSize: "0.875rem", margin: `0 0 ${t.spacing(3)}` }} role="alert">
              {formError}
            </p>
          )}

          <div
            className={importGeneration > 0 ? "raise-ai-soi-table-imported" : undefined}
            style={{
              overflowX: "auto",
              borderRadius: t.radius.md,
              border: `1px solid ${t.colors.border}`,
              backgroundColor: t.colors.background,
            }}
          >
            <table style={{ width: "max-content", minWidth: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ backgroundColor: t.colors.secondary }}>
                  {gridColumns.map((col) => (
                    <th
                      key={col.key}
                      style={{
                        ...getTableHeaderCellStyle(t, {
                          padding: `${t.spacing(2)} ${t.spacing(2)}`,
                          whiteSpace: "nowrap",
                          minWidth: col.width,
                          width: col.width,
                        }),
                      }}
                    >
                      {col.label}
                      {col.required && <span style={{ color: t.colors.danger }}> *</span>}
                    </th>
                  ))}
                  <th
                    style={getTableHeaderCellStyle(t, { width: 44, minWidth: 44, padding: t.spacing(2) })}
                    aria-label="Actions"
                  />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr
                    key={row.id}
                    className={importGeneration > 0 ? "raise-ai-soi-row-import" : undefined}
                    style={{
                      backgroundColor: t.colors.surface,
                      animationDelay: importGeneration > 0 ? `${rowIndex * 40}ms` : undefined,
                    }}
                  >
                    {gridColumns.map((col) => (
                      <td key={col.key} style={{ padding: 0, verticalAlign: "middle" }}>
                        {col.type === "money" ? (
                          <MoneyCell
                            theme={t}
                            value={row[col.key] as number}
                            onChange={(n) => updateCell(row.id, col.key, String(n))}
                            placeholder={col.required ? "0" : ""}
                            ariaLabel={`${col.label} row ${rowIndex + 1}`}
                          />
                        ) : (
                          <input
                            type="text"
                            value={String(row[col.key] ?? "")}
                            onChange={(e) => updateCell(row.id, col.key, e.target.value)}
                            placeholder={col.key === "investmentDate" ? "01/15/2024" : col.required ? "Required" : ""}
                            aria-label={`${col.label} row ${rowIndex + 1}`}
                            style={getGridCellInputStyle(t, col.key === "investmentDate" ? { minWidth: col.width } : undefined)}
                          />
                        )}
                      </td>
                    ))}
                    <td style={{ padding: t.spacing(1), textAlign: "center" }}>
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        aria-label="Remove row"
                        className="material-symbols-outlined"
                        style={{ background: "none", border: "none", cursor: "pointer", color: t.colors.textMuted, fontSize: 20 }}
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={addBlankRow}
            style={{
              marginTop: t.spacing(3),
              background: "none",
              border: "none",
              cursor: "pointer",
              color: t.colors.primary,
              fontFamily: t.typography.fontFamily,
              fontSize: "0.875rem",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: t.spacing(1),
              padding: 0,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>
              add
            </span>
            Add row
          </button>
        </div>

        <div
          style={{
            padding: `${t.spacing(3)} ${t.spacing(5)}`,
            borderTop: `1px solid ${t.colors.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: t.spacing(3),
            flexWrap: "wrap",
            opacity: savePhase !== "idle" ? 0.15 : 1,
            pointerEvents: savePhase !== "idle" ? "none" : "auto",
          }}
        >
          <span style={{ fontSize: "0.875rem", color: t.colors.textMuted }}>
            {rows.filter(rowHasRequiredData).length} valid row{rows.filter(rowHasRequiredData).length === 1 ? "" : "s"}
            {targetType === "fund" && selectedFund ? ` · ${currency}` : ""}
          </span>
          <div style={{ display: "flex", gap: t.spacing(2) }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: `${t.spacing(2)} ${t.spacing(4)}`,
                borderRadius: t.radius.md,
                border: `1px solid ${t.colors.border}`,
                background: "transparent",
                cursor: "pointer",
                color: t.colors.textMuted,
                fontFamily: t.typography.fontFamily,
              }}
            >
              Cancel
            </button>
            <button type="button" onClick={() => void handleSave()} style={{ ...primaryBtn, fontSize: "0.875rem" }}>
              Save schedule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
