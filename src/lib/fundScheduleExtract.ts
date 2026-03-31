/** Parse fund schedule tables from plain text (PDF text layer or OCR). */

export type FundScheduleRow = {
  id: string;
  fund: string;
  valuationPeriod: string;
  reportingPeriod: string;
  fundVintageYear: string;
  company: string;
  amountInvested: string;
  companyValuation: string;
};

export const FUND_SCHEDULE_COLUMNS: (keyof Omit<FundScheduleRow, "id">)[] = [
  "fund",
  "valuationPeriod",
  "reportingPeriod",
  "fundVintageYear",
  "company",
  "amountInvested",
  "companyValuation",
];

function makeRowId(): string {
  return crypto.randomUUID?.() ?? `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeCell(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function splitLineToCells(line: string): string[] {
  const t = line.trim();
  if (!t) return [];
  if (t.includes("\t")) {
    return t.split("\t").map(normalizeCell).filter(Boolean);
  }
  if (t.includes(",")) {
    const byComma = t.split(/,(?=\S)/).map(normalizeCell).filter(Boolean);
    if (byComma.length >= 4) return byComma;
  }
  const byGap = t.split(/\s{2,}/).map(normalizeCell).filter(Boolean);
  if (byGap.length >= 2) return byGap;
  return t ? [t] : [];
}

type ColKey = keyof Omit<FundScheduleRow, "id">;

function classifyHeaderCell(cell: string): ColKey | null {
  const l = cell.toLowerCase().replace(/\s+/g, " ");
  if (/reporting\s*period|period.*reporting/i.test(l)) return "reportingPeriod";
  if (/company\s*valuation|post[\s-]?money|ev\s|enterprise\s*value/i.test(l)) return "companyValuation";
  if (/valuation\s*period|fair\s*value\s*period/i.test(l) && !/company/i.test(l)) return "valuationPeriod";
  if (/fund\s*vintage|vintage\s*year/i.test(l)) return "fundVintageYear";
  if (/amount\s*(invested|funded|contributed)|investment\s*amount|cost\s*basis|paid\s*in/i.test(l))
    return "amountInvested";
  if (/^company$|portfolio\s*company|investee|issuer|investment(\s*name)?$/i.test(l.trim()))
    return "company";
  if (/^fund$|^fund\s*name$/i.test(l.trim()) || (l.includes("fund") && !l.includes("vintage")))
    return "fund";
  return null;
}

function isProbablyHeaderRow(cells: string[]): boolean {
  if (cells.length < 3) return false;
  let hits = 0;
  for (const c of cells) {
    if (classifyHeaderCell(c)) hits++;
  }
  return hits >= 2;
}

function buildRowFromMap(
  cells: string[],
  colMap: Partial<Record<ColKey, number>>,
  contextFund: string
): FundScheduleRow | null {
  const v = (k: ColKey): string => {
    const i = colMap[k];
    if (i == null || i < 0 || i >= cells.length) return "";
    return cells[i] ?? "";
  };
  const company = v("company");
  const amount = v("amountInvested");
  const nonempty = cells.filter(Boolean).length;
  if (nonempty === 0) return null;
  if (!company && !amount && nonempty < 2) return null;
  if (isProbablyHeaderRow(cells)) return null;

  return {
    id: makeRowId(),
    fund: v("fund") || contextFund,
    valuationPeriod: v("valuationPeriod"),
    reportingPeriod: v("reportingPeriod"),
    fundVintageYear: v("fundVintageYear"),
    company: company || cells[0] || "",
    amountInvested: amount,
    companyValuation: v("companyValuation"),
  };
}

function inferColMapFromHeader(cells: string[]): Partial<Record<ColKey, number>> | null {
  const map: Partial<Record<ColKey, number>> = {};
  cells.forEach((c, i) => {
    const k = classifyHeaderCell(c);
    if (k && map[k] == null) map[k] = i;
  });
  const filled = Object.keys(map).length;
  return filled >= 2 ? map : null;
}

/** Heuristic row when no header: assume canonical column order left-to-right. */
function rowFromFixedOrder(cells: string[], contextFund: string): FundScheduleRow {
  const [a, b, c, d, e, f, g] = [
    cells[0] ?? "",
    cells[1] ?? "",
    cells[2] ?? "",
    cells[3] ?? "",
    cells[4] ?? "",
    cells[5] ?? "",
    cells[6] ?? "",
  ];
  return {
    id: makeRowId(),
    fund: a || contextFund,
    valuationPeriod: b,
    reportingPeriod: c,
    fundVintageYear: d,
    company: e,
    amountInvested: f,
    companyValuation: g,
  };
}

/**
 * Parse tabular fund schedule text into rows. Works best when PDFs expose a text layer
 * with line breaks or tabs; scanned PDFs should be OCR'd first.
 */
export function parseFundScheduleText(raw: string): FundScheduleRow[] {
  const text = raw.replace(/\u00a0/g, " ");
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let contextFund = "";
  let colMap: Partial<Record<ColKey, number>> | null = null;
  let sawHeader = false;
  const out: FundScheduleRow[] = [];

  for (const line of lines) {
    if (!line) continue;
    const cells = splitLineToCells(line);

    if (cells.length === 1) {
      const only = cells[0]!;
      if (
        only.length > 2 &&
        only.length < 160 &&
        /fund|capital|partners|l\.?p\.|llc|trust|vehicles/i.test(only) &&
        !/^\$[\d,]+/.test(only)
      ) {
        contextFund = only.replace(/^[\d.)]+\s*/, "").trim();
      }
      continue;
    }

    if (!sawHeader && isProbablyHeaderRow(cells)) {
      const inferred = inferColMapFromHeader(cells);
      if (inferred) {
        colMap = inferred;
        sawHeader = true;
      }
      continue;
    }

    if (sawHeader && colMap) {
      const row = buildRowFromMap(cells, colMap, contextFund);
      if (row) out.push(row);
      continue;
    }

    if (cells.length >= 7) {
      if (!isProbablyHeaderRow(cells)) out.push(rowFromFixedOrder(cells, contextFund));
    } else if (cells.length >= 4) {
      if (!isProbablyHeaderRow(cells)) {
        out.push({
          id: makeRowId(),
          fund: contextFund,
          valuationPeriod: cells[0] ?? "",
          reportingPeriod: cells[1] ?? "",
          fundVintageYear: cells[2] ?? "",
          company: cells[3] ?? "",
          amountInvested: cells[4] ?? "",
          companyValuation: cells[5] ?? "",
        });
      }
    }
  }

  return out;
}

function pageToLines(content: { items: unknown[] }): string[] {
  type TextPiece = { str: string; y: number; x: number };
  const pieces: TextPiece[] = [];
  for (const item of content.items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const str = String((item as { str: string }).str ?? "").trim();
    if (!str) continue;
    const tr = (item as { transform?: number[] }).transform;
    const y = Math.round(tr?.[5] ?? 0);
    const x = tr?.[4] ?? 0;
    pieces.push({ str, y, x });
  }
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: string[] = [];
  let lineY: number | null = null;
  let buf = "";
  for (const it of pieces) {
    if (lineY == null || Math.abs(it.y - lineY) <= 3) {
      buf += (buf ? " " : "") + it.str;
      lineY = it.y;
    } else {
      lines.push(buf);
      buf = it.str;
      lineY = it.y;
    }
  }
  if (buf) lines.push(buf);
  return lines;
}

export async function extractTextFromPdfBuffer(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const data = new Uint8Array(buffer.slice(0));
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  const parts: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    parts.push(pageToLines(content).join("\n"));
  }

  return parts.filter(Boolean).join("\n\n").trim();
}

export async function ocrImageFile(file: Blob): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(file);
    return (data.text ?? "").trim();
  } finally {
    await worker.terminate();
  }
}
