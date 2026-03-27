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

**Single-page monolith**: All application logic lives in `app.js`, all markup in `index.html`, all styles in `style.css`. There is no module system or component framework.

**Firebase data model** (Firestore):
```
users/{userId}/
  ├── sadhana/{date}     — daily entry (times, minutes, scores, totalScore, dayPercent)
  ├── tapah/{date}       — daily tapah entry (anukulAnswers, pratikulAnswers, totalScore)
  └── editHistory/{ts}   — audit trail for edits (date, previousData, reason)
```

**Key global state variables**: `currentUser`, `userProfile`, `editingDate`

**Tab-based UI**: Sadhana, Reports, Tapah, Charts, Settings — all rendered in-page via DOM manipulation and show/hide logic.

## Scoring System

8 sadhana metrics scored on tiered scales (25/20/15/10/5/0/-5 points each). Daily max ~175 points, weekly max ~1225 points. Scoring logic is in `app.js` — look for `calculateScores` and related functions.

**Tapah scoring**: Anukul (favorable) questions at 5 points each; Pratikul (unfavorable) with variable scoring. Uses a flash-card UI for entry.

## Date Handling

Custom `toLocalDateStr()` and `parseLocalDate()` functions are used throughout to avoid UTC timezone bugs. Always use these instead of raw `Date` constructors when working with date strings.

## Service Worker Caching Strategy

- **Static assets**: Cache-first (enables offline use)
- **Firebase/API calls**: Network-first (ensures fresh data)
- Cache name: `sadhana-tracker-v1` — bump version when updating cached assets

## Key Conventions

- No framework — all UI updates are direct DOM manipulation
- Firebase 8.x compat API (not modular v9+ syntax)
- Auth state drives UI via `auth.onAuthStateChanged()`
- All async operations use async/await
