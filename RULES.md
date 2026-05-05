# Project Rules & Engineering Standards

A living reference document for code quality, architecture, and engineering principles. These rules apply to every project and should be the default bar for any work done.

---

## 1. DRY — Don't Repeat Yourself

If the same logic, value, or structure appears in more than one place, extract it.

- **Theme file** — every project must have a single `theme.ts` (or equivalent) as the one source of truth for all branding: colors, typography, spacing, border radii, shadows, and breakpoints. Light and dark mode variants live here. No hex code, font name, or spacing value should ever be hardcoded inline — always reference the theme. This makes a full rebrand or mode switch a one-file change.
- **Constants** — any URL, key, magic number, or label used in more than one place lives in a single `constants.ts` (or equivalent) file and is imported everywhere.
- **Functions & hooks** — if the same operation happens in two components or two handlers, pull it into a shared utility or custom hook.
- **Components** — if two pieces of UI look or behave the same, make one component with props, not two copies.
- **Types** — define a type or interface once and re-use it; never redefine the same shape in two files.

> Rule of thumb: the second time you write the same thing, stop and refactor.

---

## 2. Optimization & Efficiency

Code should be fast for the machine and fast to read for a human.

### Runtime
- Avoid unnecessary re-renders (memoize expensive calculations with `useMemo`/`useCallback` where it matters).
- Prefer streaming or pagination over loading large datasets in one shot.
- Debounce or throttle any user-triggered side effects (search inputs, resize handlers, etc.).
- Minimize network round-trips: batch requests, cache aggressively, and use loading/error states everywhere.

### Bundle / Build
- Tree-shake unused exports — only import what you need.
- Keep third-party dependencies lean; prefer small, focused packages over kitchen-sink libraries.
- Lazy-load pages and heavy components (`React.lazy` / dynamic imports).

### Readability (human performance)
- Functions should do one thing and be named for that one thing.
- Keep files under ~300 lines; split when they grow larger.
- Prefer explicit over clever — clear beats concise when in doubt.
- Delete dead code; don't comment it out.

### Comments — AI-first guideline
This codebase is maintained entirely through AI coding tools. Comments should be used strategically to help an AI model orient quickly without wasting tokens:
- **File-level comment** — every file should open with a 1–2 line comment describing what it is and what it owns (e.g. `// Theme — single source of truth for all colors, typography, and spacing.`).
- **Section headers** — use short comments to divide a long file into named sections (e.g. `// --- Option scoring ---`) so an AI can locate the right area fast.
- **Non-obvious logic** — comment the *why* behind any logic that isn't immediately obvious from reading it (e.g. why a specific formula is used, why an edge case is handled a certain way).
- **Do not** narrate obvious code ("// fetch the data", "// return result") — this adds noise without value and inflates context unnecessarily.

---

## 3. Security

The default posture is: **trust nothing from outside the boundary**.

### API & Backend
- Never expose secrets (API keys, DB credentials, service tokens) in client-side code or committed files. Use environment variables and `.gitignore` them.
- Validate and sanitize all inputs server-side before processing, regardless of client-side validation.
- Use parameterized queries / ORM methods — never concatenate user input into SQL or command strings.
- Apply the principle of least privilege: each service/key/role should only have access to what it strictly needs.
- Always verify auth tokens server-side on every protected endpoint, never trust `localStorage` state alone.

### Frontend
- Escape all user-generated content before rendering it in the DOM (React does this by default — never use `dangerouslySetInnerHTML` with untrusted content).
- Set `rel="noopener noreferrer"` on all `target="_blank"` links (already in place — keep it).
- Do not store sensitive data (passwords, tokens with broad scope) in `localStorage` — use `httpOnly` cookies or session storage with short TTLs where possible.

### Dependencies
- Keep dependencies up to date; run `npm audit` regularly and fix high/critical vulnerabilities.
- Pin major versions; review changelogs before major upgrades.

---

## 4. Error Handling & Resilience

Failures are expected; unhandled failures are bugs.

- Every `async` call must have an explicit error path — no silent swallowing unless you deliberately want to ignore an error (document why with a comment).
- Show the user a clear, human-readable error state rather than a blank screen or console-only error.
- Use typed error handling: distinguish network errors, auth errors, and business-logic errors so the UI can respond appropriately.
- Add cancellation to long-running async effects (e.g., `AbortController` for fetch, cleanup functions in `useEffect`) to prevent state updates on unmounted components.

---

## 5. Consistency & Style

A codebase should read as if one person wrote it.

- Follow the existing patterns in a file before introducing a new one.
- Name things consistently: if it's called `theme` in one place, don't call it `t` somewhere else without a good reason (or adopt the short form everywhere).
- Co-locate related code: a component's types, helpers, and styles should be near the component unless they are genuinely shared.
- Use TypeScript strictly — no `any` except when genuinely unavoidable, and document why.
- Write self-documenting code first; add comments only to explain *why*, not *what*.

---

## 6. Accessibility (a11y)

Every interactive element must be usable without a mouse and readable by a screen reader.

- All images need `alt` text (use `alt=""` for purely decorative images, as we already do).
- All interactive elements (`button`, `a`, custom controls) need an accessible label.
- Keyboard navigation must work: focus order should be logical and focus must be visible.
- Use semantic HTML elements (`button` not `div onClick`, `nav` not `div class="nav"`, etc.).

