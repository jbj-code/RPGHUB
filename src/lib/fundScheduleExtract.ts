/** Parse schedule-of-investments style tables from plain text (PDF text layer or OCR). */

export type FundScheduleRow = {
  id: string;
  company: string;
  shares: string;
  amountInvested: string;
  companyValuation: string;
};

export const FUND_SCHEDULE_COLUMNS: (keyof Omit<FundScheduleRow, "id">)[] = [
  "company",
  "shares",
  "amountInvested",
  "companyValuation",
];

function makeRowId(): string {
  return crypto.randomUUID?.() ?? `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeCell(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Cluster words on one line into columns using horizontal gaps (PDF pts or OCR px). */
function clusterWordsIntoCells(row: { str: string; x0: number; x1: number }[]): string[] {
  if (row.length === 0) return [];
  const gaps: number[] = [];
  for (let i = 1; i < row.length; i++) {
    const g = row[i]!.x0 - row[i - 1]!.x1;
    if (g > 0) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const med = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 8;
  const thresh = Math.max(med * 2.8, 12);

  const cells: string[] = [];
  let cur = row[0]!.str;
  let endX = row[0]!.x1;
  for (let i = 1; i < row.length; i++) {
    const w = row[i]!;
    const gap = w.x0 - endX;
    if (gap > thresh) {
      cells.push(normalizeCell(cur));
      cur = w.str;
      endX = w.x1;
    } else {
      cur += (gap > 1 ? " " : "") + w.str;
      endX = Math.max(endX, w.x1);
    }
  }
  cells.push(normalizeCell(cur));
  return cells.filter(Boolean);
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

/** Map header labels to the four columns we keep. */
function classifyHeaderCell(cell: string): ColKey | null {
  const l = cell.toLowerCase().replace(/\s+/g, " ");

  if (/\bshares\b|#\s*shares|quantity|units?\b/i.test(l) && !/shareholder/i.test(l)) return "shares";
  if (/fair\s*value|fair\s*market|^\s*fmv\s*$|mark\s*to\s*market/i.test(l) && !/period/i.test(l))
    return "companyValuation";
  if (
    /^\s*cost\s*$|^original\s*cost|cost\s*basis|amount\s*(invested|funded|contributed)|investment\s*amount|paid\s*in/i.test(
      l
    )
  )
    return "amountInvested";
  if (
    /investment\s*\/\s*security|investments?\s*\/|portfolio\s*company|^investment$/i.test(l) ||
    /^company$|^company\s*name$|^issuer$|^investee$/i.test(l.trim())
  )
    return "company";

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

function inferColMapFromHeader(cells: string[]): Partial<Record<ColKey, number>> | null {
  const map: Partial<Record<ColKey, number>> = {};
  cells.forEach((c, i) => {
    const k = classifyHeaderCell(c);
    if (k && map[k] == null) map[k] = i;
  });
  const filled = Object.keys(map).length;
  return filled >= 2 ? map : null;
}

function buildRowFromMap(cells: string[], colMap: Partial<Record<ColKey, number>>): FundScheduleRow | null {
  const v = (k: ColKey): string => {
    const i = colMap[k];
    if (i == null || i < 0 || i >= cells.length) return "";
    return cells[i] ?? "";
  };
  const company = v("company");
  const amount = v("amountInvested");
  const nonempty = cells.filter(Boolean).length;
  if (nonempty === 0) return null;
  if (!company && !amount && !v("shares") && nonempty < 2) return null;
  if (isProbablyHeaderRow(cells)) return null;

  return {
    id: makeRowId(),
    company: company || cells[0] || "",
    shares: v("shares"),
    amountInvested: amount,
    companyValuation: v("companyValuation"),
  };
}

/**
 * Typical SOI: Investment, Industry, Geography, Purchase date, Shares, Cost, FMV [, Gain].
 * We only read columns 0,4,5,6 (7+ columns with or without an eighth "gain" column).
 */
function rowFromSoiColumnPositions(cells: string[]): FundScheduleRow | null {
  if (cells.length < 7) return null;
  return {
    id: makeRowId(),
    company: cells[0] ?? "",
    shares: cells[4] ?? "",
    amountInvested: cells[5] ?? "",
    companyValuation: cells[6] ?? "",
  };
}

/** Four data columns in order: company, shares, cost, FMV. */
function rowFromFourColumnOrder(cells: string[]): FundScheduleRow {
  return {
    id: makeRowId(),
    company: cells[0] ?? "",
    shares: cells[1] ?? "",
    amountInvested: cells[2] ?? "",
    companyValuation: cells[3] ?? "",
  };
}

function isLikelySubtotalRow(cells: string[]): boolean {
  const joined = cells.join(" ").toLowerCase();
  return /^(total|sub-?total|subtotal)\b/i.test(joined) || /^[-–—]+$/.test(cells[0]?.trim() ?? "");
}

function rowLooksLikeReportingJunk(row: FundScheduleRow): boolean {
  const blob = `${row.company} ${row.shares} ${row.amountInvested} ${row.companyValuation}`;
  return /derFormat|RenderFormat|Globals!\s*R|=\s*iif|=\s*"Word"|ReportItems!/i.test(blob);
}

/** Remove SSRS / Report Builder fragments that leak into the text layer. */
function stripReportingArtifacts(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => {
      let s = line;
      s = s.replace(/derFormat\.\s*Name/gi, " ");
      s = s.replace(/RenderFormat\.\s*Name/gi, " ");
      s = s.replace(/Globals!\s*RenderFormat[^\s]*/gi, " ");
      s = s.replace(/=\s*iif\s*\([^)]*\)/gi, " ");
      s = s.replace(/=\s*"Word"\s*,\s*"\."\s*,?\s*""?\)?/gi, " ");
      s = s.replace(/\bReportItems!\w+/gi, " ");
      s = s.replace(/\s{2,}/g, " ").trim();
      return s;
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

function junkLineRatio(text: string): number {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return 0;
  let bad = 0;
  for (const line of lines) {
    if (/derFormat|RenderFormat|Globals!|=\s*iif|=\s*"Word"|ReportItems!/i.test(line)) bad++;
  }
  return bad / lines.length;
}

/**
 * Parse tabular schedule text into rows. Works best when PDFs expose a text layer
 * with line breaks or tabs; scanned PDFs should be OCR'd first.
 */
export function parseFundScheduleText(raw: string): FundScheduleRow[] {
  const text = stripReportingArtifacts(raw.replace(/\u00a0/g, " "));
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let colMap: Partial<Record<ColKey, number>> | null = null;
  let sawHeader = false;
  const out: FundScheduleRow[] = [];

  for (const line of lines) {
    if (!line) continue;
    if (/Globals!\s*RenderFormat|^=\s*iif\s*\(/i.test(line)) continue;
    const cells = splitLineToCells(line);

    if (cells.length === 1) continue;

    if (!sawHeader && isProbablyHeaderRow(cells)) {
      const inferred = inferColMapFromHeader(cells);
      if (inferred) {
        colMap = inferred;
        sawHeader = true;
      }
      continue;
    }

    if (sawHeader && colMap) {
      if (isLikelySubtotalRow(cells)) continue;
      const row = buildRowFromMap(cells, colMap);
      if (row && !rowLooksLikeReportingJunk(row)) out.push(row);
      continue;
    }

    if (!sawHeader && cells.length >= 7) {
      if (!isProbablyHeaderRow(cells) && !isLikelySubtotalRow(cells)) {
        const row = rowFromSoiColumnPositions(cells);
        if (row && !rowLooksLikeReportingJunk(row)) out.push(row);
      }
      continue;
    }

    if (cells.length >= 4) {
      if (!isProbablyHeaderRow(cells) && !isLikelySubtotalRow(cells)) {
        const row = rowFromFourColumnOrder(cells);
        if (!rowLooksLikeReportingJunk(row)) out.push(row);
      }
    }
  }

  return out;
}

type PdfPiece = { str: string; y: number; x0: number; x1: number };

/**
 * Skip text runs that are not meant to be read as visible body copy.
 * SSRS PDFs embed conditional expressions split across many small TextItems.
 */
function shouldSkipPdfTextItem(
  rawStr: string,
  transform: number[] | undefined,
  width: number,
  height: number
): boolean {
  const str = rawStr.replace(/\s+/g, " ").trim();
  if (!str) return true;

  if (/Globals!\s*RenderFormat|RenderFormat\.Name|derFormat\.Name/i.test(str)) return true;
  if (/RenderFormat|derFormat/i.test(str)) return true;
  if (/^=\s*iif\s*\(/i.test(str)) return true;
  if (/^=\s*(Fields|Parameters|Globals|ReportItems)!/i.test(str)) return true;
  if (/=\s*"Word"\s*,/i.test(str)) return true;
  if (/ReportItems!/i.test(str)) return true;

  const a = transform?.[0] ?? 0;
  const b = transform?.[1] ?? 0;
  const c = transform?.[2] ?? 0;
  const d = transform?.[3] ?? 0;
  const scale = Math.max(Math.hypot(a, b), Math.hypot(c, d)) || 1;
  if (scale < 0.12) return true;
  if (Math.abs(width) < 0.02 && Math.abs(height) < 0.02 && str.length < 200) return true;

  return false;
}

/** Rebuild table rows from PDF text runs using horizontal position (tab-separated cells per line). */
function pdfContentToTabLines(content: { items: unknown[] }): string[] {
  const pieces: PdfPiece[] = [];
  for (const item of content.items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const raw = String((item as { str: string }).str ?? "");
    const tr = (item as { transform?: number[]; width?: number; height?: number }).transform;
    const width = Number((item as { width?: number }).width) || 0;
    const height = Number((item as { height?: number }).height) || 0;
    if (shouldSkipPdfTextItem(raw, tr, width, height)) continue;
    const str = raw.replace(/\s+/g, " ").trim();
    const x0 = tr?.[4] ?? 0;
    const y = Math.round(tr?.[5] ?? 0);
    const x1 = width > 0 ? x0 + width : x0 + Math.max(6, str.length * 0.55);
    pieces.push({ str, y, x0, x1 });
  }
  pieces.sort((a, b) => b.y - a.y || a.x0 - b.x0);

  const rows: PdfPiece[][] = [];
  let lineY: number | null = null;
  let curRow: PdfPiece[] = [];
  for (const p of pieces) {
    if (lineY == null || Math.abs(p.y - lineY) <= 4) {
      curRow.push(p);
      lineY = p.y;
    } else {
      if (curRow.length) rows.push(curRow);
      curRow = [p];
      lineY = p.y;
    }
  }
  if (curRow.length) rows.push(curRow);

  const lines: string[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x0 - b.x0);
    const cells = clusterWordsIntoCells(row);
    if (cells.length) lines.push(cells.join("\t"));
  }
  return lines;
}

/** Legacy: merge each PDF text line into a single string (loses columns). */
function pageToLines(content: { items: unknown[] }): string[] {
  type TextPiece = { str: string; y: number; x: number };
  const pieces: TextPiece[] = [];
  for (const item of content.items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const raw = String((item as { str: string }).str ?? "");
    const tr = (item as { transform?: number[]; width?: number; height?: number }).transform;
    const width = Number((item as { width?: number }).width) || 0;
    const height = Number((item as { height?: number }).height) || 0;
    if (shouldSkipPdfTextItem(raw, tr, width, height)) continue;
    const str = raw.trim();
    if (!str) continue;
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
    const tabLines = pdfContentToTabLines(content);
    const tabJoined = tabLines.join("\n");
    const scored = scoreTabLineQuality(tabJoined);
    const legacyJoined = pageToLines(content).join("\n");
    const legacyScored = scoreTabLineQuality(legacyJoined);
    const tabJ = junkLineRatio(tabJoined);
    const legJ = junkLineRatio(legacyJoined);

    let chosen = scored >= legacyScored ? tabJoined : legacyJoined;
    if (Math.abs(tabJ - legJ) > 0.06 && tabJoined.length > 30 && legacyJoined.length > 30) {
      chosen = tabJ < legJ ? tabJoined : legacyJoined;
    }
    parts.push(chosen);
  }

  return stripReportingArtifacts(parts.filter(Boolean).join("\n\n").trim());
}

/** Prefer extraction where more lines look like multi-column tables. */
function scoreTabLineQuality(text: string): number {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return 0;
  let multi = 0;
  for (const line of lines) {
    if (splitLineToCells(line).length >= 4) multi++;
  }
  return multi / lines.length;
}

type OcrWordPiece = { str: string; x0: number; x1: number };

function ocrBlocksToTabLines(page: {
  blocks: { paragraphs: { lines: { words: { text: string; bbox: { x0: number; x1: number } }[] }[] }[] }[] | null;
}): string[] {
  const blocks = page.blocks;
  if (!blocks?.length) return [];
  const lines: string[] = [];
  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        if (!line.words.some((w) => w.text.trim())) continue;
        const pieces: OcrWordPiece[] = line.words
          .filter((w) => w.text.trim())
          .map((w) => ({
            str: w.text.trim(),
            x0: w.bbox.x0,
            x1: w.bbox.x1,
          }));
        pieces.sort((a, b) => a.x0 - b.x0);
        const cells = clusterWordsIntoCells(pieces);
        if (cells.length) lines.push(cells.join("\t"));
      }
    }
  }
  return lines;
}

export async function ocrImageFile(file: Blob): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const {
      data: { text, blocks },
    } = await worker.recognize(file, {}, { blocks: true } as Record<string, boolean>);
    const tabLines = blocks?.length ? ocrBlocksToTabLines({ blocks }) : [];
    const tabText = stripReportingArtifacts(tabLines.join("\n").trim());
    const plain = stripReportingArtifacts((text ?? "").trim());
    if (tabText.length >= 20 && scoreTabLineQuality(tabText) >= scoreTabLineQuality(plain)) {
      return tabText;
    }
    return plain;
  } finally {
    await worker.terminate();
  }
}
