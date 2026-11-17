# AI Engineering Workspace

> **One Workspace. Four Intelligent Agents. Infinite Possibilities.**

AI Engineering Workspace is a full-stack software engineering SaaS platform that unifies four specialized engineering tools inside one authenticated, owner-scoped workspace:

1. **Agent 1 · Code Generator** — Multi-file software architecture generator, interactive source editor, side-by-side modification diff preview, immutable version snapshots, and path-sanitized `.zip` export.
2. **Agent 2 · Website Generator** — Multi-file React/Vite & HTML/CSS/JS manifest generator with an in-browser JSX/ESM compiler, import resolver, diagnostics error panel, and opaque-origin `<iframe sandbox="allow-scripts">` live preview.
3. **Agent 3 · Document Generator** — Structured technical and business document studio with live markdown editing and native OpenXML Microsoft Word (`.docx`) compilation.
4. **Agent 4 · Data Cleaner** — CSV and Excel (`.xlsx`) statistical profiler supporting 10 deterministic cleaning operations, non-destructive before/after comparison, and valid `.csv` / `.xlsx` exports.

---

## 1. Architecture Overview

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS v4, React Router v7, Lucide Icons.
- **Code Splitting & Bundle Hygiene:** Route-level `React.lazy` + `Suspense` for all workspace pages and dynamic `import()` for heavy export libraries (`jszip`, `docx`, `xlsx`, `papaparse`), keeping the initial landing page JavaScript payload lean (~148 KB gzipped).
- **Backend Server (`server.ts`):** Node.js + Express server running on port `3000`. Hosts server-side Gemini synthesis routes (`/api/ai/*`) and the server-side salted HMAC-SHA256 6-digit Email OTP service (`/api/auth/otp/*`).
- **Authentication & Database:** Firebase Authentication (Email/Password login, Signup with 6-digit Email OTP verification, Google OAuth, and Guest Engineer mode) + Cloud Firestore (`omega-ripsaw-l7c1c` / `ai-studio-aiengineeringwor-c87510dd-88fa-4e88-8c54-78367fbab544`) with idempotent Guest-to-Account workspace migration.

---

## 2. Installation & Setup

```bash
# 1. Install dependencies
npm install

# 2. Start the full-stack development server (Express + Vite middleware on port 3000)
npm run dev

# 3. Type-check and build production assets
npm run lint
npm run build
```

---

## 3. Environment Variables

Configure environment variables in `.env` (refer to `.env.example`):

| Variable | Description |
| :--- | :--- |
| `GEMINI_API_KEY` | Server-side Google Gemini API key (never exposed to client bundles). |
| `GEMINI_MODEL` | Optional override for the server-side Gemini model (defaults to `gemini-4-hydrogen`). |
| `APP_URL` | Runtime URL of the hosted application. |
| `OTP_HMAC_SECRET` | Server-side secret used to sign and verify 6-digit Email OTP verification tokens. |
| `RESEND_API_KEY` | Primary transactional email API key for direct 6-digit OTP delivery via Resend (sufficient on its own). |
| `OTP_EMAIL_FROM` | Sender identity header used by Resend transactional emails. |
| `SMTP_WEBHOOK_URL` | **Optional.** Alternative webhook endpoint used only if explicitly set and `RESEND_API_KEY` is unavailable. |

---

## 4. Firebase Configuration & Ownership Security

- **Configuration File:** `firebase-applet-config.json` connects the client SDK (`src/lib/firebase.ts`) to the provisioned Firebase project and Firestore database.
- **Collections:**
  - `users/{userId}`
  - `codeProjects/{projectId}`
  - `websiteProjects/{projectId}`
  - `documents/{docId}`
  - `datasets/{datasetId}`
  - `activityLogs/{logId}`
- **Security Rules (`firestore.rules`):** Every workspace document enforces strict ownership (`resource.data.ownerId == request.auth.uid`), field allowlisting, and schema validation.
- **Guest-to-Account Migration (`src/utils/guestMigration.ts`):** Projects created in Guest Engineer mode (`guest_engineer_demo`) are automatically and idempotently migrated to the user's authenticated `uid` upon signup OTP verification or login, verifying `ownerId === guestUid` and recording migrated IDs in a ledger to prevent duplicates on retry.

---

## 5. AI Provider Configuration & Cost Control

- All AI requests execute exclusively on the Express backend (`server.ts`) using `@google/genai`.
- The default model is `gemini-4-hydrogen` (official economical Flash alias).
- All four agents also include deterministic, zero-credit sample project/document/dataset loaders and modification preview simulators so the entire platform can be developed, audited, and tested with **0 live Gemini API calls**.

---

## 6. Preview Compiler Capabilities & Security Boundaries

The Website Generator's live preview compiler (`src/utils/reactPreviewCompiler.ts`) performs static in-memory transpilation:

- **Supported Syntax:** Multi-file `.jsx`, `.tsx`, `.js`, `.ts`, and `.css` modules; functional components; nested JSX elements and fragments; relative (`./`, `../`), root (`/src/...`), and alias (`@/...`) imports.
- **Supported Hooks & Shims:** `useState`, `useReducer`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `createContext`, `useContext`, plus built-in offline shims for `lucide-react`, `motion` / `framer-motion`, and `clsx`.
- **Sandbox Isolation:**
  - Rendered inside `<iframe sandbox="allow-scripts">` (**without** `allow-same-origin`), assigning an opaque `null` origin that cannot access `window.parent.document`, `localStorage`, `sessionStorage`, or cookies.
  - Locked down with `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none';">` — blocking `fetch`, `XMLHttpRequest`, `WebSocket`, and external image/script exfiltration.
  - Inline `</script` and `</style` sequences in user code are escaped during bundle assembly.
  - `postMessage` status telemetry is validated against `event.source === iframeRef.current.contentWindow`, `event.origin === 'null'`, and a per-compile `previewToken`.

---

## 7. Testing Instructions

Run the complete automated unit and integration test suites using Node's native test runner via `tsx`:

```bash
# Run Phase 2 Preview Compiler & Sandbox Security tests
npx tsx --test tests/phase2_preview.test.ts

# Run Master Acceptance tests (Phase 2.1 Security, Phase 3 OTP & Migration, Phase 4 All 4 Agents)
npx tsx --test tests/master_acceptance.test.ts
```

---

## 8. Security Summary

- **No Secrets in Frontend:** `GEMINI_API_KEY` is read only inside `server.ts`.
- **Salted HMAC-SHA256 OTPs:** `src/server/otpService.ts` generates CSPRNG 6-digit OTPs, stores only salted HMAC-SHA256 hashes (`codeHash` + `salt`), verifies codes using `crypto.timingSafeEqual`, and enforces a 10-minute TTL, 60-second resend cooldown, and 5-attempt brute-force lockout.
- **Archive Path Traversal Prevention:** `sanitizeArchivePath` in `src/utils/zipExport.ts` strips `..`, leading slashes, and backslashes before adding files to `.zip` archives.
