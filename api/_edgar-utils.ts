// _edgar-utils.ts
// SEC EDGAR helpers: EFTS search, Form 4 XML fetch/parse. Requires SEC_EDGAR_USER_AGENT env.

const EFTS_SEARCH = "https://efts.sec.gov/LATEST/search-index";
const SEC_ARCHIVES = "https://www.sec.gov/Archives/edgar/data";

export type Form4SaleLead = {
  filerName: string;
  companyName: string;
  companyTicker: string | null;
  role: string;
  transactionValue: number;
  shares: number;
  pricePerShare: number | null;
  transactionDate: string;
  filedDate: string;
  transactionCode: string;
  filingUrl: string;
  accessionNo: string;
};

export type Form4ScanOptions = {
  days: number;
  minValueUsd: number;
  maxFilingsToParse: number;
  titleKeywordsOnly: boolean;
};

type EftsHit = {
  cik: string;
  accessionNoDashes: string;
  accessionAdsh: string;
  companyName: string;
  filedDate: string;
};

const SALE_DISPOSE_CODES = new Set(["S", "F"]);
const TITLE_PATTERNS = [
  /chief\s+executive/i,
  /\bceo\b/i,
  /founder/i,
  /co-?founder/i,
  /\bcto\b/i,
  /chief\s+technology/i,
  /\bpresident\b/i,
  /\bvp\b/i,
  /vice\s+president/i,
  /chief\s+financial/i,
  /\bcfo\b/i,
  /chief\s+operating/i,
  /\bcoo\b/i,
];

export function getSecUserAgent(): string {
  const configured = process.env.SEC_EDGAR_USER_AGENT?.trim();
  if (configured) return configured;
  return "Resolute Partners Group contact@resolutepartners.com";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripXmlNamespaces(xml: string): string {
  return xml.replace(/<(\/?)([\w-]+):/g, "<$1");
}

function tagValues(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = m[1].replace(/<[^>]+>/g, "").trim();
    if (v) out.push(v);
  }
  return out;
}

function firstTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, "").trim() || null;
}

function blockMatches(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, "gi");
  return xml.match(re) ?? [];
}

function parseNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function formatAccessionDashes(adsh: string): string {
  const clean = adsh.replace(/-/g, "");
  if (clean.length < 18) return adsh;
  return `${clean.slice(0, 10)}-${clean.slice(10, 12)}-${clean.slice(12)}`;
}

function cikForUrl(cik: string): string {
  return String(Number.parseInt(cik, 10));
}

function roleFromOwnerBlock(ownerXml: string): string {
  const officer = firstTag(ownerXml, "isOfficer");
  const title = firstTag(ownerXml, "officerTitle");
  if (officer === "1" || officer === "true") return title || "Officer";
  if (firstTag(ownerXml, "isDirector") === "1" || firstTag(ownerXml, "isDirector") === "true") {
    return title || "Director";
  }
  if (firstTag(ownerXml, "isTenPercentOwner") === "1" || firstTag(ownerXml, "isTenPercentOwner") === "true") {
    return title || "10% Owner";
  }
  return title || "Reporting owner";
}

function roleMatchesFilter(role: string): boolean {
  return TITLE_PATTERNS.some((re) => re.test(role));
}

/** Human-readable filing page — Form 4 is XML/HTML, not XBRL (never use xbrl_type=v). */
function filingIndexUrl(cik: string, adshNoDashes: string): string {
  return `${SEC_ARCHIVES}/${cikForUrl(cik)}/${adshNoDashes}/index.htm`;
}

async function secFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": getSecUserAgent(),
      Accept: "application/json, text/xml, application/xml, */*",
    },
  });
}

export async function searchRecentForm4Filings(
  startDate: string,
  endDate: string,
  maxResults: number
): Promise<EftsHit[]> {
  const hits: EftsHit[] = [];
  let from = 0;
  const pageSize = 100;

  while (hits.length < maxResults) {
    const params = new URLSearchParams({
      q: '"form 4"',
      forms: "4",
      dateRange: "custom",
      startdt: startDate,
      enddt: endDate,
      from: String(from),
      size: String(Math.min(pageSize, maxResults - hits.length)),
    });

    const resp = await secFetch(`${EFTS_SEARCH}?${params}`);
    if (!resp.ok) {
      throw new Error(`SEC EFTS search failed (${resp.status})`);
    }

    const json = (await resp.json()) as {
      hits?: { hits?: Array<{ _source?: Record<string, unknown> }>; total?: { value?: number } };
    };

    const page = json.hits?.hits ?? [];
    if (page.length === 0) break;

    for (const row of page) {
      const src = row._source ?? {};
      const ciks = (src.ciks as string[] | undefined) ?? [];
      const cik = ciks[0];
      const adsh = String(src.adsh ?? src.accession_no ?? "").replace(/-/g, "");
      const names = (src.display_names as string[] | undefined) ?? [];
      const fileDate = String(src.file_date ?? "");
      if (!cik || !adsh) continue;

      hits.push({
        cik,
        accessionAdsh: adsh,
        accessionNoDashes: formatAccessionDashes(adsh),
        companyName: names[0] ?? "Unknown issuer",
        filedDate: fileDate,
      });
      if (hits.length >= maxResults) break;
    }

    const total = json.hits?.total?.value ?? 0;
    from += page.length;
    if (from >= total || page.length < pageSize) break;
    await sleep(120);
  }

  return hits;
}

type Form4FilingAssets = {
  xmlUrl: string;
  /** Best SEC page for humans — prefer rendered .htm over XBRL viewer. */
  filingUrl: string;
};

async function resolveForm4FilingAssets(cik: string, adsh: string): Promise<Form4FilingAssets | null> {
  const base = `${SEC_ARCHIVES}/${cikForUrl(cik)}/${adsh}`;
  const resp = await secFetch(`${base}/index.json`);
  if (!resp.ok) return null;

  const index = (await resp.json()) as {
    directory?: { item?: Array<{ name?: string; type?: string }> | { name?: string; type?: string } };
  };

  let items = index.directory?.item ?? [];
  if (!Array.isArray(items)) items = items ? [items] : [];

  const names = items.map((f) => f.name ?? "").filter(Boolean);

  const xmlFile =
    names.find((n) => n.toLowerCase().endsWith(".xml") && !n.toLowerCase().includes("xsl")) ??
    names.find((n) => n.toLowerCase().endsWith(".xml"));

  if (!xmlFile) return null;

  // Form 4 often ships a styled .htm alongside the XML; prefer that over the XBRL viewer.
  const htmlFile =
    names.find((n) => /\.html?$/i.test(n) && !/^index\.html?$/i.test(n)) ??
    names.find((n) => /\.html?$/i.test(n));

  const filingUrl = htmlFile ? `${base}/${htmlFile}` : filingIndexUrl(cik, adsh);

  return {
    xmlUrl: `${base}/${xmlFile}`,
    filingUrl,
  };
}

export function parseForm4Sales(
  xmlRaw: string,
  meta: { companyName: string; companyTicker: string | null; filedDate: string; filingUrl: string; accessionNo: string },
  minValueUsd: number,
  titleKeywordsOnly: boolean
): Form4SaleLead[] {
  const xml = stripXmlNamespaces(xmlRaw);
  const issuerName = firstTag(xml, "issuerName") ?? meta.companyName;
  const issuerTicker = firstTag(xml, "issuerTradingSymbol") ?? meta.companyTicker;

  const ownerBlocks = blockMatches(xml, "reportingOwner");
  const owners = ownerBlocks.map((block) => ({
    name: firstTag(block, "rptOwnerName") ?? "Unknown",
    role: roleFromOwnerBlock(block),
  }));

  const primaryOwner = owners[0] ?? { name: "Unknown", role: "Reporting owner" };

  const leads: Form4SaleLead[] = [];
  const txBlocks = [
    ...blockMatches(xml, "nonDerivativeTransaction"),
    ...blockMatches(xml, "derivativeTransaction"),
  ];

  for (const tx of txBlocks) {
    const code = (firstTag(tx, "transactionCode") ?? "").toUpperCase();
    const disposed = (firstTag(tx, "transactionAcquiredDisposedCode") ?? "").toUpperCase();
    const isSale = disposed === "D" || SALE_DISPOSE_CODES.has(code);
    if (!isSale) continue;

    const shares = parseNumber(firstTag(tx, "transactionShares"));
    const price = parseNumber(firstTag(tx, "transactionPricePerShare"));
    const value = shares != null && price != null ? shares * price : null;
    if (value == null || value < minValueUsd) continue;

    const role = primaryOwner.role;
    if (titleKeywordsOnly && !roleMatchesFilter(role)) continue;

    leads.push({
      filerName: primaryOwner.name,
      companyName: issuerName,
      companyTicker: issuerTicker,
      role,
      transactionValue: Math.round(value),
      shares,
      pricePerShare: price,
      transactionDate: firstTag(tx, "transactionDate") ?? meta.filedDate,
      filedDate: meta.filedDate,
      transactionCode: code || disposed,
      filingUrl: meta.filingUrl,
      accessionNo: meta.accessionNo,
    });
  }

  return leads;
}

export async function scanForm4Sales(options: Form4ScanOptions): Promise<{
  leads: Form4SaleLead[];
  filingsSearched: number;
  filingsParsed: number;
  parseErrors: number;
}> {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(1, options.days));

  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  const filings = await searchRecentForm4Filings(
    startDate,
    endDate,
    options.maxFilingsToParse * 3
  );

  const leads: Form4SaleLead[] = [];
  let filingsParsed = 0;
  let parseErrors = 0;

  for (const filing of filings) {
    if (filingsParsed >= options.maxFilingsToParse) break;

    try {
      const assets = await resolveForm4FilingAssets(filing.cik, filing.accessionAdsh);
      if (!assets) {
        parseErrors += 1;
        continue;
      }

      const xmlResp = await secFetch(assets.xmlUrl);
      if (!xmlResp.ok) {
        parseErrors += 1;
        continue;
      }

      const xmlText = await xmlResp.text();
      const parsed = parseForm4Sales(
        xmlText,
        {
          companyName: filing.companyName,
          companyTicker: null,
          filedDate: filing.filedDate,
          filingUrl: assets.filingUrl,
          accessionNo: filing.accessionNoDashes,
        },
        options.minValueUsd,
        options.titleKeywordsOnly
      );

      leads.push(...parsed);
      filingsParsed += 1;
    } catch {
      parseErrors += 1;
    }

    await sleep(150);
  }

  leads.sort((a, b) => b.transactionValue - a.transactionValue);

  return {
    leads,
    filingsSearched: filings.length,
    filingsParsed,
    parseErrors,
  };
}
