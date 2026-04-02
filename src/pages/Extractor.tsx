import { useCallback, useEffect, useRef, useState } from "react";
import type { Theme } from "../theme";
import { getPrimaryActionButtonStyle, INTERACTIVE_CARD_CLASS, PAGE_LAYOUT } from "../theme";
import {
  parseFundScheduleText,
  extractTextFromPdfBuffer,
  ocrImageFile,
  type FundScheduleRow,
} from "../lib/fundScheduleExtract";

type ExtractorProps = { theme: Theme };

const ACCEPT = ".pdf,application/pdf,image/png,image/jpeg,image/webp,image/gif";

const DISPLAY_HEADERS: { key: keyof Omit<FundScheduleRow, "id">; label: string }[] = [
  { key: "company", label: "Company / Investment" },
  { key: "shares", label: "Shares" },
  { key: "amountInvested", label: "Cost" },
  { key: "companyValuation", label: "Fair value (FMV)" },
];

function rowsToTsv(rows: FundScheduleRow[]): string {
  const header = DISPLAY_HEADERS.map((h) => h.label).join("\t");
  const body = rows.map((r) =>
    DISPLAY_HEADERS.map((h) => String(r[h.key] ?? "").replace(/\t/g, " ")).join("\t")
  );
  return [header, ...body].join("\n");
}

function rowsToCsv(rows: FundScheduleRow[]): string {
  const esc = (s: string) => {
    const t = String(s ?? "");
    if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
    return t;
  };
  const header = DISPLAY_HEADERS.map((h) => esc(h.label)).join(",");
  const body = rows.map((r) => DISPLAY_HEADERS.map((h) => esc(String(r[h.key] ?? ""))).join(","));
  return [header, ...body].join("\n");
}

function fileFromClipboardEvent(e: ClipboardEvent): File | null {
  const items = Array.from(e.clipboardData?.items ?? []);
  const imgItem = items.find((it) => it.type.startsWith("image/"));
  if (!imgItem) return null;
  const blob = imgItem.getAsFile();
  if (!blob) return null;
  const ext = blob.type.split("/")[1] ?? "png";
  return new File([blob], `pasted-image.${ext}`, { type: blob.type });
}

export function Extractor({ theme: t }: ExtractorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [rows, setRows] = useState<FundScheduleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

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
  };
  const sectionTitleStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    color: t.colors.secondary,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: t.spacing(2),
  };
  const tableWrapStyle: React.CSSProperties = {
    overflowX: "auto",
    borderRadius: t.radius.md,
    border: `1px solid ${t.colors.border}`,
  };
  const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.875rem",
  };
  const thStyle: React.CSSProperties = {
    textAlign: "left",
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    borderBottom: `2px solid ${t.colors.border}`,
    backgroundColor: t.colors.secondary,
    color: "#FFFFFF",
    fontWeight: 600,
    whiteSpace: "nowrap",
  };
  const tdStyle: React.CSSProperties = {
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    borderBottom: `1px solid ${t.colors.border}`,
    verticalAlign: "top",
  };
  const primaryBtn = getPrimaryActionButtonStyle(t);

  const runExtraction = useCallback(async (file: File) => {
    setLoading(true);
    setMessage(null);
    try {
      const lower = file.name.toLowerCase();
      const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf");
      const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(lower);
      let text = "";

      if (isPdf) {
        const buf = await file.arrayBuffer();
        text = await extractTextFromPdfBuffer(buf);
        if (!text || text.length < 20) {
          setRows([]);
          setMessage(
            "This PDF appears scanned (no readable text layer). Paste an image with Ctrl+V or upload PNG/JPEG to run OCR."
          );
          return;
        }
      } else if (isImage) {
        setMessage("Running OCR on image...");
        text = await ocrImageFile(file);
        if (!text || text.length < 10) {
          setRows([]);
          setMessage("Could not read text from image. Try a clearer/higher-resolution screenshot.");
          return;
        }
      } else {
        setRows([]);
        setMessage("Unsupported file type. Please use PDF or image.");
        return;
      }

      const parsed = parseFundScheduleText(text);
      setRows(parsed);
      if (parsed.length === 0) {
        setMessage("Parsed successfully, but no schedule rows were detected from this file.");
      } else {
        setMessage(`Extracted ${parsed.length} row${parsed.length === 1 ? "" : "s"}.`);
      }
    } catch (err) {
      console.error(err);
      setRows([]);
      setMessage(err instanceof Error ? `Could not process file: ${err.message}` : "Could not process file.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = fileFromClipboardEvent(e);
      if (!pasted) return;
      e.preventDefault();
      setSelectedFile(pasted);
      setMessage(`Image pasted: ${pasted.name}. Click Process to extract.`);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setSelectedFile(f);
    setRows([]);
    setMessage(f ? `Selected: ${f.name}. Click Process to extract.` : null);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0] ?? null;
    if (!f) return;
    setSelectedFile(f);
    setRows([]);
    setMessage(`Selected: ${f.name}. Click Process to extract.`);
  };

  return (
    <section className="extractor-page" style={pageStyle}>
      <h2 style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}>
        <span className="material-symbols-outlined" style={{ fontSize: "1.5rem", color: t.colors.secondary }} aria-hidden>
          document_scanner
        </span>
        Extractor
      </h2>
      <p style={descStyle}>
        Drag/drop a PDF, click to upload, or paste an image screenshot with <strong>Ctrl+V</strong>, then click Process.
      </p>

      <div className={`${INTERACTIVE_CARD_CLASS} page-card`} style={cardStyle}>
        <h3 style={{ ...sectionTitleStyle, fontSize: "1.6rem", textTransform: "none", letterSpacing: 0, marginBottom: t.spacing(3) }}>
          Upload PDF
        </h3>
        <input ref={inputRef} type="file" accept={ACCEPT} style={{ display: "none" }} onChange={onInputChange} />

        <button
          type="button"
          className="extractor-dropzone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          style={{
            width: "100%",
            border: `2px dashed ${dragOver ? t.colors.primary : t.colors.border}`,
            borderRadius: t.radius.lg,
            background: dragOver ? t.colors.background : t.colors.surface,
            cursor: "pointer",
            minHeight: 180,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: t.spacing(2),
            color: t.colors.textMuted,
            transition: "all 0.15s ease",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 40, opacity: 0.55 }} aria-hidden>
            description
          </span>
          <span style={{ fontSize: "1.1rem" }}>
            Drag & drop a PDF here, or click to browse
          </span>
          <span style={{ fontSize: "0.85rem" }}>
            You can also paste an image (Ctrl+V)
          </span>
        </button>

        <div style={{ marginTop: t.spacing(3), display: "flex", gap: t.spacing(2), alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            style={primaryBtn}
            className="extractor-process"
            disabled={loading || !selectedFile}
            onClick={() => {
              if (selectedFile) void runExtraction(selectedFile);
            }}
          >
            {loading ? "Processing..." : "Process PDF"}
          </button>
          {selectedFile ? <span style={{ color: t.colors.textMuted, fontSize: "0.9rem" }}>{selectedFile.name}</span> : null}
        </div>
      </div>

      {message ? (
        <p style={{ fontSize: "0.9rem", color: rows.length > 0 ? t.colors.textMuted : t.colors.danger, marginBottom: t.spacing(3) }}>
          {message}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className={`${INTERACTIVE_CARD_CLASS} page-card`} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: t.spacing(2), marginBottom: t.spacing(2), flexWrap: "wrap" }}>
            <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Extracted schedule</h3>
            <div style={{ display: "flex", gap: t.spacing(2) }}>
              <button
                type="button"
                className="extractor-copy-table"
                style={{
                  padding: `${t.spacing(1.5)} ${t.spacing(2)}`,
                  fontSize: "0.8rem",
                  border: `1px solid ${t.colors.border}`,
                  borderRadius: t.radius.md,
                  background: t.colors.surface,
                  color: t.colors.text,
                  cursor: "pointer",
                }}
                onClick={() => void navigator.clipboard.writeText(rowsToTsv(rows))}
              >
                Copy table
              </button>
              <button
                type="button"
                className="extractor-download-csv"
                style={{
                  padding: `${t.spacing(1.5)} ${t.spacing(2)}`,
                  fontSize: "0.8rem",
                  border: `1px solid ${t.colors.border}`,
                  borderRadius: t.radius.md,
                  background: t.colors.surface,
                  color: t.colors.text,
                  cursor: "pointer",
                }}
                onClick={() => {
                  const blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "fund-schedule-extract.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download CSV
              </button>
            </div>
          </div>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {DISPLAY_HEADERS.map((h) => (
                    <th key={h.key} style={thStyle}>
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {DISPLAY_HEADERS.map((h) => (
                      <td key={h.key} style={tdStyle}>
                        {r[h.key] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
