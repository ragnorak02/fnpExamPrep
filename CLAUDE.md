# FNP Exam Prep App

## Project Overview

Mobile-first FNP (Family Nurse Practitioner) certification exam study app built for Seung Hee, optimized for Samsung Galaxy Z Flip. Static single-page application with no backend, no login, no build step — all user data lives in localStorage.

- **Repo**: GitHub (push to deploy)
- **Hosting**: GitHub Pages (static site)
- **Target device**: Samsung Galaxy Z Flip (360px+ viewport)

## Deployment

Push to `main` branch to deploy via GitHub Pages. No build step — files are served as-is.

```bash
git add -A && git commit -m "description" && git push
```

## Architecture

```
FNPapp/
  index.html              # SPA shell, dark theme default, 4-tab layout
  styles.css              # CSS custom properties for dark/light themes
  app.js                  # Single IIFE containing all application logic (~1315 lines)
  data/
    questions.seed.json   # 65 seed questions across 14 medical domains
    quotes.json           # 32 motivational quotes (fetched on each page load)
  README.md               # User-facing documentation
  CLAUDE.md               # This file (Claude Code context)
```

All JS is wrapped in a single `(function () { 'use strict'; ... })()` IIFE. No modules, no frameworks, no bundler.

## app.js Section Map

| Section              | Lines       | Purpose                                        |
|----------------------|-------------|-------------------------------------------------|
| STORAGE              | 4–23        | `safeParse()`, `save()` — localStorage helpers  |
| STATE                | 25–47       | Global `state` object loaded from localStorage  |
| DOM REFERENCES       | 49–51       | `$()` and `$$()` query selector shortcuts       |
| INIT                 | 53–91       | `init()` — loads quotes, seeds questions, boots UI |
| THEME                | 93–105      | `applyTheme()`, toggle handler                  |
| DAILY TRACKER        | 107–131     | `initDaily()`, `saveDailyProgress()`            |
| STREAK + TOAST       | 133–197     | `updateStreak()`, `showToast()`, streak logic   |
| TABS / NAVIGATION    | 199–225     | Tab switching, view activation                  |
| PRACTICE SESSION     | 227–604     | Question selection, rendering, scoring, summary |
| STATS                | 606–699     | Stats dashboard rendering, per-topic breakdown  |
| QUESTION BANK        | 701–958     | Search, filter, flag, mastered, edit, delete     |
| IMPORT / EXPORT      | 960–1075    | JSON import with validation/merge, JSON export  |
| SETTINGS             | 1077–1092   | Goal stepper, exclude-mastered toggle           |
| RESETS               | 1094–1173   | Reset today / stats / everything                |
| MODAL                | 1175–1208   | Generic `showModal()` / `closeModal()`          |
| UTILITIES            | 1210–1231   | `shuffleArray()`, `todayISO()`, helpers         |
| EVENT BINDINGS       | 1233–1308   | All DOM event listener registrations            |
| START                | 1308–1315   | Calls `init()` to boot the app                  |

## localStorage Schema

### `fnp:settings`
```json
{
  "theme": "dark",            // "dark" | "light"
  "questionsPerDay": 5,       // 1–50
  "reviewMode": "daily",      // "daily" | "weak" | "topic" | "flagged"
  "topicFilter": null,        // string topic name or null
  "excludeMastered": false    // boolean
}
```

### `fnp:questionBank`
Array of question objects (see Question JSON Format below). Seeded from `data/questions.seed.json` on first run; `null` until seeded.

### `fnp:history`
```json
{
  "q001": {
    "seen": 3,
    "correct": 2,
    "wrong": 1,
    "lastSeen": "2025-06-15",
    "flagged": false,
    "mastered": false
  }
}
```

### `fnp:daily`
```json
{
  "date": "2025-06-15",
  "completed": 3,
  "correct": 2,
  "wrong": 1,
  "questionIds": ["q001", "q003", "q007"]
}
```

### `fnp:usage`
```json
{
  "lastOpenISODate": "2025-06-15",
  "streakCount": 7,
  "totalDaysUsed": 42,
  "firstOpenTimestamps": ["2025-05-01T12:00:00.000Z"]
}
```

## Question JSON Format

```json
{
  "id": "q001",                          // REQUIRED: unique string ID
  "stem": "A 52-year-old female...",     // REQUIRED: question text
  "choices": ["A. ...", "B. ...", ...],  // REQUIRED: array, min 2 items
  "answer": 2,                           // REQUIRED: 0-based index of correct choice
  "rationale": "Explanation...",         // optional
  "topic": "Cardiology",                // optional (used for filtering/stats)
  "difficulty": "medium",               // optional: "easy" | "medium" | "hard"
  "tags": ["hypertension", "pharm"]     // optional: array of strings
}
```

## Question Selection Algorithm (3-Bucket Priority)

When building a practice session, questions are selected in this priority order:

1. **Bucket 1 — Previously incorrect**: Questions the user has gotten wrong (highest priority)
2. **Bucket 2 — Unseen**: Questions never attempted
3. **Bucket 3 — Seen but not mastered**: Questions answered before but not yet marked mastered, sorted by least-recently-seen

Within each bucket, questions are shuffled. The session pulls from bucket 1 first until exhausted, then bucket 2, then bucket 3, up to the configured `questionsPerDay` count.

If `excludeMastered` is enabled, mastered questions are removed from all buckets.

Practice modes apply additional filters:
- **Daily Mix**: Uses all 3 buckets with smart selection
- **Weak Areas**: Only questions from topics with <70% accuracy
- **Topic Filter**: Only questions matching the selected topic
- **Flagged Only**: Only questions the user has flagged

## Styling Conventions

- **Theme system**: CSS custom properties on `:root[data-theme="dark"]` and `:root[data-theme="light"]`
- **Max width**: 480px container, centered
- **Responsive breakpoint**: `@media (max-width: 360px)` for small phones
- **Color tokens**: `--accent`, `--correct`, `--incorrect`, `--warning` plus bg/text/border variants
- **Component patterns**: `.card`, `.btn`, `.btn-primary`/`.btn-secondary`/`.btn-danger`, `.badge`
- **Font stack**: System fonts (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ...`)
- **Touch targets**: Minimum 48px height on buttons (`min-height: 48px`)

## Content

- **65 seed questions** across 14 medical domains
- **32 motivational quotes** in `data/quotes.json`
- **14 domains**: Health Promotion & Screening, Cardiology, Pulmonology, Endocrine, GI, Renal/Urology, Dermatology, MSK, Neurology, Infectious Disease, Women's Health / OB-GYN, Pediatrics, Psychiatry, Geriatrics

## How to Add Content

### Adding questions via import (in-app)
Settings > Import > paste a JSON array of question objects. Matching IDs overwrite existing questions; new IDs are added.

### Editing the seed file
Modify `data/questions.seed.json`. This file is only read on first run or after "Reset Everything". Changes won't affect existing users until they reset.

### Editing quotes
Edit `data/quotes.json` (simple JSON array of strings). Quotes are fetched fresh on each page load — not cached in localStorage — so changes take effect immediately.

## Constraints

- **No backend**: Everything runs client-side, data in localStorage only
- **No build step**: No bundler, transpiler, or package manager — edit and deploy
- **No frameworks**: Vanilla HTML/CSS/JS only
- **No login/auth**: Single-user, single-device
- **file:// limitation**: `fetch()` for seed questions and quotes may fail on `file://` protocol in some browsers; use a local HTTP server for development
