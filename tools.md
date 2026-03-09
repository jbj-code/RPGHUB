## Internal Toolkit – Tools & Ideas

### Current core tools to build

- **Put Optimizer**
  - Goal: Help quickly evaluate and compare put strategies for specific tickers/portfolios.
  - Inputs: Ticker, expiry, strikes, premiums, desired protection, etc.
  - Outputs: Clear comparison of candidate structures, key Greeks, breakevens, and P&L scenarios.

- **Stock Comparison**
  - Goal: Compare multiple equities (or ETFs) across key metrics in one view.
  - Inputs: Tickers, lookback periods, benchmark.
  - Outputs: Performance charts, valuation metrics, risk metrics, simple “summary view” for discussion.

### Planned / idea tools for the hub

- **Weekly Highlights Generator**
  - Goal: Provide a curated list of major macro/market/company stories to use in weekly client letters.
  - Ideas:
    - Pull key headlines and summaries from a few trusted finance/news sources.
    - Tag or group items by theme (macro, rates, equities, geopolitics, etc.).
    - Let users “star” items to include in a draft weekly note.

- **Trade Allocator Tester / Ideator**
  - Goal: Replace or augment the current Google Sheets process used with Addepar exports.
  - Workflow idea:
    - Upload/export holdings (e.g. from Addepar) into the tool.
    - Compute breakdowns: currency exposure, sector, region, asset class, issuer concentration, etc.
    - Let users test alternative allocations or proposed trades and see the before/after exposures.
  - Long term:
    - Save “scenarios” for a client.
    - Export results back to CSV/Excel or into a simple PDF for sharing.

### Overall vision (high-level)

- **Single hub** where the team can:
  - Access all quantitative tools (puts, comparisons, allocation testing) in one place.
  - Pull weekly macro/market highlights to support client communication.
  - Gradually add new tools without rebuilding everything each time.

