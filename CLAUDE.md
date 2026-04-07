# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RAPD Sadhana Tracker — a Progressive Web App (PWA) for devotees to record and track daily spiritual practice (sadhana) metrics. Built with vanilla JavaScript and Firebase, no build step required.

## Tech Stack

- **Frontend**: Vanilla JS (ES6+), custom CSS3 with CSS variables
- **Backend/DB**: Firebase 8.10.1 (Firestore + Authentication)
- **Charts**: Chart.js 4.4.0
- **Excel Export**: SheetJS (XLSX 0.20.0)
- **PWA**: Service Worker (`sw.js`) + Web Manifest (`manifest.json`)

## Running the App

Open `index.html` in a browser. No build tools, no npm, no bundler. Libraries are loaded via CDN.

## Architecture

**Single-page monolith**: All logic in `app.js` (~3200 lines), all markup in `index.html`, styles in `style.css` + heavy inline styles in `index.html`. No module system or component framework.

**Firebase data model** (Firestore):
```
users/{userId}/
  ├── sadhana/{date}     — daily entry (times, minutes, scores, totalScore, dayPercent)
  ├── tapah/{date}       — daily tapah entry (anukulAnswers, pratikulAnswers, totalScore)
  └── editHistory/{ts}   — audit trail for edits (date, previousData, reason)
```

**Key global state**: `currentUser`, `userProfile`, `editingDate`, `scoreChart`, `activityChart`

**Tab-based UI** (bottom nav): Home → Sadhna → Tapah → Settings. Sadhna and Tapah each have 3 sub-tabs: Entry, Reports, Progress. All tabs use show/hide via `showSection()` / `switchMainTab()` / `switchSubTab()`.

### Major `app.js` Sections (by line region)

| Lines | Section | Key Functions |
|-------|---------|---------------|
| 1–60 | Firebase init, helpers | `toLocalDateStr()`, `parseLocalDate()`, `t2m()`, `getNRData()` |
| 60–420 | Excel import/export | `downloadUserExcel()`, `importExcelFile()` |
| 420–490 | UI navigation | `showSection()`, `switchMainTab()`, `switchSubTab()` |
| 489–702 | Home screen | `loadHomeScreen()` — weekly summary ring, day dots, activity bars |
| 704–730 | Auth state | `auth.onAuthStateChanged()` — drives entire UI |
| 733–920 | Scoring engine & form | `computeScores()`, form submit handler |
| 980–1160 | Edit & history | `editEntry()`, `viewEditHistory()` |
| 1160–1580 | Reports | Weekly cards, 4-week comparison (`generate4WeekComparison`), activity analysis |
| 1580–1998 | Charts | Score ring, line chart (28d/4w/6m), activity bar chart |
| 1998–2350 | Tapah flashcard | 10-question flash-card entry, `submitTapahFromFlash()` |
| 2350–3000 | Activity analysis modal | `openActivityAnalysis()`, `loadActivityAnalysis()` |
| 3000+ | Profile, password, misc | Profile pic upload, forgot/change password |

## Scoring System

8 sadhana metrics scored on tiered scales (25/20/15/10/5/0/-5 points each). Daily max = **175 points**, weekly max = **1225 points**. Scoring logic is in `computeScores()`.

**NR (Not Reported) penalty**: When a past day has no entry, `getNRData()` returns totalScore = **-40**, dayPercent = **-23%**, with **-5 for every activity including daySleep**. NR days are included in all weekly calculations — they are NOT skipped.

**APP_START_DATE** (`const APP_START_DATE = '2026-03-27'` at line 24): Days before this date are never penalized as NR — they are simply skipped in all calculations (reports, charts, ring). This is the app launch date.

**Today exception**: If today is not yet filled, it gets `null` (no penalty) — penalty only applies to past unfilled days on/after APP_START_DATE.

**Tapah scoring**: Anukulasya — 5 pts (yes), 2 (partial), 0 (no). Pratikulasya — 5 pts (no), 2 (partial), -5 (yes). Flash-card UI with 10 questions.

## Date Handling

Custom `toLocalDateStr()` and `parseLocalDate()` functions are used throughout to avoid UTC timezone bugs (users are in IST). Always use these instead of raw `Date` constructors when working with date strings.

Week boundaries: Sunday–Saturday. `getWeekInfo()` returns the week's Sunday date.

## Service Worker Caching Strategy

- **App HTML/JS/CSS**: Network-first (ensures updates)
- **Other static assets**: Cache-first (offline support)
- **Firebase/API calls**: Always network-first (bypasses cache)
- Cache name: `sadhana-tracker-v3` — bump version when updating cached assets

## Key Conventions

- No framework — all UI updates are direct DOM manipulation
- Firebase 8.x compat API (not modular v9+ syntax)
- Auth state drives UI via `auth.onAuthStateChanged()`
- All async operations use async/await
- Majority of component styling is inline in HTML template literals within `app.js`
- `signup.html` is a separate page for new user registration

## Related Apps

The parent directory contains related apps:
- **Coordinators-Sadhana-App/** — Coordinator/admin version with leaderboards, rankings, user management, and reject/approve functionality
- Other branches/versions in sibling folders
