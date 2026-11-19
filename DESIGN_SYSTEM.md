# PoliNetwork StudyLab — Design System & Functional Architecture

## 1. Information Architecture (4 Primary Destinations)
| Destination | Route | User Intent | Key Components |
|---|---|---|---|
| **Panoramica** | `#overview` | Orientation, progress awareness, next best action | Editorial Briefing, Weighted Mastery Ring, Live Deadline Strip, Hairline Metric Strip, Document Directory |
| **Normativa** | `#reader/<id>[/cloze]` | Verbatim study, cross-referencing, inline memorization | TOC Sidebar / Mobile Slide-Over Drawer, Editorial Prose Sheet, Inline `Lettura / A Memoria` Switch, Related Drills |
| **Allenamento** | `#practice/<mode>` | Active recall & verification | Unified Practice Studio (`Flashcards`, `Quiz & Casi`, `A Memoria`), 1-Line Filter Summary + Collapsible Tray |
| **Sinossi** | `#reference/<tab>` | Fast operational lookup during or before assemblies | Horizontal Underline Rail (`Cronoprogramma 2026`, `Quorum`, `Organi`, `Scadenze`, `Gerarchia & STV`, `Schemi PDF`) |

## 2. Design Tokens (`styles.css`)
- **Themes:**
  - **Light (Default — Carta & Inchiostro):** `--bg-canvas: #f6f5f0`, `--bg-surface: #ffffff`, `--bg-subtle: #efede6`, `--ink-primary: #111827`, `--ink-secondary: #3f4957`, `--ink-tertiary: #525f70`, `--accent: #1d4ed8`.
  - **Dark (Grafite & Cobalto):** `--bg-canvas: #0d1017`, `--bg-surface: #141923`, `--bg-subtle: #1a2130`, `--ink-primary: #f3f4f6`, `--ink-secondary: #b1bac8`, `--ink-tertiary: #939eb0`, `--accent: #3b82f6`.
- **Typography:**
  - Display & Headings: `Source Serif 4`
  - UI & Verbatim Legal Prose: `Inter` (`max-width: 70ch`, scalable `--reader-scale: 0.85–1.30`)
  - Normative Codes, Dates, Counters & Formulas: `JetBrains Mono` (`tabular-nums`)
- **Semantic Status Dots:**
  - `s0` Da studiare (Neutral) · `s1` In corso (Amber) · `s2` Imparato (Emerald) · `s3` A memoria (Violet)

## 3. Epistemic Learning Model (Data Integrity Contract)
The application strictly distinguishes four epistemic states:
1. **Visualizzato:** Opening an article in `Normativa` updates `lastSecId` for session continuity only; it never claims learning.
2. **Rivelato (passivo):** Using *Mostra testo*, *Suggerisci 1*, or `?` in Testo a scomparsa styles tokens in amber (`.peeked`), increments `revealed` (not `recalled`), and never auto-promotes mastery.
3. **Ricordato (attivo):** Accurately typing tokens without peek (or verifying individually in click mode) increments `recalled`, displays exact recall accuracy, and promotes unstudied (`0`) articles to `In corso (1)` without downgrading higher states.
4. **Consolidato / Appreso:** Explicit user mastery (`Imparato` / `A memoria`), SM-2 spaced repetition progression (`computeNextSM2`), and verified quiz mastery (`quizMastered`).

## 4. Responsive & Accessibility Contract (WCAG 2.2 AA)
- **Breakpoints:** Desktop (`> 1024px`), Compact Desktop (`901–1024px`), Tablet/Mobile Bottom Nav (`<= 900px`), Compact Mobile (`<= 640px`), Small Phone (`<= 380px`, tested down to `320px`).
- **Accessibility:** Skip-link, semantic landmarks, keyboard focus trap inside modals & mobile TOC drawer, `body.modal-open` scroll lock, `aria-live="polite"` feedback regions, zero native `alert()`/`confirm()`, `prefers-reduced-motion` support.
