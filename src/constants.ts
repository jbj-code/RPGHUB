// constants.ts
// Shared client-side configuration (API bases, defaults). Import instead of duplicating env reads.

/** Schwab proxy API base. Override with VITE_SCHWAB_API_BASE in .env or Vercel. */
export const SCHWAB_API_BASE =
  (import.meta.env.VITE_SCHWAB_API_BASE as string | undefined)?.trim() ||
  "https://therpghub.vercel.app";
