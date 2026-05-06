# Sourcing Agent — Strategy & Build Notes

## Vision
An always-on, AI-powered prospect discovery system for a wealth management multi-family office.
Surfaces high-net-worth individuals ($15M+ liquid/investable assets) at the moment they have a liquidity event or wealth trigger, drafts personalized outreach, and routes approvals to the team.

Target: **50–100 qualified outbounds/week** at a meaningful conversion rate.

---

## Target Prospect Profile
- **Minimum net worth / liquid assets**: $15M+
- **Ideal**: $20–100M range (multi-family office sweet spot)
- **Best timing to reach**: Within 48–72 hours of a liquidity event
- **Personas** (in priority order):
  1. Tech executives / founders at acquired companies (equity payout)
  2. Pre-IPO / post-IPO executives (lockup strategy window)
  3. Late-stage startup co-founders (Series D+ or secondary liquidity)
  4. Public company insiders who filed large Form 4 sales (>$1M)
  5. Private equity / hedge fund principals (carried interest events)
  6. Real estate developers who just closed a major exit
  7. Business owners who sold their company (M&A exit)

---

## Sourcing Triggers (what to monitor)
| Trigger | Why It Matters | Source |
|---|---|---|
| Acquisition announced | Equity holders get liquid | Exa AI / NewsAPI |
| IPO S-1 filing | Execs have lockup ending soon | SEC EDGAR free API |
| Form 4 insider sale > $1M | Person literally just got liquid | SEC EDGAR free API |
| Series D+ funding round | Founder secondary shares common | Crunchbase / Exa AI |
| SpaceX / private co secondary | Large paper wealth becoming real | Exa AI / news |
| M&A advisory announcements | Bankers on the deal know who wins | Exa AI |
| Real estate public records | $3M+ home purchase = HNW signal | County records (varies) |

---

## Data Sources & APIs
| Source | What It Gets | Cost | Status |
|---|---|---|---|
| **Exa AI** (exa.ai) | News, people discovery, event monitoring | $20/mo (paid) / 1k free searches | Not connected |
| **SEC EDGAR API** (api.sec.gov) | Form 4 insider sales, S-1 IPO filings | **Free** | Not connected |
| **Apollo.io** | Email discovery, contact enrichment | Free tier: 50 exports/mo; $49/mo for more | Not connected |
| **Hunter.io** | Email finder (secondary fallback) | Free: 25/mo; $34/mo for 500 | Not connected |
| **Crunchbase Basic API** | Funding rounds, founder data | $49/mo | Not connected |
| **Resend** (resend.com) | Digest email delivery | Free: 3k/mo | Not connected |
| **Smartlead / Instantly** | High-volume sending infra + tracking | $37–97/mo | Optional — see notes |

---

## Do We Need Clay? (clay.com)
Clay is a no-code tool that builds lists from multiple sources and does waterfall email enrichment.
**Short answer: No — we can DIY it inside the hub for less money and with more control.**

What Clay does that we can replicate:
- Pull names from multiple data sources → **Exa AI + SEC EDGAR** (DIY)
- Waterfall enrich emails (Apollo → Hunter → RocketReach) → **Apollo API** (DIY)
- AI-personalize each message → **Claude** (already have)
- Track pipeline → **Supabase + Sourcing page in hub** (already built)

**DIY all-in cost: $20–70/mo** vs Clay $149/mo + Smartlead $97/mo = $246/mo
The gap is worth it since we can build exactly what we need.

---

## On Sending: Manual vs Automated

### For $15M+ targets — manual is better
At this wealth level, a cold email from a real person (partner/principal at the firm)
converts dramatically better than any automated sequence. Recipients at this level
have strong spam filters (both technical and psychological).

**Recommended flow:**
1. Agent finds the prospect and drafts the message
2. Boss reviews in the Sourcing dashboard (RPG Hub)
3. Boss personally sends from his own email — copy/paste
4. Track "sent" status in the hub

For the boss sending 10–20/week from his own email: **zero ban risk**.
His domain reputation stays intact because it's normal professional volume.

### If we want 50–100/week volume
- Use a **subdomain** for bulk: `reach.firmname.com` (protects main domain)
- Warm it up over 3–4 weeks (send 5/day → 20/day → 50/day gradually)
- Resend handles delivery for free up to 3,000/mo
- Smartlead/Instantly ($37/mo) is only needed if you want reply tracking, A/B testing, or sequences

---

## On "OpenClaw" / Always-On Autonomous Agents
OpenClaw appears to be a browser automation / agent tool used for Facebook scraping workflows
(e.g., scraping FSBO home sellers on Facebook Marketplace and auto-messaging them).
It's not a well-known enterprise tool.

For a wealth management use case with high compliance requirements:
- **Don't** use Facebook automation tools for outreach — ToS violation, ban risk, and reputational risk
- **Do** use the autonomous agent pattern, but built on reliable infrastructure:
  - Vercel Cron → fires daily API calls
  - Claude for intelligence layer
  - Structured data sources (SEC, Exa) instead of scraping social platforms

The "always on" goal is 100% achievable without OpenClaw.
A Vercel Cron + Exa AI + SEC EDGAR + Claude is effectively the same thing but:
- No ban risk (licensed data sources)
- Compliance-friendly (public record data only)
- Runs in your own infrastructure

---

## Architecture Plan

```
Daily Cron (Vercel Cron, free)
  └─ api/sourcing-scan.ts
       ├─ Exa AI: "acquisition IPO funding tech executive 2026" (last 24h)
       ├─ SEC EDGAR: Form 4 filings with transactions > $1M (last 24h)
       └─ Claude: parse events → extract HNW individuals → score each one
            └─ Apollo.io: enrich with email + LinkedIn URL
                 └─ Claude: write personalized message per person
                      └─ Supabase: insert prospect rows (status = "draft")

Weekly Digest (Monday 8am)
  └─ api/sourcing-digest.ts
       ├─ Pull all draft prospects from Supabase
       ├─ Claude: summarize the week's top 10 opportunities
       └─ Resend: email to boss with approve/skip links

RPG Hub Sourcing Page (already built)
  ├─ Review trigger events
  ├─ Edit / approve messages
  ├─ Mark sent, track pipeline
  └─ Supabase as single source of truth
```

---

## Supabase Schema (to be created)
```sql
-- sourcing_triggers: raw events found by the cron
CREATE TABLE sourcing_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  type TEXT, -- acquisition | ipo | funding | sec_filing | news
  headline TEXT,
  source TEXT,
  estimated_value TEXT,
  url TEXT,
  raw_data JSONB
);

-- sourcing_prospects: HNW individuals extracted from triggers
CREATE TABLE sourcing_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  trigger_id UUID REFERENCES sourcing_triggers(id),
  name TEXT,
  title TEXT,
  company TEXT,
  linkedin_url TEXT,
  email TEXT,
  estimated_liquidity TEXT,
  message TEXT,
  status TEXT DEFAULT 'new', -- new | draft | approved | sent | responded | qualified
  notes TEXT,
  sent_at TIMESTAMPTZ
);
```

---

## Compliance Notes
- Only use **publicly available data** (SEC filings, press releases, LinkedIn public profiles)
- No PII databases, no NDAs, no client account numbers
- All outreach is cold professional contact — standard B2B practice
- Boss manually reviews and approves every message before send
- CAN-SPAM compliant: include firm address + unsubscribe mechanism in any bulk email
- LinkedIn manual outreach only (no automation bots on LinkedIn)

---

## Decisions Log
| Date | Decision | Reason |
|---|---|---|
| 2026-05-05 | DIY over Clay | Lower cost, more control, hub integration |
| 2026-05-05 | Manual send for top tier | Better conversion at $15M+ wealth level |
| 2026-05-05 | No Facebook/LinkedIn automation | ToS + compliance risk |
| 2026-05-05 | Exa AI + SEC EDGAR as primary sources | Best quality triggers for HNW prospects |

---

## Next Steps
- [ ] Sign up for Exa AI — add `EXA_API_KEY` to Vercel env vars
- [ ] Sign up for Apollo.io — add `APOLLO_API_KEY` to Vercel env vars
- [ ] Create Supabase tables (`sourcing_triggers`, `sourcing_prospects`)
- [ ] Build `api/sourcing-scan.ts` (Vercel Cron endpoint)
- [ ] Build `api/sourcing-digest.ts` (weekly email via Resend)
- [ ] Sign up for Resend — add `RESEND_API_KEY` to Vercel env vars
- [ ] Connect Sourcing page to live Supabase data (replace mock data)
- [ ] Test first live scan run
