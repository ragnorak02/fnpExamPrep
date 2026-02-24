# FNP Certification Exam Prep App

A mobile-first study tool for the Family Nurse Practitioner (FNP) certification exam (AANPCB/ANCC). Built as a static single-page app with no backend — all data stored in localStorage.

## How to Run

### Option 1: Static Hosting (Recommended)
Push to any static hosting service (GitHub Pages, Netlify, Vercel) and open the URL.

### Option 2: Local Server
```bash
# Using npx (Node.js required)
npx serve .

# Using Python
python -m http.server 8000
```

Then open `http://localhost:5000` (or `8000` for Python).

### Option 3: Direct File
Open `index.html` directly in a browser. Note: question seeding via `fetch()` may not work with the `file://` protocol in some browsers. Use a local server if questions don't load.

## Features

- **Practice Mode**: Daily mix, weak areas, topic filter, or flagged-only sessions
- **Smart Question Selection**: Prioritizes questions you got wrong, then unseen, then least recently seen
- **Stats Dashboard**: Overall accuracy, per-topic breakdown (weakest first), streak tracking
- **Question Bank**: Search, filter, flag, mark as mastered, edit, and delete questions
- **Import/Export**: JSON-based import with validation and merge support
- **Dark/Light Theme**: Toggle between themes; preference saved
- **Daily Goal**: Configurable questions-per-day goal with progress tracking
- **Streak Tracking**: Consecutive days of use with motivational toasts
- **Mobile-First**: Optimized for 360px+ screens (Samsung Galaxy Z Flip)

## Import/Export Format

Export produces (and import expects) a JSON array:

```json
[
  {
    "id": "q001",
    "stem": "A 45-year-old female presents with...",
    "choices": ["A. Option one", "B. Option two", "C. Option three", "D. Option four"],
    "answer": 2,
    "rationale": "The correct answer is C because...",
    "topic": "Cardiology",
    "difficulty": "medium",
    "tags": ["hypertension", "pharmacology"]
  }
]
```

**Required fields**: `id`, `stem`, `choices` (array, min 2), `answer` (0-based index)
**Optional fields**: `rationale`, `topic`, `difficulty`, `tags`

**Import behavior**: Matching IDs overwrite existing questions; new IDs are added.

## localStorage Keys

| Key | Description |
|-----|-------------|
| `fnp:settings` | Theme, questions-per-day, review mode, exclude mastered |
| `fnp:questionBank` | Array of all questions |
| `fnp:history` | Per-question stats (times seen, correct, wrong, flagged, mastered) |
| `fnp:daily` | Current day's session progress |
| `fnp:usage` | Streak count, total days used, open timestamps |

## Editing Quotes

Edit `data/quotes.json` — it's a simple JSON array of strings. Quotes are fetched fresh on each page load (not cached in localStorage), so changes take effect immediately.

## Adding Questions

Two ways to add questions:

1. **In-app Import**: Go to Settings > Import, paste a JSON array
2. **Edit seed file**: Modify `data/questions.seed.json` (only used on first run or after "Reset Everything")

## Topics Covered

- Health Promotion & Screening
- Cardiology
- Pulmonology
- Endocrine
- GI
- Renal/Urology
- Dermatology
- MSK
- Neurology
- Infectious Disease
- Women's Health / OB-GYN
- Pediatrics
- Psychiatry
- Geriatrics
