# PoliNetwork Studio — Design System & Technical Architecture (`v4.4.0`)

## 1. Information Architecture (4 Primary Destinations)
| Destination | Route | User Intent | Key Components |
|---|---|---|---|
| **Studio** | `#overview` | Orientation, progress ring, next best action, live election countdown & Cloud sync status | Bento Hero Card, Weighted Mastery Ring (`role="progressbar"`), iOS Calendar Event Card (`Europe/Rome`), 3-Stat Card, Inset Grouped Document List, Google Cloud Sync Card |
| **Norme** | `#reader/<id>[/cloze]` | Verbatim legal study, cross-referencing, inline Cloze recall | TOC Sidebar / Mobile Slide-Over Drawer, Full-Bleed Reading Sheet, Sticky iOS Nav Bar, Inline `Leggi / Cloze` Tabs, Related Flashcards & Quiz |
| **Pratica** | `#practice/<mode>[/<id>]` | Active recall & exam verification | Unified Practice Studio (`Flashcard` SM-2, `Quiz` with Fisher-Yates question+option shuffling, `Cloze` 4-level generator), Collapsible Filter Trays, Sticky Mobile Thumb Dock |
| **Sinossi** | `#reference/<tab>` | Fast operational lookup during or before assemblies | Pill Rail (`Cronoprogramma`, `Quorum`, `Organi`, `Scadenze`, `STV`, `Schemi PDF`), Accent-Insensitive Filter, Responsive Borderless Cards on Mobile, PDF Lightbox |

## 2. Design Tokens (`styles.css`)
- **Light Theme (Apple Grouped Default):**
  - Canvas `#f2f2f7` (`--bg-canvas`), Surface `#ffffff` (`--bg-surface`), Subtle `#efeff4` (`--bg-subtle`), Hover `#e5e5ea` (`--bg-hover`)
  - Inks `#1c1c1e` / `#5c5c62` / `#59595e`, Field Border `#8a8a93`
  - Accent Apple Blue `--accent: #0071e3`, `--accent-text: #005ec4`, `--accent-soft: #e6f2ff`
  - Semantics: `--red-solid: #c81e1e` (≥5.7:1 AA), `--orange: #ff9500`, `--green: #34c759`, `--indigo: #5856d6`
- **Dark Theme (True OLED Graphite):**
  - Canvas `#000000`, Surface `#1c1c1e`, Subtle `#2c2c2e`, Hover `#3a3a3c`, Field Border `#7c7c85` (≥3.3:1 Non-Text AA)
  - Inks `#ffffff` / `#b8b8bf` / `#a6a6ae`, `--red-solid: #d72c24` (≥4.6:1 AA)
  - Anti-FOUC synchronous `<script>` in `<head>` applies `data-theme` and `theme-color` before first paint.
- **Typography:**
  - Display & Titles: `Plus Jakarta Sans` + `-apple-system` / `SF Pro Display` / `Inter`
  - Body & Verbatim Prose: system sans / `Inter` (`max-width: 720px`, scalable `--reader-scale: 0.88–1.28`)
  - Code / Formulas / Diagnostic Console: `ui-monospace` (`SFMono-Regular`, `Menlo`, `Consolas`)
- **Semantic Status Dots:**
  - `s0` Da studiare (Neutral) · `s1` In corso (Orange) · `s2` Imparato (Green) · `s3` A memoria (Apple Blue `--accent`)

## 3. Epistemic Learning & Cloze Model
1. **Visualizzato:** Opening an article updates `lastSecId` via `saveState({ light: true })` (no `updatedAt` bump, no Cloud write, never claims learning).
2. **Rivelato (passivo):** `+1 aiuto`, `Mostra tutte`, or `?` marks tokens as `.peeked` (amber), increments `revealed` (not `recalled`), and never promotes mastery.
3. **Ricordato (attivo):** Matching tokens (with elision handling `l’/dell’/all’/…`, Euro/decimal normalization, and non-spoiling numeric masks) increments `recalled`; completing with ≥50% recall promotes `0 → 1`.
4. **Consolidato / Appreso:** Explicit mastery (`Imparato` / `A memoria`), SM-2 spaced repetition with undo tombstones (`_ts.sm2Del`), and per-device quiz statistics (`quizStats.byDevice`).

## 4. Cloud Sync, Privacy & Security Architecture
- **Firebase Cloud Sync (Schema v2):** Google Sign-In (`signInWithPopup` + mobile `signInWithRedirect`), single-collection `users/{uid}`, persistent multi-tab IndexedDB offline cache (`persistentLocalCache`), single-flight debounced push (`1.5s` / `maxWait 10s`), exponential backoff retry (`1s → 60s`), automatic token refresh on `permission-denied`, and real-time `onSnapshot` listener with active-session preservation.
- **CRDT Lossless Merge:** Per-item last-writer-wins timestamps (`_ts.mastery`, `_ts.bookmarks`, `_ts.quizMastered`, `_ts.sm2Del`), additive per-device quiz counters, strict whitelist sanitization (`normalizeStateObject`), and shared-device account isolation (`ownerUid`).
- **Security & GDPR:** Production Cloud Firestore Security Rules (`firestore.rules`), `<meta http-equiv="Content-Security-Policy">`, strict opt-in GDPR consent banner (Google Analytics loads only after explicit consent), PII masking in Diagnostic Console logs, and localhost-bound dev server (`avvia_app.bat --bind 127.0.0.1`).

## 5. Responsive & Accessibility Contract (WCAG 2.2 AA)
- **Breakpoints:** Desktop (`> 900px`), Mobile iOS Pill Nav (`<= 900px`), Compact (`<= 480px`), Small Phone / Short Viewport (`<= 380px` or `max-height: 700px`).
- **A11y:** Skip-link, semantic landmarks, `<noscript>` fallback, full WAI-ARIA `tablist`/`tabpanel` + roving `tabindex` + Arrow/Home/End navigation, ARIA combobox/listbox search, focus trap with modal anti-stacking, safe-area insets (`env(safe-area-inset-*)`), `dvh` modals, and `prefers-reduced-motion` (including `transition-delay: 0s`).
