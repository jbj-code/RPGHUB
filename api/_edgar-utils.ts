// _edgar-utils.ts
// SEC EDGAR helpers: EFTS search, Form 4 XML fetch/parse. Requires SEC_EDGAR_USER_AGENT env.

const EFTS_SEARCH = "https://efts.sec.gov/LATEST/search-index";
const SEC_ARCHIVES = "https://www.sec.gov/Archives/edgar/data";

export type Form4SaleLead = {
  filerName: string;
  /** Country label for display (e.g. US, UK). From reporting-owner address on the filing. */
  filerCountry: string;
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
  /** SEC viewer — issuer/owner metadata (may show XBRL notice; still useful for identity check). */
  filingAltUrl: string;
  accessionNo: string;
};

export type Form4ScanOptions = {
  days: number;
  minValueUsd: number;
  maxFilingsToParse: number;
  titleKeywordsOnly: boolean;
  /** When true (default), drop fund/LP/LLC/etc. filers — keep natural-person names only. */
  individualsOnly: boolean;
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

/** Fund, LP, LLC, trust, and similar non-person reporting owners. */
const ENTITY_NAME_PATTERNS = [
  /\bL\.?\s*P\.?\b/i,
  /\bLLC\b/i,
  /\bL\.L\.C\./i,
  /\bInc\.?\b/i,
  /\bCorp\.?\b/i,
  /\bCorporation\b/i,
  /\bTrust\b/i,
  /\bFund\b/i,
  /\bPartners\b/i,
  /\bSPV\b/i,
  /\bHoldings\b/i,
  /\bCapital\b/i,
  /\bVentures\b/i,
  /\bManagement\b/i,
  /\bAssociates\b/i,
  /\bInvestments?\b/i,
  /\bS\.A\.\b/i,
  /\bde C\.V\./i,
  /\bAIV\b/i,
  /\bPLC\b/i,
  /\bLtd\.?\b/i,
  /\bG\.?\s*P\.?\b/i,
  /\bLimited\b/i,
  /\bCompany\b/i,
  /\bCo\.,/i,
];

export function isLikelyEntityFiler(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  return ENTITY_NAME_PATTERNS.some((re) => re.test(trimmed));
}

const COUNTRY_ABBREV: Array<[RegExp, string]> = [
  [/UNITED\s+STATES/i, "US"],
  [/UNITED\s+KINGDOM|(^|\s)UK(\s|$)/i, "UK"],
  [/^CANADA$/i, "CA"],
  [/^GERMANY$/i, "DE"],
  [/^FRANCE$/i, "FR"],
  [/^ICELAND$/i, "IS"],
  [/^DENMARK$/i, "DK"],
  [/^SWEDEN$/i, "SE"],
  [/^NORWAY$/i, "NO"],
  [/^NETHERLANDS$/i, "NL"],
  [/^SWITZERLAND$/i, "CH"],
  [/^IRELAND$/i, "IE"],
  [/^AUSTRALIA$/i, "AU"],
  [/^SINGAPORE$/i, "SG"],
  [/^HONG\s+KONG$/i, "HK"],
  [/^JAPAN$/i, "JP"],
  [/^ISRAEL$/i, "IL"],
];

export function countryFromOwnerBlock(ownerXml: string): string {
  const nonUs = firstTag(ownerXml, "rptOwnerNonUSAddressFlag");
  if (nonUs !== "1" && nonUs !== "true") return "US";
  const desc = (firstTag(ownerXml, "rptOwnerStateDescription") ?? "").trim();
  if (!desc) return "Non-US";
  const upper = desc.toUpperCase();
  for (const [re, code] of COUNTRY_ABBREV) {
    if (re.test(upper)) return code;
  }
  if (upper.length <= 4) return upper;
  return desc
    .split(/\s+/)[0]
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 12);
}

function xslFolderFromSchema(schemaVersion: string | null): string | null {
  if (!schemaVersion) return null;
  const m = schemaVersion.match(/^X(\d{2})\d{2}$/i);
  return m ? `xslF345X${m[1]}` : null;
}

function xmlBaseName(xmlFile: string): string {
  const slash = xmlFile.lastIndexOf("/");
  return slash >= 0 ? xmlFile.slice(slash + 1) : xmlFile;
}

/** Human-readable Form 4 (XSL-rendered XML). Never index-headers.html. */
export function buildForm4ViewUrl(
  base: string,
  xmlFile: string,
  names: string[],
  schemaVersion: string | null
): string {
  const fileName = xmlBaseName(xmlFile);
  const xslFolder = xslFolderFromSchema(schemaVersion);
  if (xslFolder) {
    return `${base}/${xslFolder}/${fileName}`;
  }

  const namesLower = new Set(names.map((n) => n.toLowerCase()));
  const paired = fileName.replace(/\.xml$/i, ".html");
  if (namesLower.has(paired.toLowerCase())) {
    return `${base}/${paired}`;
  }

  const wkHtml = names.find((n) => /^wk-form4_.*\.html?$/i.test(n));
  if (wkHtml) return `${base}/${wkHtml}`;

  const form4Html = names.find(
    (n) => /form\s*4|form4/i.test(n) && /\.html?$/i.test(n) && !/^index/i.test(n)
  );
  if (form4Html) return `${base}/${form4Html}`;

  return `${base}/${xmlFile}`;
}

/** Legacy SEC viewer — shows reporting owner / issuer even when XBRL notice appears. */
function filingLegacyViewerUrl(cik: string, accessionDashes: string): string {
  return (
    "https://www.sec.gov/cgi-bin/viewer?action=view" +
    `&cik=${encodeURIComponent(cikForUrl(cik))}` +
    `&accession_number=${encodeURIComponent(accessionDashes)}` +
    "&xbrl_type=v"
  );
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
  base: string;
  xmlFile: string;
  indexNames: string[];
  xmlUrl: string;
  /** SEC viewer — owner/issuer identity check. */
  filingAltUrl: string;
};

async function resolveForm4FilingAssets(
  cik: string,
  adsh: string,
  accessionDashes: string
): Promise<Form4FilingAssets | null> {
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

  return {
    base,
    xmlFile,
    indexNames: names,
    xmlUrl: `${base}/${xmlFile}`,
    filingAltUrl: filingLegacyViewerUrl(cik, accessionDashes),
  };
}

export function parseForm4Sales(
  xmlRaw: string,
  meta: {
    companyName: string;
    companyTicker: string | null;
    filedDate: string;
    filingUrl: string;
    filingAltUrl: string;
    accessionNo: string;
  },
  minValueUsd: number,
  titleKeywordsOnly: boolean,
  individualsOnly: boolean
): Form4SaleLead[] {
  const xml = stripXmlNamespaces(xmlRaw);
  const issuerName = firstTag(xml, "issuerName") ?? meta.companyName;
  const issuerTicker = firstTag(xml, "issuerTradingSymbol") ?? meta.companyTicker;

  const ownerBlocks = blockMatches(xml, "reportingOwner");
  const owners = ownerBlocks.map((block) => ({
    name: firstTag(block, "rptOwnerName") ?? "Unknown",
    role: roleFromOwnerBlock(block),
    country: countryFromOwnerBlock(block),
  }));

  const primaryOwner = owners[0] ?? { name: "Unknown", role: "Reporting owner", country: "US" };
  if (individualsOnly && isLikelyEntityFiler(primaryOwner.name)) return [];

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
      filerCountry: primaryOwner.country,
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
      filingAltUrl: meta.filingAltUrl,
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
    options.maxFilingsToParse
  );

  const leads: Form4SaleLead[] = [];
  let filingsParsed = 0;
  let parseErrors = 0;

  for (const filing of filings) {
    if (filingsParsed >= options.maxFilingsToParse) break;

    try {
      const assets = await resolveForm4FilingAssets(
        filing.cik,
        filing.accessionAdsh,
        filing.accessionNoDashes
      );
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
      const xmlStripped = stripXmlNamespaces(xmlText);
      const schemaVersion = firstTag(xmlStripped, "schemaVersion");
      const filingUrl = buildForm4ViewUrl(
        assets.base,
        assets.xmlFile,
        assets.indexNames,
        schemaVersion
      );
      const parsed = parseForm4Sales(
        xmlText,
        {
          companyName: filing.companyName,
          companyTicker: null,
          filedDate: filing.filedDate,
          filingUrl,
          filingAltUrl: assets.filingAltUrl,
          accessionNo: filing.accessionNoDashes,
        },
        options.minValueUsd,
        options.titleKeywordsOnly,
        options.individualsOnly
      );

      leads.push(...parsed);
      filingsParsed += 1;
    } catch {
      parseErrors += 1;
    }

    await sleep(120);
  }

  leads.sort((a, b) => b.transactionValue - a.transactionValue);

  return {
    leads,
    filingsSearched: filings.length,
    filingsParsed,
    parseErrors,
  };
}
