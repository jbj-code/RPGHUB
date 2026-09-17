// SchwabSheetFunctions.gs
// Google Sheets custom functions + menu for live Schwab option/stock data via RPG HUB.
// Paste into Extensions → Apps Script on your spreadsheet (replaces prior version).

// ─── Config ────────────────────────────────────────────────────────────────

var BASE_URL = "https://therpghub.vercel.app/api/schwab";
var SHEET_KEY = ""; // paste your SHEET_KEY here if you set one in Vercel
var OPT_CACHE_KEY = "schwab_opt_cache_v1";
var OPT_CACHE_TTL_SEC = 21600; // 6 hours — populated by Refresh Data

// ─── SCHWAB_OCC ────────────────────────────────────────────────────────────

/**
 * Builds the OCC option symbol string needed by SCHWAB_OPT. No API call.
 * @param {string} underlying  - Stock ticker, e.g. "SPY", "AAPL", "BE"
 * @param {string} expiry      - Expiration date as "YYYY-MM-DD", e.g. "2026-01-17"
 * @param {string} type        - "C" for call, "P" for put
 * @param {number} strike      - Strike price, e.g. 450 or 12.5
 * @customfunction
 */
function SCHWAB_OCC(underlying, expiry, type, strike) {
  var d = new Date(String(expiry));
  var yy = String(d.getUTCFullYear()).slice(-2);
  var mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  var dd = String(d.getUTCDate()).padStart(2, "0");
  var root = String(underlying).toUpperCase().padEnd(6, " ").slice(0, 6);
  var t = String(type).toUpperCase().startsWith("P") ? "P" : "C";
  var strikeStr = String(Math.round(parseFloat(strike) * 1000)).padStart(8, "0");
  return root + yy + mm + dd + t + strikeStr;
}

// ─── SCHWAB_OPT ────────────────────────────────────────────────────────────

/**
 * Fetches live data from Schwab for one option contract and returns a single value.
 * After Refresh Data, reads from cache (no API call). Otherwise falls back to one request.
 *
 * @param {string} symbol - OCC option symbol, e.g. from SCHWAB_OCC() or a cell reference
 * @param {string} field  - bid | ask | mark | mid | last | iv | delta | ... (see sheetQuote API)
 * @customfunction
 */
function SCHWAB_OPT(symbol, field) {
  try {
    var sym = String(symbol).trim();
    var fld = String(field).trim().toLowerCase();

    var cached = readOptCache_(sym, fld);
    if (cached !== null) return cached;

    return fetchOptField_(sym, fld);
  } catch (e) {
    return "ERR: " + e.message;
  }
}

// ─── SCHWAB_STOCK ──────────────────────────────────────────────────────────

/**
 * Fetches stock-level analytics. Takes a plain ticker, not an OCC symbol.
 * @param {string} symbol - Stock ticker, e.g. "SPY", "AAPL", "BE"
 * @param {string} field  - rv30 | rv90 | iv30 | iv90 | ivrv30 | ivrv90 | beta
 * @customfunction
 */
function SCHWAB_STOCK(symbol, field) {
  try {
    var sym = encodeURIComponent(String(symbol).trim().toUpperCase());
    var fld = encodeURIComponent(String(field).trim().toLowerCase());
    var url = BASE_URL + "?action=sheetStock&symbol=" + sym + "&field=" + fld;
    if (SHEET_KEY) url += "&key=" + encodeURIComponent(SHEET_KEY);

    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var json = JSON.parse(res.getContentText());
    if (json.error) return "ERR: " + json.error;
    return json.value;
  } catch (e) {
    return "ERR: " + e.message;
  }
}

// ─── Menu ──────────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Schwab")
    .addItem("Refresh Data", "refreshSchwabData")
    .addSeparator()
    .addItem("Check Connection Status", "checkSchwabStatus")
    .addItem("Reauthorize Schwab", "reauthorizeSchwab")
    .addSeparator()
    .addItem("Enable Daily Status Emails", "setupDailyStatusCheck")
    .addToUi();
}

// ─── Refresh (batch) ─────────────────────────────────────────────────────────

/**
 * Scans all sheets for SCHWAB_OPT formulas, batch-fetches unique contracts from Schwab,
 * stores results in cache, then re-applies formulas (reads cache — no per-cell API calls).
 * SCHWAB_STOCK cells still refresh individually (fewer / heavier endpoints).
 */
function refreshSchwabData() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = spreadsheet.getSheets();
  var optCells = [];
  var stockCount = 0;

  sheets.forEach(function(sheet) {
    var range = sheet.getDataRange();
    var formulas = range.getFormulas();
    var startRow = range.getRow();
    var startCol = range.getColumn();

    formulas.forEach(function(row, rowIdx) {
      row.forEach(function(formula, colIdx) {
        if (!formula) return;
        var upper = formula.toUpperCase();

        if (upper.indexOf("SCHWAB_OPT") !== -1) {
          var parsed = parseSchwabOptFormula_(formula);
          if (!parsed) return;
          var symbol = resolveSymbolArg_(sheet, parsed.symbolArg);
          if (!symbol) return;
          optCells.push({
            sheet: sheet,
            row: startRow + rowIdx,
            col: startCol + colIdx,
            formula: formula,
            symbol: String(symbol).trim(),
            field: parsed.field,
          });
          return;
        }

        if (upper.indexOf("SCHWAB_STOCK") !== -1) {
          sheet.getRange(startRow + rowIdx, startCol + colIdx).setFormula(formula);
          stockCount++;
        }
      });
    });
  });

  var optCount = 0;
  var batchCalls = 0;
  var apiErrors = 0;

  if (optCells.length > 0) {
    var byField = groupOptCellsByField_(optCells);
    var cache = readOptCacheAll_();

    Object.keys(byField).forEach(function(field) {
      var cells = byField[field];
      var symbols = uniqueStrings_(cells.map(function(c) { return c.symbol; }));

      for (var i = 0; i < symbols.length; i += 50) {
        var chunk = symbols.slice(i, i + 50);
        batchCalls++;
        var result = fetchOptBatch_(chunk, field);
        if (result.error) {
          apiErrors++;
          return;
        }
        Object.keys(result.values).forEach(function(sym) {
          var norm = normalizeOcc_(sym);
          if (!cache[norm]) cache[norm] = {};
          var row = result.values[sym];
          Object.keys(row).forEach(function(f) {
            cache[norm][f] = row[f];
          });
        });
      }
    });

    writeOptCacheAll_(cache);

    optCells.forEach(function(cell) {
      cell.sheet.getRange(cell.row, cell.col).setFormula(cell.formula);
      optCount++;
    });
  }

  SpreadsheetApp.flush();

  var msg = "Refreshed " + optCount + " SCHWAB_OPT cell" + (optCount !== 1 ? "s" : "");
  if (batchCalls > 0) msg += " via " + batchCalls + " batch call" + (batchCalls !== 1 ? "s" : "");
  if (stockCount > 0) msg += " and " + stockCount + " SCHWAB_STOCK cell" + (stockCount !== 1 ? "s" : "");
  if (apiErrors > 0) msg += ".\n\nWarning: " + apiErrors + " batch request(s) failed — try again in a moment.";
  msg += ".";

  SpreadsheetApp.getUi().alert(msg);
}

// ─── Batch + cache helpers ───────────────────────────────────────────────────

function fetchOptField_(symbol, field) {
  var sym = encodeURIComponent(String(symbol).trim());
  var fld = encodeURIComponent(String(field).trim().toLowerCase());
  var url = BASE_URL + "?action=sheetQuote&symbol=" + sym + "&field=" + fld;
  if (SHEET_KEY) url += "&key=" + encodeURIComponent(SHEET_KEY);

  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var json = JSON.parse(res.getContentText());
  if (json.error) return "ERR: " + json.error;
  return json.value;
}

function fetchOptBatch_(symbols, field) {
  var url = BASE_URL + "?action=sheetBatch&symbols=" +
    encodeURIComponent(symbols.join(",")) + "&fields=" + encodeURIComponent(field);
  if (SHEET_KEY) url += "&key=" + encodeURIComponent(SHEET_KEY);

  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var json = JSON.parse(res.getContentText());
  if (json.error) return { error: json.error, values: {} };
  return { values: json.values || {}, errors: json.errors || {} };
}

function readOptCache_(symbol, field) {
  var cache = readOptCacheAll_();
  var entry = cache[normalizeOcc_(symbol)];
  if (!entry || entry[field] === undefined || entry[field] === null) return null;
  return entry[field];
}

function readOptCacheAll_() {
  var raw = CacheService.getDocumentCache().get(OPT_CACHE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function writeOptCacheAll_(data) {
  CacheService.getDocumentCache().put(OPT_CACHE_KEY, JSON.stringify(data), OPT_CACHE_TTL_SEC);
}

function normalizeOcc_(symbol) {
  return String(symbol).replace(/\s+/g, "");
}

function parseSchwabOptFormula_(formula) {
  var m = formula.match(/SCHWAB_OPT\s*\(\s*([^,]+)\s*,\s*["']([^"']+)["']\s*\)/i);
  if (!m) return null;
  return { symbolArg: m[1].trim(), field: m[2].trim().toLowerCase() };
}

function resolveSymbolArg_(sheet, symbolArg) {
  var arg = String(symbolArg).trim();

  if (/^["']/.test(arg)) {
    return arg.replace(/^["']|["']$/g, "");
  }

  var cellRef = arg.replace(/\$/g, "");
  if (/^[A-Z]+\d+$/i.test(cellRef)) {
    return sheet.getRange(cellRef).getValue();
  }

  if (/SCHWAB_OCC\s*\(/i.test(arg)) {
    return evaluateSchwabOccArg_(sheet, arg);
  }

  return arg;
}

function evaluateSchwabOccArg_(sheet, arg) {
  var m = arg.match(/SCHWAB_OCC\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/i);
  if (!m) return null;

  function val(part) {
    part = String(part).trim().replace(/\$/g, "");
    if (/^["']/.test(part)) return part.replace(/^["']|["']$/g, "");
    if (/^[A-Z]+\d+$/i.test(part)) return sheet.getRange(part).getValue();
    return part;
  }

  return SCHWAB_OCC(val(m[1]), val(m[2]), val(m[3]), val(m[4]));
}

function groupOptCellsByField_(cells) {
  var out = {};
  cells.forEach(function(c) {
    if (!out[c.field]) out[c.field] = [];
    out[c.field].push(c);
  });
  return out;
}

function uniqueStrings_(arr) {
  var seen = {};
  var out = [];
  arr.forEach(function(s) {
    if (!s || seen[s]) return;
    seen[s] = true;
    out.push(s);
  });
  return out;
}

// ─── Status Check ──────────────────────────────────────────────────────────

function checkSchwabStatus() {
  try {
    var url = BASE_URL + "?action=status";
    if (SHEET_KEY) url += "&key=" + encodeURIComponent(SHEET_KEY);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var json = JSON.parse(res.getContentText());

    if (json.connected) {
      SpreadsheetApp.getUi().alert(
        "Schwab Status: Connected\n\nLive market data is working. Refresh token is active."
      );
    } else if (json.expired) {
      SpreadsheetApp.getUi().alert(
        "Schwab Status: Token Expired\n\nThe refresh token has expired (this happens every 7 days).\n\nGo to Schwab menu → Reauthorize Schwab to fix it."
      );
    } else {
      SpreadsheetApp.getUi().alert(
        "Schwab Status: Not Connected\n\nNo active Schwab token found.\n\nGo to Schwab menu → Reauthorize Schwab."
      );
    }
  } catch (e) {
    SpreadsheetApp.getUi().alert("Status check failed: " + e.message);
  }
}

function checkSchwabStatusSilent() {
  try {
    var url = BASE_URL + "?action=status";
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var json = JSON.parse(res.getContentText());
    return json.connected ? "connected" : "disconnected";
  } catch (e) {
    return "disconnected";
  }
}

// ─── Reauthorize ───────────────────────────────────────────────────────────

function reauthorizeSchwab() {
  var authUrl = "https://therpghub.vercel.app/api/schwab?action=auth";
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;padding:16px;">' +
    '<p style="margin:0 0 12px;">Click below to reauthorize Schwab. A new tab will open — ' +
    'log in with your Schwab credentials and approve access.</p>' +
    '<p style="margin:0 0 16px;color:#666;font-size:12px;">Only the Schwab account holder needs to do this. ' +
    'Once complete, all sheets will work again automatically.</p>' +
    '<a href="' + authUrl + '" target="_blank" style="text-decoration:none;">' +
    '<button style="padding:10px 24px;background:#1a73e8;color:white;border:none;' +
    'border-radius:4px;cursor:pointer;font-size:14px;font-weight:bold;">' +
    'Open Schwab Authorization</button></a>' +
    '<hr style="margin:16px 0;border:none;border-top:1px solid #e0e0e0;">' +
    '<p style="margin:0 0 8px;color:#444;font-size:12px;">Once you have approved access in the new tab, click below to verify and close:</p>' +
    '<button onclick="verify()" style="padding:8px 20px;background:#34a853;color:white;border:none;' +
    'border-radius:4px;cursor:pointer;font-size:13px;">Verify Connection & Close</button>' +
    '<p id="status" style="margin:8px 0 0;font-size:12px;color:#666;"></p>' +
    '</div>' +
    '<script>' +
    'function verify() {' +
    '  document.getElementById("status").innerText = "Checking...";' +
    '  google.script.run' +
    '    .withSuccessHandler(function(result) {' +
    '      if (result === "connected") {' +
    '        document.getElementById("status").style.color = "#34a853";' +
    '        document.getElementById("status").innerText = "Connected! Closing...";' +
    '        setTimeout(function() { google.script.host.close(); }, 1200);' +
    '      } else {' +
    '        document.getElementById("status").style.color = "#ea4335";' +
    '        document.getElementById("status").innerText = "Not connected yet — make sure you approved access in the Schwab tab.";' +
    '      }' +
    '    })' +
    '    .withFailureHandler(function() {' +
    '      document.getElementById("status").style.color = "#ea4335";' +
    '      document.getElementById("status").innerText = "Check failed — try again.";' +
    '    })' +
    '    .checkSchwabStatusSilent();' +
    '}' +
    '</scr' + 'ipt>'
  ).setWidth(420).setHeight(240);
  SpreadsheetApp.getUi().showModalDialog(html, "Reauthorize Schwab");
}

// ─── Daily Email Alert ─────────────────────────────────────────────────────

function setupDailyStatusCheck() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "dailySchwabStatusCheck") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("dailySchwabStatusCheck")
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .create();

  SpreadsheetApp.getUi().alert(
    "Daily status check enabled.\n\nEvery morning at 8am this sheet will check if Schwab is connected. " +
    "If the token has expired, you will receive an email at " + Session.getActiveUser().getEmail() + "."
  );
}

function dailySchwabStatusCheck() {
  try {
    var url = BASE_URL + "?action=status";
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var json = JSON.parse(res.getContentText());

    if (!json.connected) {
      GmailApp.sendEmail(
        Session.getActiveUser().getEmail(),
        "Action Required: Schwab Reauthorization Needed",
        "Your Schwab connection has expired and your Google Sheets are no longer pulling live data.\n\n" +
        "To fix it, open any sheet with Schwab data, click:\n" +
        "Schwab menu → Reauthorize Schwab\n\n" +
        "Or go directly to RPG HUB: https://therpghub.vercel.app\n\n" +
        "This needs to be done by the Schwab account holder. Once reauthorized, all sheets will work again automatically.\n\n" +
        "Note: Schwab refresh tokens expire every 7 days, so this is expected roughly once a week."
      );
    }
  } catch (e) {
    // Silently fail — don't spam email on network errors
  }
}
