/** Predefined ticker sets for Options Opportunities (scan within a subset of the market). */

export type OpportunityBucket = {
  id: string;
  label: string;
  description: string;
  /** Empty = use full built-in universe + Schwab movers (server default). */
  symbols: string[];
};

export const OPPORTUNITY_BUCKETS: OpportunityBucket[] = [
  {
    id: "full",
    label: "Full universe + movers",
    description: "Broad US list (~660+ names) plus live index movers.",
    symbols: [],
  },
  {
    id: "climate-energy",
    label: "Climate / Energy transition",
    description: "User-curated list of transition infrastructure, power, industrial, and semis names.",
    symbols: [
      "GE",
      "VRT",
      "AVGO",
      "GEV",
      "VG",
      "AMAT",
      "KLAC",
      "Q",
      "POWL",
      "ANET",
      "RSG",
      "MIR",
      "UNP",
      "MLM",
      "CAT",
      "PWR",
      "VST",
      "MSFT",
      "CEG",
      "FSLR",
      "TSLA",
      "FPS",
      "NEE",
      "APD",
      "PCAR",
      "BE",
    ],
  },
  {
    id: "mega-tech",
    label: "Mega‑cap tech & semis",
    description: "Large liquid tech and semiconductor names.",
    symbols: [
      "AAPL",
      "MSFT",
      "NVDA",
      "AMZN",
      "META",
      "GOOGL",
      "GOOG",
      "AVGO",
      "ORCL",
      "CRM",
      "ADBE",
      "AMD",
      "INTC",
      "QCOM",
      "TXN",
      "MU",
      "AMAT",
      "LRCX",
      "KLAC",
      "NOW",
      "INTU",
      "SNOW",
      "PANW",
      "CRWD",
      "NET",
      "DDOG",
    ],
  },
];
