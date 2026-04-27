import { useState } from "react";
import type { CSSProperties } from "react";
import type { Theme } from "../theme";
import { getPrimaryButtonStyle } from "../theme";

const SCHWAB_API_BASE =
  (import.meta.env.VITE_SCHWAB_API_BASE as string | undefined) ?? "https://therpghub.vercel.app";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ParamDef = {
  name: string;
  label: string;
  /** date-ms: renders as a date picker but sends the value as epoch milliseconds (required by pricehistory startDate/endDate) */
  type: "text" | "select" | "date" | "date-ms";
  options?: { value: string; label: string }[];
  required?: boolean;
  description?: string;
  placeholder?: string;
};

type EndpointDef = {
  id: string;
  label: string;
  category: string;
  pathTemplate: string;
  pathParamNames?: string[];
  params: ParamDef[];
  description: string;
};

type SchemaFieldDef = { name: string; type: string; desc: string };
type SchemaDef = { description: string; fields: SchemaFieldDef[] };

// ---------------------------------------------------------------------------
// Endpoint definitions
// ---------------------------------------------------------------------------

const ENDPOINTS: EndpointDef[] = [
  {
    id: "quotes",
    label: "Quotes",
    category: "Market Data",
    pathTemplate: "/marketdata/v1/quotes",
    description: "Get real-time quotes for one or more symbols.",
    params: [
      {
        name: "symbols",
        label: "Symbols",
        type: "text",
        required: true,
        placeholder: "SPY,QQQ,AAPL",
        description: "Comma-separated list of symbols",
      },
      {
        name: "fields",
        label: "Fields",
        type: "text",
        placeholder: "quote,fundamental,reference",
        description: "Comma-separated field groups to return: quote, fundamental, extended, reference, regular (leave blank for all)",
      },
      {
        name: "indicative",
        label: "Indicative",
        type: "select",
        options: [
          { value: "", label: "Default" },
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ],
        description: "Include indicative symbol quotes",
      },
    ],
  },
  {
    id: "quote-single",
    label: "Quote — Single Symbol",
    category: "Market Data",
    pathTemplate: "/marketdata/v1/{symbol_id}/quotes",
    pathParamNames: ["symbol_id"],
    description: "Get a real-time quote for a single symbol by path parameter.",
    params: [
      {
        name: "symbol_id",
        label: "Symbol",
        type: "text",
        required: true,
        placeholder: "SPY",
        description: "The symbol to look up",
      },
      {
        name: "fields",
        label: "Fields",
        type: "text",
        placeholder: "quote,fundamental,reference",
        description: "Comma-separated field groups: quote, fundamental, extended, reference, regular (leave blank for all)",
      },
    ],
  },
  {
    id: "option-chains",
    label: "Option Chains",
    category: "Options",
    pathTemplate: "/marketdata/v1/chains",
    description: "Get a full option chain for a symbol.",
    params: [
      {
        name: "symbol",
        label: "Symbol",
        type: "text",
        required: true,
        placeholder: "SPY",
        description: "Underlying symbol",
      },
      {
        name: "contractType",
        label: "Contract Type",
        type: "select",
        options: [
          { value: "", label: "ALL (default)" },
          { value: "CALL", label: "CALL" },
          { value: "PUT", label: "PUT" },
        ],
      },
      {
        name: "strikeCount",
        label: "Strike Count",
        type: "text",
        placeholder: "10",
        description: "Number of strikes above/below ATM to return",
      },
      {
        name: "includeUnderlyingQuote",
        label: "Include Underlying Quote",
        type: "select",
        options: [
          { value: "", label: "Default" },
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ],
      },
      {
        name: "strategy",
        label: "Strategy",
        type: "select",
        options: [
          { value: "", label: "SINGLE (default)" },
          { value: "ANALYTICAL", label: "ANALYTICAL" },
          { value: "COVERED", label: "COVERED" },
          { value: "VERTICAL", label: "VERTICAL" },
          { value: "CALENDAR", label: "CALENDAR" },
          { value: "STRANGLE", label: "STRANGLE" },
          { value: "STRADDLE", label: "STRADDLE" },
          { value: "BUTTERFLY", label: "BUTTERFLY" },
          { value: "CONDOR", label: "CONDOR" },
          { value: "DIAGONAL", label: "DIAGONAL" },
          { value: "COLLAR", label: "COLLAR" },
          { value: "ROLL", label: "ROLL" },
        ],
      },
      {
        name: "strike",
        label: "Strike Price",
        type: "text",
        placeholder: "450.00",
        description: "Return only this specific strike",
      },
      {
        name: "range",
        label: "Range",
        type: "select",
        options: [
          { value: "", label: "ALL (default)" },
          { value: "ITM", label: "ITM" },
          { value: "NTM", label: "NTM" },
          { value: "OTM", label: "OTM" },
          { value: "SAK", label: "SAK (strikes above)" },
          { value: "SBK", label: "SBK (strikes below)" },
          { value: "SNK", label: "SNK (strikes near)" },
        ],
      },
      { name: "fromDate", label: "From Date", type: "date", description: "Filter by expiration start (YYYY-MM-DD)" },
      { name: "toDate", label: "To Date", type: "date", description: "Filter by expiration end (YYYY-MM-DD)" },
      { name: "daysToExpiration", label: "Days to Expiration", type: "text", placeholder: "30" },
      {
        name: "expMonth",
        label: "Expiration Month",
        type: "select",
        options: [
          { value: "", label: "ALL (default)" },
          ...["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"].map((m) => ({
            value: m,
            label: m,
          })),
        ],
      },
    ],
  },
  {
    id: "expiration-chain",
    label: "Option Expiration Chain",
    category: "Options",
    pathTemplate: "/marketdata/v1/expirationchain",
    description: "Get all available expiration dates for an underlying symbol.",
    params: [
      {
        name: "symbol",
        label: "Symbol",
        type: "text",
        required: true,
        placeholder: "SPY",
        description: "Underlying symbol",
      },
    ],
  },
  {
    id: "price-history",
    label: "Price History",
    category: "Market Data",
    pathTemplate: "/marketdata/v1/pricehistory",
    description: "Get historical OHLCV candle data for a symbol.",
    params: [
      { name: "symbol", label: "Symbol", type: "text", required: true, placeholder: "SPY" },
      {
        name: "periodType",
        label: "Period Type",
        type: "select",
        options: [
          { value: "", label: "Default" },
          { value: "day", label: "day" },
          { value: "month", label: "month" },
          { value: "year", label: "year" },
          { value: "ytd", label: "ytd" },
        ],
      },
      { name: "period", label: "Period", type: "text", placeholder: "1", description: "Number of periods" },
      {
        name: "frequencyType",
        label: "Frequency Type",
        type: "select",
        options: [
          { value: "", label: "Default" },
          { value: "minute", label: "minute" },
          { value: "daily", label: "daily" },
          { value: "weekly", label: "weekly" },
          { value: "monthly", label: "monthly" },
        ],
      },
      {
        name: "frequency",
        label: "Frequency",
        type: "text",
        placeholder: "1",
        description: "Interval (e.g. 1, 5, 10, 15, 30 for minutes)",
      },
      { name: "startDate", label: "Start Date", type: "date-ms", description: "Sent as epoch ms — Schwab requires milliseconds since Unix epoch" },
      { name: "endDate", label: "End Date", type: "date-ms", description: "Sent as epoch ms — Schwab requires milliseconds since Unix epoch" },
      {
        name: "needExtendedHoursData",
        label: "Extended Hours",
        type: "select",
        options: [
          { value: "", label: "Default" },
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ],
      },
      {
        name: "needPreviousClose",
        label: "Include Previous Close",
        type: "select",
        options: [
          { value: "", label: "Default" },
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ],
      },
    ],
  },
  {
    id: "movers",
    label: "Movers",
    category: "Market Data",
    pathTemplate: "/marketdata/v1/movers/{index_symbol}",
    pathParamNames: ["index_symbol"],
    description: "Get top movers for a market index. Response is either a plain array or { screeners: [...] } — check both shapes.",
    params: [
      {
        name: "index_symbol",
        label: "Index",
        type: "select",
        required: true,
        options: [
          { value: "$DJI", label: "$DJI — Dow Jones" },
          { value: "$COMPX", label: "$COMPX — NASDAQ Composite" },
          { value: "$SPX", label: "$SPX — S&P 500" },
          { value: "NYSE", label: "NYSE" },
          { value: "NASDAQ", label: "NASDAQ" },
          { value: "OTCBB", label: "OTCBB" },
          { value: "INDEX_ALL", label: "INDEX_ALL" },
          { value: "EQUITY_ALL", label: "EQUITY_ALL" },
          { value: "OPTION_ALL", label: "OPTION_ALL" },
          { value: "OPTION_PUT", label: "OPTION_PUT" },
          { value: "OPTION_CALL", label: "OPTION_CALL" },
        ],
      },
      {
        name: "sort",
        label: "Sort By",
        type: "select",
        options: [
          { value: "", label: "Default" },
          { value: "VOLUME", label: "VOLUME" },
          { value: "TRADES", label: "TRADES" },
          { value: "PERCENT_CHANGE_UP", label: "PERCENT_CHANGE_UP" },
          { value: "PERCENT_CHANGE_DOWN", label: "PERCENT_CHANGE_DOWN" },
        ],
      },
      {
        name: "frequency",
        label: "Frequency (minutes)",
        type: "select",
        options: [
          { value: "", label: "Default" },
          { value: "0", label: "0 — latest snapshot" },
          { value: "1", label: "1" },
          { value: "5", label: "5" },
          { value: "10", label: "10" },
          { value: "30", label: "30" },
          { value: "60", label: "60" },
        ],
      },
    ],
  },
  {
    id: "market-hours",
    label: "Market Hours",
    category: "Market Data",
    pathTemplate: "/marketdata/v1/markets",
    description: "Check whether markets are open and get session hours.",
    params: [
      {
        name: "markets",
        label: "Markets",
        type: "text",
        required: true,
        placeholder: "equity,option",
        description: "Comma-separated: equity, option, bond, future, forex",
      },
      { name: "date", label: "Date", type: "date", description: "Date to check (defaults to today)" },
    ],
  },
  {
    id: "market-hours-single",
    label: "Market Hours — Single",
    category: "Market Data",
    pathTemplate: "/marketdata/v1/markets/{market_id}",
    pathParamNames: ["market_id"],
    description: "Get market hours for a single specific market.",
    params: [
      {
        name: "market_id",
        label: "Market",
        type: "select",
        required: true,
        options: [
          { value: "equity", label: "equity" },
          { value: "option", label: "option" },
          { value: "bond", label: "bond" },
          { value: "future", label: "future" },
          { value: "forex", label: "forex" },
        ],
      },
      { name: "date", label: "Date", type: "date", description: "Date to check (defaults to today)" },
    ],
  },
  {
    id: "instruments",
    label: "Instruments",
    category: "Market Data",
    pathTemplate: "/marketdata/v1/instruments",
    description: "Search for instruments by symbol, description, or fundamentals.",
    params: [
      {
        name: "symbol",
        label: "Symbol / Query",
        type: "text",
        required: true,
        placeholder: "AAPL",
        description: "Symbol or search string",
      },
      {
        name: "projection",
        label: "Projection",
        type: "select",
        required: true,
        options: [
          { value: "symbol-search", label: "symbol-search" },
          { value: "symbol-regex", label: "symbol-regex" },
          { value: "desc-search", label: "desc-search" },
          { value: "desc-regex", label: "desc-regex" },
          { value: "search", label: "search" },
          { value: "fundamental", label: "fundamental" },
        ],
      },
    ],
  },
  {
    id: "instruments-cusip",
    label: "Instruments — By CUSIP",
    category: "Market Data",
    pathTemplate: "/marketdata/v1/instruments/{cusip_id}",
    pathParamNames: ["cusip_id"],
    description: "Get a single instrument by its CUSIP identifier.",
    params: [
      {
        name: "cusip_id",
        label: "CUSIP",
        type: "text",
        required: true,
        placeholder: "037833100",
        description: "9-character CUSIP (e.g. 037833100 for AAPL)",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Schema reference
// ---------------------------------------------------------------------------

const SCHEMA_DEFS: Record<string, SchemaDef> = {
  QuoteEquity: {
    description: "Quote data for an equity security (sub-object of EquityResponse.quote).",
    fields: [
      { name: "52WeekHigh", type: "number($double)", desc: "Highest price traded in the past 52 weeks" },
      { name: "52WeekLow", type: "number($double)", desc: "Lowest price traded in the past 52 weeks" },
      { name: "askMICId", type: "string", desc: "Ask MIC code (e.g. XNYS)" },
      { name: "askPrice", type: "number($double)", desc: "Current best ask price" },
      { name: "askSize", type: "integer($int32)", desc: "Number of shares for ask" },
      { name: "askTime", type: "integer($int64)", desc: "Last ask time (ms since epoch)" },
      { name: "bidMICId", type: "string", desc: "Bid MIC code" },
      { name: "bidPrice", type: "number($double)", desc: "Current best bid price" },
      { name: "bidSize", type: "integer($int32)", desc: "Number of shares for bid" },
      { name: "bidTime", type: "integer($int64)", desc: "Last bid time (ms since epoch)" },
      { name: "closePrice", type: "number($double)", desc: "Previous day's closing price" },
      { name: "highPrice", type: "number($double)", desc: "Day's high trade price" },
      { name: "lastMICId", type: "string", desc: "Last trade MIC code" },
      { name: "lastPrice", type: "number($double)", desc: "Last traded price" },
      { name: "lastSize", type: "integer($int32)", desc: "Number of shares traded with last trade" },
      { name: "lowPrice", type: "number($double)", desc: "Day's low trade price" },
      { name: "mark", type: "number($double)", desc: "Mark price" },
      { name: "markChange", type: "number($double)", desc: "Mark price change" },
      { name: "markPercentChange", type: "number($double)", desc: "Mark price percent change" },
      { name: "netChange", type: "number($double)", desc: "Current last minus previous close" },
      { name: "netPercentChange", type: "number($double)", desc: "Net percentage change" },
      { name: "openPrice", type: "number($double)", desc: "Price at market open" },
      { name: "quoteTime", type: "integer($int64)", desc: "Last quote time (ms since epoch)" },
      { name: "securityStatus", type: "string", desc: "Status of security (e.g. Normal)" },
      { name: "totalVolume", type: "integer($int64)", desc: "Aggregated shares traded including pre/post market" },
      { name: "tradeTime", type: "integer($int64)", desc: "Last trade time (ms since epoch)" },
      { name: "volatility", type: "number($double)", desc: "Option risk / volatility measurement" },
    ],
  },
  EquityResponse: {
    description: "Top-level quote response object for an equity security.",
    fields: [
      { name: "assetMainType", type: "AssetMainType", desc: "BOND | EQUITY | FOREX | FUTURE | FUTURE_OPTION | INDEX | MUTUAL_FUND | OPTION" },
      { name: "assetSubType", type: "EquityAssetSubType (nullable)", desc: "COE | PRF | ADR | GDR | CEF | ETF | ETN | UIT | WAR | RGT" },
      { name: "ssid", type: "integer($int64)", desc: "SSID of instrument (e.g. 1234567890)" },
      { name: "symbol", type: "string", desc: "Symbol of instrument (e.g. AAPL)" },
      { name: "realtime", type: "boolean", desc: "Whether quote is real-time" },
      { name: "quoteType", type: "QuoteType (nullable)", desc: "NBBO (real-time) or NFL (non-fee liable)" },
      { name: "extended", type: "ExtendedMarket", desc: "Extended hours quote data (pre/after market)" },
      { name: "fundamental", type: "Fundamental", desc: "Fundamental data (dividends, P/E, EPS, etc.)" },
      { name: "quote", type: "QuoteEquity", desc: "Core quote data (bid, ask, last, volume, greeks, etc.)" },
      { name: "reference", type: "ReferenceEquity", desc: "Static reference data (CUSIP, exchange, shortability)" },
      { name: "regular", type: "RegularMarket", desc: "Regular market session data" },
    ],
  },
  QuoteOption: {
    description: "Quote data for an option security (sub-object of OptionResponse.quote).",
    fields: [
      { name: "52WeekHigh", type: "number($double)", desc: "52-week high price" },
      { name: "52WeekLow", type: "number($double)", desc: "52-week low price" },
      { name: "askPrice", type: "number($double)", desc: "Current ask price" },
      { name: "askSize", type: "integer($int32)", desc: "Ask size (contracts)" },
      { name: "bidPrice", type: "number($double)", desc: "Current bid price" },
      { name: "bidSize", type: "integer($int32)", desc: "Bid size (contracts)" },
      { name: "closePrice", type: "number($double)", desc: "Previous day's closing price" },
      { name: "delta", type: "number($double)", desc: "Delta (−1 to 1)" },
      { name: "gamma", type: "number($double)", desc: "Gamma" },
      { name: "highPrice", type: "number($double)", desc: "Day's high" },
      { name: "indAskPrice", type: "number($double)", desc: "Indicative ask price" },
      { name: "indBidPrice", type: "number($double)", desc: "Indicative bid price" },
      { name: "indQuoteTime", type: "integer($int64)", desc: "Indicative quote time (ms since epoch)" },
      { name: "impliedYield", type: "number($double)", desc: "Implied yield" },
      { name: "lastPrice", type: "number($double)", desc: "Last traded price" },
      { name: "lastSize", type: "integer($int32)", desc: "Last trade size" },
      { name: "lowPrice", type: "number($double)", desc: "Day's low" },
      { name: "mark", type: "number($double)", desc: "Mark price (mid of bid/ask)" },
      { name: "markChange", type: "number($double)", desc: "Mark price change" },
      { name: "markPercentChange", type: "number($double)", desc: "Mark price % change" },
      { name: "moneyIntrinsicValue", type: "number($double)", desc: "Money intrinsic value" },
      { name: "netChange", type: "number($double)", desc: "Net change from previous close" },
      { name: "netPercentChange", type: "number($double)", desc: "Net % change" },
      { name: "openInterest", type: "integer($int64)", desc: "Open interest" },
      { name: "openPrice", type: "number($double)", desc: "Opening price" },
      { name: "quoteTime", type: "integer($int64)", desc: "Last quote time (ms since epoch)" },
      { name: "rho", type: "number($double)", desc: "Rho" },
      { name: "securityStatus", type: "string", desc: "Security status (e.g. Normal)" },
      { name: "theoreticalOptionValue", type: "number($double)", desc: "Theoretical option value (Black-Scholes)" },
      { name: "theta", type: "number($double)", desc: "Theta (daily decay)" },
      { name: "timeValue", type: "number($double)", desc: "Time value portion of premium" },
      { name: "totalVolume", type: "integer($int64)", desc: "Total volume" },
      { name: "tradeTime", type: "integer($int64)", desc: "Last trade time (ms since epoch)" },
      { name: "underlyingPrice", type: "number($double)", desc: "Underlying asset price" },
      { name: "vega", type: "number($double)", desc: "Vega" },
      { name: "volatility", type: "number($double)", desc: "Implied volatility" },
    ],
  },
  OptionChain: {
    description: "Full option chain response for an underlying symbol.",
    fields: [
      { name: "symbol", type: "string", desc: "Underlying symbol" },
      { name: "status", type: "string", desc: "SUCCESS or FAILED" },
      { name: "underlying", type: "Underlying", desc: "Underlying asset quote data" },
      { name: "strategy", type: "string", desc: "Strategy used in request" },
      { name: "interval", type: "number", desc: "Strike interval" },
      { name: "isDelayed", type: "boolean", desc: "Whether data is delayed" },
      { name: "isIndex", type: "boolean", desc: "Whether underlying is an index" },
      { name: "daysToExpiration", type: "number", desc: "Requested DTE" },
      { name: "interestRate", type: "number", desc: "Interest rate used" },
      { name: "underlyingPrice", type: "number", desc: "Underlying price used" },
      { name: "volatility", type: "number", desc: "Volatility used (ANALYTICAL strategy only)" },
      { name: "callExpDateMap", type: "OptionContractMap", desc: "Call contracts keyed by expiry then strike" },
      { name: "putExpDateMap", type: "OptionContractMap", desc: "Put contracts keyed by expiry then strike" },
    ],
  },
  OptionContractMap: {
    description: 'Nested map: { "YYYY-MM-DD:DTE": { "strikePrice:n": OptionContract[] } }',
    fields: [
      { name: "key (date)", type: "string", desc: 'Expiration date key, e.g. "2025-01-17:30"' },
      { name: "key (strike)", type: "string", desc: 'Strike key, e.g. "450.0:1"' },
      { name: "value", type: "OptionContract[]", desc: "Array of option contracts at that strike" },
    ],
  },
  OptionContract: {
    description: "A single option contract within an option chain (from /chains endpoint).",
    fields: [
      { name: "putCall", type: "string", desc: "PUT or CALL" },
      { name: "symbol", type: "string", desc: "OCC option symbol" },
      { name: "description", type: "string", desc: "Human-readable description" },
      { name: "exchangeName", type: "string", desc: "Exchange" },
      { name: "bidPrice", type: "number", desc: "Current bid price" },
      { name: "askPrice", type: "number", desc: "Current ask price" },
      { name: "lastPrice", type: "number", desc: "Last traded price" },
      { name: "markPrice", type: "number", desc: "Mark price (mid of bid/ask)" },
      { name: "bidSize", type: "integer", desc: "Bid size (contracts)" },
      { name: "askSize", type: "integer", desc: "Ask size (contracts)" },
      { name: "lastSize", type: "integer", desc: "Last trade size" },
      { name: "highPrice", type: "number", desc: "Day's high" },
      { name: "lowPrice", type: "number", desc: "Day's low" },
      { name: "openPrice", type: "number", desc: "Opening price" },
      { name: "closePrice", type: "number", desc: "Previous close" },
      { name: "totalVolume", type: "integer", desc: "Total volume" },
      { name: "tradeDate", type: "integer", desc: "Last trade date (ms since epoch)" },
      { name: "quoteTimeInLong", type: "integer", desc: "Last quote time (ms since epoch)" },
      { name: "tradeTimeInLong", type: "integer", desc: "Last trade time (ms since epoch)" },
      { name: "netChange", type: "number", desc: "Net change from previous close" },
      { name: "volatility", type: "number", desc: "Implied volatility" },
      { name: "delta", type: "number", desc: "Delta" },
      { name: "gamma", type: "number", desc: "Gamma" },
      { name: "theta", type: "number", desc: "Theta" },
      { name: "vega", type: "number", desc: "Vega" },
      { name: "rho", type: "number", desc: "Rho" },
      { name: "timeValue", type: "number", desc: "Time value portion of premium" },
      { name: "openInterest", type: "integer", desc: "Open interest" },
      { name: "isInTheMoney", type: "boolean", desc: "Whether option is in-the-money" },
      { name: "theoreticalOptionValue", type: "number", desc: "Theoretical value (Black-Scholes)" },
      { name: "theoreticalVolatility", type: "number", desc: "Theoretical volatility" },
      { name: "isMini", type: "boolean", desc: "Whether this is a mini option" },
      { name: "isNonStandard", type: "boolean", desc: "Whether this is a non-standard option" },
      { name: "optionDeliverablesList", type: "OptionDeliverables[]", desc: "Deliverables upon exercise/assignment" },
      { name: "strikePrice", type: "number", desc: "Strike price" },
      { name: "expirationDate", type: "string", desc: "Expiration date" },
      { name: "daysToExpiration", type: "integer", desc: "Days to expiration" },
      { name: "expirationType", type: "ExpirationType", desc: "W | M | Q | S" },
      { name: "lastTradingDay", type: "integer", desc: "Last trading day (ms since epoch)" },
      { name: "multiplier", type: "number", desc: "Contract multiplier (typically 100)" },
      { name: "settlementType", type: "SettlementType", desc: "A (AM) or P (PM)" },
      { name: "deliverableNote", type: "string", desc: "Note about deliverables" },
      { name: "isIndexOption", type: "boolean", desc: "Whether this is an index option" },
      { name: "percentChange", type: "number", desc: "% change from previous close" },
      { name: "markChange", type: "number", desc: "Mark price change" },
      { name: "markPercentChange", type: "number", desc: "Mark price % change" },
      { name: "isPennyPilot", type: "boolean", desc: "Whether in penny pilot program" },
      { name: "intrinsicValue", type: "number", desc: "Intrinsic value" },
      { name: "optionRoot", type: "string", desc: "Option root symbol" },
    ],
  },
  Underlying: {
    description: "The underlying asset's market data within an option chain response.",
    fields: [
      { name: "ask", type: "number", desc: "Ask price" },
      { name: "askSize", type: "integer", desc: "Ask size" },
      { name: "bid", type: "number", desc: "Bid price" },
      { name: "bidSize", type: "integer", desc: "Bid size" },
      { name: "change", type: "number", desc: "Dollar change" },
      { name: "close", type: "number", desc: "Previous close" },
      { name: "delayed", type: "boolean", desc: "Data is delayed" },
      { name: "description", type: "string", desc: "Name / description" },
      { name: "exchangeName", type: "string", desc: "Exchange" },
      { name: "fiftyTwoWeekHigh", type: "number", desc: "52-week high" },
      { name: "fiftyTwoWeekLow", type: "number", desc: "52-week low" },
      { name: "highPrice", type: "number", desc: "Intraday high" },
      { name: "last", type: "number", desc: "Last price" },
      { name: "lowPrice", type: "number", desc: "Intraday low" },
      { name: "mark", type: "number", desc: "Mark price" },
      { name: "openPrice", type: "number", desc: "Open price" },
      { name: "percentChange", type: "number", desc: "% change" },
      { name: "symbol", type: "string", desc: "Symbol" },
      { name: "totalVolume", type: "integer", desc: "Total volume" },
      { name: "tradeTime", type: "integer", desc: "Trade timestamp (ms epoch)" },
    ],
  },
  ExpirationChain: {
    description: "Response from the Option Expiration Chain endpoint.",
    fields: [
      { name: "status", type: "string", desc: "Response status (e.g. SUCCESS)" },
      { name: "expirationList", type: "Expiration[]", desc: "List of available expiration dates" },
    ],
  },
  Expiration: {
    description: "A single option expiration entry — describes expiration type and settlement.",
    fields: [
      { name: "daysToExpiration", type: "integer", desc: "Days until expiration" },
      { name: "expiration", type: "string", desc: "Expiration date string" },
      { name: "expirationType", type: "ExpirationType", desc: "W (weekly) | M (monthly) | Q (quarterly) | S (3rd Friday / regular)" },
      { name: "standard", type: "boolean", desc: "Whether this is a standard expiration" },
      { name: "settlementType", type: "SettlementType", desc: "A (AM settlement) | P (PM settlement)" },
      { name: "optionRoots", type: "string", desc: "Option roots for this expiration" },
    ],
  },
  CandleList: {
    description: "Response from the Price History endpoint — list of OHLCV candles.",
    fields: [
      { name: "candles", type: "Candle[]", desc: "Array of OHLCV candles" },
      { name: "empty", type: "boolean", desc: "True if no data returned" },
      { name: "previousClose", type: "number($double)", desc: "Previous day close price (if requested)" },
      { name: "previousCloseDate", type: "integer($int64)", desc: "Previous close date (ms since epoch)" },
      { name: "previousCloseDateISO8601", type: "string($yyyy-MM-dd)", desc: "Previous close date in ISO 8601 format" },
      { name: "symbol", type: "string", desc: "The requested symbol" },
    ],
  },
  Candle: {
    description: "A single OHLCV price candle.",
    fields: [
      { name: "close", type: "number($double)", desc: "Closing price" },
      { name: "datetime", type: "integer($int64)", desc: "Candle open time (ms since epoch)" },
      { name: "datetimeISO8601", type: "string($yyyy-MM-dd)", desc: "Candle open time in ISO 8601 format" },
      { name: "high", type: "number($double)", desc: "Highest price in period" },
      { name: "low", type: "number($double)", desc: "Lowest price in period" },
      { name: "open", type: "number($double)", desc: "Opening price" },
      { name: "volume", type: "integer($int64)", desc: "Volume in period" },
    ],
  },
  Screener: {
    description: "Security info for a mover within an index (from the Movers endpoint). NOTE: the API may return either a plain array of Screener objects, or { screeners: Screener[] } — always check both shapes.",
    fields: [
      { name: "change", type: "number($double)", desc: "Percent or value changed — by default it's percent changed" },
      { name: "description", type: "string", desc: "Name of the security" },
      { name: "direction", type: "enum", desc: "up | down" },
      { name: "last", type: "number($double)", desc: "Last quoted price" },
      { name: "symbol", type: "string", desc: "Schwab security symbol" },
      { name: "totalVolume", type: "integer($int64)", desc: "Total volume" },
    ],
  },
  Hours: {
    description: "Market hours for a single market/product on a given date.",
    fields: [
      { name: "date", type: "string", desc: "Date of the hours" },
      { name: "marketType", type: "enum", desc: "BOND | EQUITY | ETF | EXTENDED | FOREX | FUTURE | FUTURE_OPTION | FUNDAMENTAL | INDEX | INDICATOR | MUTUAL_FUND | OPTION | UNKNOWN" },
      { name: "exchange", type: "string", desc: "Exchange identifier" },
      { name: "category", type: "string", desc: "Product category" },
      { name: "product", type: "string", desc: "Product code" },
      { name: "productName", type: "string", desc: "Human-readable product name" },
      { name: "isOpen", type: "boolean", desc: "Whether the market is open on this date" },
      { name: "sessionHours", type: "{ [sessionName]: Interval[] }", desc: "Map of session name (e.g. regularMarket, preMarket) → array of Interval objects" },
    ],
  },
  Interval: {
    description: "A start/end time interval for a market session.",
    fields: [
      { name: "start", type: "string", desc: "Session start (ISO datetime, e.g. 2026-04-28T09:30:00-04:00)" },
      { name: "end", type: "string", desc: "Session end (ISO datetime, e.g. 2026-04-28T16:00:00-04:00)" },
    ],
  },
  Instrument: {
    description: "Base instrument returned from the Instruments search.",
    fields: [
      { name: "cusip", type: "string", desc: "CUSIP identifier" },
      { name: "symbol", type: "string", desc: "Symbol" },
      { name: "description", type: "string", desc: "Name / description" },
      { name: "exchange", type: "string", desc: "Exchange" },
      { name: "assetType", type: "enum", desc: "BOND | EQUITY | ETF | EXTENDED | FOREX | FUTURE | FUTURE_OPTION | FUNDAMENTAL | INDEX | INDICATOR | MUTUAL_FUND | OPTION | UNKNOWN" },
      { name: "type", type: "enum (writeOnly)", desc: "BOND | EQUITY | ETF | EXTENDED | FOREX | FUTURE | FUTURE_OPTION | FUNDAMENTAL | INDEX | INDICATOR | MUTUAL_FUND | OPTION | UNKNOWN" },
    ],
  },
  InstrumentResponse: {
    description: "Full instrument response — extends Instrument with fundamentals and bond details.",
    fields: [
      { name: "cusip", type: "string", desc: "CUSIP identifier" },
      { name: "symbol", type: "string", desc: "Symbol" },
      { name: "description", type: "string", desc: "Name / description" },
      { name: "exchange", type: "string", desc: "Exchange" },
      { name: "assetType", type: "enum", desc: "BOND | EQUITY | ETF | EXTENDED | FOREX | FUTURE | FUTURE_OPTION | FUNDAMENTAL | INDEX | INDICATOR | MUTUAL_FUND | OPTION | UNKNOWN" },
      { name: "bondFactor", type: "string", desc: "Bond factor (bonds only)" },
      { name: "bondMultiplier", type: "string", desc: "Bond multiplier (bonds only)" },
      { name: "bondPrice", type: "number", desc: "Bond price (bonds only)" },
      { name: "fundamental", type: "FundamentalInst", desc: "Fundamental financial data (when projection=fundamental)" },
      { name: "instrumentInfo", type: "Instrument", desc: "Nested base instrument info" },
      { name: "bondInstrumentInfo", type: "Bond", desc: "Nested bond instrument info (bonds only)" },
      { name: "type", type: "enum (writeOnly)", desc: "BOND | EQUITY | ETF | EXTENDED | FOREX | FUTURE | FUTURE_OPTION | FUNDAMENTAL | INDEX | INDICATOR | MUTUAL_FUND | OPTION | UNKNOWN" },
    ],
  },
  FundamentalInst: {
    description: "Complete fundamental financial data for an instrument (from Instruments endpoint).",
    fields: [
      { name: "symbol", type: "string", desc: "Symbol" },
      { name: "high52", type: "number($double)", desc: "52-week high price" },
      { name: "low52", type: "number($double)", desc: "52-week low price" },
      { name: "dividendAmount", type: "number($double)", desc: "Annual dividend amount" },
      { name: "dividendYield", type: "number($double)", desc: "Dividend yield %" },
      { name: "dividendDate", type: "string", desc: "Dividend date" },
      { name: "peRatio", type: "number($double)", desc: "Price-to-earnings ratio" },
      { name: "pegRatio", type: "number($double)", desc: "PEG ratio (P/E ÷ growth)" },
      { name: "pbRatio", type: "number($double)", desc: "Price-to-book ratio" },
      { name: "prRatio", type: "number($double)", desc: "Price-to-revenue ratio" },
      { name: "pcfRatio", type: "number($double)", desc: "Price-to-cash-flow ratio" },
      { name: "grossMarginTTM", type: "number($double)", desc: "Gross margin — trailing twelve months" },
      { name: "grossMarginMRQ", type: "number($double)", desc: "Gross margin — most recent quarter" },
      { name: "netProfitMarginTTM", type: "number($double)", desc: "Net profit margin — TTM" },
      { name: "netProfitMarginMRQ", type: "number($double)", desc: "Net profit margin — MRQ" },
      { name: "operatingMarginTTM", type: "number($double)", desc: "Operating margin — TTM" },
      { name: "operatingMarginMRQ", type: "number($double)", desc: "Operating margin — MRQ" },
      { name: "returnOnEquity", type: "number($double)", desc: "Return on equity (ROE)" },
      { name: "returnOnAssets", type: "number($double)", desc: "Return on assets (ROA)" },
      { name: "returnOnInvestment", type: "number($double)", desc: "Return on investment (ROI)" },
      { name: "quickRatio", type: "number($double)", desc: "Quick ratio (acid test)" },
      { name: "currentRatio", type: "number($double)", desc: "Current ratio" },
      { name: "interestCoverage", type: "number($double)", desc: "Interest coverage ratio (EBIT / interest expense)" },
      { name: "totalDebtToCapital", type: "number($double)", desc: "Total debt-to-capital ratio" },
      { name: "ltDebtToEquity", type: "number($double)", desc: "Long-term debt-to-equity ratio" },
      { name: "totalDebtToEquity", type: "number($double)", desc: "Total debt-to-equity ratio" },
      { name: "epsTTM", type: "number($double)", desc: "EPS — trailing twelve months" },
      { name: "epsChangePercentTTM", type: "number($double)", desc: "EPS % change — TTM" },
      { name: "epsChangeYear", type: "number($double)", desc: "EPS change year-over-year" },
      { name: "epsChange", type: "number($double)", desc: "EPS change" },
      { name: "revChangeYear", type: "number($double)", desc: "Revenue change year-over-year" },
      { name: "revChangeTTM", type: "number($double)", desc: "Revenue change — TTM" },
      { name: "revChangeIn", type: "number($double)", desc: "Revenue change (inception)" },
      { name: "sharesOutstanding", type: "number($double)", desc: "Total shares outstanding" },
      { name: "marketCapFloat", type: "number($double)", desc: "Float market cap" },
      { name: "marketCap", type: "number($double)", desc: "Total market capitalization" },
      { name: "bookValuePerShare", type: "number($double)", desc: "Book value per share" },
      { name: "shortIntToFloat", type: "number($double)", desc: "Short interest as % of float" },
      { name: "shortIntDayToCover", type: "number($double)", desc: "Days to cover short interest" },
      { name: "divGrowthRate3Year", type: "number($double)", desc: "3-year dividend growth rate" },
      { name: "dividendPayAmount", type: "number($double)", desc: "Most recent dividend pay amount" },
      { name: "dividendPayDate", type: "string", desc: "Most recent dividend pay date" },
      { name: "beta", type: "number($double)", desc: "Beta vs. S&P 500" },
      { name: "vol1DayAvg", type: "number($double)", desc: "1-day average volume" },
      { name: "vol10DayAvg", type: "number($double)", desc: "10-day average volume" },
      { name: "vol3MonthAvg", type: "number($double)", desc: "3-month average volume" },
      { name: "avg10DaysVolume", type: "integer($int64)", desc: "10-day average volume (integer)" },
      { name: "avg1DayVolume", type: "integer($int64)", desc: "1-day average volume (integer)" },
      { name: "avg3MonthVolume", type: "integer($int64)", desc: "3-month average volume (integer)" },
      { name: "declarationDate", type: "string", desc: "Dividend declaration date" },
      { name: "dividendFreq", type: "integer($int32)", desc: "Dividend frequency (times per year)" },
      { name: "eps", type: "number($double)", desc: "Earnings per share" },
      { name: "corpactionDate", type: "string", desc: "Corporate action date" },
      { name: "dtnVolume", type: "integer($int64)", desc: "DTN volume" },
      { name: "nextDividendPayDate", type: "string", desc: "Next dividend pay date" },
      { name: "nextDividendDate", type: "string", desc: "Next dividend date" },
      { name: "fundLeverageFactor", type: "number($double)", desc: "Leveraged fund factor (e.g. 2.0 for a 2× ETF)" },
      { name: "fundStrategy", type: "string", desc: "Fund strategy (A=Active, L=Leveraged, P=Passive, Q=Quantitative, S=Short)" },
    ],
  },
  Fundamental: {
    description: "Fundamentals of a security — sub-object of EquityResponse.fundamental.",
    fields: [
      { name: "avg10DaysVolume", type: "number($double)", desc: "Average 10-day volume" },
      { name: "avg1YearVolume", type: "number($double)", desc: "Average 1-year volume" },
      { name: "declarationDate", type: "string($date-time)", desc: "Declaration date (yyyy-MM-dd'T'HH:mm:ssZ)" },
      { name: "divAmount", type: "number($double)", desc: "Dividend amount (e.g. 0.88)" },
      { name: "divExDate", type: "string($yyyy-MM-dd'T'HH:mm:ssZ)", desc: "Dividend ex-date (e.g. 2021-05-07T00:00:00Z)" },
      { name: "divFreq", type: "DivFreq integer (nullable)", desc: "Dividend frequency: 1=annual, 2=semi-annual, 3=3x/yr, 4=quarterly, 6=every-other-month, 11=11x/yr, 12=monthly" },
      { name: "divPayAmount", type: "number($double)", desc: "Dividend pay amount (e.g. 0.22)" },
      { name: "divPayDate", type: "string($date-time)", desc: "Dividend pay date (yyyy-MM-dd'T'HH:mm:ssZ)" },
      { name: "divYield", type: "number($double)", desc: "Dividend yield (e.g. 0.7)" },
      { name: "eps", type: "number($double)", desc: "Earnings per share (e.g. 4.45645)" },
      { name: "fundLeverageFactor", type: "number($double)", desc: "Fund leverage factor (e.g. -1, 2.0 for 2× ETF)" },
      { name: "fundStrategy", type: "FundStrategy (nullable)", desc: "A=Active | L=Leveraged | P=Passive | Q=Quantitative | S=Short" },
      { name: "nextDivExDate", type: "string($date-time)", desc: "Next dividend ex-date (yyyy-MM-dd'T'HH:mm:ssZ)" },
      { name: "nextDivPayDate", type: "string($date-time)", desc: "Next dividend pay date (yyyy-MM-dd'T'HH:mm:ssZ)" },
      { name: "peRatio", type: "number($double)", desc: "P/E ratio (e.g. 28.599)" },
    ],
  },
  AssetMainType: {
    description: "Enum — the primary asset class of an instrument.",
    fields: [
      { name: "BOND", type: "enum", desc: "Fixed-income bond" },
      { name: "EQUITY", type: "enum", desc: "Stock or ETF" },
      { name: "FOREX", type: "enum", desc: "Foreign exchange pair" },
      { name: "FUTURE", type: "enum", desc: "Futures contract" },
      { name: "FUTURE_OPTION", type: "enum", desc: "Option on a futures contract" },
      { name: "INDEX", type: "enum", desc: "Market index" },
      { name: "MUTUAL_FUND", type: "enum", desc: "Mutual fund" },
      { name: "OPTION", type: "enum", desc: "Equity option" },
    ],
  },
  ContractType: {
    description: "Enum — option contract type.",
    fields: [
      { name: "CALL", type: "enum", desc: "Call option" },
      { name: "PUT", type: "enum", desc: "Put option" },
    ],
  },
  ExpirationType: {
    description: "Enum — how/when the option expires.",
    fields: [
      { name: "M", type: "enum", desc: "Standard monthly expiration" },
      { name: "Q", type: "enum", desc: "Quarterly expiration" },
      { name: "W", type: "enum", desc: "Weekly expiration" },
      { name: "S", type: "enum", desc: "LEAP or special expiration" },
    ],
  },
  SettlementType: {
    description: "Enum — when the option settles relative to expiration.",
    fields: [
      { name: "A", type: "enum", desc: "AM settlement — cash settled at open of expiration day" },
      { name: "P", type: "enum", desc: "PM settlement — settles at close of expiration day" },
    ],
  },
  ExerciseType: {
    description: "Enum — option exercise style.",
    fields: [
      { name: "A", type: "enum", desc: "American — can exercise any time before expiration" },
      { name: "E", type: "enum", desc: "European — can only exercise at expiration" },
    ],
  },
  DivFreq: {
    description: "Enum — how often dividends are paid.",
    fields: [
      { name: "ANNUAL", type: "enum", desc: "Once per year" },
      { name: "MONTHLY", type: "enum", desc: "Every month" },
      { name: "QUARTERLY", type: "enum", desc: "Every quarter" },
      { name: "SEMI_ANNUAL", type: "enum", desc: "Twice per year" },
      { name: "UNKNOWN", type: "enum", desc: "Unknown frequency" },
    ],
  },
  QuoteType: {
    description: "Enum — the type/source of the quote.",
    fields: [
      { name: "NBBO", type: "enum", desc: "National Best Bid and Offer" },
      { name: "NFL", type: "enum", desc: "Non-NMS firm limit order" },
    ],
  },
  ErrorResponse: {
    description: "Top-level error response object.",
    fields: [
      { name: "errors", type: "Error[]", desc: "Array of error objects" },
    ],
  },
  Error: {
    description: "A single error object in an error response.",
    fields: [
      { name: "id", type: "string", desc: "Unique error ID for tracing" },
      { name: "status", type: "string", desc: "HTTP status code as string" },
      { name: "title", type: "string", desc: "Short error title" },
      { name: "detail", type: "string", desc: "Detailed error message" },
      { name: "source", type: "ErrorSource", desc: "Source of the error (parameter, etc.)" },
    ],
  },
  ErrorSource: {
    description: "Points to the source responsible for triggering the error.",
    fields: [
      { name: "pointer", type: "string", desc: "JSON pointer to the erroneous field" },
      { name: "parameter", type: "string", desc: "Query parameter that caused the error" },
      { name: "header", type: "string", desc: "Request header that caused the error" },
    ],
  },
  QuoteResponse: {
    description: "Top-level response from the Quotes endpoint — dynamic map keyed by symbol.",
    fields: [
      { name: "< * >", type: "QuoteResponseObject", desc: "Each key is a symbol (e.g. SCHWAB); value is a QuoteResponseObject" },
    ],
  },
  QuoteResponseObject: {
    description: "oneOf: EquityResponse | OptionResponse | ForexResponse | FutureResponse | FutureOptionResponse | IndexResponse | MutualFundResponse | QuoteError",
    fields: [
      { name: "(oneOf)", type: "EquityResponse", desc: "When assetMainType = EQUITY" },
      { name: "(oneOf)", type: "OptionResponse", desc: "When assetMainType = OPTION" },
      { name: "(oneOf)", type: "ForexResponse", desc: "When assetMainType = FOREX" },
      { name: "(oneOf)", type: "FutureResponse", desc: "When assetMainType = FUTURE" },
      { name: "(oneOf)", type: "FutureOptionResponse", desc: "When assetMainType = FUTURE_OPTION" },
      { name: "(oneOf)", type: "IndexResponse", desc: "When assetMainType = INDEX" },
      { name: "(oneOf)", type: "MutualFundResponse", desc: "When assetMainType = MUTUAL_FUND" },
      { name: "(oneOf)", type: "QuoteError", desc: "When the symbol lookup failed" },
    ],
  },
  RegularMarket: {
    description: "Regular market session data for a security.",
    fields: [
      { name: "regularMarketLastPrice", type: "number($double)", desc: "Regular market last price" },
      { name: "regularMarketLastSize", type: "integer($int32)", desc: "Regular market last size" },
      { name: "regularMarketNetChange", type: "number($double)", desc: "Regular market net change" },
      { name: "regularMarketPercentChange", type: "number($double)", desc: "Regular market percent change" },
      { name: "regularMarketTradeTime", type: "integer($int64)", desc: "Regular market trade time (ms since epoch)" },
    ],
  },
  ExtendedMarket: {
    description: "Quote data for extended (pre/after) market hours.",
    fields: [
      { name: "askPrice", type: "number($double)", desc: "Extended market ask price" },
      { name: "askSize", type: "integer($int32)", desc: "Extended market ask size" },
      { name: "bidPrice", type: "number($double)", desc: "Extended market bid price" },
      { name: "bidSize", type: "integer($int32)", desc: "Extended market bid size" },
      { name: "lastPrice", type: "number($double)", desc: "Extended market last price" },
      { name: "lastSize", type: "integer($int32)", desc: "Regular market last size (also shown here)" },
      { name: "mark", type: "number($double)", desc: "Mark price" },
      { name: "quoteTime", type: "integer($int64)", desc: "Extended market quote time (ms since epoch)" },
      { name: "totalVolume", type: "number($int64)", desc: "Total volume" },
      { name: "tradeTime", type: "integer($int64)", desc: "Extended market trade time (ms since epoch)" },
    ],
  },
  ReferenceEquity: {
    description: "Static reference data for an equity security.",
    fields: [
      { name: "cusip", type: "string", desc: "CUSIP of instrument (e.g. A23456789)" },
      { name: "description", type: "string", desc: "Description of instrument (e.g. Apple Inc. - Common Stock)" },
      { name: "exchange", type: "string", desc: "Exchange code (e.g. q)" },
      { name: "exchangeName", type: "string", desc: "Exchange full name" },
      { name: "fsiDesc", type: "string (maxLength: 50)", desc: "FSI description" },
      { name: "htbQuantity", type: "integer($int32)", desc: "Hard-to-borrow quantity" },
      { name: "htbRate", type: "number($double)", desc: "Hard-to-borrow rate" },
      { name: "isHardToBorrow", type: "boolean", desc: "Whether the security is hard to borrow" },
      { name: "isShortable", type: "boolean", desc: "Whether the security is shortable" },
      { name: "otcMarketTier", type: "string (maxLength: 10)", desc: "OTC market tier (if applicable)" },
    ],
  },
  ReferenceOption: {
    description: "Static reference data for an option contract in a quote response.",
    fields: [
      { name: "contractType", type: "ContractType", desc: "CALL or PUT" },
      { name: "cusip", type: "string", desc: "CUSIP identifier" },
      { name: "daysToExpiration", type: "integer", desc: "Days to expiration" },
      { name: "deliverables", type: "string", desc: "What the option delivers" },
      { name: "description", type: "string", desc: "Human-readable description" },
      { name: "exchange", type: "string", desc: "Exchange code" },
      { name: "exchangeName", type: "string", desc: "Exchange full name" },
      { name: "exerciseType", type: "ExerciseType", desc: "A (American) or E (European)" },
      { name: "expirationDay", type: "integer", desc: "Day of expiration" },
      { name: "expirationMonth", type: "integer", desc: "Month of expiration" },
      { name: "expirationYear", type: "integer", desc: "Year of expiration" },
      { name: "expirationType", type: "ExpirationType", desc: "W | M | Q | S" },
      { name: "isPennyPilot", type: "boolean", desc: "Whether in penny pilot program" },
      { name: "lastTradingDay", type: "integer($int64)", desc: "Last trading day (ms since epoch)" },
      { name: "multiplier", type: "number", desc: "Contract multiplier (typically 100)" },
      { name: "settlementType", type: "SettlementType", desc: "A (AM) or P (PM)" },
      { name: "strikePrice", type: "number", desc: "Strike price" },
      { name: "underlying", type: "string", desc: "Underlying symbol" },
    ],
  },
  OptionDeliverables: {
    description: "What an option contract delivers upon exercise/assignment.",
    fields: [
      { name: "symbol", type: "string", desc: "Deliverable symbol" },
      { name: "assetType", type: "string", desc: "Type of deliverable asset" },
      { name: "deliverableUnits", type: "number", desc: "Number of units delivered" },
      { name: "currencyType", type: "string", desc: "Currency type" },
    ],
  },
  EquityAssetSubType: {
    description: "Enum — equity sub-type classification.",
    fields: [
      { name: "COE", type: "enum", desc: "Common or ordinary equity" },
      { name: "PRF", type: "enum", desc: "Preferred equity" },
      { name: "ADR", type: "enum", desc: "American Depositary Receipt" },
      { name: "GDR", type: "enum", desc: "Global Depositary Receipt" },
      { name: "CEF", type: "enum", desc: "Closed-end fund" },
      { name: "ETF", type: "enum", desc: "Exchange-traded fund" },
      { name: "ETN", type: "enum", desc: "Exchange-traded note" },
      { name: "UIT", type: "enum", desc: "Unit investment trust" },
      { name: "WAR", type: "enum", desc: "Warrant" },
      { name: "RGT", type: "enum", desc: "Right" },
    ],
  },
  MutualFundAssetSubType: {
    description: "Enum — mutual fund sub-type.",
    fields: [
      { name: "OEF", type: "enum", desc: "Open-end fund" },
      { name: "CEF", type: "enum", desc: "Closed-end fund" },
      { name: "MMF", type: "enum", desc: "Money market fund" },
    ],
  },
  FundStrategy: {
    description: "Enum — fund investment strategy.",
    fields: [
      { name: "A", type: "enum", desc: "Active" },
      { name: "L", type: "enum", desc: "Leveraged" },
      { name: "P", type: "enum", desc: "Passive" },
      { name: "Q", type: "enum", desc: "Quantitative" },
      { name: "S", type: "enum", desc: "Short" },
    ],
  },
  Bond: {
    description: "Bond instrument data — extends base Instrument with bond-specific fields.",
    fields: [
      { name: "cusip", type: "string", desc: "CUSIP identifier" },
      { name: "symbol", type: "string", desc: "Symbol" },
      { name: "description", type: "string", desc: "Bond description" },
      { name: "exchange", type: "string", desc: "Exchange" },
      { name: "assetType", type: "enum", desc: "BOND | EQUITY | ETF | EXTENDED | FOREX | FUTURE | FUTURE_OPTION | FUNDAMENTAL | INDEX | INDICATOR | MUTUAL_FUND | OPTION | UNKNOWN" },
      { name: "bondFactor", type: "string", desc: "Bond factor" },
      { name: "bondMultiplier", type: "string", desc: "Bond multiplier" },
      { name: "bondPrice", type: "number", desc: "Bond price" },
      { name: "type", type: "enum (writeOnly)", desc: "BOND | EQUITY | ETF | EXTENDED | FOREX | FUTURE | FUTURE_OPTION | FUNDAMENTAL | INDEX | INDICATOR | MUTUAL_FUND | OPTION | UNKNOWN" },
    ],
  },

  // ---------------------------------------------------------------------------
  // Response wrappers (one per asset type)
  // ---------------------------------------------------------------------------

  OptionResponse: {
    description: "Top-level quote response for an option security.",
    fields: [
      { name: "assetMainType", type: "AssetMainType", desc: "OPTION" },
      { name: "ssid", type: "integer($int64)", desc: "SSID of instrument" },
      { name: "symbol", type: "string", desc: "OCC option symbol" },
      { name: "realtime", type: "boolean", desc: "Whether quote is real-time" },
      { name: "quote", type: "QuoteOption", desc: "Option quote data (greeks, bid/ask, IV, etc.)" },
      { name: "reference", type: "ReferenceOption", desc: "Static reference data (strike, expiry, type, etc.)" },
    ],
  },
  ForexResponse: {
    description: "Top-level quote response for a Forex security.",
    fields: [
      { name: "assetMainType", type: "AssetMainType", desc: "FOREX" },
      { name: "ssid", type: "integer($int64)", desc: "SSID of instrument" },
      { name: "symbol", type: "string", desc: "Forex pair symbol" },
      { name: "realtime", type: "boolean", desc: "Whether quote is real-time" },
      { name: "quote", type: "QuoteForex", desc: "Forex quote data" },
      { name: "reference", type: "ReferenceForex", desc: "Forex reference data" },
    ],
  },
  FutureResponse: {
    description: "Top-level quote response for a Future security.",
    fields: [
      { name: "assetMainType", type: "AssetMainType", desc: "FUTURE" },
      { name: "ssid", type: "integer($int64)", desc: "SSID of instrument" },
      { name: "symbol", type: "string", desc: "Futures symbol" },
      { name: "realtime", type: "boolean", desc: "Whether quote is real-time" },
      { name: "quote", type: "QuoteFuture", desc: "Futures quote data" },
      { name: "reference", type: "ReferenceFuture", desc: "Futures reference data" },
    ],
  },
  FutureOptionResponse: {
    description: "Top-level quote response for a Future Option security.",
    fields: [
      { name: "assetMainType", type: "AssetMainType", desc: "FUTURE_OPTION" },
      { name: "ssid", type: "integer($int64)", desc: "SSID of instrument" },
      { name: "symbol", type: "string", desc: "Future option symbol" },
      { name: "realtime", type: "boolean", desc: "Whether quote is real-time" },
      { name: "quote", type: "QuoteFutureOption", desc: "Future option quote data" },
      { name: "reference", type: "ReferenceFutureOption", desc: "Future option reference data" },
    ],
  },
  IndexResponse: {
    description: "Top-level quote response for an Index security.",
    fields: [
      { name: "assetMainType", type: "AssetMainType", desc: "INDEX" },
      { name: "ssid", type: "integer($int64)", desc: "SSID of instrument" },
      { name: "symbol", type: "string", desc: "Index symbol (e.g. $SPX)" },
      { name: "realtime", type: "boolean", desc: "Whether quote is real-time" },
      { name: "quote", type: "QuoteIndex", desc: "Index quote data" },
      { name: "reference", type: "ReferenceIndex", desc: "Index reference data" },
    ],
  },
  MutualFundResponse: {
    description: "Top-level quote response for a Mutual Fund security.",
    fields: [
      { name: "assetMainType", type: "AssetMainType", desc: "MUTUAL_FUND" },
      { name: "assetSubType", type: "MutualFundAssetSubType", desc: "OEF | CEF | MMF" },
      { name: "ssid", type: "integer($int64)", desc: "SSID of instrument" },
      { name: "symbol", type: "string", desc: "Fund symbol" },
      { name: "realtime", type: "boolean", desc: "Whether quote is real-time" },
      { name: "fundamental", type: "Fundamental", desc: "Fundamental data (dividends, P/E, etc.)" },
      { name: "quote", type: "QuoteMutualFund", desc: "Mutual fund quote data" },
      { name: "reference", type: "ReferenceMutualFund", desc: "Mutual fund reference data" },
    ],
  },

  // ---------------------------------------------------------------------------
  // Quote sub-objects (by asset type)
  // ---------------------------------------------------------------------------

  QuoteForex: {
    description: "Quote data for a Forex security.",
    fields: [
      { name: "52WeekHigh", type: "number($double)", desc: "52-week high" },
      { name: "52WeekLow", type: "number($double)", desc: "52-week low" },
      { name: "askPrice", type: "number($double)", desc: "Ask price" },
      { name: "askSize", type: "integer($int32)", desc: "Ask size" },
      { name: "bidPrice", type: "number($double)", desc: "Bid price" },
      { name: "bidSize", type: "integer($int32)", desc: "Bid size" },
      { name: "closePrice", type: "number($double)", desc: "Previous close" },
      { name: "highPrice", type: "number($double)", desc: "Day's high" },
      { name: "lastPrice", type: "number($double)", desc: "Last price" },
      { name: "lastSize", type: "integer($int32)", desc: "Last trade size" },
      { name: "lowPrice", type: "number($double)", desc: "Day's low" },
      { name: "mark", type: "number($double)", desc: "Mark price" },
      { name: "netChange", type: "number($double)", desc: "Net change" },
      { name: "netPercentChange", type: "number($double)", desc: "Net % change" },
      { name: "openPrice", type: "number($double)", desc: "Opening price" },
      { name: "quoteTime", type: "integer($int64)", desc: "Quote time (ms since epoch)" },
      { name: "securityStatus", type: "string", desc: "Security status" },
      { name: "tick", type: "number($double)", desc: "Tick size" },
      { name: "tickAmount", type: "number($double)", desc: "Tick amount" },
      { name: "totalVolume", type: "integer($int64)", desc: "Total volume" },
      { name: "tradeTime", type: "integer($int64)", desc: "Trade time (ms since epoch)" },
    ],
  },
  QuoteFuture: {
    description: "Quote data for a Future security.",
    fields: [
      { name: "askMICId", type: "string", desc: "Ask MIC code" },
      { name: "askPrice", type: "number($double)", desc: "Ask price" },
      { name: "askSize", type: "integer($int32)", desc: "Ask size" },
      { name: "askTime", type: "integer($int64)", desc: "Ask time (ms since epoch)" },
      { name: "bidMICId", type: "string", desc: "Bid MIC code" },
      { name: "bidPrice", type: "number($double)", desc: "Bid price" },
      { name: "bidSize", type: "integer($int32)", desc: "Bid size" },
      { name: "bidTime", type: "integer($int64)", desc: "Bid time (ms since epoch)" },
      { name: "closePrice", type: "number($double)", desc: "Previous close / settlement price" },
      { name: "futurePercentChange", type: "number($double)", desc: "Futures % change" },
      { name: "highPrice", type: "number($double)", desc: "Day's high" },
      { name: "lastMICId", type: "string", desc: "Last trade MIC code" },
      { name: "lastPrice", type: "number($double)", desc: "Last traded price" },
      { name: "lastSize", type: "integer($int32)", desc: "Last trade size" },
      { name: "lowPrice", type: "number($double)", desc: "Day's low" },
      { name: "mark", type: "number($double)", desc: "Mark price" },
      { name: "netChange", type: "number($double)", desc: "Net change" },
      { name: "openInterest", type: "integer($int64)", desc: "Open interest" },
      { name: "openPrice", type: "number($double)", desc: "Opening price" },
      { name: "quoteTime", type: "integer($int64)", desc: "Quote time (ms since epoch)" },
      { name: "quotedInSession", type: "boolean", desc: "Whether quoted in current session" },
      { name: "securityStatus", type: "string", desc: "Security status" },
      { name: "settleTime", type: "integer($int64)", desc: "Settlement time (ms since epoch)" },
      { name: "tick", type: "number($double)", desc: "Tick size" },
      { name: "tickAmount", type: "number($double)", desc: "Tick amount in dollars" },
      { name: "totalVolume", type: "integer($int64)", desc: "Total volume" },
      { name: "tradeTime", type: "integer($int64)", desc: "Trade time (ms since epoch)" },
    ],
  },
  QuoteFutureOption: {
    description: "Quote data for a Future Option security.",
    fields: [
      { name: "askMICId", type: "string", desc: "Ask MIC code" },
      { name: "askPrice", type: "number($double)", desc: "Ask price" },
      { name: "askSize", type: "integer($int32)", desc: "Ask size" },
      { name: "bidMICId", type: "string", desc: "Bid MIC code" },
      { name: "bidPrice", type: "number($double)", desc: "Bid price" },
      { name: "bidSize", type: "integer($int32)", desc: "Bid size" },
      { name: "closePrice", type: "number($double)", desc: "Previous close" },
      { name: "highPrice", type: "number($double)", desc: "Day's high" },
      { name: "lastMICId", type: "string", desc: "Last trade MIC code" },
      { name: "lastPrice", type: "number($double)", desc: "Last traded price" },
      { name: "lastSize", type: "integer($int32)", desc: "Last trade size" },
      { name: "lowPrice", type: "number($double)", desc: "Day's low" },
      { name: "mark", type: "number($double)", desc: "Mark price" },
      { name: "markChange", type: "number($double)", desc: "Mark change" },
      { name: "netChange", type: "number($double)", desc: "Net change" },
      { name: "netPercentChange", type: "number($double)", desc: "Net % change" },
      { name: "openInterest", type: "integer($int64)", desc: "Open interest" },
      { name: "openPrice", type: "number($double)", desc: "Opening price" },
      { name: "quoteTime", type: "integer($int64)", desc: "Quote time (ms since epoch)" },
      { name: "securityStatus", type: "string", desc: "Security status" },
      { name: "settlemetPrice", type: "number($double)", desc: "Settlement price (note: portal spells it 'settlemetPrice')" },
      { name: "tick", type: "number($double)", desc: "Tick size" },
      { name: "tickAmount", type: "number($double)", desc: "Tick amount" },
      { name: "totalVolume", type: "integer($int64)", desc: "Total volume" },
      { name: "tradeTime", type: "integer($int64)", desc: "Trade time (ms since epoch)" },
    ],
  },
  QuoteIndex: {
    description: "Quote data for an Index security.",
    fields: [
      { name: "52WeekHigh", type: "number($double)", desc: "52-week high" },
      { name: "52WeekLow", type: "number($double)", desc: "52-week low" },
      { name: "closePrice", type: "number($double)", desc: "Previous close" },
      { name: "highPrice", type: "number($double)", desc: "Day's high" },
      { name: "lastPrice", type: "number($double)", desc: "Last value" },
      { name: "lowPrice", type: "number($double)", desc: "Day's low" },
      { name: "netChange", type: "number($double)", desc: "Net change" },
      { name: "netPercentChange", type: "number($double)", desc: "Net % change" },
      { name: "openPrice", type: "number($double)", desc: "Opening value" },
      { name: "securityStatus", type: "string", desc: "Security status" },
      { name: "totalVolume", type: "integer($int64)", desc: "Total volume" },
      { name: "tradeTime", type: "integer($int64)", desc: "Trade time (ms since epoch)" },
    ],
  },
  QuoteMutualFund: {
    description: "Quote data for a Mutual Fund security.",
    fields: [
      { name: "52WeekHigh", type: "number($double)", desc: "52-week high NAV" },
      { name: "52WeekLow", type: "number($double)", desc: "52-week low NAV" },
      { name: "closePrice", type: "number($double)", desc: "Previous close NAV" },
      { name: "nAV", type: "number($double)", desc: "Net Asset Value (current NAV)" },
      { name: "netChange", type: "number($double)", desc: "NAV change" },
      { name: "netPercentChange", type: "number($double)", desc: "NAV % change" },
      { name: "securityStatus", type: "string", desc: "Security status" },
      { name: "totalVolume", type: "integer($int64)", desc: "Total volume" },
      { name: "tradeTime", type: "integer($int64)", desc: "Trade time (ms since epoch)" },
    ],
  },
  QuoteRequest: {
    description: "Request body for POST /quotes — allows bulk quote requests by symbol, CUSIP, or SSID.",
    fields: [
      { name: "cusips", type: "string[]", desc: "List of CUSIPs to quote" },
      { name: "fields", type: "string", desc: "Comma-separated field groups: quote, fundamental, extended, reference, regular" },
      { name: "ssids", type: "integer[]", desc: "List of SSIDs to quote" },
      { name: "symbols", type: "string[]", desc: "List of symbols to quote" },
      { name: "realtime", type: "boolean", desc: "Whether to request real-time quotes" },
      { name: "indicative", type: "boolean", desc: "Whether to include indicative symbol quotes" },
    ],
  },
  QuoteError: {
    description: "Partial or custom errors per request — returned for symbols that could not be quoted.",
    fields: [
      { name: "invalidCusips", type: "string[]", desc: "CUSIPs that were invalid or not found" },
      { name: "invalidSSIDs", type: "integer[]", desc: "SSIDs that were invalid or not found" },
      { name: "invalidSymbols", type: "string[]", desc: "Symbols that were invalid or not found" },
    ],
  },

  // ---------------------------------------------------------------------------
  // Reference sub-objects (by asset type)
  // ---------------------------------------------------------------------------

  ReferenceForex: {
    description: "Static reference data for a Forex security.",
    fields: [
      { name: "description", type: "string", desc: "Currency pair description" },
      { name: "exchange", type: "string", desc: "Exchange code" },
      { name: "exchangeName", type: "string", desc: "Exchange full name" },
      { name: "isTradable", type: "boolean", desc: "Whether tradable" },
      { name: "marketMaker", type: "string", desc: "Market maker identifier" },
      { name: "product", type: "string", desc: "Product code" },
      { name: "tradingHours", type: "string", desc: "Trading hours description" },
    ],
  },
  ReferenceFuture: {
    description: "Static reference data for a Future security.",
    fields: [
      { name: "description", type: "string", desc: "Contract description" },
      { name: "exchange", type: "string", desc: "Exchange code" },
      { name: "exchangeName", type: "string", desc: "Exchange full name" },
      { name: "futureActiveSymbol", type: "string", desc: "Active (front-month) contract symbol" },
      { name: "futureExpirationDate", type: "integer($int64)", desc: "Expiration date (ms since epoch)" },
      { name: "futureIsActive", type: "boolean", desc: "Whether this is the active contract" },
      { name: "futureMultiplier", type: "number($double)", desc: "Contract multiplier (e.g. 50 for ES)" },
      { name: "futurePriceFormat", type: "string", desc: "Price format string" },
      { name: "futureSettlementPrice", type: "number($double)", desc: "Settlement price" },
      { name: "futureTradingHours", type: "string", desc: "Trading hours" },
      { name: "product", type: "string", desc: "Product code (e.g. /ES)" },
    ],
  },
  ReferenceFutureOption: {
    description: "Static reference data for a Future Option security.",
    fields: [
      { name: "contractType", type: "ContractType", desc: "CALL or PUT" },
      { name: "description", type: "string", desc: "Contract description" },
      { name: "exchange", type: "string", desc: "Exchange code" },
      { name: "exchangeName", type: "string", desc: "Exchange full name" },
      { name: "multiplier", type: "number($double)", desc: "Contract multiplier" },
      { name: "expirationDate", type: "integer($int64)", desc: "Expiration date (ms since epoch)" },
      { name: "expirationStyle", type: "string", desc: "Expiration style (American / European)" },
      { name: "strikePrice", type: "number($double)", desc: "Strike price" },
      { name: "underlying", type: "string", desc: "Underlying futures symbol" },
    ],
  },
  ReferenceIndex: {
    description: "Static reference data for an Index security.",
    fields: [
      { name: "description", type: "string", desc: "Index description" },
      { name: "exchange", type: "string", desc: "Exchange code" },
      { name: "exchangeName", type: "string", desc: "Exchange full name" },
    ],
  },
  ReferenceMutualFund: {
    description: "Static reference data for a Mutual Fund security.",
    fields: [
      { name: "cusip", type: "string", desc: "CUSIP identifier" },
      { name: "description", type: "string", desc: "Fund description" },
      { name: "exchange", type: "string", desc: "Exchange code" },
      { name: "exchangeName", type: "string", desc: "Exchange full name" },
    ],
  },
};

// Schemas listed in the developer portal that don't have a full definition above
const ALL_SCHEMA_NAMES: string[] = [
  "Bond","FundamentalInst","Instrument","InstrumentResponse","Hours",
  "Interval","Screener","Candle","CandleList","EquityResponse","QuoteError",
  "ExtendedMarket","ForexResponse","Fundamental","FutureOptionResponse",
  "FutureResponse","IndexResponse","MutualFundResponse","OptionResponse",
  "QuoteEquity","QuoteForex","QuoteFuture","QuoteFutureOption","QuoteIndex",
  "QuoteMutualFund","QuoteOption","QuoteRequest","QuoteResponse",
  "QuoteResponseObject","ReferenceEquity","ReferenceForex","ReferenceFuture",
  "ReferenceFutureOption","ReferenceIndex","ReferenceMutualFund",
  "ReferenceOption","RegularMarket","AssetMainType","EquityAssetSubType",
  "MutualFundAssetSubType","ContractType","SettlementType","ExpirationType",
  "FundStrategy","ExerciseType","DivFreq","QuoteType","ErrorResponse",
  "Error","ErrorSource","OptionChain","OptionContractMap","Underlying",
  "OptionDeliverables","OptionContract","ExpirationChain","Expiration",
];

// ---------------------------------------------------------------------------
// JSON syntax highlighter
// ---------------------------------------------------------------------------

function syntaxHighlight(json: string, isDark: boolean): string {
  const colors = {
    key: "#44c1c1",
    string: isDark ? "#86efac" : "#15803d",
    number: isDark ? "#fbbf24" : "#b45309",
    boolean: isDark ? "#a78bfa" : "#7c3aed",
    null: isDark ? "#94a3b8" : "#6b7280",
    punctuation: isDark ? "#e5e5e5" : "#374151",
  };

  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let color = colors.number;
      if (/^"/.test(match)) {
        color = /:$/.test(match) ? colors.key : colors.string;
      } else if (/true|false/.test(match)) {
        color = colors.boolean;
      } else if (/null/.test(match)) {
        color = colors.null;
      }
      return `<span style="color:${color}">${match}</span>`;
    }
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type Props = { theme: Theme; sidebarWidth: number };

const HEADER_H = 68;
const LEFT_RAIL_W = 268;

export function Schwab({ theme: t, sidebarWidth }: Props) {
  const [leftTab, setLeftTab] = useState<"endpoints" | "schemas">("endpoints");
  const [selectedEndpointId, setSelectedEndpointId] = useState("quotes");
  const [params, setParams] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [selectedSchema, setSelectedSchema] = useState("QuoteEquity");
  const [schemaSearch, setSchemaSearch] = useState("");
  const [endpointSearch, setEndpointSearch] = useState("");

  const selectedEndpoint = ENDPOINTS.find((e) => e.id === selectedEndpointId)!;

  const handleEndpointSelect = (id: string) => {
    setSelectedEndpointId(id);
    setParams({});
    setResponse(null);
    setStatusCode(null);
    setElapsed(null);
  };

  const handleRun = async () => {
    let path = selectedEndpoint.pathTemplate;
    const queryParams: Record<string, string> = {};

    // Build a lookup of param name → paramDef for type-aware conversion
    const paramDefByName = Object.fromEntries(
      selectedEndpoint.params.map((p) => [p.name, p])
    );

    for (const [key, value] of Object.entries(params)) {
      if (!value) continue;
      if (selectedEndpoint.pathParamNames?.includes(key)) {
        path = path.replace(`{${key}}`, encodeURIComponent(value));
      } else {
        // date-ms: Schwab pricehistory requires epoch milliseconds, not date strings
        if (paramDefByName[key]?.type === "date-ms") {
          const ms = new Date(value).getTime();
          queryParams[key] = Number.isFinite(ms) ? String(ms) : value;
        } else {
          queryParams[key] = value;
        }
      }
    }

    // If path still has unresolved params, warn
    if (path.includes("{")) {
      const required = selectedEndpoint.params.find(
        (p) => selectedEndpoint.pathParamNames?.includes(p.name) && p.required
      );
      if (required) {
        setResponse(JSON.stringify({ error: `Missing required path parameter: ${required.name}` }, null, 2));
        setStatusCode(400);
        return;
      }
    }

    setLoading(true);
    setResponse(null);
    setStatusCode(null);
    const start = Date.now();

    try {
      const resp = await fetch(`${SCHWAB_API_BASE}/api/schwab`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "explorer", explorePath: path, explorerParams: queryParams }),
      });
      setStatusCode(resp.status);
      const text = await resp.text();
      try {
        setResponse(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResponse(text);
      }
    } catch (err) {
      setResponse(JSON.stringify({ error: String(err) }, null, 2));
      setStatusCode(null);
    } finally {
      setElapsed(Date.now() - start);
      setLoading(false);
    }
  };

  const hasRequired = selectedEndpoint.params
    .filter((p) => p.required)
    .every((p) => params[p.name] && params[p.name].trim() !== "");

  // Group endpoints by category
  const categories = Array.from(new Set(ENDPOINTS.map((e) => e.category)));
  const filteredEndpoints = ENDPOINTS.filter(
    (e) =>
      !endpointSearch ||
      e.label.toLowerCase().includes(endpointSearch.toLowerCase()) ||
      e.category.toLowerCase().includes(endpointSearch.toLowerCase())
  );

  const filteredSchemas = ALL_SCHEMA_NAMES.filter(
    (s) => !schemaSearch || s.toLowerCase().includes(schemaSearch.toLowerCase())
  );

  const currentSchemaDef = SCHEMA_DEFS[selectedSchema];

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const pageStyle: CSSProperties = {
    width: "100%",
    minHeight: "100vh",
    fontFamily: t.typography.fontFamily,
    color: t.colors.text,
    position: "relative",
  };

  const headerStyle: CSSProperties = {
    position: "fixed",
    left: sidebarWidth,
    right: 0,
    top: 0,
    height: HEADER_H,
    backgroundColor: t.colors.surface,
    borderBottom: `1px solid ${t.colors.border}`,
    padding: `0 ${t.spacing(8)}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 8,
  };

  const leftRailStyle: CSSProperties = {
    position: "fixed",
    left: sidebarWidth,
    top: HEADER_H,
    width: LEFT_RAIL_W,
    height: `calc(100vh - ${HEADER_H}px)`,
    borderRight: `1px solid ${t.colors.border}`,
    backgroundColor: t.colors.surface,
    display: "flex",
    flexDirection: "column",
    zIndex: 6,
    overflow: "hidden",
  };

  const mainStyle: CSSProperties = {
    marginTop: HEADER_H,
    marginLeft: LEFT_RAIL_W,
    minHeight: `calc(100vh - ${HEADER_H}px)`,
    padding: `${t.spacing(6)} ${t.spacing(8)}`,
    backgroundColor: t.colors.background,
    boxSizing: "border-box",
  };

  const tabBarStyle: CSSProperties = {
    display: "flex",
    borderBottom: `1px solid ${t.colors.border}`,
    flexShrink: 0,
  };

  const tabStyle = (active: boolean): CSSProperties => ({
    flex: 1,
    padding: `${t.spacing(3)} ${t.spacing(2)}`,
    border: "none",
    background: "none",
    cursor: "pointer",
    fontSize: "0.8rem",
    fontWeight: active ? 700 : 500,
    color: active ? t.colors.primary : t.colors.textMuted,
    fontFamily: t.typography.fontFamily,
    borderBottom: active ? `2px solid ${t.colors.primary}` : "2px solid transparent",
    marginBottom: -1,
    transition: "color 0.15s, border-color 0.15s",
  });

  const searchStyle: CSSProperties = {
    margin: `${t.spacing(2)} ${t.spacing(2)} 0`,
    padding: `${t.spacing(1.5)} ${t.spacing(2)}`,
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.background,
    color: t.colors.text,
    fontSize: "0.8rem",
    fontFamily: t.typography.fontFamily,
    width: `calc(100% - ${t.spacing(4)})`,
    outline: "none",
    boxSizing: "border-box",
  };

  const railListStyle: CSSProperties = {
    flex: 1,
    overflowY: "auto",
    padding: `${t.spacing(2)} ${t.spacing(2)} ${t.spacing(3)}`,
    scrollbarWidth: "none",
  };

  const categoryLabelStyle: CSSProperties = {
    fontSize: "0.7rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: t.colors.textMuted,
    padding: `${t.spacing(3)} ${t.spacing(1)} ${t.spacing(1)}`,
  };

  const endpointBtnStyle = (active: boolean): CSSProperties => ({
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: `${t.spacing(2)} ${t.spacing(2)}`,
    border: "none",
    borderRadius: t.radius.sm,
    backgroundColor: active ? `${t.colors.primary}18` : "transparent",
    color: active ? t.colors.primary : t.colors.text,
    fontSize: "0.875rem",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    fontFamily: t.typography.fontFamily,
    transition: "background-color 0.12s, color 0.12s",
  });

  const schemaBtnStyle = (active: boolean): CSSProperties => ({
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: `${t.spacing(1.5)} ${t.spacing(2)}`,
    border: "none",
    borderRadius: t.radius.sm,
    backgroundColor: active ? `${t.colors.primary}18` : "transparent",
    color: active ? t.colors.primary : t.colors.text,
    fontSize: "0.8rem",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background-color 0.12s",
  });

  const cardStyle: CSSProperties = {
    backgroundColor: t.colors.surface,
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.lg,
    padding: t.spacing(5),
    marginBottom: t.spacing(4),
  };

  const labelStyle: CSSProperties = {
    display: "block",
    fontSize: "0.775rem",
    fontWeight: 600,
    color: t.colors.textMuted,
    marginBottom: t.spacing(1),
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.background,
    color: t.colors.text,
    fontSize: "0.875rem",
    fontFamily: t.typography.fontFamily,
    outline: "none",
    boxSizing: "border-box",
  };

  const selectStyle: CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
  };

  const statusBadgeStyle = (code: number): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: t.spacing(1),
    padding: `${t.spacing(0.5)} ${t.spacing(2)}`,
    borderRadius: t.radius.sm,
    fontSize: "0.75rem",
    fontWeight: 700,
    backgroundColor:
      code >= 200 && code < 300
        ? `${t.colors.success}22`
        : code >= 400
        ? `${t.colors.danger}22`
        : `${t.colors.primary}22`,
    color:
      code >= 200 && code < 300
        ? t.colors.success
        : code >= 400
        ? t.colors.danger
        : t.colors.primary,
  });

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderParamField = (p: ParamDef) => (
    <div key={p.name} style={{ marginBottom: t.spacing(4) }}>
      <label style={labelStyle}>
        {p.label}
        {p.required && <span style={{ color: t.colors.danger, marginLeft: 3 }}>*</span>}
      </label>
      {p.type === "select" ? (
        <select
          style={selectStyle}
          value={params[p.name] ?? ""}
          onChange={(e) => setParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
        >
          {p.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : p.type === "date" || p.type === "date-ms" ? (
        <div>
          <input
            type="date"
            style={inputStyle}
            value={params[p.name] ?? ""}
            onChange={(e) => setParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
          />
          {p.type === "date-ms" && params[p.name] && (
            <span style={{ fontSize: "0.7rem", color: t.colors.textMuted, marginTop: 3, display: "block" }}>
              → {new Date(params[p.name]).getTime()} ms
            </span>
          )}
        </div>
      ) : (
        <input
          type="text"
          style={inputStyle}
          placeholder={p.placeholder}
          value={params[p.name] ?? ""}
          onChange={(e) => setParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
        />
      )}
      {p.description && (
        <p style={{ margin: `${t.spacing(1)} 0 0`, fontSize: "0.75rem", color: t.colors.textMuted }}>
          {p.description}
        </p>
      )}
    </div>
  );

  const responseHighlighted =
    response && syntaxHighlight(response, t.mode === "dark");

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <div style={pageStyle}>
      {/* ── Header ── */}
      <div style={headerStyle}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: t.colors.text }}>
            Schwab API Explorer
          </h1>
          <p style={{ margin: 0, fontSize: "0.775rem", color: t.colors.textMuted, marginTop: 2 }}>
            Test any Schwab Market Data endpoint and browse response schemas
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: t.spacing(3) }}>
          <div
            style={{
              fontSize: "0.75rem",
              color: t.colors.textMuted,
              background: t.colors.background,
              border: `1px solid ${t.colors.border}`,
              borderRadius: t.radius.sm,
              padding: `${t.spacing(1)} ${t.spacing(2)}`,
              fontFamily: "monospace",
            }}
          >
            api.schwabapi.com
          </div>
        </div>
      </div>

      {/* ── Left Rail ── */}
      <div style={leftRailStyle}>
        <div style={tabBarStyle}>
          <button style={tabStyle(leftTab === "endpoints")} onClick={() => setLeftTab("endpoints")}>
            Endpoints
          </button>
          <button style={tabStyle(leftTab === "schemas")} onClick={() => setLeftTab("schemas")}>
            Schemas
          </button>
        </div>

        {leftTab === "endpoints" ? (
          <>
            <input
              style={searchStyle}
              placeholder="Filter endpoints…"
              value={endpointSearch}
              onChange={(e) => setEndpointSearch(e.target.value)}
            />
            <div style={railListStyle}>
              {categories.map((cat) => {
                const catEndpoints = filteredEndpoints.filter((e) => e.category === cat);
                if (catEndpoints.length === 0) return null;
                return (
                  <div key={cat}>
                    <div style={categoryLabelStyle}>{cat}</div>
                    {catEndpoints.map((ep) => (
                      <button
                        key={ep.id}
                        style={endpointBtnStyle(selectedEndpointId === ep.id)}
                        onClick={() => handleEndpointSelect(ep.id)}
                      >
                        {ep.label}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <input
              style={searchStyle}
              placeholder="Filter schemas…"
              value={schemaSearch}
              onChange={(e) => setSchemaSearch(e.target.value)}
            />
            <div style={railListStyle}>
              {filteredSchemas.map((name) => (
                <button
                  key={name}
                  style={schemaBtnStyle(selectedSchema === name)}
                  onClick={() => setSelectedSchema(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Main Content ── */}
      <div style={mainStyle}>
        {leftTab === "endpoints" ? (
          <div style={{ maxWidth: 900 }}>
            {/* Endpoint info */}
            <div style={{ marginBottom: t.spacing(5) }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: t.spacing(3), flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>
                  {selectedEndpoint.label}
                </h2>
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontFamily: "monospace",
                    background: `${t.colors.primary}18`,
                    color: t.colors.primary,
                    padding: `${t.spacing(0.5)} ${t.spacing(2)}`,
                    borderRadius: t.radius.sm,
                    fontWeight: 600,
                  }}
                >
                  GET
                </span>
                <code
                  style={{
                    fontSize: "0.78rem",
                    fontFamily: "monospace",
                    color: t.colors.textMuted,
                    background: t.colors.background,
                    border: `1px solid ${t.colors.border}`,
                    padding: `${t.spacing(0.5)} ${t.spacing(2)}`,
                    borderRadius: t.radius.sm,
                  }}
                >
                  {selectedEndpoint.pathTemplate}
                </code>
              </div>
              <p style={{ margin: `${t.spacing(2)} 0 0`, color: t.colors.textMuted, fontSize: "0.875rem" }}>
                {selectedEndpoint.description}
              </p>
            </div>

            {/* Parameters */}
            <div style={cardStyle}>
              <h3 style={{ margin: `0 0 ${t.spacing(4)}`, fontSize: "0.9rem", fontWeight: 700 }}>
                Parameters
              </h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                  gap: `0 ${t.spacing(6)}`,
                }}
              >
                {selectedEndpoint.params.map(renderParamField)}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: t.spacing(3), marginTop: t.spacing(2) }}>
                <button
                  style={{
                    ...getPrimaryButtonStyle(t),
                    opacity: loading || !hasRequired ? 0.6 : 1,
                    cursor: loading || !hasRequired ? "not-allowed" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: t.spacing(2),
                    padding: `${t.spacing(2.5)} ${t.spacing(5)}`,
                    fontSize: "0.875rem",
                  }}
                  onClick={handleRun}
                  disabled={loading || !hasRequired}
                >
                  {loading ? (
                    <>
                      <span
                        style={{
                          display: "inline-block",
                          width: 14,
                          height: 14,
                          border: "2px solid rgba(255,255,255,0.3)",
                          borderTopColor: "#fff",
                          borderRadius: "50%",
                          animation: "spin 0.7s linear infinite",
                        }}
                      />
                      Calling…
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                        play_arrow
                      </span>
                      Run
                    </>
                  )}
                </button>
                {!hasRequired && !loading && (
                  <span style={{ fontSize: "0.775rem", color: t.colors.textMuted }}>
                    Fill in required fields to run
                  </span>
                )}
              </div>
            </div>

            {/* Response */}
            {(response !== null || loading) && (
              <div style={cardStyle}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: t.spacing(3),
                    flexWrap: "wrap",
                    gap: t.spacing(2),
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700 }}>Response</h3>
                  <div style={{ display: "flex", alignItems: "center", gap: t.spacing(3) }}>
                    {statusCode !== null && (
                      <span style={statusBadgeStyle(statusCode)}>
                        {statusCode >= 200 && statusCode < 300 ? "●" : "●"} {statusCode}
                      </span>
                    )}
                    {elapsed !== null && (
                      <span style={{ fontSize: "0.75rem", color: t.colors.textMuted }}>{elapsed} ms</span>
                    )}
                    {response && (
                      <button
                        style={{
                          border: `1px solid ${t.colors.border}`,
                          borderRadius: t.radius.sm,
                          background: "none",
                          color: t.colors.textMuted,
                          cursor: "pointer",
                          fontSize: "0.75rem",
                          padding: `${t.spacing(1)} ${t.spacing(2)}`,
                          fontFamily: "inherit",
                          display: "flex",
                          alignItems: "center",
                          gap: t.spacing(1),
                        }}
                        onClick={() => {
                          navigator.clipboard.writeText(response);
                        }}
                        title="Copy to clipboard"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                          content_copy
                        </span>
                        Copy
                      </button>
                    )}
                  </div>
                </div>

                {loading ? (
                  <div style={{ padding: t.spacing(6), textAlign: "center", color: t.colors.textMuted }}>
                    <span style={{ fontSize: "0.875rem" }}>Waiting for response…</span>
                  </div>
                ) : response ? (
                  <pre
                    style={{
                      margin: 0,
                      padding: t.spacing(4),
                      backgroundColor: t.mode === "dark" ? "#0d1117" : "#f6f8fa",
                      borderRadius: t.radius.md,
                      overflowX: "auto",
                      overflowY: "auto",
                      maxHeight: 540,
                      fontSize: "0.78rem",
                      lineHeight: 1.6,
                      fontFamily: '"Fira Code", "Cascadia Code", Consolas, monospace',
                      color: t.mode === "dark" ? "#e5e5e5" : "#374151",
                      whiteSpace: "pre",
                      scrollbarWidth: "thin",
                    }}
                    dangerouslySetInnerHTML={{ __html: responseHighlighted! }}
                  />
                ) : null}
              </div>
            )}
          </div>
        ) : (
          /* ── Schemas Tab ── */
          <div style={{ maxWidth: 840 }}>
            <div style={{ marginBottom: t.spacing(5) }}>
              <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>{selectedSchema}</h2>
              {currentSchemaDef ? (
                <p style={{ margin: `${t.spacing(2)} 0 0`, color: t.colors.textMuted, fontSize: "0.875rem" }}>
                  {currentSchemaDef.description}
                </p>
              ) : (
                <p style={{ margin: `${t.spacing(2)} 0 0`, color: t.colors.textMuted, fontSize: "0.875rem" }}>
                  Select a schema from the left panel. Detailed field documentation is available for the most commonly used schemas.
                </p>
              )}
            </div>

            {currentSchemaDef ? (
              <div style={cardStyle}>
                <h3 style={{ margin: `0 0 ${t.spacing(4)}`, fontSize: "0.9rem", fontWeight: 700 }}>
                  Fields
                </h3>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.83rem",
                  }}
                >
                  <thead>
                    <tr>
                      {["Field", "Type", "Description"].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            padding: `${t.spacing(2)} ${t.spacing(3)}`,
                            borderBottom: `1px solid ${t.colors.border}`,
                            color: t.colors.textMuted,
                            fontWeight: 700,
                            fontSize: "0.72rem",
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {currentSchemaDef.fields.map((f, i) => (
                      <tr key={f.name}>
                        <td
                          style={{
                            padding: `${t.spacing(2)} ${t.spacing(3)}`,
                            borderBottom: `1px solid ${t.colors.border}`,
                            fontFamily: "monospace",
                            fontSize: "0.8rem",
                            color: "#44c1c1",
                            fontWeight: 600,
                            background: i % 2 === 0 ? "transparent" : `${t.colors.border}33`,
                          }}
                        >
                          {f.name}
                        </td>
                        <td
                          style={{
                            padding: `${t.spacing(2)} ${t.spacing(3)}`,
                            borderBottom: `1px solid ${t.colors.border}`,
                            fontFamily: "monospace",
                            fontSize: "0.78rem",
                            color: t.mode === "dark" ? "#a78bfa" : "#7c3aed",
                            background: i % 2 === 0 ? "transparent" : `${t.colors.border}33`,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {f.type}
                        </td>
                        <td
                          style={{
                            padding: `${t.spacing(2)} ${t.spacing(3)}`,
                            borderBottom: `1px solid ${t.colors.border}`,
                            color: t.colors.text,
                            background: i % 2 === 0 ? "transparent" : `${t.colors.border}33`,
                          }}
                        >
                          {f.desc}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div
                style={{
                  ...cardStyle,
                  textAlign: "center",
                  padding: t.spacing(10),
                  color: t.colors.textMuted,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 40, display: "block", marginBottom: t.spacing(2), opacity: 0.4 }}
                >
                  schema
                </span>
                <p style={{ margin: 0, fontSize: "0.875rem" }}>
                  Detailed field docs not yet available for <strong>{selectedSchema}</strong>.
                </p>
                <p style={{ margin: `${t.spacing(1)} 0 0`, fontSize: "0.775rem" }}>
                  This schema exists in the Schwab API. Run an endpoint that returns it to see its structure.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
