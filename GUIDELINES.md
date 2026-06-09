# Coding Guidelines

> These are universal rules that apply to every project. Drop this file in the root of any project alongside a `CONTEXT.md` specific to that project.
> All AI coding tools should read and follow these guidelines throughout every session.
> **Important:** Keep this file focused on rules that apply to *every* task. The more irrelevant content that's in here, the more likely the AI is to start ignoring it. Project-specific details (commands, architecture, current state) belong in `CONTEXT.md`, not here.

---

## 1. Know When to Ask, Know When to Just Do It

- **Small, clear tasks** (e.g. "fix this bug", "add a field to this form", "update this copy"): just do it. No preamble needed.
- **Larger or ambiguous tasks** (e.g. a new feature, a refactor touching multiple files, anything architectural): briefly state your intended approach before writing code. If something is genuinely unclear, ask — but ask once, not repeatedly.
- Default toward action. Only pause when the cost of going in the wrong direction would be high.

---

## 2. DRY — Don't Repeat Yourself

- If logic, UI, or configuration appears more than once, extract it into a shared component, utility, hook, or constant.
- Before creating something new, search the codebase for something that already does it.
- Prefer refactoring existing code over adding parallel code when fixing bugs or extending features.

---

## 3. Project Structure & Naming

The goal is a codebase any engineer — or AI — can navigate immediately without a guide.

**Folder structure:**
- Organize by feature or domain first, not by file type. For example, group everything related to `auth` together rather than scattering it across `/components`, `/utils`, and `/types`.
- Common top-level folders: `components/`, `screens/` (or `pages/`), `hooks/`, `services/`, `utils/`, `types/`, `constants/`, `assets/`, `styles/`.
- Keep related files co-located: a component, its styles, and its tests should live in the same folder.

**Naming:**
- Files and folders: `kebab-case` for most projects; follow the framework convention if one exists.
- Components: `PascalCase` (e.g. `UserProfileCard`).
- Functions, variables, hooks: `camelCase` (e.g. `useAuthSession`, `formatCurrency`).
- Constants: `SCREAMING_SNAKE_CASE` (e.g. `MAX_RETRY_COUNT`).
- Names should communicate intent. Avoid vague names like `data`, `handler`, `utils2`, or `newComponent`.

**File headers:**
Add a brief comment at the top of every new file describing its purpose:
```
// services/auth.ts
// Handles user authentication: login, logout, token refresh, and session checks.
```

**Section headers:**
In longer files, use short section headers to divide the file into named blocks — easier to skim and navigate for humans and AI tools alike:
```
// --- Session refresh ---
```
Use the comment style natural to the language (`//`, `#`, `--`, etc.). Mark logical groups of code, not every function or obvious line.

---

## 4. Central Styles & Theming

All visual design values — colors, fonts, spacing, border radii, shadows, and any brand-specific values — must live in one central styles or theme file (e.g. `styles/theme.ts`, `styles/tokens.ts`, or the framework equivalent).

- **Never hardcode** color values, font names, or sizing constants inline anywhere else in the codebase.
- The theme file must define both **light and dark mode** values.
- Changing the brand's primary color (or any design value) should require editing exactly one place.
- This applies regardless of framework — React Native, React, or anything else — adapt the format to what the project uses, but the principle is non-negotiable.

---

## 5. Security

- **No secrets in code.** API keys, tokens, passwords, and credentials go in environment variables (`.env`). Always maintain a `.env.example` with placeholder values so the structure is documented without exposing real secrets.
- **Validate all user input** on the server side, not just the client. Treat every input as untrusted.
- **Authentication, authorization, and payment flows** are sensitive. Before making any changes to these areas, pause and ask for confirmation — do not modify them without explicit instruction.
- **Least privilege:** only request the permissions, scopes, or database access that a feature actually needs.
- **Dependencies:** avoid adding packages that have known security vulnerabilities or haven't been actively maintained in over two years.
- **Project-specific patterns:** how this project handles auth, secrets, and data access belongs in `CONTEXT.md`. Follow what's documented there — don't invent a new security approach unless asked.

---

## 6. Accessibility (UI Projects)

*Applies when the project has a user-facing interface. Skip for CLI, API-only, or headless projects.*

Every interactive element should be usable without a mouse and perceivable by assistive technology:

- **Images:** provide meaningful alternative text; use empty alt for purely decorative images.
- **Controls:** every interactive element (buttons, links, form fields, custom controls) needs an accessible name — visible label or equivalent.
- **Keyboard:** tab order should be logical; focus must be visible; all actions reachable without a mouse.
- **Semantics:** use the framework's native interactive elements where they exist (e.g. `button` not a clickable `div`) so behavior is correct by default.

For project-specific a11y tooling or conventions, see `CONTEXT.md`.

---

## 7. Code Quality & Efficiency

- Simpler is better. If two solutions work, choose the one that is easier to read and understand.
- Avoid over-engineering: no premature abstractions, unnecessary patterns, or extra dependencies without clear justification.
- Avoid deeply nested logic. Use early returns and helper functions to keep code flat and readable.
- Add comments only when the *why* behind something would not be immediately obvious to another engineer. Do not add comments that just describe what the code is already clearly doing — that is noise.
- Clean up before finishing: remove dead code, unused imports, leftover `console.log` statements, and any temporary workarounds unless they are intentional and documented.

---

## 8. Error Handling

- Never silently swallow errors. Always handle them explicitly — at minimum, log them with enough context to understand what went wrong and where.
- User-facing error messages should be friendly and actionable.
- Internal/server errors should be detailed in logs.
- Validate inputs at the entry point (API routes, form submissions) — not buried deep inside business logic.

---

## 9. The CONTEXT.md File (Per Project)

Every project must have a `CONTEXT.md` in its root. This is the AI's memory for that specific project — point it here first before exploring the codebase.

It should cover:
- **What the project is** — what it does, who it's for, and the core problem it solves (a short paragraph is fine).
- **Tech stack** — frameworks, languages, key libraries, database, hosting.
- **Architecture & key decisions** — how the app is structured and why, any important patterns or conventions specific to this project.
- **Current state** — what's been built, what's in progress, what's planned next.
- **Common commands** — the exact terminal commands used in this project (how to run the app, run tests, build for production, etc.). This prevents the AI from guessing and running wrong or nonexistent commands.
- **Security patterns** — auth model, how secrets are stored, and any project-specific security rules.
- **Important gotchas** — anything non-obvious that would trip up someone new to the codebase.

**Update `CONTEXT.md` after every meaningful session, feature addition, or architectural change.** A stale context file is worse than no context file.

---

## 10. Always Verify Your Output

AI-generated code can look correct and still have logic errors, missed edge cases, or subtle bugs. Before considering any task done:

- Manually test the feature or fix in the context it will actually be used.
- Think through edge cases: what happens with empty input, unexpected values, or a user doing something unexpected?
- If something feels off or too easy, it probably needs a second look. Don't ship blind.

---

## 11. Git Commit Messages

Use the **Conventional Commits** format — the widely adopted industry standard:

```
type(optional scope): short description in present tense
```

**Types:**

| Type | When to use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code restructured, behavior unchanged |
| `style` | Formatting or whitespace — no logic change |
| `docs` | Documentation only |
| `chore` | Dependencies, config, build scripts, tooling |
| `test` | Adding or updating tests |
| `perf` | Performance improvement |

**Rules:**
- Write in imperative present tense, max ~50 characters, no period at the end.
  - ✅ `feat(auth): add Google OAuth login`
  - ✅ `fix(dashboard): correct revenue total calculation`
  - ❌ `Added google login` / `fixed a bug` / `tweaks`
- Add a scope in parentheses when it helps narrow context: `fix(api):`, `feat(onboarding):`.
- Breaking changes: append `!` after the type — `feat!: rename user ID field`.
- If a commit needs more context, add a body after a blank line explaining the *why*.

---

## 12. Sensitive Areas — Ask First

Before making changes to any of the following, stop and ask for explicit confirmation:

- Authentication or authorization logic
- Payment or billing flows
- Database schema changes or data migrations (scripts that modify the structure or contents of the database)
- Any file that handles environment variables or secrets
- CI/CD pipeline or deployment configuration

These areas carry the highest risk. A quick confirmation is always worth it.

---

## 13. Dependencies

- Introduce new third-party packages only when they solve a real problem that isn't already handled in the codebase.
- Prefer well-maintained, widely adopted packages over obscure ones.
- After adding a dependency, briefly note what it's for and why it was chosen.
- Regularly review and remove packages that are no longer used.

---

## 14. Database Design & Data Fetching

Databases and queries are where performance and cost problems quietly compound. Get these right from the start.

**Schema design:**
- Design the schema intentionally before writing any queries. A well-structured schema is cheaper to fix early than later.
- Use appropriate data types — don't store numbers as strings, don't use a generic `text` field where a specific type exists.
- Add indexes on columns that are frequently filtered, sorted, or joined on. Missing indexes are the most common cause of slow queries.
- Avoid storing redundant or derived data that can be computed — unless caching it is a deliberate performance decision.

**Fetching:**
- **Never fetch more than you need.** Select only the columns required for the task — avoid `SELECT *` or fetching entire documents when only a few fields are needed.
- **Never fetch inside a loop.** Batch queries instead of making individual database calls per item (this is the classic N+1 problem — one query that returns N results, then N more queries for each).
- Paginate all list queries. Never return unbounded result sets.
- Use caching for data that is read frequently and changes rarely. Cache at the appropriate layer (in-memory, CDN, or database query cache).
- Keep expensive queries (aggregations, joins across large tables) out of the hot path — precompute or cache them where possible.

**General:**
- Log slow queries during development and treat them as bugs, not warnings.
- If a query is getting complex, step back and ask whether the schema should be adjusted instead.

---

## 15. Shell & Terminal (Windows / PowerShell)

This project is developed on **Windows**. Always use **PowerShell syntax** for any terminal commands, scripts, or shell instructions:

- Use `$env:VARIABLE` for environment variables, not `export VARIABLE=` or `$VARIABLE`.
- Use `;` to chain commands, not `&&` (or use PowerShell's `&&` operator only if targeting PowerShell 7+).
- Use `New-Item`, `Remove-Item`, `Copy-Item`, `Move-Item` for file operations — not `touch`, `rm`, `cp`, `mv`.
- Path separators: use `\` or PowerShell-safe forward slashes where supported.
- If a command only exists in bash/Unix, provide the PowerShell equivalent or note the difference explicitly.

---

## 16. Efficient AI Tool Usage

Small habits here add up to meaningful savings in tokens and quota over time:

- **Don't re-read files already in context.** If a file's content has already been provided in the current session, work from that — don't fetch it again.
- **Be concise in responses.** Explanations and summaries should be as short as they can be while still being clear. No padding, no restating the task back before doing it.
- **Don't make speculative changes.** Only edit files that are directly relevant to the current task. Avoid "while I'm here" changes to unrelated files unless asked.
- **Batch related changes.** If multiple files need to change for one task, make all the changes together rather than one file per round-trip.
- **No unnecessary confirmations.** For small, clear tasks, just do the work — don't ask "shall I proceed?" before obvious next steps.

---

*This file is reused across projects. For project-specific context, architecture, and current state — see `CONTEXT.md`.*
