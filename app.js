// --- 1. FIREBASE SETUP ---
const firebaseConfig = {
    apiKey: "AIzaSyDMXB0mD3fZPpCQti9Ikt-MdBjzmfBNfJs",
    authDomain: "nimai-nitai.firebaseapp.com",
    projectId: "nimai-nitai",
    storageBucket: "nimai-nitai.firebasestorage.app",
    messagingSenderId: "221744100000",
    appId: "1:221744100000:web:24830d9a7d9a5cb4d3cfc5"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();
let currentUser = null, userProfile = null, activeListener = null;
let scoreChart = null, activityChart = null;
// For edit-mode tracking
let editingDate = null;

// --- 2. HELPERS ---
// App start date — days before this date are not penalised as NR (app didn't exist yet)
const APP_START_DATE = '2026-03-27';

// Local date helpers — avoids toISOString() UTC bug
// (IST users between midnight–5:30 AM would get yesterday's date with toISOString)
function toLocalDateStr(date) {
    const d = date || new Date();
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}
function parseLocalDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}
const t2m = (t, isSleep = false) => {
    if (!t || t === "NR") return 9999;
    let [h, m] = t.split(':').map(Number);
    if (isSleep && h >= 0 && h <= 3) h += 24;
    return h * 60 + m;
};

function getWeekInfo(dateStr) {
    const MONTHS_WK = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const d = new Date(dateStr + 'T00:00:00');
    const sun = new Date(d); sun.setDate(d.getDate() - d.getDay());
    const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
    const fmt = (date) => `${String(date.getDate()).padStart(2,'0')} ${MONTHS_WK[date.getMonth()]}`;
    return { sunStr: toLocalDateStr(sun), label: `${fmt(sun)} to ${fmt(sat)}_${sun.getFullYear()}` };
}

function getNRData(date) {
    return {
        id: date, totalScore: -40, dayPercent: -23,
        sleepTime: "NR", wakeupTime: "NR", morningProgramTime: "NR", chantingTime: "NR",
        readingMinutes: "NR", hearingMinutes: "NR", notesMinutes: "NR", daySleepMinutes: "NR",
        scores: { sleep: -5, wakeup: -5, morningProgram: -5, chanting: -5, reading: -5, hearing: -5, notes: -5, daySleep: -5 }
    };
}

// --- 3. DOWNLOAD EXCEL LOGIC ---
window.downloadUserExcel = async (userId, userName) => {
    try {
        if (typeof XLSX === 'undefined') { alert("Excel Library not loaded. Please wait 2 seconds and try again."); return; }
        const snap = await db.collection('users').doc(userId).collection('sadhana').get();
        if (snap.empty) { alert("No data found to download."); return; }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, _buildSadhnaWs(snap), 'Sadhna History');
        XLSX.writeFile(wb, `${userName}_Sadhna_History.xlsx`);
    } catch (err) {
        console.error(err);
        alert("Could not download Excel. Please check your internet connection and try again.");
    }
};

// --- 3B. IMPORT EXCEL LOGIC ---

// Convert "11.35 pm", "4.30 am", "03:00", "22:30" etc. to 24h "HH:MM"
function parseTimeTo24h(raw) {
    if (!raw) return null;
    let s = String(raw).trim().toLowerCase();
    if (s === 'nr' || s === '' || s === 'no' || s === 'not done' || s === 'nd') return null;

    // Already 24h format like "22:30" or "03:00"
    const match24 = s.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) return String(match24[1]).padStart(2,'0') + ':' + match24[2];

    // AM/PM format: "11.35 pm", "4:30 am", "03.00 pm", "7.00am"
    const matchAMPM = s.match(/^(\d{1,2})[.:](\d{2})\s*(am|pm)$/);
    if (matchAMPM) {
        let h = parseInt(matchAMPM[1]);
        const m = matchAMPM[2];
        const ampm = matchAMPM[3];
        if (ampm === 'pm' && h !== 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
        return String(h).padStart(2,'0') + ':' + m;
    }

    // Try just "HH.MM" without am/pm (treat as 24h)
    const matchDot = s.match(/^(\d{1,2})\.(\d{2})$/);
    if (matchDot) return String(matchDot[1]).padStart(2,'0') + ':' + matchDot[2];

    return null; // unrecognized
}

// Parse "0 min", "30 min", "7 hrs", "40 MIN", just "30", etc. to number of minutes
function parseMinsValue(raw) {
    if (!raw && raw !== 0) return 0;
    let s = String(raw).trim().toLowerCase();
    if (s === 'nr' || s === '' || s === 'no') return 0;

    // "7 hrs" or "7hrs"
    const hrsMatch = s.match(/^(\d+(?:\.\d+)?)\s*hrs?$/);
    if (hrsMatch) return Math.round(parseFloat(hrsMatch[1]) * 60);

    // "30 min" or "30min" or "40 MIN"
    const minMatch = s.match(/^(\d+(?:\.\d+)?)\s*min$/);
    if (minMatch) return Math.round(parseFloat(minMatch[1]));

    // Plain number
    const num = parseFloat(s);
    return isNaN(num) ? 0 : Math.round(num);
}

window.importExcelFile = async (input) => {
    if (!input.files || !input.files[0]) return;
    if (!currentUser) { alert('Please login first.'); return; }
    if (typeof XLSX === 'undefined') { alert('Excel library not loaded yet. Please wait a moment and try again.'); return; }

    const file = input.files[0];
    input.value = '';

    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (!rows || rows.length < 2) {
            alert('This file appears to be empty or not in the correct format.');
            return;
        }

        const MONTHS_MAP = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
        const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Thur','Fri','Sat'];
        const DAY_INDEX = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Thur:4, Fri:5, Sat:6 };

        // Detect format: check if header row has "Mks" columns (export format) or not (simple format)
        let isExportFormat = false;
        for (const row of rows) {
            if (!row || !row[0]) continue;
            const c0 = String(row[0]).trim();
            if (c0 === 'Day') {
                // Check if column 2 is "Mks"
                isExportFormat = row[2] && String(row[2]).trim() === 'Mks';
                break;
            }
        }

        // Column indices based on format
        // Simple: [Day, Bed, Wake, Japa, MP, DS, Pathan, Sarwan, Notes]
        // Export: [Day, Bed, Mks, Wake, Mks, Japa, Mks, MP, Mks, DS, Mks, Pathan, Mks, Sarwan, Mks, Notes, Mks, Day%]
        const COL = isExportFormat
            ? { bed:1, wake:3, japa:5, mp:7, ds:9, read:11, hear:13, notes:15 }
            : { bed:1, wake:2, japa:3, mp:4, ds:5, read:6, hear:7, notes:8 };

        const entries = [];
        let currentYear = new Date().getFullYear();
        let weekStartDate = null;

        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            if (!row || row[0] === undefined || row[0] === null) continue;
            const cell0 = String(row[0]).trim();
            if (!cell0) continue;

            // Detect week header: "WEEK: DD Mon to DD Mon_YYYY" or "DD Mon to DD Mon_YYYY"
            const weekMatch = cell0.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+to\s+\d{1,2}\s+\w+/i);
            if (weekMatch) {
                const yearMatch = cell0.match(/_?(\d{4})/);
                if (yearMatch) currentYear = parseInt(yearMatch[1]);
                const startDay = parseInt(weekMatch[1]);
                const startMonth = MONTHS_MAP[weekMatch[2]];
                if (startMonth !== undefined) {
                    weekStartDate = new Date(currentYear, startMonth, startDay);
                }
                continue;
            }

            // Skip non-day rows
            if (cell0 === 'Day' || cell0.startsWith('Total') || cell0.startsWith('Sadhna') || cell0.startsWith('Sadhana')
                || cell0 === 'OVERALL' || cell0.startsWith('WEEK') || cell0.startsWith('OVERALL')) continue;

            // Match day rows: "Sun 08", "Mon 09", "Thur 12", "Sat 14" etc.
            const dayMatch = cell0.match(/^(Sun|Mon|Tue|Wed|Thu|Thur|Fri|Sat)\s+(\d{1,2})$/i);
            if (!dayMatch) continue;

            const dayName = dayMatch[1].charAt(0).toUpperCase() + dayMatch[1].slice(1).toLowerCase();
            const dayOfMonth = parseInt(dayMatch[2]);
            const dayIdx = DAY_INDEX[dayName];
            if (dayIdx === undefined) continue;

            // Calculate actual date
            let entryDate;
            if (weekStartDate) {
                entryDate = new Date(weekStartDate);
                entryDate.setDate(weekStartDate.getDate() + dayIdx);
            } else {
                entryDate = new Date(currentYear, new Date().getMonth(), dayOfMonth);
            }
            const dateStr = toLocalDateStr(entryDate);

            // Get raw cell values
            const rawBed   = row[COL.bed]   !== undefined ? String(row[COL.bed]).trim()   : '';
            const rawWake  = row[COL.wake]  !== undefined ? String(row[COL.wake]).trim()  : '';
            const rawJapa  = row[COL.japa]  !== undefined ? String(row[COL.japa]).trim()  : '';
            const rawMP    = row[COL.mp]    !== undefined ? String(row[COL.mp]).trim()     : '';
            const rawDS    = row[COL.ds]    !== undefined ? row[COL.ds]                    : 0;
            const rawRead  = row[COL.read]  !== undefined ? row[COL.read]                 : 0;
            const rawHear  = row[COL.hear]  !== undefined ? row[COL.hear]                 : 0;
            const rawNotes = row[COL.notes] !== undefined ? row[COL.notes]                : 0;

            // Parse times (handles "11.35 pm", "03:00", "22:30" etc.)
            const sleepTime   = parseTimeTo24h(rawBed);
            const wakeupTime  = parseTimeTo24h(rawWake);
            const chantingTime = parseTimeTo24h(rawJapa);
            const mpTimeParsed = parseTimeTo24h(rawMP);

            // Morning program: "no", "Not Done", "ND" = not done
            const mpLower = rawMP.toLowerCase();
            const mpNotDone = mpLower === 'no' || mpLower === 'not done' || mpLower === 'nd' || mpLower === '✗ nd';
            const mpTimeClean = mpNotDone ? 'Not Done' : (mpTimeParsed || 'NR');

            // Parse minutes (handles "30 min", "7 hrs", "0 min", plain numbers)
            const dsSleepMins  = parseMinsValue(rawDS);
            const readingMins  = parseMinsValue(rawRead);
            const hearingMins  = parseMinsValue(rawHear);
            const notesMins    = parseMinsValue(rawNotes);

            // Skip fully empty rows
            if (!sleepTime && !wakeupTime && !chantingTime && !mpTimeParsed && !mpNotDone
                && readingMins === 0 && hearingMins === 0 && notesMins === 0 && dsSleepMins === 0) continue;

            // Compute scores
            const scores = computeScores(
                sleepTime || 'NR',
                wakeupTime || 'NR',
                mpNotDone ? '' : (mpTimeParsed || 'NR'),
                mpNotDone,
                chantingTime || 'NR',
                readingMins, hearingMins, notesMins, dsSleepMins
            );
            const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
            const dayPercent = Math.round((totalScore / 175) * 100);

            entries.push({
                dateStr,
                data: {
                    sleepTime: sleepTime || 'NR',
                    wakeupTime: wakeupTime || 'NR',
                    morningProgramTime: mpTimeClean,
                    chantingTime: chantingTime || 'NR',
                    readingMinutes: readingMins,
                    hearingMinutes: hearingMins,
                    notesMinutes: notesMins,
                    daySleepMinutes: dsSleepMins,
                    scores, totalScore, dayPercent,
                    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    importedFromExcel: true
                }
            });
        }

        if (entries.length === 0) {
            alert('No valid sadhna entries found in this file.\n\nMake sure it has a week header like "08 Mar to 14 Mar_2025" and day rows like "Sun 08".');
            return;
        }

        // Sort entries by date
        entries.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
        const oldest = entries[0].dateStr;
        const newest = entries[entries.length - 1].dateStr;
        const confirmed = confirm(
            `Found ${entries.length} sadhna entries (${oldest} to ${newest}).\n\n` +
            `Existing entries for the same dates will be overwritten.\n\nContinue?`
        );
        if (!confirmed) return;

        // Progress modal
        const modal = document.createElement('div');
        modal.id = 'import-progress-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `
            <div style="background:white;border-radius:14px;max-width:340px;width:100%;padding:28px;text-align:center;">
                <div style="font-size:36px;margin-bottom:10px;">📤</div>
                <div style="font-weight:700;font-size:16px;color:#2c3e50;margin-bottom:8px;">Importing Sadhna...</div>
                <div id="import-progress-text" style="font-size:13px;color:#888;">0 / ${entries.length}</div>
                <div style="margin-top:12px;background:#eee;border-radius:6px;height:8px;overflow:hidden;">
                    <div id="import-progress-bar" style="width:0%;height:100%;background:#3498db;border-radius:6px;transition:width 0.3s;"></div>
                </div>
            </div>`;
        document.body.appendChild(modal);

        let imported = 0;
        const BATCH_SIZE = 400;
        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = entries.slice(i, i + BATCH_SIZE);
            chunk.forEach(entry => {
                const ref = db.collection('users').doc(currentUser.uid).collection('sadhana').doc(entry.dateStr);
                batch.set(ref, entry.data);
            });
            await batch.commit();
            imported += chunk.length;
            const progText = document.getElementById('import-progress-text');
            const progBar = document.getElementById('import-progress-bar');
            if (progText) progText.textContent = `${imported} / ${entries.length}`;
            if (progBar) progBar.style.width = Math.round((imported / entries.length) * 100) + '%';
        }

        modal.innerHTML = `
            <div style="background:white;border-radius:14px;max-width:340px;width:100%;padding:28px;text-align:center;">
                <div style="font-size:36px;margin-bottom:10px;">✅</div>
                <div style="font-weight:700;font-size:16px;color:#27ae60;margin-bottom:8px;">Import Complete!</div>
                <div style="font-size:13px;color:#888;margin-bottom:16px;">${imported} entries imported successfully.</div>
                <button onclick="document.getElementById('import-progress-modal').remove();_reportsLoading=false;loadReports(currentUser.uid,'weekly-reports-container');"
                    style="padding:10px 24px;background:#3498db;color:white;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;width:auto;">
                    OK
                </button>
            </div>`;
    } catch (err) {
        console.error('Import error:', err);
        const modal = document.getElementById('import-progress-modal');
        if (modal) modal.remove();
        alert('Could not import the file. Please make sure it is a valid Excel file with the correct format.');
    }
};

// --- 3C. TAPAH EXCEL DOWNLOAD ---
window.downloadTapahExcel = async () => {
    if (!currentUser) { alert('Please login first.'); return; }
    if (typeof XLSX === 'undefined') { alert('Excel library not loaded yet. Please wait and try again.'); return; }
    try {
        const snap = await db.collection('users').doc(currentUser.uid).collection('tapah').get();
        if (snap.empty) { alert('No Tapah data found to download.'); return; }
        const docs = [];
        snap.forEach(doc => docs.push({ id: doc.id, ...doc.data() }));
        docs.sort((a,b) => a.id.localeCompare(b.id));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, _buildTapahWs(docs), 'Tapah History');
        XLSX.writeFile(wb, `${userProfile?.name || 'My'}_Tapah_History.xlsx`);
    } catch (err) {
        alert('Could not download. Error: ' + (err.code || err.message));
    }
};
// ── Tapah worksheet builder ────────────────────────────────────────
function _buildTapahWs(docs) {
        const dates   = docs.map(d => d.id);
        const numCols = 2 + dates.length + 2;

        const thinGrey  = { style: 'thin',   color: { rgb: 'BBBBBB' } };
        const medDark   = { style: 'medium',  color: { rgb: '555555' } };
        const medGreen  = { style: 'medium',  color: { rgb: '1A7A3C' } };
        const medRed    = { style: 'medium',  color: { rgb: 'A93226' } };
        const medNavy   = { style: 'medium',  color: { rgb: '1E4D8C' } };
        const allThin   = { top: thinGrey, bottom: thinGrey, left: thinGrey, right: thinGrey };
        const allMedDrk = { top: medDark,  bottom: medDark,  left: medDark,  right: medDark  };

        const S = {
            header:    { font:{ bold:true, sz:11, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'2C3E50' } }, alignment:{ horizontal:'center', vertical:'center', wrapText:true }, border: allMedDrk },
            hdrLabel:  { font:{ bold:true, sz:11, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'2C3E50' } }, alignment:{ horizontal:'left',   vertical:'center', wrapText:true }, border: allMedDrk },
            anuHdr:    { font:{ bold:true, sz:12, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'1D6A39' } }, alignment:{ horizontal:'left',   vertical:'center' }, border:{ top:medGreen, bottom:medGreen, left:medGreen, right:medGreen } },
            anuHdrC:   { font:{ bold:true, sz:12, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'1D6A39' } }, alignment:{ horizontal:'center', vertical:'center' }, border:{ top:medGreen, bottom:medGreen, left:medGreen, right:medGreen } },
            praHdr:    { font:{ bold:true, sz:12, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'922B21' } }, alignment:{ horizontal:'left',   vertical:'center' }, border:{ top:medRed,   bottom:medRed,   left:medRed,   right:medRed   } },
            praHdrC:   { font:{ bold:true, sz:12, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'922B21' } }, alignment:{ horizontal:'center', vertical:'center' }, border:{ top:medRed,   bottom:medRed,   left:medRed,   right:medRed   } },
            qLabel:    { font:{ sz:10, color:{ rgb:'2C3E50' } }, fill:{ patternType:'solid', fgColor:{ rgb:'F4FBF7' } }, alignment:{ horizontal:'left',   vertical:'center' }, border: allThin },
            qCell:     { font:{ sz:10, color:{ rgb:'2C3E50' } }, fill:{ patternType:'solid', fgColor:{ rgb:'F4FBF7' } }, alignment:{ horizontal:'center', vertical:'center' }, border: allThin },
            qLabelR:   { font:{ sz:10, color:{ rgb:'2C3E50' } }, fill:{ patternType:'solid', fgColor:{ rgb:'FDF3F2' } }, alignment:{ horizontal:'left',   vertical:'center' }, border: allThin },
            qCellR:    { font:{ sz:10, color:{ rgb:'2C3E50' } }, fill:{ patternType:'solid', fgColor:{ rgb:'FDF3F2' } }, alignment:{ horizontal:'center', vertical:'center' }, border: allThin },
            subGreen:  { font:{ bold:true, sz:10, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'27AE60' } }, alignment:{ horizontal:'center', vertical:'center' }, border:{ top:medGreen, bottom:medGreen, left:medGreen, right:medGreen } },
            subGreenL: { font:{ bold:true, sz:10, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'27AE60' } }, alignment:{ horizontal:'left',   vertical:'center' }, border:{ top:medGreen, bottom:medGreen, left:medGreen, right:medGreen } },
            subRed:    { font:{ bold:true, sz:10, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'E74C3C' } }, alignment:{ horizontal:'center', vertical:'center' }, border:{ top:medRed,   bottom:medRed,   left:medRed,   right:medRed   } },
            subRedL:   { font:{ bold:true, sz:10, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'E74C3C' } }, alignment:{ horizontal:'left',   vertical:'center' }, border:{ top:medRed,   bottom:medRed,   left:medRed,   right:medRed   } },
            gtLabel:   { font:{ bold:true, sz:11, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'1A5276' } }, alignment:{ horizontal:'left',   vertical:'center' }, border:{ top:medNavy,  bottom:medNavy,  left:medNavy,  right:medNavy  } },
            gtCell:    { font:{ bold:true, sz:11, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'1A5276' } }, alignment:{ horizontal:'center', vertical:'center' }, border:{ top:medNavy,  bottom:medNavy,  left:medNavy,  right:medNavy  } },
            pctLabel:  { font:{ bold:true, sz:11, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'117A65' } }, alignment:{ horizontal:'left',   vertical:'center' }, border:{ top:medNavy,  bottom:medNavy,  left:medNavy,  right:medNavy  } },
            pctCell:   { font:{ bold:true, sz:11, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'117A65' } }, alignment:{ horizontal:'center', vertical:'center' }, border:{ top:medNavy,  bottom:medNavy,  left:medNavy,  right:medNavy  } },
        };

        // ── Build rows + metadata ──────────────────────
        const rows    = [];
        const rowMeta = [];

        rows.push(['Question', 'Max/day', ...dates, 'Total Obtained', 'Total Max']);
        rowMeta.push({ type:'header', h:22 });

        // Anukul section
        rows.push(['🌿  ANUKULASYA (Favourable)', '', ...dates.map(()=>''), '', '']);
        rowMeta.push({ type:'anuHdr', h:20 });

        ANUKUL_QUESTIONS.forEach(q => {
            let rowTotal = 0;
            const cells = docs.map(d => {
                const val = d.anukul?.[q.id] || 'no';
                const sc  = getAanukulScore(val);
                rowTotal += sc;
                return `${val==='yes'?'Y':val==='partial'?'P':'N'} (${sc>=0?'+':''}${sc})`;
            });
            rows.push([`    ${q.label}`, 5, ...cells, rowTotal, docs.length * 5]);
            rowMeta.push({ type:'qAnukul', h:16 });
        });

        rows.push(['🌿  Anukul Total', 25,
            ...docs.map(d => d.anukulTotal ?? 0),
            docs.reduce((s,d) => s+(d.anukulTotal ?? 0), 0), docs.length * 25]);
        rowMeta.push({ type:'subAnukul', h:18 });

        // Spacer
        rows.push(Array(numCols).fill(''));
        rowMeta.push({ type:'spacer', h:6 });

        // Pratikul section
        rows.push(['🚫  PRATIKULASYA (Unfavourable)', '', ...dates.map(()=>''), '', '']);
        rowMeta.push({ type:'praHdr', h:20 });

        PRATIKUL_QUESTIONS.forEach(q => {
            let rowTotal = 0;
            const cells = docs.map(d => {
                const val = d.pratikul?.[q.id] || 'no';
                const sc  = getPratikulScore(val);
                rowTotal += sc;
                return `${val==='yes'?'Y':val==='partial'?'P':'N'} (${sc>=0?'+':''}${sc})`;
            });
            rows.push([`    ${q.label}`, 5, ...cells, rowTotal, docs.length * 5]);
            rowMeta.push({ type:'qPratikul', h:16 });
        });

        rows.push(['🚫  Pratikul Total', 25,
            ...docs.map(d => d.pratikulTotal ?? 0),
            docs.reduce((s,d) => s+(d.pratikulTotal ?? 0), 0), docs.length * 25]);
        rowMeta.push({ type:'subPratikul', h:18 });

        // Spacer
        rows.push(Array(numCols).fill(''));
        rowMeta.push({ type:'spacer', h:6 });

        // Grand total / percent
        rows.push(['Grand Total', 50,
            ...docs.map(d => d.totalScore ?? 0),
            docs.reduce((s,d) => s+(d.totalScore ?? 0), 0), docs.length * 50]);
        rowMeta.push({ type:'grandTotal', h:20 });

        rows.push(['Percent', '100%', ...docs.map(d => (d.percent ?? 0)+'%'), '', '']);
        rowMeta.push({ type:'percent', h:18 });

        // ── Build worksheet ────────────────────────────
        const ws = XLSX.utils.aoa_to_sheet(rows);

        // ── Apply styles ───────────────────────────────
        rows.forEach((row, ri) => {
            const meta = rowMeta[ri];
            for (let ci = 0; ci < numCols; ci++) {
                const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
                if (!ws[addr]) ws[addr] = { v: '', t: 's' };
                const isLabel = ci === 0;
                switch (meta.type) {
                    case 'header':     ws[addr].s = isLabel ? S.hdrLabel  : S.header;    break;
                    case 'anuHdr':     ws[addr].s = isLabel ? S.anuHdr    : S.anuHdrC;   break;
                    case 'qAnukul':    ws[addr].s = isLabel ? S.qLabel    : S.qCell;     break;
                    case 'subAnukul':  ws[addr].s = isLabel ? S.subGreenL : S.subGreen;  break;
                    case 'praHdr':     ws[addr].s = isLabel ? S.praHdr    : S.praHdrC;   break;
                    case 'qPratikul':  ws[addr].s = isLabel ? S.qLabelR   : S.qCellR;    break;
                    case 'subPratikul':ws[addr].s = isLabel ? S.subRedL   : S.subRed;    break;
                    case 'grandTotal': ws[addr].s = isLabel ? S.gtLabel   : S.gtCell;    break;
                    case 'percent':    ws[addr].s = isLabel ? S.pctLabel  : S.pctCell;   break;
                    default: break; // spacer
                }
            }
        });

        ws['!cols'] = [{ wch: 44 }, { wch: 8 }, ...dates.map(() => ({ wch: 14 })), { wch: 14 }, { wch: 10 }];
        ws['!rows'] = rowMeta.map(m => ({ hpt: m.h }));
        return ws;
}

// --- 3D. TAPAH EXCEL IMPORT ---
window.importTapahExcel = async (input) => {
    if (!input.files || !input.files[0]) return;
    if (!currentUser) { alert('Please login first.'); return; }
    if (typeof XLSX === 'undefined') { alert('Excel library not loaded yet.'); return; }

    const file = input.files[0];
    input.value = '';

    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (!rows || rows.length < 2) { alert('File appears empty or wrong format.'); return; }

        const headerRow = rows[0].map(c => String(c || '').trim());
        const dateCol = 0;
        // Map question label → column index
        const colMap = {};
        headerRow.forEach((h, i) => { colMap[h] = i; });

        const entries = [];
        for (let r = 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || !row[dateCol]) continue;
            const dateStr = String(row[dateCol]).trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

            const anukulAnswers = {}, pratikulAnswers = {}, anukulScores = {}, pratikulScores = {};
            let anukulTotal = 0, pratikulTotal = 0;

            ANUKUL_QUESTIONS.forEach(q => {
                const ci = colMap[q.label];
                const val = ci !== undefined && row[ci] ? String(row[ci]).trim().toLowerCase() : 'no';
                const clean = ['yes','partial','no'].includes(val) ? val : 'no';
                anukulAnswers[q.id] = clean;
                anukulScores[q.id] = getAanukulScore(clean);
                anukulTotal += anukulScores[q.id];
            });
            PRATIKUL_QUESTIONS.forEach(q => {
                const ci = colMap[q.label];
                const val = ci !== undefined && row[ci] ? String(row[ci]).trim().toLowerCase() : 'no';
                const clean = ['yes','partial','no'].includes(val) ? val : 'no';
                pratikulAnswers[q.id] = clean;
                pratikulScores[q.id] = getPratikulScore(clean);
                pratikulTotal += pratikulScores[q.id];
            });

            const total = anukulTotal + pratikulTotal;
            entries.push({ dateStr, data: {
                anukul: anukulAnswers, pratikul: pratikulAnswers,
                anukulScores, pratikulScores, anukulTotal, pratikulTotal,
                totalScore: total, percent: Math.round((total / 50) * 100),
                submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
                importedFromExcel: true
            }});
        }

        if (entries.length === 0) { alert('No valid Tapah entries found. Make sure you are using the exported format.'); return; }
        entries.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
        const confirmed = confirm(`Found ${entries.length} Tapah entries (${entries[0].dateStr} to ${entries[entries.length-1].dateStr}).\n\nExisting entries will be overwritten. Continue?`);
        if (!confirmed) return;

        const modal = document.createElement('div');
        modal.id = 'import-progress-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `<div style="background:white;border-radius:14px;max-width:340px;width:100%;padding:28px;text-align:center;">
            <div style="font-size:36px;margin-bottom:10px;">📤</div>
            <div style="font-weight:700;font-size:16px;color:#2c3e50;margin-bottom:8px;">Importing Tapah...</div>
            <div id="import-progress-text" style="font-size:13px;color:#888;">0 / ${entries.length}</div>
            <div style="margin-top:12px;background:#eee;border-radius:6px;height:8px;overflow:hidden;">
                <div id="import-progress-bar" style="width:0%;height:100%;background:#764ba2;border-radius:6px;transition:width 0.3s;"></div>
            </div></div>`;
        document.body.appendChild(modal);

        let imported = 0;
        for (let i = 0; i < entries.length; i += 400) {
            const batch = db.batch();
            entries.slice(i, i + 400).forEach(e => {
                batch.set(db.collection('users').doc(currentUser.uid).collection('tapah').doc(e.dateStr), e.data);
            });
            await batch.commit();
            imported += Math.min(400, entries.length - i);
            const pt = document.getElementById('import-progress-text');
            const pb = document.getElementById('import-progress-bar');
            if (pt) pt.textContent = `${imported} / ${entries.length}`;
            if (pb) pb.style.width = Math.round((imported / entries.length) * 100) + '%';
        }

        modal.innerHTML = `<div style="background:white;border-radius:14px;max-width:340px;width:100%;padding:28px;text-align:center;">
            <div style="font-size:36px;margin-bottom:10px;">✅</div>
            <div style="font-weight:700;font-size:16px;color:#27ae60;margin-bottom:8px;">Import Complete!</div>
            <div style="font-size:13px;color:#888;margin-bottom:16px;">${imported} Tapah entries imported.</div>
            <button onclick="document.getElementById('import-progress-modal').remove();loadTapahReport();"
                style="padding:10px 24px;background:#764ba2;color:white;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;width:auto;">OK</button></div>`;
    } catch (err) {
        const m = document.getElementById('import-progress-modal');
        if (m) m.remove();
        alert('Could not import file. Error: ' + (err.code || err.message));
    }
};

// --- 3E. TAPAH-2 EXCEL DOWNLOAD ---
window.downloadTapah2Excel = async () => {
    if (!currentUser) { alert('Please login first.'); return; }
    if (typeof XLSX === 'undefined') { alert('Excel library not loaded yet.'); return; }
    try {
        const snap = await db.collection('users').doc(currentUser.uid).collection('tapah2').get();
        if (snap.empty) { alert('No Tapah-2 data found to download.'); return; }
        const docs = [];
        snap.forEach(doc => docs.push({ id: doc.id, ...doc.data() }));
        docs.sort((a,b) => a.id.localeCompare(b.id));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, _buildTapah2Ws(docs), 'Tapah-2 History');
        XLSX.writeFile(wb, `${userProfile?.name || 'My'}_Tapah2_History.xlsx`);
    } catch (err) {
        alert('Could not download. Error: ' + (err.code || err.message));
    }
};

// ── Tapah-2 worksheet builder ──────────────────────────────────────
function _buildTapah2Ws(docs) {
        const dates = docs.map(d => d.id);
        const numCols = 2 + dates.length + 2;

        // ── Style helpers ──────────────────────────────
        const thinGrey   = { style: 'thin',   color: { rgb: 'BBBBBB' } };
        const medDark    = { style: 'medium',  color: { rgb: '555555' } };
        const medOrange  = { style: 'medium',  color: { rgb: 'CC5500' } };
        const medGreen   = { style: 'medium',  color: { rgb: '1E8449' } };
        const allThin    = { top: thinGrey, bottom: thinGrey, left: thinGrey, right: thinGrey };
        const allMedDark = { top: medDark,  bottom: medDark,  left: medDark,  right: medDark  };

        const S = {
            header:      { font: { bold:true, sz:11, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'2C3E50' } }, alignment:{ horizontal:'center', vertical:'center', wrapText:true }, border: allMedDark },
            headerLabel: { font: { bold:true, sz:11, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'2C3E50' } }, alignment:{ horizontal:'left',   vertical:'center', wrapText:true }, border: allMedDark },
            catHdr:      { font: { bold:true, sz:12, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'D35400' } }, alignment:{ horizontal:'left',   vertical:'center' }, border:{ top:medOrange, bottom:medOrange, left:medOrange, right:medOrange } },
            catHdrC:     { font: { bold:true, sz:12, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'D35400' } }, alignment:{ horizontal:'center', vertical:'center' }, border:{ top:medOrange, bottom:medOrange, left:medOrange, right:medOrange } },
            qLabel:      { font: { sz:10, color:{ rgb:'2C3E50' } }, fill:{ patternType:'solid', fgColor:{ rgb:'FEF9F5' } }, alignment:{ horizontal:'left',   vertical:'center' }, border: allThin },
            qCell:       { font: { sz:10, color:{ rgb:'2C3E50' } }, fill:{ patternType:'solid', fgColor:{ rgb:'FEF9F5' } }, alignment:{ horizontal:'center', vertical:'center' }, border: allThin },
            subLabel:    { font: { bold:true, sz:10, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'E67E22' } }, alignment:{ horizontal:'left',   vertical:'center' }, border:{ top:medOrange, bottom:medOrange, left:medOrange, right:medOrange } },
            subCell:     { font: { bold:true, sz:10, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'E67E22' } }, alignment:{ horizontal:'center', vertical:'center' }, border:{ top:medOrange, bottom:medOrange, left:medOrange, right:medOrange } },
            gtLabel:     { font: { bold:true, sz:11, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'1A5276' } }, alignment:{ horizontal:'left',   vertical:'center' }, border:{ top:medGreen,  bottom:medGreen,  left:medGreen,  right:medGreen  } },
            gtCell:      { font: { bold:true, sz:11, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'1A5276' } }, alignment:{ horizontal:'center', vertical:'center' }, border:{ top:medGreen,  bottom:medGreen,  left:medGreen,  right:medGreen  } },
            pctLabel:    { font: { bold:true, sz:11, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'117A65' } }, alignment:{ horizontal:'left',   vertical:'center' }, border:{ top:medGreen,  bottom:medGreen,  left:medGreen,  right:medGreen  } },
            pctCell:     { font: { bold:true, sz:11, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'117A65' } }, alignment:{ horizontal:'center', vertical:'center' }, border:{ top:medGreen,  bottom:medGreen,  left:medGreen,  right:medGreen  } },
        };

        // ── Build rows + row-type metadata ─────────────
        const rows    = [];
        const rowMeta = []; // each entry: { type, colStyles[] }

        // Header
        rows.push(['Question / Category', 'Max', ...dates, 'Total Obtained', 'Total Max']);
        rowMeta.push({ type:'header', h: 22 });

        TAPAH2_CATS.forEach(cat => {
            const catQs       = TAPAH2_QUESTIONS.filter(q => q.cat === cat.id);
            const catMaxPerDay = catQs.reduce((s,q) => s+q.max, 0);

            // Category header row
            rows.push([`${cat.emoji}  ${cat.label}`, catMaxPerDay, ...dates.map(()=>''), '', '']);
            rowMeta.push({ type:'catHdr', h: 20 });

            catQs.forEach(q => {
                let rowTotal = 0;
                const cells = docs.map(d => {
                    const sc = d.scores?.[q.id] !== undefined ? d.scores[q.id] : 0;
                    rowTotal += sc;
                    return sc;
                });
                rows.push([`    ${q.label}`, q.max, ...cells, rowTotal, docs.length * q.max]);
                rowMeta.push({ type:'question', h: 16 });
            });

            // Category subtotal row
            const catTotals = docs.map(d => catQs.reduce((s,q) => s + (d.scores?.[q.id] !== undefined ? d.scores[q.id] : 0), 0));
            rows.push([`${cat.emoji}  ${cat.label} — Subtotal`, catMaxPerDay,
                ...catTotals,
                catTotals.reduce((a,b)=>a+b,0), docs.length * catMaxPerDay]);
            rowMeta.push({ type:'subTotal', h: 18 });

            // Spacer
            rows.push(Array(numCols).fill(''));
            rowMeta.push({ type:'spacer', h: 6 });
        });

        // Grand total
        rows.push(['Grand Total', TAPAH2_MAX,
            ...docs.map(d => d.totalScore !== undefined ? d.totalScore : 0),
            docs.reduce((s,d)=>s+(d.totalScore!==undefined?d.totalScore:0),0),
            docs.length * TAPAH2_MAX]);
        rowMeta.push({ type:'grandTotal', h: 20 });

        // Percent
        rows.push(['Percent', '100%',
            ...docs.map(d => (d.percent !== undefined ? d.percent : 0) + '%'),
            '', '']);
        rowMeta.push({ type:'percent', h: 18 });

        // ── Build worksheet ────────────────────────────
        const ws = XLSX.utils.aoa_to_sheet(rows);

        // ── Apply styles ───────────────────────────────
        rows.forEach((row, ri) => {
            const meta = rowMeta[ri];
            for (let ci = 0; ci < numCols; ci++) {
                const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
                if (!ws[addr]) ws[addr] = { v: '', t: 's' };
                const isLabel = ci === 0;
                const isMax   = ci === 1;
                switch (meta.type) {
                    case 'header':    ws[addr].s = isLabel ? S.headerLabel : S.header;    break;
                    case 'catHdr':    ws[addr].s = isLabel ? S.catHdr      : S.catHdrC;   break;
                    case 'question':  ws[addr].s = isLabel ? S.qLabel      : S.qCell;     break;
                    case 'subTotal':  ws[addr].s = isLabel ? S.subLabel    : S.subCell;   break;
                    case 'grandTotal':ws[addr].s = isLabel ? S.gtLabel     : S.gtCell;    break;
                    case 'percent':   ws[addr].s = isLabel ? S.pctLabel    : S.pctCell;   break;
                    default: break; // spacer — no style
                }
            }
        });

        ws['!cols'] = [{ wch: 46 }, { wch: 7 }, ...dates.map(() => ({ wch: 11 })), { wch: 14 }, { wch: 10 }];
        ws['!rows'] = rowMeta.map(m => ({ hpt: m.h }));
        return ws;
}

// --- 3F. TAPAH-2 EXCEL IMPORT ---
window.importTapah2Excel = async (input) => {
    if (!input.files || !input.files[0]) return;
    if (!currentUser) { alert('Please login first.'); return; }
    if (typeof XLSX === 'undefined') { alert('Excel library not loaded yet.'); return; }

    const file = input.files[0];
    input.value = '';

    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (!rows || rows.length < 2) { alert('File appears empty or wrong format.'); return; }

        const headerRow = rows[0].map(c => String(c || '').trim());
        // Build map: question column header → question id
        const qColMap = {};
        TAPAH2_QUESTIONS.forEach(q => {
            const expectedHeader = `${q.catLabel} | ${q.label} (max ${q.max})`;
            const idx = headerRow.indexOf(expectedHeader);
            if (idx >= 0) qColMap[q.id] = idx;
        });

        const entries = [];
        for (let r = 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || !row[0]) continue;
            const dateStr = String(row[0]).trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

            const scores = {};
            let total = 0;
            TAPAH2_QUESTIONS.forEach(q => {
                const ci = qColMap[q.id];
                const raw = ci !== undefined && row[ci] !== undefined ? parseInt(row[ci], 10) : 0;
                const val = isNaN(raw) ? 0 : Math.max(0, Math.min(q.max, raw));
                scores[q.id] = val;
                total += val;
            });

            entries.push({ dateStr, data: {
                scores, totalScore: total,
                percent: Math.round((total / TAPAH2_MAX) * 100),
                submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
                importedFromExcel: true
            }});
        }

        if (entries.length === 0) { alert('No valid Tapah-2 entries found. Make sure you are using the exported format.'); return; }
        entries.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
        const confirmed = confirm(`Found ${entries.length} Tapah-2 entries (${entries[0].dateStr} to ${entries[entries.length-1].dateStr}).\n\nExisting entries will be overwritten. Continue?`);
        if (!confirmed) return;

        const modal = document.createElement('div');
        modal.id = 'import-progress-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `<div style="background:white;border-radius:14px;max-width:340px;width:100%;padding:28px;text-align:center;">
            <div style="font-size:36px;margin-bottom:10px;">📤</div>
            <div style="font-weight:700;font-size:16px;color:#2c3e50;margin-bottom:8px;">Importing Tapah-2...</div>
            <div id="import-progress-text" style="font-size:13px;color:#888;">0 / ${entries.length}</div>
            <div style="margin-top:12px;background:#eee;border-radius:6px;height:8px;overflow:hidden;">
                <div id="import-progress-bar" style="width:0%;height:100%;background:#e67e22;border-radius:6px;transition:width 0.3s;"></div>
            </div></div>`;
        document.body.appendChild(modal);

        let imported = 0;
        for (let i = 0; i < entries.length; i += 400) {
            const batch = db.batch();
            entries.slice(i, i + 400).forEach(e => {
                batch.set(db.collection('users').doc(currentUser.uid).collection('tapah2').doc(e.dateStr), e.data);
            });
            await batch.commit();
            imported += Math.min(400, entries.length - i);
            const pt = document.getElementById('import-progress-text');
            const pb = document.getElementById('import-progress-bar');
            if (pt) pt.textContent = `${imported} / ${entries.length}`;
            if (pb) pb.style.width = Math.round((imported / entries.length) * 100) + '%';
        }

        modal.innerHTML = `<div style="background:white;border-radius:14px;max-width:340px;width:100%;padding:28px;text-align:center;">
            <div style="font-size:36px;margin-bottom:10px;">✅</div>
            <div style="font-weight:700;font-size:16px;color:#27ae60;margin-bottom:8px;">Import Complete!</div>
            <div style="font-size:13px;color:#888;margin-bottom:16px;">${imported} Tapah-2 entries imported.</div>
            <button onclick="document.getElementById('import-progress-modal').remove();loadTapah2Report();"
                style="padding:10px 24px;background:#e67e22;color:white;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;width:auto;">OK</button></div>`;
    } catch (err) {
        const m = document.getElementById('import-progress-modal');
        if (m) m.remove();
        alert('Could not import file. Error: ' + (err.code || err.message));
    }
};

// ── Sadhna worksheet builder ───────────────────────────────────────
function _buildSadhnaWs(snap) {
    const bdr = (c = "BBBBBB") => ({ top:{style:"thin",color:{rgb:c}}, bottom:{style:"thin",color:{rgb:c}}, left:{style:"thin",color:{rgb:c}}, right:{style:"thin",color:{rgb:c}} });
    const fill = (rgb) => ({ fgColor:{rgb}, patternType:"solid" });
    const f = (opts) => ({ sz:9, ...opts });
    const S = {
        weekHdr:  { font:f({bold:true,sz:12,color:{rgb:"1A3650"}}), fill:fill("9DC3E6"), alignment:{horizontal:"center",vertical:"center"}, border:bdr("9DC3E6") },
        colHdr:   { font:f({bold:true,color:{rgb:"1A3650"}}), fill:fill("BDD7EE"), alignment:{horizontal:"center",vertical:"center",wrapText:true}, border:bdr() },
        dayName:  { font:f({bold:true}), alignment:{horizontal:"left",vertical:"center"}, border:bdr() },
        dayNR:    { font:f({bold:true,color:{rgb:"9C0006"}}), fill:fill("FFE0E0"), alignment:{horizontal:"left",vertical:"center"}, border:bdr() },
        normal:   { font:f({}), alignment:{horizontal:"center",vertical:"center"}, border:bdr() },
        nrVal:    { font:f({bold:true,color:{rgb:"9C0006"}}), fill:fill("FFCCCC"), alignment:{horizontal:"center",vertical:"center"}, border:bdr() },
        mksPos:   { font:f({bold:true,color:{rgb:"006100"}}), fill:fill("C6EFCE"), alignment:{horizontal:"center",vertical:"center"}, border:bdr() },
        mksNeg:   { font:f({bold:true,color:{rgb:"9C0006"}}), fill:fill("FFC7CE"), alignment:{horizontal:"center",vertical:"center"}, border:bdr() },
        mksZero:  { font:f({color:{rgb:"888888"}}), fill:fill("F5F5F5"), alignment:{horizontal:"center",vertical:"center"}, border:bdr() },
        totalLbl: { font:f({bold:true,color:{rgb:"1A3650"}}), fill:fill("DEEAF1"), alignment:{horizontal:"left",vertical:"center"}, border:bdr() },
        totalRow: { font:f({bold:true,color:{rgb:"1A3650"}}), fill:fill("DEEAF1"), alignment:{horizontal:"center",vertical:"center"}, border:bdr() },
        overall:  { font:f({bold:true,sz:10,color:{rgb:"FFFFFF"}}), fill:fill("2E75B6"), alignment:{horizontal:"center",vertical:"center"}, border:bdr("2E75B6") },
        pctGood:  { font:f({bold:true,color:{rgb:"006100"}}), fill:fill("C6EFCE"), alignment:{horizontal:"center",vertical:"center"}, border:bdr() },
        pctOk:    { font:f({bold:true,color:{rgb:"7D6608"}}), fill:fill("FFEB9C"), alignment:{horizontal:"center",vertical:"center"}, border:bdr() },
        pctBad:   { font:f({bold:true,color:{rgb:"9C0006"}}), fill:fill("FFC7CE"), alignment:{horizontal:"center",vertical:"center"}, border:bdr() },
    };
    const weeksData = {};
    snap.forEach(doc => {
        const wi = getWeekInfo(doc.id);
        if (!weeksData[wi.sunStr]) weeksData[wi.sunStr] = { label: wi.label, sunStr: wi.sunStr, days: {} };
        weeksData[wi.sunStr].days[doc.id] = doc.data();
    });
    const sortedWeeks = Object.keys(weeksData).sort((a,b) => b.localeCompare(a));
    const dataArray = [], rowMeta = [];
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    sortedWeeks.forEach((sunStr, weekIndex) => {
        const week = weeksData[sunStr];
        dataArray.push([`WEEK: ${week.label}`, ...Array(17).fill('')]); rowMeta.push({ type:'weekHdr' });
        dataArray.push(['Day','1.To Bed','Mks','2. Wake Up','Mks','3. Japa','Mks','4. MP','Mks','5. DS','Mks','6. Pathan','Mks','7. Sarwan','Mks','8. Ntes Rev.','Mks','Day Wise']); rowMeta.push({ type:'colHdr' });
        const wt = { sleepM:0,wakeupM:0,morningProgramM:0,chantingM:0,readingM:0,hearingM:0,notesM:0,daySleepM:0,readingMins:0,hearingMins:0,notesMins:0,total:0 };
        const weekStart = new Date(week.sunStr + 'T00:00:00');
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart); d.setDate(d.getDate() + i);
            const dateStr = toLocalDateStr(d);
            const hasEntry = !!week.days[dateStr];
            const entry = week.days[dateStr] || getNRData(dateStr);
            wt.sleepM += entry.scores?.sleep??0; wt.wakeupM += entry.scores?.wakeup??0;
            wt.morningProgramM += entry.scores?.morningProgram??0; wt.chantingM += entry.scores?.chanting??0;
            wt.readingM += entry.scores?.reading??0; wt.hearingM += entry.scores?.hearing??0;
            wt.notesM += entry.scores?.notes??0; wt.daySleepM += entry.scores?.daySleep??0;
            wt.readingMins += entry.readingMinutes==='NR'?0:(entry.readingMinutes||0);
            wt.hearingMins += entry.hearingMinutes==='NR'?0:(entry.hearingMinutes||0);
            wt.notesMins   += entry.notesMinutes==='NR'?0:(entry.notesMinutes||0);
            wt.total += entry.totalScore??0;
            dataArray.push([`${dayNames[i]} ${String(d.getDate()).padStart(2,'0')}`,entry.sleepTime||'NR',entry.scores?.sleep??0,entry.wakeupTime||'NR',entry.scores?.wakeup??0,entry.chantingTime||'NR',entry.scores?.chanting??0,entry.morningProgramTime||'NR',entry.scores?.morningProgram??0,entry.daySleepMinutes!=='NR'?entry.daySleepMinutes:'NR',entry.scores?.daySleep??0,entry.readingMinutes!=='NR'?entry.readingMinutes:'NR',entry.scores?.reading??0,entry.hearingMinutes!=='NR'?entry.hearingMinutes:'NR',entry.scores?.hearing??0,entry.notesMinutes!=='NR'?entry.notesMinutes:'NR',entry.scores?.notes??0,(entry.dayPercent??0)+'%']);
            rowMeta.push({ type:'day', isNR:!hasEntry, scores:entry.scores, dayPercent:entry.dayPercent??0 });
        }
        let adjNotesM = wt.notesM; if (wt.notesMins >= 245) adjNotesM = 175;
        const adjTotal = wt.total - wt.notesM + adjNotesM;
        const weekPct = Math.round((adjTotal/1225)*100);
        dataArray.push(['Total/1225','',wt.sleepM,'',wt.wakeupM,'',wt.chantingM,'',wt.morningProgramM,'',wt.daySleepM,wt.readingMins,wt.readingM,wt.hearingMins,wt.hearingM,wt.notesMins,adjNotesM,'']); rowMeta.push({ type:'total' });
        dataArray.push(['Sadhna %','',`${Math.round((wt.sleepM/175)*100)}%`,'',`${Math.round((wt.wakeupM/175)*100)}%`,'',`${Math.round((wt.chantingM/175)*100)}%`,'',`${Math.round((wt.morningProgramM/175)*100)}%`,'',`${Math.round((wt.daySleepM/70)*100)}%`,'',`${Math.round((wt.readingM/175)*100)}%`,'',`${Math.round((wt.hearingM/175)*100)}%`,'',`${Math.round((adjNotesM/175)*100)}%`,'']); rowMeta.push({ type:'total' });
        dataArray.push([`OVERALL  ${weekPct}%`, ...Array(17).fill('')]); rowMeta.push({ type:'overall' });
        if (weekIndex < sortedWeeks.length - 1) { dataArray.push(Array(18).fill('')); rowMeta.push({ type:'blank' }); dataArray.push(Array(18).fill('')); rowMeta.push({ type:'blank' }); }
    });
    const ws = XLSX.utils.aoa_to_sheet(dataArray);
    ws['!cols'] = [{wch:10},{wch:8},{wch:4},{wch:9},{wch:4},{wch:8},{wch:4},{wch:8},{wch:4},{wch:7},{wch:4},{wch:8},{wch:4},{wch:8},{wch:4},{wch:10},{wch:4},{wch:8}];
    ws['!rows'] = rowMeta.map(m => ({ hpt: m.type==='weekHdr'?22:m.type==='colHdr'?28:16 }));
    ws['!merges'] = [];
    const NUM_COLS=18, MKS_COLS=new Set([2,4,6,8,10,12,14,16]), TIME_COLS=new Set([1,3,5,7,9,11,13,15]);
    rowMeta.forEach((meta,r) => {
        if (meta.type==='weekHdr'||meta.type==='overall') ws['!merges'].push({ s:{r,c:0}, e:{r,c:NUM_COLS-1} });
        for (let c=0;c<NUM_COLS;c++) {
            const ref=XLSX.utils.encode_cell({r,c}); if (!ws[ref]) ws[ref]={v:'',t:'s'}; const cell=ws[ref];
            if (meta.type==='weekHdr') cell.s=S.weekHdr;
            else if (meta.type==='colHdr') cell.s=S.colHdr;
            else if (meta.type==='day') {
                if (c===0) cell.s=meta.isNR?S.dayNR:S.dayName;
                else if (c===17) { const p=meta.dayPercent; cell.s=p>=60?S.pctGood:p>=0?S.pctOk:S.pctBad; }
                else if (MKS_COLS.has(c)) { const v=typeof cell.v==='number'?cell.v:0; cell.s=v>0?S.mksPos:v<0?S.mksNeg:S.mksZero; }
                else if (TIME_COLS.has(c)) cell.s=cell.v==='NR'?S.nrVal:S.normal;
            } else if (meta.type==='total') cell.s=c===0?S.totalLbl:S.totalRow;
            else if (meta.type==='overall') cell.s=S.overall;
        }
    });
    return ws;
}

// --- 3G. MASTER EXCEL DOWNLOAD (all 3 tabs) ---
window.downloadMasterExcel = async () => {
    if (!currentUser) { alert('Please login first.'); return; }
    if (typeof XLSX === 'undefined') { alert('Excel library not loaded yet.'); return; }
    try {
        const [sadhnaSnap, tapahSnap, tapah2Snap] = await Promise.all([
            db.collection('users').doc(currentUser.uid).collection('sadhana').get(),
            db.collection('users').doc(currentUser.uid).collection('tapah').get(),
            db.collection('users').doc(currentUser.uid).collection('tapah2').get(),
        ]);
        const wb = XLSX.utils.book_new();

        if (!sadhnaSnap.empty) {
            XLSX.utils.book_append_sheet(wb, _buildSadhnaWs(sadhnaSnap), 'Sadhna');
        }
        if (!tapahSnap.empty) {
            const docs = []; tapahSnap.forEach(doc => docs.push({ id:doc.id, ...doc.data() }));
            docs.sort((a,b) => a.id.localeCompare(b.id));
            XLSX.utils.book_append_sheet(wb, _buildTapahWs(docs), 'Tapah');
        }
        if (!tapah2Snap.empty) {
            const docs = []; tapah2Snap.forEach(doc => docs.push({ id:doc.id, ...doc.data() }));
            docs.sort((a,b) => a.id.localeCompare(b.id));
            XLSX.utils.book_append_sheet(wb, _buildTapah2Ws(docs), 'Tapah-2');
        }

        if (wb.SheetNames.length === 0) { alert('No data found across any tab.'); return; }
        XLSX.writeFile(wb, `${userProfile?.name || 'My'}_Master_Sadhana.xlsx`);
    } catch (err) {
        alert('Could not download master Excel. Error: ' + (err.code || err.message));
    }
};

// --- 4. UI NAVIGATION ---
function showSection(section) {
    ['auth', 'profile', 'dashboard'].forEach(s => {
        document.getElementById(`${s}-section`).classList.add('hidden');
    });
    document.getElementById(`${section}-section`).classList.remove('hidden');
    // Show/hide bottom nav
    const bottomNav = document.getElementById('bottom-nav');
    if (bottomNav) bottomNav.style.display = (section === 'dashboard') ? 'block' : 'none';
}

// --- MAIN TAB SWITCHER (bottom nav) ---
window.switchMainTab = (tab) => {
    // Hide all main tab contents
    document.querySelectorAll('.main-tab-content').forEach(el => { el.style.display = 'none'; });
    // Show selected
    const tabIds = { sadhna: 'sadhna-main-tab', tapah: 'tapah-main-tab', tapah2: 'tapah2-main-tab' };
    const target = document.getElementById(tabIds[tab] || 'home-tab');
    if (target) target.style.display = 'block';

    // Update bottom nav active state
    document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
        const isActive = btn.dataset.tab === tab;
        btn.style.color = isActive ? '#3498db' : '#999';
    });

    // Load data for the tab
    if (tab === 'home' && currentUser) loadHomeScreen();
    if (tab === 'tapah') resetTapahForm();
    if (tab === 'tapah2') resetTapah2Form();
};

// --- SUB-TAB SWITCHER (within Sadhna / Tapah) ---
window.switchSubTab = (parent, sub) => {
    const activeColor = parent === 'sadhna' ? '#2c3e50' : parent === 'tapah2' ? '#e67e22' : '#764ba2';
    // Hide all sub-tab contents for this parent
    document.querySelectorAll(`.${parent}-subtab-content`).forEach(el => { el.style.display = 'none'; });
    // Show selected
    const target = document.getElementById(`${parent}-${sub}-subtab`);
    if (target) target.style.display = 'block';

    // Update sub-tab button styles
    document.querySelectorAll(`.${parent}-sub`).forEach(btn => {
        btn.style.background = '#f0f0f0';
        btn.style.color = '#666';
    });
    const activeBtn = document.querySelector(`.${parent}-sub[onclick*="'${sub}'"]`);
    if (activeBtn) {
        activeBtn.style.background = activeColor;
        activeBtn.style.color = 'white';
    }

    if (parent === 'tapah'  && sub === 'entry') resetTapahForm();
    if (parent === 'tapah2' && sub === 'entry') resetTapah2Form();

    // Load data
    if (parent === 'sadhna' && sub === 'reports' && currentUser) {
        _reportsLoading = false;
        loadReports(currentUser.uid, 'weekly-reports-container');
    }
    if (parent === 'sadhna'  && sub === 'progress' && currentUser) generateCharts();
    if (parent === 'tapah'   && sub === 'reports'  && currentUser) loadTapahReport();
    if (parent === 'tapah'   && sub === 'progress' && currentUser) loadTapahProgress();
    if (parent === 'tapah2'  && sub === 'reports'  && currentUser) loadTapah2Report();
    if (parent === 'tapah2'  && sub === 'progress' && currentUser) loadTapah2Progress();
};

// Legacy switchTab — keep for backward compat (edit buttons etc.)
window.switchTab = (t) => {
    if (t === 'sadhana') { switchMainTab('sadhna'); switchSubTab('sadhna', 'entry'); }
    else if (t === 'tapah') { switchMainTab('tapah'); switchSubTab('tapah', 'entry'); }
    else if (t === 'reports') { switchMainTab('sadhna'); switchSubTab('sadhna', 'reports'); }
    else if (t === 'charts') { switchMainTab('sadhna'); switchSubTab('sadhna', 'progress'); }
};

// --- HOME SCREEN ---
let _homeWeekOffset = 0; // 0 = this week, 1 = last week
async function loadHomeScreen(weekOffset) {
    if (weekOffset !== undefined) _homeWeekOffset = weekOffset;
    const container = document.getElementById('home-content');
    if (!container || !currentUser) return;

    container.innerHTML = '<div style="text-align:center;padding:40px;color:#888;">⏳ Loading...</div>';

    try {
        const today = new Date();
        const todayStr = toLocalDateStr(today);
        // Get target week's Sunday
        const thisWeekSun = new Date(today);
        thisWeekSun.setDate(today.getDate() - today.getDay() - (_homeWeekOffset * 7));
        const sunStr = toLocalDateStr(thisWeekSun);
        const satDate = new Date(thisWeekSun);
        satDate.setDate(thisWeekSun.getDate() + 6);
        const satStr = toLocalDateStr(satDate);

        // Fetch this week's data
        const snap = await db.collection('users').doc(currentUser.uid)
            .collection('sadhana')
            .where(firebase.firestore.FieldPath.documentId(), '>=', sunStr)
            .where(firebase.firestore.FieldPath.documentId(), '<=', satStr)
            .get();

        const weekData = {};
        snap.forEach(doc => { weekData[doc.id] = doc.data(); });

        // Calculate week stats
        let totalScore = 0, daysFilled = 0, elapsedDays = 0;
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayDots = [];
        const actTotals = { Sleep: 0, 'Wake-up': 0, 'Morning Prog.': 0, Chanting: 0, Reading: 0, Hearing: 0, 'Notes Rev.': 0, 'Day Sleep': 0 };
        const NR_SC = { sleep: -5, wakeup: -5, morningProgram: -5, chanting: -5, reading: -5, hearing: -5, notes: -5, daySleep: -5 };

        for (let i = 0; i < 7; i++) {
            const d = new Date(thisWeekSun);
            d.setDate(thisWeekSun.getDate() + i);
            const ds = toLocalDateStr(d);
            const isFuture = d > today;
            const isToday = ds === todayStr;
            const filled = !!weekData[ds];

            if (!isFuture && ds >= APP_START_DATE) {
                elapsedDays++;
                if (filled) {
                    daysFilled++;
                    totalScore += weekData[ds].totalScore ?? 0;
                    const sc = weekData[ds].scores || {};
                    actTotals['Sleep'] += sc.sleep ?? 0;
                    actTotals['Wake-up'] += sc.wakeup ?? 0;
                    actTotals['Morning Prog.'] += sc.morningProgram ?? 0;
                    actTotals['Chanting'] += sc.chanting ?? 0;
                    actTotals['Reading'] += sc.reading ?? 0;
                    actTotals['Hearing'] += sc.hearing ?? 0;
                    actTotals['Notes Rev.'] += sc.notes ?? 0;
                    actTotals['Day Sleep'] += sc.daySleep ?? 0;
                } else {
                    totalScore += -40;
                    const map = { sleep: 'Sleep', wakeup: 'Wake-up', morningProgram: 'Morning Prog.', chanting: 'Chanting', reading: 'Reading', hearing: 'Hearing', notes: 'Notes Rev.', daySleep: 'Day Sleep' };
                    Object.keys(NR_SC).forEach(k => {
                        actTotals[map[k]] += NR_SC[k];
                    });
                }
            }

            dayDots.push({ name: dayNames[i], filled, isFuture, isToday });
        }

        const fairMax = elapsedDays * 175;
        const weekPercent = fairMax > 0 ? Math.round((totalScore / fairMax) * 100) : 0;
        const todayFilled = !!weekData[todayStr];

        // Calculate streak — fetch last 60 days to check properly
        let streak = 0;
        const streakStart = new Date(today);
        streakStart.setDate(today.getDate() - 59);
        const streakSnap = await db.collection('users').doc(currentUser.uid)
            .collection('sadhana')
            .where(firebase.firestore.FieldPath.documentId(), '>=', toLocalDateStr(streakStart))
            .where(firebase.firestore.FieldPath.documentId(), '<=', todayStr)
            .get();
        const streakData = {};
        streakSnap.forEach(doc => { streakData[doc.id] = true; });

        const checkDate = new Date(today);
        if (!todayFilled) checkDate.setDate(checkDate.getDate() - 1);
        for (let i = 0; i < 60; i++) {
            const cs = toLocalDateStr(checkDate);
            if (streakData[cs]) {
                streak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                break;
            }
        }

        // Score ring color
        const ringColor = weekPercent >= 70 ? '#27ae60' : weekPercent >= 50 ? '#f39c12' : '#e74c3c';
        const circumference = Math.round(2 * Math.PI * 48);
        const dashLen = Math.round(circumference * Math.max(0, weekPercent) / 100);

        // Day dots HTML
        const dotsHtml = dayDots.map(d => {
            if (d.isFuture) return `<div style="text-align:center;"><div style="width:32px;height:32px;border-radius:50%;border:2px solid #e0e0e0;margin:0 auto;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:14px;">○</div><div style="font-size:10px;color:#aaa;margin-top:3px;">${d.name}</div></div>`;
            if (d.filled) return `<div style="text-align:center;"><div style="width:32px;height:32px;border-radius:50%;background:#27ae60;margin:0 auto;display:flex;align-items:center;justify-content:center;color:white;font-size:16px;">✓</div><div style="font-size:10px;color:#555;margin-top:3px;">${d.name}</div></div>`;
            if (d.isToday) return `<div style="text-align:center;"><div style="width:32px;height:32px;border-radius:50%;border:2px solid #3498db;margin:0 auto;display:flex;align-items:center;justify-content:center;color:#3498db;font-size:14px;">○</div><div style="font-size:10px;color:#3498db;font-weight:600;margin-top:3px;">${d.name}</div></div>`;
            return `<div style="text-align:center;"><div style="width:32px;height:32px;border-radius:50%;background:#e74c3c;margin:0 auto;display:flex;align-items:center;justify-content:center;color:white;font-size:14px;">✗</div><div style="font-size:10px;color:#555;margin-top:3px;">${d.name}</div></div>`;
        }).join('');

        // Activity bars HTML — scale max by elapsed days (fair denominator)
        const actDayMax = { 'Day Sleep': 10 };  // 10 pts/day
        const defaultActDayMax = 25;             // 25 pts/day
        const actEmojis = { Sleep: '🛏️', 'Wake-up': '⏰', 'Morning Prog.': '🙏', Chanting: '📿', Reading: '📖', Hearing: '🎧', 'Notes Rev.': '📝', 'Day Sleep': '😴' };
        const actBarsHtml = Object.entries(actTotals).map(([name, val]) => {
            const thisMax = (actDayMax[name] || defaultActDayMax) * elapsedDays;
            const pct = thisMax > 0 ? Math.round((val / thisMax) * 100) : 0;
            const barWidth = Math.max(0, pct); // bar can't be negative width
            const pctColor = pct < 0 ? '#e74c3c' : '#555';
            return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="font-size:12px;min-width:80px;text-align:right;color:#555;">${actEmojis[name] || ''} ${name}</span>
                <div style="flex:1;background:#e8ecf1;border-radius:6px;height:10px;overflow:hidden;">
                    <div style="width:${barWidth}%;height:100%;background:#3498db;border-radius:6px;transition:width 0.5s;"></div>
                </div>
                <span style="font-size:12px;color:${pctColor};min-width:36px;text-align:right;font-weight:600;">${pct}%</span>
            </div>`;
        }).join('');

        container.innerHTML = `
            <!-- Weekly Summary -->
            <div class="card" style="padding:20px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:18px;">📅</span>
                        <strong style="color:#2c3e50;font-size:15px;">Weekly Summary</strong>
                    </div>
                    <div style="display:flex;gap:6px;">
                        <button onclick="loadHomeScreen(0)" style="width:auto;padding:5px 14px;border-radius:20px;background:${_homeWeekOffset===0?'#2c3e50':'#f0f0f0'};color:${_homeWeekOffset===0?'white':'#666'};font-size:12px;font-weight:600;border:none;margin:0;cursor:pointer;">This Week</button>
                        <button onclick="loadHomeScreen(1)" style="width:auto;padding:5px 14px;border-radius:20px;background:${_homeWeekOffset===1?'#2c3e50':'#f0f0f0'};color:${_homeWeekOffset===1?'white':'#666'};font-size:12px;font-weight:600;border:none;margin:0;cursor:pointer;">Last Week</button>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
                    <div style="position:relative;width:110px;height:110px;flex-shrink:0;">
                        <svg width="110" height="110" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="48" fill="none" stroke="#eee" stroke-width="12"/>
                            <circle cx="60" cy="60" r="48" fill="none" stroke="${ringColor}" stroke-width="12"
                                stroke-dasharray="${dashLen} ${circumference - dashLen}"
                                stroke-linecap="round" transform="rotate(-90 60 60)"/>
                        </svg>
                        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">
                            <div style="font-size:24px;font-weight:bold;color:${ringColor};">${weekPercent}%</div>
                            <div style="font-size:9px;color:#888;">score</div>
                        </div>
                    </div>
                    <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div class="card" style="text-align:center;padding:12px 8px;margin:0;border:1px solid #eee;">
                            <div style="font-size:22px;font-weight:700;color:#2c3e50;">${totalScore}</div>
                            <div style="font-size:11px;color:#888;">Points</div>
                        </div>
                        <div class="card" style="text-align:center;padding:12px 8px;margin:0;border:1px solid #eee;">
                            <div style="font-size:22px;font-weight:700;color:#2c3e50;">${daysFilled}</div>
                            <div style="font-size:11px;color:#888;">Days Filled</div>
                        </div>
                    </div>
                </div>
                ${streak > 0 ? `<div class="card" style="text-align:center;padding:10px;margin:14px 0 0;border:1px solid #eee;">
                    <span style="font-size:20px;font-weight:700;color:#2c3e50;">${streak}</span>
                    <span style="font-size:12px;color:#f39c12;font-weight:600;margin-left:6px;">🔥 day streak</span>
                </div>` : ''}
                <div style="display:flex;justify-content:space-around;margin-top:16px;padding-top:14px;border-top:1px solid #f0f0f0;">
                    ${dotsHtml}
                </div>
            </div>

            <!-- Today's reminder (only for this week) -->
            ${_homeWeekOffset === 0 ? (!todayFilled ? `
            <div class="card" style="padding:16px 20px;border-left:4px solid #f39c12;margin-top:0;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <span style="font-size:18px;">⚠️</span>
                    <span style="font-weight:600;color:#856404;">Haven't filled today's sadhna yet</span>
                    <span style="font-size:12px;color:#999;">(आज की साधना अभी भरी नहीं है)</span>
                </div>
                <button onclick="switchMainTab('sadhna');switchSubTab('sadhna','entry');"
                    style="width:100%;padding:14px;background:#2c3e50;color:white;border:none;border-radius:10px;font-weight:700;font-size:15px;cursor:pointer;margin:0;">
                    📝 Fill Today's Sadhna →
                </button>
            </div>` : `
            <div class="card" style="padding:14px 20px;border-left:4px solid #27ae60;margin-top:0;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:18px;">✅</span>
                    <span style="font-weight:600;color:#27ae60;">Today's sadhna is filled!</span>
                </div>
            </div>`) : ''}

            <!-- Activity This Week -->
            <div class="card" style="padding:20px;margin-top:0;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
                    <span style="font-size:18px;">📊</span>
                    <strong style="color:#2c3e50;font-size:15px;">Activity This Week</strong>
                </div>
                ${actBarsHtml}
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<div class="card" style="text-align:center;padding:30px;color:#e74c3c;">
            <div style="font-size:28px;margin-bottom:8px;">😔</div>
            <div style="font-weight:600;margin-bottom:6px;">Something went wrong</div>
            <div style="font-size:13px;color:#888;">Please check your internet connection and try again.</div>
            <button onclick="loadHomeScreen()" style="width:auto;padding:8px 20px;background:#3498db;color:white;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;margin-top:12px;">🔄 Retry</button>
        </div>`;
    }
}

// --- 5. AUTH STATE ---
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        const userDoc = await db.collection('users').doc(user.uid).get();
        if (!userDoc.exists || !userDoc.data().name) {
            showSection('profile');
            document.getElementById('profile-title').textContent = 'Set Your Name';
            // First time setup — hide password change section
            const pwSection = document.getElementById('change-password-section');
            if (pwSection) pwSection.classList.add('hidden');
        } else {
            userProfile = userDoc.data();
            showSection('dashboard');
            document.getElementById('user-display-name').textContent = userProfile.name;
            loadProfilePic();
            setupDateSelect();
            _reportsLoading = false;
            _tapahAnswering = false;
            // Show home tab by default
            switchMainTab('home');
        }
    } else {
        showSection('auth');
        currentUser = null;
        userProfile = null;
    }
});

// --- 6. SCORING ENGINE ---
function computeScores(slp, wak, mpTime, mpNotDone, chn, rMin, hMin, nMin, dsMin) {
    const sc = { sleep: -5, wakeup: -5, morningProgram: -5, chanting: -5, reading: -5, hearing: -5, notes: -5, daySleep: -5 };

    // Sleep Score
    const slpM = t2m(slp, true);
    if (slpM <= 1350) sc.sleep = 25;
    else if (slpM <= 1355) sc.sleep = 20;
    else if (slpM <= 1360) sc.sleep = 15;
    else if (slpM <= 1365) sc.sleep = 10;
    else if (slpM <= 1370) sc.sleep = 5;
    else if (slpM <= 1375) sc.sleep = 0;
    else sc.sleep = -5;

    // Wakeup Score
    const wakM = t2m(wak, false);
    if (wakM <= 305) sc.wakeup = 25;
    else if (wakM <= 310) sc.wakeup = 20;
    else if (wakM <= 315) sc.wakeup = 15;
    else if (wakM <= 320) sc.wakeup = 10;
    else if (wakM <= 325) sc.wakeup = 5;
    else if (wakM <= 330) sc.wakeup = 0;
    else sc.wakeup = -5;

    // Morning Program Score — CHANGE 3: if "No" toggle selected, fixed -5
    if (mpNotDone) {
        sc.morningProgram = -5;
    } else {
        const mpM = t2m(mpTime, false);
        if (mpM <= 285) sc.morningProgram = 25;
        else if (mpM <= 300) sc.morningProgram = 10;
        else if (mpM <= 334) sc.morningProgram = 5;
        else if (mpM <= 359) sc.morningProgram = 0;
        else sc.morningProgram = -5;
    }

    // Chanting Score
    const chnM = t2m(chn, false);
    if (chnM <= 540) sc.chanting = 25;
    else if (chnM <= 570) sc.chanting = 20;
    else if (chnM <= 660) sc.chanting = 15;
    else if (chnM <= 870) sc.chanting = 10;
    else if (chnM <= 1020) sc.chanting = 5;
    else if (chnM <= 1140) sc.chanting = 0;
    else sc.chanting = -5;

    // Day Sleep
    sc.daySleep = (dsMin <= 60) ? 10 : -5;

    // Reading & Hearing
    const getActScore = (m) => {
        if (m >= 40) return 25; if (m >= 30) return 20; if (m >= 20) return 15;
        if (m >= 15) return 10; if (m >= 10) return 5; if (m >= 5) return 0;
        return -5;
    };
    sc.reading = getActScore(rMin);
    sc.hearing = getActScore(hMin);

    // Notes Revision
    if (nMin >= 35) sc.notes = 25;
    else if (nMin >= 30) sc.notes = 20;
    else if (nMin >= 20) sc.notes = 15;
    else if (nMin >= 15) sc.notes = 10;
    else if (nMin >= 10) sc.notes = 5;
    else if (nMin >= 5) sc.notes = 0;
    else sc.notes = -5;

    return sc;
}

// --- CHANGE 3: Morning Program toggle handler ---
window.toggleMorningProgram = (notDone) => {
    const timeRow = document.getElementById('mp-time-row');
    const mpDoneBtn = document.getElementById('mp-done-btn');
    const mpNoBtn = document.getElementById('mp-no-btn');
    if (!timeRow || !mpDoneBtn || !mpNoBtn) return; // guard: elements not in DOM yet
    if (notDone) {
        timeRow.style.display = 'none';
        mpDoneBtn.classList.remove('mp-active');
        mpNoBtn.classList.add('mp-active');
    } else {
        timeRow.style.display = 'block';
        mpDoneBtn.classList.add('mp-active');
        mpNoBtn.classList.remove('mp-active');
    }
};

function isMorningProgramNotDone() {
    const btn = document.getElementById('mp-no-btn');
    return btn ? btn.classList.contains('mp-active') : false;
}

// --- BED TIME WARNING MODAL ---
// Returns a Promise<boolean> — resolves true if user confirms, false if they go back to fix
function showBedTimeWarning(slp, warningMsg) {
    return new Promise((resolve) => {
        const existing = document.getElementById('bedtime-warn-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'bedtime-warn-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `
            <div style="background:white;border-radius:14px;max-width:380px;width:100%;padding:28px;box-shadow:0 10px 40px rgba(0,0,0,0.3);text-align:center;">
                <div style="font-size:40px;margin-bottom:10px;">⚠️</div>
                <h3 style="margin:0 0 10px;color:#e67e22;font-size:17px;">Check Bed Time</h3>
                <p style="font-size:14px;color:#555;margin:0 0 8px;">You entered: <strong style="color:#e74c3c;font-size:16px;">${slp}</strong></p>
                <p style="font-size:13px;color:#777;margin:0 0 20px;line-height:1.5;">${warningMsg}</p>
                <div style="display:flex;gap:10px;justify-content:center;">
                    <button id="bedwarn-fix" style="flex:1;padding:11px;background:#f8f9fa;color:#2c3e50;border:2px solid #ddd;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">
                        ✏️ Fix It
                    </button>
                    <button id="bedwarn-confirm" style="flex:1;padding:11px;background:#e67e22;color:white;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">
                        Yes, Submit
                    </button>
                </div>
                <p style="font-size:11px;color:#aaa;margin:12px 0 0;">Score will be <strong style="color:#e74c3c;">−5</strong> for bed time regardless.</p>
            </div>`;
        document.body.appendChild(modal);

        document.getElementById('bedwarn-fix').onclick = () => { modal.remove(); resolve(false); };
        document.getElementById('bedwarn-confirm').onclick = () => { modal.remove(); resolve(true); };
        modal.addEventListener('click', (e) => { if (e.target === modal) { modal.remove(); resolve(false); } });
    });
}

// Validate bed time — returns a warning message string if suspicious, null if fine
function getBedTimeWarning(slp) {
    if (!slp) return null;
    const [h, m] = slp.split(':').map(Number);

    // AM hours 4:00–11:59 entered as bed time are almost certainly a mistake
    // (user typed 10:30 meaning 10:30 PM but entered AM)
    if (h >= 4 && h <= 11) {
        const ampm = `${h}:${String(m).padStart(2,'0')} AM`;
        const pm = `${h + 12}:${String(m).padStart(2,'0')} (${h}:${String(m).padStart(2,'0')} PM)`;
        return `Did you mean <strong>${pm}</strong>?<br>A bed time of <strong>${ampm}</strong> seems unusual. Please confirm or go back to fix it.`;
    }

    // 12:xx PM range (noon) also suspicious
    if (h === 12) {
        return `A bed time of <strong>12:${String(m).padStart(2,'0')} PM (noon)</strong> seems unusual.<br>Did you mean <strong>00:${String(m).padStart(2,'0')}</strong> (midnight) or a late night time?`;
    }

    // Afternoon hours (13:00–19:59) — very unusual as a bed time
    if (h >= 13 && h <= 19) {
        return `A bed time of <strong>${h}:${String(m).padStart(2,'0')} (afternoon/evening)</strong> seems unusual.<br>Did you accidentally type the wrong time?`;
    }

    return null; // 20:00–03:59 are all normal bed times — no warning
}

// --- 7. FORM SUBMIT (new + edit) ---
const sadhanaForm = document.getElementById('sadhana-form');
if (sadhanaForm) {
    sadhanaForm.onsubmit = async (e) => {
        e.preventDefault();
        if (!currentUser) { alert('Please login first'); return; }

        const date = document.getElementById('sadhana-date').value;
        const slp = document.getElementById('sleep-time').value;
        const wak = document.getElementById('wakeup-time').value;
        const mpTime = document.getElementById('morning-program-time').value;
        const mpNotDone = isMorningProgramNotDone();
        const chn = document.getElementById('chanting-time').value;
        const rMin = parseInt(document.getElementById('reading-mins').value) || 0;
        const hMin = parseInt(document.getElementById('hearing-mins').value) || 0;
        const nMin = parseInt(document.getElementById('notes-mins').value) || 0;
        const dsMin = parseInt(document.getElementById('day-sleep-minutes').value) || 0;

        // --- Bed time sanity check ---
        const bedWarning = getBedTimeWarning(slp);
        if (bedWarning) {
            const confirmed = await showBedTimeWarning(slp, bedWarning);
            if (!confirmed) return; // user chose to fix — abort submit
        }

        const sc = computeScores(slp, wak, mpTime, mpNotDone, chn, rMin, hMin, nMin, dsMin);
        const total = sc.sleep + sc.wakeup + sc.morningProgram + sc.chanting + sc.reading + sc.hearing + sc.notes + sc.daySleep;
        const dayPercent = Math.round((total / 175) * 100);

        try {
            // Save edit history before overwriting if editing
            if (editingDate !== null) {
                const prevSnap = await db.collection('users').doc(currentUser.uid).collection('sadhana').doc(date).get();
                if (prevSnap.exists) {
                    const prevData = prevSnap.data();
                    const historyEntry = {
                        changedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        changedBy: userProfile.name || currentUser.email,
                        before: {
                            sleepTime: prevData.sleepTime,
                            wakeupTime: prevData.wakeupTime,
                            morningProgramTime: prevData.morningProgramTime,
                            chantingTime: prevData.chantingTime,
                            readingMinutes: prevData.readingMinutes,
                            hearingMinutes: prevData.hearingMinutes,
                            notesMinutes: prevData.notesMinutes,
                            daySleepMinutes: prevData.daySleepMinutes,
                            totalScore: prevData.totalScore,
                            dayPercent: prevData.dayPercent
                        },
                        after: {
                            sleepTime: slp,
                            wakeupTime: wak,
                            morningProgramTime: mpNotDone ? 'Not Done' : mpTime,
                            chantingTime: chn,
                            readingMinutes: rMin,
                            hearingMinutes: hMin,
                            notesMinutes: nMin,
                            daySleepMinutes: dsMin,
                            totalScore: total,
                            dayPercent: dayPercent
                        }
                    };
                    await db.collection('users').doc(currentUser.uid)
                        .collection('sadhana').doc(date)
                        .collection('editHistory').add(historyEntry);
                }
            }

            await db.collection('users').doc(currentUser.uid).collection('sadhana').doc(date).set({
                sleepTime: slp,
                wakeupTime: wak,
                morningProgramTime: mpNotDone ? 'Not Done' : mpTime,
                chantingTime: chn,
                readingMinutes: rMin,
                hearingMinutes: hMin,
                notesMinutes: nMin,
                daySleepMinutes: dsMin,
                scores: sc,
                totalScore: total,
                dayPercent: dayPercent,
                submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
                wasEdited: editingDate !== null
            });

            const isEdit = editingDate !== null;
            cancelEdit();
            alert(`${isEdit ? 'Updated' : 'Saved'}! Score: ${total}/175 (${dayPercent}%)`);
            switchTab('reports');
        } catch (error) {
            alert('Could not save your entry. Please check your internet and try again.');
        }
    };
}

// --- CHANGE 2: Edit from reports ---
window.editEntry = async (dateStr) => {
    // Switch to Sadhna > Entry sub-tab
    switchMainTab('sadhna');
    switchSubTab('sadhna', 'entry');

    // Load existing data
    const snap = await db.collection('users').doc(currentUser.uid).collection('sadhana').doc(dateStr).get();
    const data = snap.exists ? snap.data() : null;

    // Set date dropdown to this date (add option if needed)
    const sel = document.getElementById('sadhana-date');
    let found = false;
    for (const opt of sel.options) { if (opt.value === dateStr) { opt.selected = true; found = true; break; } }
    if (!found) {
        const opt = document.createElement('option');
        opt.value = dateStr;
        opt.textContent = dateStr;
        sel.insertBefore(opt, sel.firstChild);
        sel.value = dateStr;
    }
    sel.disabled = true; // Lock date in edit mode

    if (data) {
        document.getElementById('sleep-time').value = data.sleepTime !== 'NR' ? data.sleepTime : '';
        document.getElementById('wakeup-time').value = data.wakeupTime !== 'NR' ? data.wakeupTime : '';
        document.getElementById('chanting-time').value = data.chantingTime !== 'NR' ? data.chantingTime : '';
        document.getElementById('reading-mins').value = data.readingMinutes !== 'NR' ? data.readingMinutes : 0;
        document.getElementById('hearing-mins').value = data.hearingMinutes !== 'NR' ? data.hearingMinutes : 0;
        document.getElementById('notes-mins').value = data.notesMinutes !== 'NR' ? data.notesMinutes : 0;
        document.getElementById('day-sleep-minutes').value = data.daySleepMinutes !== 'NR' ? data.daySleepMinutes : 0;

        // Morning program toggle
        if (data.morningProgramTime === 'Not Done') {
            toggleMorningProgram(true);
        } else {
            toggleMorningProgram(false);
            document.getElementById('morning-program-time').value = data.morningProgramTime !== 'NR' ? data.morningProgramTime : '';
        }
    }

    // Show edit banner
    editingDate = dateStr;
    document.getElementById('edit-mode-banner').style.display = 'flex';
    // Target the second span (text label), not the first (emoji ✏️)
    const bannerSpans = document.getElementById('edit-mode-banner').querySelectorAll('span');
    if (bannerSpans[1]) bannerSpans[1].textContent = `Editing: ${dateStr}`;
    document.getElementById('sadhana-submit-btn').textContent = '💾 Update Entry';

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

function cancelEdit() {
    editingDate = null;
    const sel = document.getElementById('sadhana-date');
    if (sel) { sel.disabled = false; setupDateSelect(); }
    const banner = document.getElementById('edit-mode-banner');
    if (banner) banner.style.display = 'none';
    const submitBtn = document.getElementById('sadhana-submit-btn');
    if (submitBtn) submitBtn.textContent = '✅ Submit Sadhna';
    // Null-guard: elements may not exist yet on first load / mobile slow render
    const mpNoBtn = document.getElementById('mp-no-btn');
    const mpTimeEl = document.getElementById('morning-program-time');
    if (mpNoBtn && mpTimeEl) {
        toggleMorningProgram(false);
        mpTimeEl.value = '';
    }
}
window.cancelEdit = cancelEdit;

// --- EDIT HISTORY MODAL ---
window.viewEditHistory = async (dateStr) => {
    const histSnap = await db.collection('users').doc(currentUser.uid)
        .collection('sadhana').doc(dateStr)
        .collection('editHistory')
        .orderBy('changedAt', 'asc')
        .get();

    let modalContent = '';
    if (histSnap.empty) {
        modalContent = '<p style="color:#999;text-align:center;padding:20px;">No edit history found for this entry.<br><small>History is recorded from the next edit onwards.</small></p>';
    } else {
        const fieldLabels = {
            sleepTime: 'Bed Time', wakeupTime: 'Wake Up', morningProgramTime: 'Morning Prog.',
            chantingTime: 'Chanting', readingMinutes: 'Reading (mins)', hearingMinutes: 'Hearing (mins)',
            notesMinutes: 'Notes (mins)', daySleepMinutes: 'Day Sleep (mins)',
            totalScore: 'Total Score', dayPercent: 'Day %'
        };

        histSnap.forEach((doc, idx) => {
            const h = doc.data();
            const when = h.changedAt?.toDate
                ? h.changedAt.toDate().toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
                : 'Unknown time';

            let changesHTML = '';
            Object.keys(fieldLabels).forEach(field => {
                const bVal = h.before?.[field] ?? '—';
                const aVal = h.after?.[field] ?? '—';
                if (String(bVal) !== String(aVal)) {
                    changesHTML += `
                        <tr>
                            <td style="padding:6px 10px;color:#555;font-size:13px;">${fieldLabels[field]}</td>
                            <td style="padding:6px 10px;color:#e74c3c;font-size:13px;">${bVal}</td>
                            <td style="padding:6px 10px;color:#27ae60;font-size:13px;">${aVal}</td>
                        </tr>`;
                }
            });

            if (!changesHTML) changesHTML = '<tr><td colspan="3" style="padding:6px 10px;color:#999;font-size:12px;">No field differences recorded</td></tr>';

            modalContent += `
                <div style="margin-bottom:16px;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
                    <div style="background:#f0f4ff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
                        <strong style="font-size:13px;color:#2c3e50;">Edit #${idx + 1}</strong>
                        <span style="font-size:12px;color:#666;">🕓 ${when} &nbsp; by <strong>${h.changedBy || 'Unknown'}</strong></span>
                    </div>
                    <table style="width:100%;border-collapse:collapse;">
                        <thead><tr style="background:#fafafa;">
                            <th style="padding:6px 10px;font-size:12px;text-align:left;color:#888;font-weight:600;">Field</th>
                            <th style="padding:6px 10px;font-size:12px;text-align:left;color:#e74c3c;font-weight:600;">Before</th>
                            <th style="padding:6px 10px;font-size:12px;text-align:left;color:#27ae60;font-weight:600;">After</th>
                        </tr></thead>
                        <tbody>${changesHTML}</tbody>
                    </table>
                </div>`;
        });
    }

    // Show modal
    let modal = document.getElementById('edit-history-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'edit-history-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div style="background:white;border-radius:12px;max-width:640px;width:100%;max-height:80vh;overflow-y:auto;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,0.3);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="margin:0;color:#2c3e50;">🕓 Edit History — ${dateStr}</h3>
                <button onclick="document.getElementById('edit-history-modal').remove()" style="width:auto;padding:4px 12px;background:#95a5a6;font-size:13px;">✕ Close</button>
            </div>
            ${modalContent}
        </div>`;
};

// --- SCORE CELL RENDERER ---
// Returns {bg, color, text} matching the reference design:
//   25 (max)  → plain bg, green bold text
//   10–20     → light yellow bg, orange text
//   0–9       → light yellow bg, muted text
//   negative  → light red bg, red text in parentheses
//   null/NR   → light red bg, red text in parentheses
function scoreCell(score, isNR) {
    if (isNR || score === null || score === undefined) {
        // NR entries carry -5 per activity — show (-5) not the string "NR"
        const val = (score !== null && score !== undefined) ? score : -5;
        return { bg: '#fde8e8', color: '#e74c3c', text: `(${val})` };
    }
    if (score >= 25) return { bg: 'transparent', color: '#27ae60', text: String(score) };
    if (score > 0)   return { bg: '#fffde7',     color: '#f39c12', text: String(score) };
    if (score === 0) return { bg: '#fffde7',     color: '#888',    text: '0' };
    return { bg: '#fde8e8', color: '#e74c3c', text: `(${score})` };
}
function renderScoreCell(score, isNR) {
    const s = scoreCell(score, isNR);
    return `<td style="background:${s.bg};color:${s.color};font-weight:700;text-align:center;padding:7px 5px;">${s.text}</td>`;
}
// Legacy wrapper kept for any remaining callers
function getScoreBackground(score) {
    if (score === null || score === undefined) return '#fde8e8';
    if (score >= 25) return 'transparent';
    if (score > 0)   return '#fffde7';
    if (score === 0) return '#fffde7';
    return '#fde8e8';
}

// --- 8. REPORTS ---
let _reportsLoading = false; // debounce guard — prevents duplicate loads on mobile auth re-fires
async function loadReports(userId, containerId) {
    if (_reportsLoading) return;
    _reportsLoading = true;
    const container = document.getElementById(containerId);
    if (!container) { _reportsLoading = false; return; } // Guard: always reset flag

    // Show loading state immediately — critical for mobile on slow connections
    container.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:#888;">
            <div style="font-size:28px;margin-bottom:10px;">⏳</div>
            <div style="font-weight:600;">Loading reports…</div>
            <div style="font-size:12px;margin-top:6px;">Fetching your data</div>
        </div>`;

    let snap;
    try {
        snap = await db.collection('users').doc(userId).collection('sadhana').get();
    } catch (err) {
        container.innerHTML = `
            <div style="text-align:center;padding:40px 20px;background:#fff0f0;border-radius:10px;color:#e74c3c;">
                <div style="font-size:28px;margin-bottom:10px;">⚠️</div>
                <div style="font-weight:700;margin-bottom:6px;">Could not load reports</div>
                <div style="font-size:13px;color:#666;margin-bottom:16px;">Please check your internet connection and try again.</div>
                <button onclick="_reportsLoading=false;loadReports('${userId}','${containerId}')"
                    style="padding:10px 24px;background:#3498db;color:white;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;width:auto;">
                    🔄 Retry
                </button>
            </div>`;
        _reportsLoading = false;
        return;
    }

    const weeksData = {};
    snap.forEach(doc => {
        const weekInfo = getWeekInfo(doc.id);
        if (!weeksData[weekInfo.sunStr]) {
            weeksData[weekInfo.sunStr] = { label: weekInfo.label, sunStr: weekInfo.sunStr, days: {} };
        }
        weeksData[weekInfo.sunStr].days[doc.id] = doc.data();
    });

    // Always show last 4 calendar weeks (NR for gaps)
    const today = new Date();
    const thisWeekSun = new Date(today);
    thisWeekSun.setDate(today.getDate() - today.getDay());

    // Build a set of ALL weeks to show: last 4 + any older weeks with data
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const fmtDate = d => `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]}`;
    const last4Suns = new Set();
    for (let w = 0; w < 4; w++) {
        const sun = new Date(thisWeekSun);
        sun.setDate(thisWeekSun.getDate() - w * 7);
        const sunStr = toLocalDateStr(sun);
        last4Suns.add(sunStr);
        if (!weeksData[sunStr]) {
            const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
            weeksData[sunStr] = { label: `${fmtDate(sun)} to ${fmtDate(sat)}_${sun.getFullYear()}`, sunStr, days: {} };
        }
    }

    // 4-week comparison is rendered AFTER weekly reports (called below after container.innerHTML)

    // Show only the last 4 weeks that have at least one day >= APP_START_DATE
    const sortedWeeks = Array.from(last4Suns)
        .filter(sunStr => {
            // Week's Saturday = sunStr + 6 days
            const sat = new Date(sunStr + 'T00:00:00');
            sat.setDate(sat.getDate() + 6);
            return toLocalDateStr(sat) >= APP_START_DATE;
        })
        .sort((a, b) => b.localeCompare(a));

    let html = '';
    sortedWeeks.forEach(sunStr => {
        const week = weeksData[sunStr];
        const weekStart = new Date(sunStr + 'T00:00:00');
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        let weekTotals = { total: 0, readingMins: 0, hearingMins: 0, notesMins: 0, notesMarks: 0, sleepMarks: 0, wakeupMarks: 0, morningMarks: 0, chantingMarks: 0, readingMarks: 0, hearingMarks: 0, daySleepMarks: 0 };

        let tableRows = '';
        const todayStart = new Date(); todayStart.setHours(0,0,0,0);

        // First pass: accumulate totals — ONLY past days (skip future entirely)
        for (let i = 0; i < 7; i++) {
            const currentDate = new Date(weekStart);
            currentDate.setDate(weekStart.getDate() + i);
            const dateStr = toLocalDateStr(currentDate);
            const isFuture = currentDate > todayStart;
            if (isFuture) continue; // future days don't count toward totals
            if (dateStr < APP_START_DATE) continue; // before app launch — not NR

            const entry = week.days[dateStr] || getNRData(dateStr);
            const isNR = !week.days[dateStr];

            weekTotals.total        += entry.totalScore ?? 0;
            weekTotals.readingMins  += (entry.readingMinutes  === 'NR' ? 0 : entry.readingMinutes)  || 0;
            weekTotals.hearingMins  += (entry.hearingMinutes  === 'NR' ? 0 : entry.hearingMinutes)  || 0;
            weekTotals.notesMins    += (entry.notesMinutes    === 'NR' ? 0 : entry.notesMinutes)    || 0;
            weekTotals.notesMarks   += entry.scores?.notes    ?? 0;
            weekTotals.sleepMarks   += entry.scores?.sleep    ?? 0;
            weekTotals.wakeupMarks  += entry.scores?.wakeup   ?? 0;
            weekTotals.morningMarks += entry.scores?.morningProgram ?? 0;
            weekTotals.chantingMarks+= entry.scores?.chanting ?? 0;
            weekTotals.readingMarks += entry.scores?.reading  ?? 0;
            weekTotals.hearingMarks += entry.scores?.hearing  ?? 0;
            weekTotals.daySleepMarks+= entry.scores?.daySleep ?? 0;
        }

        // Second pass: render rows newest-day-first (Sat→Sun = i from 6 down to 0)
        for (let i = 6; i >= 0; i--) {
            const currentDate = new Date(weekStart);
            currentDate.setDate(weekStart.getDate() + i);
            const dateStr = toLocalDateStr(currentDate);
            const isFuture = currentDate > todayStart;

            // Future dates and pre-app-launch dates — skip entirely, no row shown
            if (isFuture) continue;
            if (dateStr < APP_START_DATE) continue;

            const entry = week.days[dateStr] || getNRData(dateStr);
            const isNR = !week.days[dateStr];
            const hasBeenEdited = !isNR && entry.wasEdited === true;

            const dayPercent = entry.dayPercent ?? -23;

            // Pass/Fail badge — past entries only (future rows handled above via continue)
            let pfBadge = '';
            if (isNR) {
                pfBadge = '<span style="display:inline-block;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:700;background:#fde8e8;color:#e74c3c;border:1px solid #f5c6c6;">Fail</span>';
            } else if (dayPercent >= 50) {
                pfBadge = '<span style="display:inline-block;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:700;background:#e8f8f0;color:#27ae60;border:1px solid #a9dfbf;">Pass</span>';
            } else {
                pfBadge = '<span style="display:inline-block;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:700;background:#fde8e8;color:#e74c3c;border:1px solid #f5c6c6;">Fail</span>';
            }

            // Date label with optional edit history pencil
            // Use data-date attribute to avoid quote-in-quote issues on mobile browsers
            const editedFlag = hasBeenEdited
                ? ` <span class="edit-hist-btn" data-date="${dateStr}" title="Entry was edited" style="color:#9b59b6;font-size:10px;cursor:pointer;">✏️</span>`
                : '';
            const dateLabel = `<strong>${String(currentDate.getDate()).padStart(2,'0')}/${String(currentDate.getMonth()+1).padStart(2,'0')}${editedFlag}</strong>`;

            // Action button — NR gets Fill, filled gets Edit
            const actionBtn = isNR
                ? `<button class="fill-btn" data-date="${dateStr}" style="padding:3px 9px;font-size:11px;background:#27ae60;color:white;width:auto;margin:0;border-radius:12px;border:none;cursor:pointer;font-weight:600;">+ Fill</button>`
                : `<button class="edit-btn" data-date="${dateStr}" title="Edit entry" style="padding:3px 8px;font-size:13px;background:transparent;color:#3498db;width:auto;margin:0;border:none;cursor:pointer;">✏️</button>`;

            // Value display helpers
            const tv = (val) => (val === 'NR' || val === undefined || val === null) ? '<span style="color:#e74c3c;font-weight:600;">NR</span>' : val;
            const mv = (mins) => (mins === 'NR' || mins === undefined || mins === null) ? '<span style="color:#e74c3c;">NR</span>' : `${mins}m`;
            const mpVal = entry.morningProgramTime === 'Not Done'
                ? '<span style="color:#e74c3c;font-size:0.85em;">✗ ND</span>'
                : tv(entry.morningProgramTime);
            const dsVal = entry.daySleepMinutes === 'NR' ? '<span style="color:#e74c3c;">NR</span>' : `${entry.daySleepMinutes ?? 0}m`;

            // Day % cell
            const pctColor = dayPercent >= 70 ? '#27ae60' : dayPercent >= 50 ? '#f39c12' : '#e74c3c';
            const pctBg    = dayPercent >= 50 ? '#f0fff4' : '#fff0f0';
            const rowBg = isNR ? 'background:#fff8f8;' : '';

            tableRows += `
                <tr style="${rowBg}border-bottom:1px solid #f0f0f0;">
                    <td style="text-align:center;padding:7px 5px;${isNR?'background:#fff8f8;':'background:white;'}">${pfBadge}</td>
                    <td style="white-space:nowrap;padding:7px 8px;font-size:13px;border-right:2px solid #e0e0e0;${isNR?'background:#fff8f8;':'background:white;'}">${dateLabel}</td>
                    <td style="padding:7px 6px;font-size:12px;white-space:nowrap;color:${isNR?'#e74c3c':'#333'};">${tv(entry.sleepTime)}</td>
                    ${renderScoreCell(entry.scores?.sleep, isNR)}
                    <td style="padding:7px 6px;font-size:12px;white-space:nowrap;color:${isNR?'#e74c3c':'#333'};">${tv(entry.wakeupTime)}</td>
                    ${renderScoreCell(entry.scores?.wakeup, isNR)}
                    <td style="padding:7px 6px;font-size:12px;white-space:nowrap;color:${isNR?'#e74c3c':'#333'};">${tv(entry.chantingTime)}</td>
                    ${renderScoreCell(entry.scores?.chanting, isNR)}
                    <td style="padding:7px 6px;font-size:12px;white-space:nowrap;">${mpVal}</td>
                    ${renderScoreCell(entry.scores?.morningProgram, isNR)}
                    <td style="padding:7px 6px;font-size:12px;text-align:center;">${dsVal}</td>
                    ${renderScoreCell(entry.scores?.daySleep, isNR)}
                    <td style="padding:7px 6px;font-size:12px;text-align:center;">${mv(entry.readingMinutes)}</td>
                    ${renderScoreCell(entry.scores?.reading, isNR)}
                    <td style="padding:7px 6px;font-size:12px;text-align:center;">${mv(entry.hearingMinutes)}</td>
                    ${renderScoreCell(entry.scores?.hearing, isNR)}
                    <td style="padding:7px 6px;font-size:12px;text-align:center;">${mv(entry.notesMinutes)}</td>
                    ${renderScoreCell(entry.scores?.notes, isNR)}
                    <td style="background:${pctBg};color:${pctColor};font-weight:700;text-align:center;padding:7px 5px;font-size:12px;">${dayPercent}%</td>
                    <td style="text-align:center;padding:5px;white-space:nowrap;">${actionBtn}</td>
                </tr>
            `;
        }

        let adjustedNotesMarks = weekTotals.notesMarks;
        if (weekTotals.notesMins >= 245) adjustedNotesMarks = 175;
        const adjustedTotal = weekTotals.total - weekTotals.notesMarks + adjustedNotesMarks;
        let elapsedDays = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
            const today2 = new Date(); today2.setHours(23,59,59,0);
            if (d <= today2) elapsedDays++;
        }
        const fairMax = elapsedDays * 175;
        const weekPercent = Math.round((adjustedTotal / 1225) * 100);
        const fairPercent = fairMax > 0 ? Math.round((adjustedTotal / fairMax) * 100) : 0;
        const weekClass = adjustedTotal < 735 ? 'low-score' : '';

        // Total row score cell helper (no isNR, uses total value)
        const totCell = (val, max) => {
            const bg = val < 0 ? '#fde8e8' : val >= max * 0.7 ? '#e8f8f0' : '#fffde7';
            const cl = val < 0 ? '#e74c3c' : val >= max * 0.7 ? '#27ae60' : '#f39c12';
            const txt = val < 0 ? `(${val})` : String(val);
            return `<td style="background:${bg};color:${cl};font-weight:700;text-align:center;padding:7px 5px;">${txt}</td>`;
        };
        const pctCell = (val, max) => {
            const pct = max > 0 ? Math.round((val/max)*100) : 0;
            const bg = pct < 0 ? '#fde8e8' : pct >= 70 ? '#e8f8f0' : '#fffde7';
            const cl = pct < 0 ? '#e74c3c' : pct >= 70 ? '#27ae60' : '#f39c12';
            return `<td colspan="2" style="background:${bg};color:${cl};font-weight:700;text-align:center;padding:6px 4px;font-size:12px;">${pct}%</td>`;
        };

        html += `
            <div class="week-card ${weekClass}">
                <div class="week-header" onclick="this.nextElementSibling.classList.toggle('expanded'); this.querySelector('.toggle-icon').textContent = this.nextElementSibling.classList.contains('expanded') ? '▼' : '▶';">
                    <span>📅 ${week.label.split('_')[0]} ${week.label.split('_')[1] || ''}</span>
                    <span style="color:${fairPercent>=50?'#27ae60':'#e74c3c'};font-weight:700;text-align:right;">${adjustedTotal}/${fairMax} (${fairPercent}%) <span class="toggle-icon">▶</span></span>
                </div>
                <div class="week-content">
                    <div style="overflow-x:auto;">
                    <table class="daily-table" style="font-size:13px;">
                        <thead>
                            <tr style="background:#2c3e50;color:white;font-size:12px;">
                                <th style="padding:8px 5px;text-align:center;width:44px;min-width:44px;">P/F</th>
                                <th style="padding:8px 6px;white-space:nowrap;min-width:52px;border-right:2px solid #1a252f;">Date</th>
                                <th style="padding:8px 6px;white-space:nowrap;">Bed</th>
                                <th style="padding:8px 4px;text-align:center;min-width:32px;">M</th>
                                <th style="padding:8px 6px;white-space:nowrap;">Wake</th>
                                <th style="padding:8px 4px;text-align:center;min-width:32px;">M</th>
                                <th style="padding:8px 6px;white-space:nowrap;">Chant</th>
                                <th style="padding:8px 4px;text-align:center;min-width:32px;">M</th>
                                <th style="padding:8px 6px;white-space:nowrap;">Morn.Prog</th>
                                <th style="padding:8px 4px;text-align:center;min-width:32px;">M</th>
                                <th style="padding:8px 4px;text-align:center;white-space:nowrap;">DS</th>
                                <th style="padding:8px 4px;text-align:center;min-width:32px;">M</th>
                                <th style="padding:8px 4px;text-align:center;white-space:nowrap;">Read</th>
                                <th style="padding:8px 4px;text-align:center;min-width:32px;">M</th>
                                <th style="padding:8px 4px;text-align:center;white-space:nowrap;">Hear</th>
                                <th style="padding:8px 4px;text-align:center;min-width:32px;">M</th>
                                <th style="padding:8px 4px;text-align:center;white-space:nowrap;">Notes</th>
                                <th style="padding:8px 4px;text-align:center;min-width:32px;">M</th>
                                <th style="padding:8px 4px;text-align:center;min-width:44px;">Day%</th>
                                <th style="padding:8px 6px;text-align:center;min-width:44px;">Edit</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                            <tr style="background:#f0f4ff;font-weight:bold;font-size:12px;">
                                <td colspan="2" style="padding:7px 8px;color:#2c3e50;position:sticky;left:0;z-index:2;background:#f0f4ff;">Total</td>
                                <td style="padding:7px 4px;text-align:center;color:#888;">—</td>
                                ${totCell(weekTotals.sleepMarks, elapsedDays * 25)}
                                <td style="padding:7px 4px;text-align:center;color:#888;">—</td>
                                ${totCell(weekTotals.wakeupMarks, elapsedDays * 25)}
                                <td style="padding:7px 4px;text-align:center;color:#888;">—</td>
                                ${totCell(weekTotals.chantingMarks, elapsedDays * 25)}
                                <td style="padding:7px 4px;text-align:center;color:#888;">—</td>
                                ${totCell(weekTotals.morningMarks, elapsedDays * 25)}
                                <td style="padding:7px 4px;text-align:center;color:#888;">—</td>
                                ${totCell(weekTotals.daySleepMarks, elapsedDays * 10)}
                                <td style="padding:7px 4px;text-align:center;font-size:11px;color:#555;">${weekTotals.readingMins}m</td>
                                ${totCell(weekTotals.readingMarks, elapsedDays * 25)}
                                <td style="padding:7px 4px;text-align:center;font-size:11px;color:#555;">${weekTotals.hearingMins}m</td>
                                ${totCell(weekTotals.hearingMarks, elapsedDays * 25)}
                                <td style="padding:7px 4px;text-align:center;font-size:11px;color:#555;">${weekTotals.notesMins}m</td>
                                ${totCell(adjustedNotesMarks, elapsedDays * 25)}
                                <td colspan="2" style="padding:7px 4px;text-align:center;color:#888;">—</td>
                            </tr>
                            <tr style="background:#e8f0fe;font-weight:bold;font-size:12px;">
                                <td colspan="2" style="padding:6px 8px;color:#2c3e50;position:sticky;left:0;z-index:2;background:#e8f0fe;">Sadhna %</td>
                                ${pctCell(weekTotals.sleepMarks,    elapsedDays * 25)}
                                ${pctCell(weekTotals.wakeupMarks,   elapsedDays * 25)}
                                ${pctCell(weekTotals.chantingMarks, elapsedDays * 25)}
                                ${pctCell(weekTotals.morningMarks,  elapsedDays * 25)}
                                ${pctCell(weekTotals.daySleepMarks, elapsedDays * 10)}
                                ${pctCell(weekTotals.readingMarks,  elapsedDays * 25)}
                                ${pctCell(weekTotals.hearingMarks,  elapsedDays * 25)}
                                ${pctCell(adjustedNotesMarks,       elapsedDays * 25)}
                                <td colspan="2" style="padding:6px 4px;text-align:center;color:#888;">—</td>
                            </tr>
                        </tbody>
                    </table>
                    </div>
                    <div style="margin-top:12px;padding:12px 16px;background:${fairPercent>=50?'#27ae60':'#e74c3c'};color:white;border-radius:8px;text-align:center;">
                        <strong style="font-size:1.2em;">${adjustedTotal} / ${fairMax} (${fairPercent}%)</strong>
                        <div style="font-size:11px;opacity:0.85;margin-top:3px;">${elapsedDays} days × 175 pts</div>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // Render 4-week trend comparison AFTER weekly reports are in the DOM
    try {
        generate4WeekComparison([], weeksData);
    } catch(e) {
        console.error('4-week comparison error:', e);
    }

    // Event delegation — handles fill-btn, edit-btn, edit-hist-btn
    if (container._reportClickHandler) {
        container.removeEventListener('click', container._reportClickHandler);
    }
    container._reportClickHandler = (e) => {
        const fillBtn = e.target.closest('.fill-btn');
        const editBtn = e.target.closest('.edit-btn');
        const histBtn = e.target.closest('.edit-hist-btn');
        if (fillBtn) { editEntry(fillBtn.dataset.date); return; }
        if (editBtn) { editEntry(editBtn.dataset.date); return; }
        if (histBtn) { viewEditHistory(histBtn.dataset.date); return; }
    };
    container.addEventListener('click', container._reportClickHandler);
    _reportsLoading = false; // always reset — even if comparison threw
}

// 4-week comparison — always shows 4 weeks (NR for missing), trend oldest→newest, fair denominator
function generate4WeekComparison(weeksNewestFirst, weeksData) {
    const container = document.getElementById('four-week-comparison');
    if (!container) return;

    // Build exactly 4 week-sun-strings going back from today (Sun-anchored), newest first
    const today = new Date();
    const thisWeekSun = new Date(today);
    thisWeekSun.setDate(today.getDate() - today.getDay());

    const last4Suns = [];
    for (let w = 3; w >= 0; w--) {
        const sun = new Date(thisWeekSun);
        sun.setDate(thisWeekSun.getDate() - w * 7);
        last4Suns.push(toLocalDateStr(sun));
    }

    // Compute stats for each of the 4 weeks (oldest first for trend calculation)
    const weekStats = last4Suns.map(sunStr => {
        const week = weeksData[sunStr];
        const weekStart = new Date(sunStr + 'T00:00:00');
        let weekTotal = 0, weekNotesMins = 0, weekNotesMarks = 0, filledDays = 0;

        for (let i = 0; i < 7; i++) {
            const currentDate = new Date(weekStart);
            currentDate.setDate(weekStart.getDate() + i);
            const dateStr = toLocalDateStr(currentDate);
            const isFuture = new Date(dateStr + 'T00:00:00') > today;
            if (isFuture) continue; // skip future days entirely for fair denominator
            if (dateStr < APP_START_DATE) continue; // before app launch — not NR
            const entry = (week && week.days[dateStr]) ? week.days[dateStr] : getNRData(dateStr);
            const isFilled = !!(week && week.days[dateStr]);
            weekTotal += entry.totalScore ?? 0;
            weekNotesMins += (isFilled && entry.notesMinutes !== 'NR') ? (entry.notesMinutes || 0) : 0;
            weekNotesMarks += entry.scores?.notes ?? 0;
            filledDays++;
        }

        let adjustedNotesMarks = weekNotesMarks;
        if (weekNotesMins >= 245) adjustedNotesMarks = 175;
        const adjustedTotal = weekTotal - weekNotesMarks + adjustedNotesMarks;
        // Fair denominator: only count elapsed days in week (not future)
        const maxPossible = filledDays * 175;
        const fairPercent = maxPossible > 0 ? Math.round((adjustedTotal / maxPossible) * 100) : 0;
        const rawPercent = Math.round((adjustedTotal / 1225) * 100);

        // Label
        const MONTHS_CMP = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const sunDate = new Date(sunStr + 'T00:00:00');
        const sat = new Date(sunStr + 'T00:00:00'); sat.setDate(sunDate.getDate() + 6);
        const fmt = d => `${String(d.getDate()).padStart(2,'0')} ${MONTHS_CMP[d.getMonth()]}`;
        const label = `${fmt(sunDate)} – ${fmt(sat)}`;

        return { sunStr, label, adjustedTotal, maxPossible, fairPercent, rawPercent, filledDays };
    });

    // Compute trend oldest→newest first, then reverse for display (newest on top)
    let previousFairPercent = null;
    const weekStatsWithTrend = weekStats.map((ws, idx) => {
        let trendIcon = idx === 0 ? '—' : '', trendColor = '#666';
        if (idx > 0 && previousFairPercent !== null) {
            const diff = ws.fairPercent - previousFairPercent;
            if (diff > 0)      { trendIcon = `▲ +${diff}%`; trendColor = '#27ae60'; }
            else if (diff < 0) { trendIcon = `▼ ${diff}%`;  trendColor = '#e74c3c'; }
            else               { trendIcon = '→ 0%';         trendColor = '#666'; }
        }
        previousFairPercent = ws.fairPercent;
        return { ...ws, trendIcon, trendColor };
    });

    // Display newest week first, hide weeks entirely before app start
    const displayStats = [...weekStatsWithTrend]
        .reverse()
        .filter(ws => {
            const sat = new Date(ws.sunStr + 'T00:00:00');
            sat.setDate(sat.getDate() + 6);
            return toLocalDateStr(sat) >= APP_START_DATE;
        });

    let tableHTML = `
        <table class="comparison-table">
            <thead><tr>
                <th>Week</th>
                <th>Score</th>
                <th>Fair %<br><span style="font-size:10px;font-weight:normal;">(÷ elapsed days)</span></th>
                <th>Overall %<br><span style="font-size:10px;font-weight:normal;">(÷ 1225)</span></th>
                <th>Trend</th>
            </tr></thead>
            <tbody>`;

    displayStats.forEach((ws, idx) => {
        const fairColor = ws.fairPercent >= 80 ? '#27ae60' : ws.fairPercent >= 60 ? '#f39c12' : '#e74c3c';
        const rawColor  = ws.rawPercent  >= 80 ? '#27ae60' : ws.rawPercent  >= 60 ? '#f39c12' : '#e74c3c';
        // Highlight current week row
        const isCurrentWeek = idx === 0;
        const rowStyle = isCurrentWeek ? 'background:#f0f8ff;' : '';

        tableHTML += `
            <tr style="${rowStyle}">
                <td><strong>${ws.label}</strong>${isCurrentWeek ? ' <span style="font-size:10px;background:#3498db;color:white;padding:1px 5px;border-radius:10px;vertical-align:middle;">This week</span>' : ''}</td>
                <td><strong>${ws.adjustedTotal}/${ws.maxPossible}</strong></td>
                <td style="color:${fairColor};font-weight:bold;font-size:1.05em;">${ws.fairPercent}%</td>
                <td style="color:${rawColor};font-weight:bold;font-size:1.05em;">${ws.rawPercent}%</td>
                <td style="color:${ws.trendColor};font-weight:bold;">${ws.trendIcon}</td>
            </tr>`;
    });

    tableHTML += `</tbody></table>
        <p style="margin-top:8px;font-size:11px;color:#888;">
            <strong>Fair %</strong> = score ÷ (elapsed days × 175) — excludes future days &amp; compares weeks fairly.<br>
            <strong>Overall %</strong> = score ÷ 1225 (full week max) — traditional view.
        </p>`;
    container.innerHTML = tableHTML;
}

// --- 9. CHARTS ---
async function generateCharts() {
    const period = document.getElementById('chart-period')?.value;
    const scoreCanvas = document.getElementById('score-chart');
    const actSection = document.getElementById('activity-chart-section');

    // Show loading state
    if (scoreCanvas) {
        const ctx = scoreCanvas.getContext('2d');
        if (scoreChart) { scoreChart.destroy(); scoreChart = null; }
        ctx.clearRect(0, 0, scoreCanvas.width, scoreCanvas.height);
        ctx.fillStyle = '#aaa';
        ctx.font = '14px Segoe UI';
        ctx.textAlign = 'center';
        ctx.fillText('Loading…', scoreCanvas.width / 2 || 200, 60);
    }

    try {
        if (period === 'daily')        await generateDailyCharts();
        else if (period === 'weekly')  await generateWeeklyCharts();
        else if (period === 'monthly') await generateMonthlyCharts();
    } catch (err) {
        console.error('Chart error:', err);
        if (scoreCanvas) {
            const ctx = scoreCanvas.getContext('2d');
            ctx.clearRect(0, 0, scoreCanvas.width, scoreCanvas.height);
            ctx.fillStyle = '#e74c3c';
            ctx.font = '13px Segoe UI';
            ctx.textAlign = 'center';
            ctx.fillText('Error loading chart: ' + err.message, scoreCanvas.width / 2 || 200, 60);
        }
    }
}

// Global store for activity chart data (for filter updates)
let _currentActivityTotals = null;

async function generateDailyCharts() {
    const today = new Date();
    const todayStr = toLocalDateStr(today);
    const dates = [];
    for (let i = 27; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const ds = toLocalDateStr(d);
        if (ds >= APP_START_DATE) dates.push(ds);  // Only show from app start date
    }

    if (dates.length === 0) return;
    // Use date range query — works for any number of dates
    const snapshot = await db.collection('users').doc(currentUser.uid)
        .collection('sadhana')
        .where(firebase.firestore.FieldPath.documentId(), '>=', dates[0])
        .where(firebase.firestore.FieldPath.documentId(), '<=', dates[dates.length - 1])
        .get();

    const data = {};
    snapshot.forEach(doc => { data[doc.id] = doc.data(); });

    const labels = dates.map(d => (() => { const _d = new Date(d + 'T00:00:00'); const _M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return String(_d.getDate()).padStart(2,'0')+' '+_M[_d.getMonth()]; })());
    // NR past days = -40 shown on chart; today unfilled = null (gap, no penalty yet)
    const scores = dates.map(d => {
        if (data[d] !== undefined) return data[d].totalScore ?? null;
        if (d === todayStr) return null;
        if (d < APP_START_DATE) return null; // before app launch — no penalty
        return -40;
    });

    // Activity totals: NR past days contribute penalty scores (same as getNRData)
    const NR_SCORES = { sleep: -5, wakeup: -5, morningProgram: -5, chanting: -5, reading: -5, hearing: -5, notes: -5, daySleep: 0 };
    const getS = (d, key) => data[d] ? (data[d]?.scores?.[key] ?? 0) : (d === todayStr || d < APP_START_DATE ? 0 : NR_SCORES[key]);
    _currentActivityTotals = {
        Sleep:           dates.reduce((s, d) => s + getS(d, 'sleep'), 0),
        'Wake-up':       dates.reduce((s, d) => s + getS(d, 'wakeup'), 0),
        'Morning Prog.': dates.reduce((s, d) => s + getS(d, 'morningProgram'), 0),
        Chanting:        dates.reduce((s, d) => s + getS(d, 'chanting'), 0),
        Reading:         dates.reduce((s, d) => s + getS(d, 'reading'), 0),
        Hearing:         dates.reduce((s, d) => s + getS(d, 'hearing'), 0),
        'Notes Rev.':    dates.reduce((s, d) => s + getS(d, 'notes'), 0),
        'Day Sleep':     dates.reduce((s, d) => s + getS(d, 'daySleep'), 0),
    };

    // Ring: include NR past days at -40, exclude today if not yet filled, exclude pre-app-start
    const datesForRing = dates.filter(d => (d !== todayStr || data[d]) && d >= APP_START_DATE);
    const totalEarned = datesForRing.reduce((s, d) => s + (data[d] ? (data[d].totalScore ?? 0) : -40), 0);
    const maxPossible = datesForRing.length * 175;
    const fairPercent = maxPossible > 0 ? Math.round((totalEarned / maxPossible) * 100) : 0;

    const ringContainer = document.getElementById('score-ring-container');
    if (ringContainer) ringContainer.style.display = datesForRing.length > 0 ? 'block' : 'none';
    if (datesForRing.length > 0) renderScoreRing(fairPercent, `${dates[0].slice(5).replace('-','/')} – ${dates[dates.length-1].slice(5).replace('-','/')}`, datesForRing.length, totalEarned);

    renderScoreLineChart(labels, scores);
    renderActivityBarChart(_currentActivityTotals);
}

async function generateWeeklyCharts() {
    const today = new Date();
    const weeks = [];
    for (let i = 3; i >= 0; i--) {
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - (today.getDay() + i * 7));
        weeks.push(weekStart);
    }

    const labels = [];
    const scores = [];
    _currentActivityTotals = { Sleep: 0, 'Wake-up': 0, 'Morning Prog.': 0, Chanting: 0, Reading: 0, Hearing: 0, 'Notes Rev.': 0, 'Day Sleep': 0 };
    let latestWeekTotal = 0, latestWeekDays = 0;

    for (let wi = 0; wi < weeks.length; wi++) {
        const weekStart = weeks[wi];
        const weekDates = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart);
            d.setDate(weekStart.getDate() + i);
            weekDates.push(toLocalDateStr(d));
        }

        // Use range query — safe and no 'in' limit issue
        const snapshot = await db.collection('users').doc(currentUser.uid)
            .collection('sadhana')
            .where(firebase.firestore.FieldPath.documentId(), '>=', weekDates[0])
            .where(firebase.firestore.FieldPath.documentId(), '<=', weekDates[6])
            .get();

        const today2 = new Date();
        const todayStr2 = toLocalDateStr(today2);
        let weekTotal = 0, weekDayCount = 0;
        const wData = {};
        snapshot.forEach(doc => { wData[doc.id] = doc.data(); });

        // Count all past days in week (submitted or NR), skip future and pre-app-start
        weekDates.forEach(dateStr => {
            if (dateStr > todayStr2) return; // future day — skip
            if (dateStr < APP_START_DATE) return; // before app launch — skip
            if (wData[dateStr]) {
                weekTotal += wData[dateStr].totalScore ?? 0;
            } else {
                weekTotal += -40; // NR penalty
            }
            weekDayCount++;
        });

        labels.push(`Wk ${weekStart.getDate()}/${weekStart.getMonth() + 1}`);
        scores.push(weekDayCount > 0 ? weekTotal : null);

        if (wi === weeks.length - 1) {
            latestWeekTotal = weekTotal;
            latestWeekDays = weekDayCount;
            const NR_SC = { sleep:-5, wakeup:-5, morningProgram:-5, chanting:-5, reading:-5, hearing:-5, notes:-5, daySleep:0 };
            weekDates.forEach(d => {
                if (d > todayStr2) return;
                if (d < APP_START_DATE) return;
                const src = wData[d] ? wData[d].scores : NR_SC;
                _currentActivityTotals['Sleep']          += src?.sleep ?? 0;
                _currentActivityTotals['Wake-up']        += src?.wakeup ?? 0;
                _currentActivityTotals['Morning Prog.']  += src?.morningProgram ?? 0;
                _currentActivityTotals['Chanting']       += src?.chanting ?? 0;
                _currentActivityTotals['Reading']        += src?.reading ?? 0;
                _currentActivityTotals['Hearing']        += src?.hearing ?? 0;
                _currentActivityTotals['Notes Rev.']     += src?.notes ?? 0;
                _currentActivityTotals['Day Sleep']      += src?.daySleep ?? 0;
            });
        }
    }

    const maxPossible = latestWeekDays * 175;
    const weekPercent = maxPossible > 0 ? Math.round((latestWeekTotal / maxPossible) * 100) : 0;
    const dateRange = `Wk ${weeks[weeks.length-1].getDate()}/${weeks[weeks.length-1].getMonth()+1}`;

    const ringContainer = document.getElementById('score-ring-container');
    if (ringContainer) ringContainer.style.display = latestWeekDays > 0 ? 'block' : 'none';
    if (latestWeekDays > 0) renderScoreRing(weekPercent, dateRange, latestWeekDays, latestWeekTotal);

    renderScoreLineChart(labels, scores);
    renderActivityBarChart(_currentActivityTotals);
}

async function generateMonthlyCharts() {
    const today = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(new Date(today.getFullYear(), today.getMonth() - i, 1));

    const labels = [];
    const scores = [];
    _currentActivityTotals = null; // no activity bar for monthly

    for (const month of months) {
        const startDate = new Date(month.getFullYear(), month.getMonth(), 1);
        const endDate = new Date(month.getFullYear(), month.getMonth() + 1, 0);

        const snapshot = await db.collection('users').doc(currentUser.uid)
            .collection('sadhana')
            .where(firebase.firestore.FieldPath.documentId(), '>=', toLocalDateStr(startDate))
            .where(firebase.firestore.FieldPath.documentId(), '<=', toLocalDateStr(endDate))
            .get();

        let monthTotal = 0, monthDays = 0;
        snapshot.forEach(doc => { monthTotal += doc.data().totalScore ?? 0; monthDays++; });
        labels.push((() => { const _M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return _M[month.getMonth()]+' '+String(month.getFullYear()).slice(2); })());
        scores.push(monthDays > 0 ? monthTotal : null);
    }

    document.getElementById('score-ring-container').style.display = 'none';
    renderScoreLineChart(labels, scores);
    // Hide activity chart for monthly
    const actSection = document.getElementById('activity-chart-section');
    if (actSection) actSection.style.display = 'none';
}

// --- CHANGE 4: Render score ring (donut) ---
function renderScoreRing(percent, dateRange, days, totalPts) {
    const container = document.getElementById('score-ring-container');
    container.style.display = 'flex';

    const color = percent >= 70 ? '#27ae60' : percent >= 50 ? '#f39c12' : '#e74c3c';
    const ringLabel = percent >= 70 ? 'Good' : percent >= 50 ? 'OK' : 'Needs work';

    container.innerHTML = `
        <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
            <div style="position:relative;width:120px;height:120px;flex-shrink:0;">
                <svg width="120" height="120" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="48" fill="none" stroke="#eee" stroke-width="14"/>
                    <circle cx="60" cy="60" r="48" fill="none" stroke="${color}" stroke-width="14"
                        stroke-dasharray="${Math.round(2*Math.PI*48*percent/100)} ${Math.round(2*Math.PI*48*(100-percent)/100)}"
                        stroke-dashoffset="${Math.round(2*Math.PI*48*0.25)}"
                        stroke-linecap="round" transform="rotate(-90 60 60)"/>
                </svg>
                <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;line-height:1.2;">
                    <div style="font-size:22px;font-weight:bold;color:${color};">${percent}%</div>
                    <div style="font-size:10px;color:#888;">week score</div>
                </div>
            </div>
            <div>
                <div style="font-weight:700;font-size:15px;color:#2c3e50;margin-bottom:4px;">Score Summary</div>
                <div style="font-size:13px;color:#555;margin-bottom:6px;">${days} day${days !== 1 ? 's' : ''} · ${totalPts} pts</div>
                <div style="font-size:12px;">
                    <span style="color:#27ae60;font-weight:600;">≥70%</span> Good &nbsp;
                    <span style="color:#f39c12;font-weight:600;">50–69%</span> OK &nbsp;
                    <span style="color:#e74c3c;font-weight:600;">&lt;50%</span> Needs work
                </div>
                <div style="margin-top:6px;padding:4px 10px;background:${color}18;border-left:3px solid ${color};border-radius:4px;font-size:12px;color:${color};font-weight:600;">${ringLabel}</div>
            </div>
        </div>
    `;
}

// --- Render score LINE chart ---
function renderScoreLineChart(labels, scores) {
    if (scoreChart) { scoreChart.destroy(); scoreChart = null; }

    // Restore ring visibility (monthly hides it)
    const ringContainer = document.getElementById('score-ring-container');
    if (ringContainer) ringContainer.style.display = '';

    const actSection = document.getElementById('activity-chart-section');
    if (actSection) actSection.style.display = 'block';

    const scoreCtx = document.getElementById('score-chart').getContext('2d');

    // Determine if we have any real data
    const realScores = scores.filter(s => s !== null);
    const hasData = realScores.length > 0;

    // Y-axis range: always show full meaningful range regardless of data
    const yMin = hasData ? Math.min(-40, Math.min(...realScores) - 10) : -40;
    const yMax = hasData ? Math.max(175, Math.max(...realScores) + 10) : 175;

    scoreChart = new Chart(scoreCtx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Score',
                data: scores,
                borderColor: '#5b9bd5',
                backgroundColor: 'rgba(91,155,213,0.10)',
                borderWidth: 2.5,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: '#5b9bd5',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#5b9bd5',
                tension: 0.35,
                fill: true,
                spanGaps: true,
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => ctx.parsed.y !== null ? `Score: ${ctx.parsed.y}` : 'No entry'
                    }
                }
            },
            scales: {
                y: {
                    min: yMin,
                    max: yMax,
                    grid: { color: 'rgba(0,0,0,0.06)' },
                    ticks: {
                        stepSize: 20,
                        callback: v => v
                    }
                },
                x: { grid: { display: false } }
            }
        }
    });

    // If no data, show a message overlay
    if (!hasData) {
        const canvas = document.getElementById('score-chart');
        const ctx2 = canvas.getContext('2d');
        // Draw after chart renders
        setTimeout(() => {
            ctx2.save();
            ctx2.fillStyle = 'rgba(150,150,150,0.7)';
            ctx2.font = '14px Segoe UI';
            ctx2.textAlign = 'center';
            ctx2.fillText('No data yet — submit your first Sadhna entry!', canvas.width / 2, canvas.height / 2);
            ctx2.restore();
        }, 100);
    }
}

// Chart period tab switcher (Daily / Weekly / Monthly buttons)
window.setChartPeriod = (period) => {
    const select = document.getElementById('chart-period');
    if (select) select.value = period;
    // Update tab button styles
    document.querySelectorAll('.chart-period-btn').forEach(btn => {
        btn.style.background = '#f0f0f0';
        btn.style.color = '#666';
        btn.style.border = '1px solid #ddd';
        btn.classList.remove('active');
    });
    const activeBtn = document.querySelector(`.chart-period-btn[onclick*="'${period}'"]`);
    if (activeBtn) {
        activeBtn.style.background = '#2c3e50';
        activeBtn.style.color = 'white';
        activeBtn.style.border = 'none';
        activeBtn.classList.add('active');
    }
    // Update max label
    const maxLabel = document.getElementById('chart-max-label');
    if (maxLabel) {
        if (period === 'daily') maxLabel.textContent = 'Daily max: 175 · Weekly max: 1225';
        else if (period === 'weekly') maxLabel.textContent = 'Weekly max: 1225';
        else maxLabel.textContent = '';
    }
    generateCharts();
};

// Activity filter update (called by checkboxes)
window.updateActivityFilter = () => {
    if (_currentActivityTotals) renderActivityBarChart(_currentActivityTotals);
};

// --- Render horizontal bar chart (activity breakdown) with filter ---
function renderActivityBarChart(activityTotals) {
    if (activityChart) { activityChart.destroy(); activityChart = null; }

    const actSection = document.getElementById('activity-chart-section');
    if (!activityTotals) { if (actSection) actSection.style.display = 'none'; return; }
    if (actSection) actSection.style.display = 'block';

    // Apply filters
    const checkboxes = document.querySelectorAll('#activity-filters input[type=checkbox]');
    const enabledActivities = new Set();
    checkboxes.forEach(cb => { if (cb.checked) enabledActivities.add(cb.dataset.activity); });

    const filteredKeys = Object.keys(activityTotals).filter(k => enabledActivities.has(k));
    const filteredVals = filteredKeys.map(k => activityTotals[k]);
    // Calculate max possible per activity for percentage (based on chart period)
    const period = document.getElementById('chart-period')?.value || 'daily';
    let actMaxPerItem = 175; // daily: 28 days × 25 pts but we show raw pts, need to calc %
    if (period === 'daily') actMaxPerItem = 28 * 25;
    else if (period === 'weekly') actMaxPerItem = 7 * 25;
    const filteredPcts = filteredVals.map(v => actMaxPerItem > 0 ? Math.round((v / actMaxPerItem) * 100) : 0);
    const actColors = filteredPcts.map(p => p >= 70 ? '#27ae60' : p >= 0 ? '#f39c12' : '#e74c3c');

    const actCtx = document.getElementById('activity-chart').getContext('2d');
    activityChart = new Chart(actCtx, {
        type: 'bar',
        data: {
            labels: filteredKeys,
            datasets: [{
                label: '%',
                data: filteredPcts,
                backgroundColor: actColors,
                borderRadius: 5,
                borderSkipped: false,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x}%` } },
                datalabels: false
            },
            scales: {
                x: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: 'rgba(0,0,0,0.06)' },
                    ticks: { stepSize: 20, callback: v => v + '%' }
                },
                y: { grid: { display: false } }
            }
        }
    });
}

// ══════════════════════════════════════════════
// --- TAPAH FLASHCARD MODULE ---
// ══════════════════════════════════════════════

const ANUKUL_QUESTIONS = [
    { id: 'channelWork',    label: 'Did I work on Channel work?',                    target: '30 min', note: null },
    { id: 'lectureSewa',    label: 'Did I do Lecture Preparation & Lecture Sewa?',   target: '40 min', note: null },
    { id: 'shlokRecite',    label: 'Did I do One Shlok Recitation with meaning?',    target: '20 min', note: null },
    { id: 'healthChart',    label: 'Did I work on Health Chart?',                    target: '20 min', note: null },
    { id: 'dataValidation', label: 'Did I work on Data Validation Preaching?',       target: '30 min', note: null },
];
const PRATIKUL_QUESTIONS = [
    { id: 'personalProgram',  label: 'Did I do Personal Program?',                 target: null, note: 'Positive if done'  },
    { id: 'socialMedia',      label: 'Did I spend time on Social Media & Videos?', target: null, note: 'Negative activity' },
    { id: 'outsideFood',      label: 'Did I eat Outside Food?',                    target: null, note: 'Negative activity' },
    { id: 'withoutBhoga',     label: 'Did I eat Without Bhoga Food?',              target: null, note: 'Negative activity' },
    { id: 'withoutMantra',    label: 'Did I eat food without Mantra?',             target: null, note: 'Negative activity' },
];

function getAanukulScore(val) { return val === 'yes' ? 5 : val === 'partial' ? 2 : 0; }
function getPratikulScore(val) { return val === 'yes' ? -5 : val === 'partial' ? 2 : 5; }

let tapahEditingDate = null;
let _tapahAnswers = {};
let _tapahChart = null;

// Flat list of all questions with section tag
const ALL_TAPAH_QUESTIONS = [
    ...ANUKUL_QUESTIONS.map(q => ({ ...q, section: 'anukul' })),
    ...PRATIKUL_QUESTIONS.map(q => ({ ...q, section: 'pratikul' })),
];

let _flashCardIndex = 0; // current card index (0–9)

function resetTapahForm() {
    _tapahAnswers = {};
    _flashCardIndex = 0;
    _tapahAnswering = false;
    tapahEditingDate = null;
    setupTapahDateSelect();
    const banner = document.getElementById('tapah-edit-banner');
    if (banner) banner.style.display = 'none';
    const submitBtn = document.getElementById('tapah-submit-btn');
    if (submitBtn) submitBtn.style.display = 'none';
    const doneScreen = document.getElementById('tapah-done-screen');
    if (doneScreen) doneScreen.style.display = 'none';
    const card = document.getElementById('tapah-card');
    if (card) { card.style.display = 'block'; card.style.opacity = '1'; card.style.transform = 'none'; card.style.transition = 'opacity 0.2s ease, transform 0.2s ease'; }
    renderFlashCard(0);
    updateTapahTotals();
}

window.cancelTapahEdit = () => {
    resetTapahForm();
    // Badge back to today
    const todayStr = toLocalDateStr(new Date());
    const badge = document.getElementById('tapah-date-status');
    const hint  = document.getElementById('tapah-date-hint');
    if (badge) { badge.textContent = '📆 Today'; badge.style.background = '#e8f0fe'; badge.style.color = '#3498db'; }
    if (hint)  hint.textContent = 'Filling today\'s entry';
};

function setupTapahDateSelect() {
    const s = document.getElementById('tapah-date');
    if (!s) return;
    const todayStr = toLocalDateStr(new Date());
    s.min = APP_START_DATE;
    s.max = todayStr;
    s.value = todayStr;
    s.disabled = false;
    updateTapahDateStatus(todayStr);
}

function updateTapahDateStatus(dateStr) {
    const badge  = document.getElementById('tapah-date-status');
    const hint   = document.getElementById('tapah-date-hint');
    if (!badge) return;
    const todayStr = toLocalDateStr(new Date());
    if (!dateStr) { badge.textContent = '—'; badge.style.background = '#f0f0f0'; badge.style.color = '#888'; return; }
    if (dateStr === todayStr) {
        badge.textContent = '📆 Today';
        badge.style.background = '#e8f0fe'; badge.style.color = '#3498db';
        if (hint) hint.textContent = 'Filling today\'s entry';
    } else {
        badge.textContent = '⏳ Checking…';
        badge.style.background = '#f0f0f0'; badge.style.color = '#888';
    }
}

window.onTapahDateChange = async (dateStr) => {
    if (!dateStr || !currentUser) return;
    const badge = document.getElementById('tapah-date-status');
    const hint  = document.getElementById('tapah-date-hint');
    const todayStr = toLocalDateStr(new Date());

    // Reset form state (keep date)
    _tapahAnswers = {};
    _flashCardIndex = 0;
    _tapahAnswering = false;
    tapahEditingDate = null;
    const banner = document.getElementById('tapah-edit-banner');
    if (banner) banner.style.display = 'none';
    const card = document.getElementById('tapah-card');
    if (card) { card.style.display = 'block'; card.style.opacity = '1'; card.style.transform = 'none'; }
    const doneScreen = document.getElementById('tapah-done-screen');
    if (doneScreen) doneScreen.style.display = 'none';
    const submitBtn = document.getElementById('tapah-submit-btn');
    if (submitBtn) submitBtn.style.display = 'none';

    if (badge) { badge.textContent = '⏳'; badge.style.background = '#f0f0f0'; badge.style.color = '#888'; }

    try {
        const snap = await db.collection('users').doc(currentUser.uid).collection('tapah').doc(dateStr).get();
        if (snap.exists) {
            const d = snap.data();
            restoreTapahButtons(d.anukul || {}, d.pratikul || {});
            tapahEditingDate = dateStr;
            const bannerText = document.getElementById('tapah-edit-banner-text');
            if (banner) banner.style.display = 'flex';
            if (bannerText) bannerText.textContent = `Editing Tapah: ${dateStr}`;
            if (badge) { badge.textContent = '✅ Filled'; badge.style.background = '#e8f8f0'; badge.style.color = '#27ae60'; }
            if (hint) hint.textContent = 'Entry exists — editing it now';
        } else {
            if (badge) {
                if (dateStr === todayStr) {
                    badge.textContent = '📆 Today'; badge.style.background = '#e8f0fe'; badge.style.color = '#3498db';
                    if (hint) hint.textContent = 'New entry for today';
                } else {
                    badge.textContent = '⚠️ NR'; badge.style.background = '#fff3cd'; badge.style.color = '#856404';
                    if (hint) hint.textContent = 'No entry yet — filling now';
                }
            }
        }
    } catch (err) {
        if (badge) { badge.textContent = '❌ Error'; badge.style.background = '#fde8e8'; badge.style.color = '#e74c3c'; }
        if (hint) hint.textContent = err.code || err.message;
    }
    renderFlashCard(0);
    updateTapahTotals();
};

function renderFlashCard(idx) {
    const total = ALL_TAPAH_QUESTIONS.length;
    const q = ALL_TAPAH_QUESTIONS[idx];
    if (!q) return;

    // If key elements aren't in the DOM yet, bail silently
    const counter = document.getElementById('tapah-card-counter');
    if (!counter) return;

    const isAnukul = q.section === 'anukul';
    const badge = document.getElementById('tapah-section-badge');
    const questionEl = document.getElementById('tapah-card-question');
    const metaEl = document.getElementById('tapah-card-meta');
    const scoringEl = document.getElementById('tapah-card-scoring');
    const progressBar = document.getElementById('tapah-progress-bar');
    const flash = document.getElementById('tapah-score-flash');

    if (counter) counter.textContent = `Q ${idx + 1} / ${total}`;
    if (badge) {
        badge.textContent = isAnukul ? '🌿 Anukulasya' : '🚫 Pratikulasya';
        badge.style.background = isAnukul ? '#e8f8f0' : '#fde8e8';
        badge.style.color = isAnukul ? '#27ae60' : '#e74c3c';
    }
    if (questionEl) questionEl.textContent = q.label;
    if (metaEl) {
        const parts = [];
        if (q.target) parts.push(`⏱ ${q.target}`);
        if (q.note) parts.push(`(${q.note})`);
        metaEl.textContent = parts.join('  ');
    }
    if (scoringEl) {
        scoringEl.innerHTML = isAnukul
            ? '<strong style="color:#27ae60;">Yes +5</strong> &nbsp;|&nbsp; <strong style="color:#f39c12;">Partial +2</strong> &nbsp;|&nbsp; <strong style="color:#e74c3c;">No 0</strong>'
            : '<strong style="color:#e74c3c;">Yes −5</strong> &nbsp;|&nbsp; <strong style="color:#f39c12;">Partial +2</strong> &nbsp;|&nbsp; <strong style="color:#27ae60;">No +5</strong>';
    }
    if (progressBar) progressBar.style.width = `${(idx / total) * 100}%`;
    if (flash) { flash.textContent = ''; flash.style.opacity = '0'; }

    // Restore button state if already answered
    ['yes','partial','no'].forEach(v => {
        const btn = document.getElementById(`tapah-btn-${v}`);
        if (!btn) return;
        btn.style.border = '2px solid #ddd';
        btn.style.background = '#f8f9fa';
        btn.style.color = '#555';
    });
    const existing = _tapahAnswers[q.id];
    if (existing) highlightBtn(existing.val, isAnukul, false);
}

function highlightBtn(val, isAnukul, flash = true) {
    ['yes','partial','no'].forEach(v => {
        const btn = document.getElementById(`tapah-btn-${v}`);
        if (!btn) return;
        btn.style.border = '2px solid #ddd';
        btn.style.background = '#f8f9fa';
        btn.style.color = '#555';
    });
    let color, bg;
    if (val === 'yes')     { color = isAnukul ? '#27ae60' : '#e74c3c'; bg = isAnukul ? '#e8f8f0' : '#fde8e8'; }
    if (val === 'partial') { color = '#f39c12'; bg = '#fff8e8'; }
    if (val === 'no')      { color = isAnukul ? '#e74c3c' : '#27ae60'; bg = isAnukul ? '#fde8e8' : '#e8f8f0'; }
    const btn = document.getElementById(`tapah-btn-${val}`);
    if (btn) { btn.style.border = `2px solid ${color}`; btn.style.background = bg; btn.style.color = color; }
}

let _tapahAnswering = false; // debounce: prevents double-fire on mobile touch
window.tapahFlashAnswer = (val) => {
    if (_tapahAnswering) return; // block rapid/double tap
    _tapahAnswering = true;
    setTimeout(() => { _tapahAnswering = false; }, 700); // unlock after advance

    const q = ALL_TAPAH_QUESTIONS[_flashCardIndex];
    if (!q) return;
    const isAnukul = q.section === 'anukul';
    _tapahAnswers[q.id] = { val, type: q.section };

    const score = isAnukul ? getAanukulScore(val) : getPratikulScore(val);
    highlightBtn(val, isAnukul, true);

    // Flash score feedback
    const flash = document.getElementById('tapah-score-flash');
    if (flash) {
        flash.textContent = `${score >= 0 ? '+' : ''}${score} pts`;
        flash.style.color = score > 0 ? '#27ae60' : score < 0 ? '#e74c3c' : '#888';
        flash.style.opacity = '1';
    }

    updateTapahTotals();

    // Auto-advance after 600ms
    setTimeout(() => {
        const next = _flashCardIndex + 1;
        if (next < ALL_TAPAH_QUESTIONS.length) {
            const card = document.getElementById('tapah-card');
            // Fade out
            if (card) { card.style.opacity = '0'; card.style.transform = 'translateX(-20px)'; }
            setTimeout(() => {
                _flashCardIndex = next;
                renderFlashCard(next);
                // Reset position instantly (no transition) then fade in
                if (card) {
                    card.style.transition = 'none';
                    card.style.transform = 'translateX(20px)';
                    card.style.opacity = '0';
                    // Use setTimeout(0) instead of rAF — more reliable on mobile
                    setTimeout(() => {
                        card.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
                        card.style.opacity = '1';
                        card.style.transform = 'translateX(0)';
                    }, 20);
                }
            }, 220);
        } else {
            showTapahDoneScreen();
        }
    }, 600);
};

function showTapahDoneScreen() {
    const card = document.getElementById('tapah-card');
    const done = document.getElementById('tapah-done-screen');
    const submitBtn = document.getElementById('tapah-submit-btn');
    const bar = document.getElementById('tapah-progress-bar');

    if (card) card.style.display = 'none';
    if (bar) bar.style.width = '100%';

    let anukulTotal = 0, pratikulTotal = 0;
    ANUKUL_QUESTIONS.forEach(q => { const a = _tapahAnswers[q.id]; if (a) anukulTotal += getAanukulScore(a.val); });
    PRATIKUL_QUESTIONS.forEach(q => { const a = _tapahAnswers[q.id]; if (a) pratikulTotal += getPratikulScore(a.val); });
    const total = anukulTotal + pratikulTotal;
    const pct = Math.round((total / 50) * 100);
    const color = total >= 35 ? '#27ae60' : total >= 20 ? '#f39c12' : '#e74c3c';

    const doneScore = document.getElementById('tapah-done-score');
    const donePct = document.getElementById('tapah-done-pct');
    if (doneScore) { doneScore.textContent = `${total} / 50`; doneScore.style.color = color; }
    if (donePct)   donePct.textContent = `${pct}%`;

    if (done) done.style.display = 'block';
    if (submitBtn) submitBtn.style.display = 'block';
}

window.tapahFlashReview = () => {
    _tapahAnswering = false; // reset debounce when going back to review
    // Go back to first unanswered or first card
    const firstUnanswered = ALL_TAPAH_QUESTIONS.findIndex(q => !_tapahAnswers[q.id]);
    _flashCardIndex = firstUnanswered >= 0 ? firstUnanswered : 0;
    const card = document.getElementById('tapah-card');
    const done = document.getElementById('tapah-done-screen');
    const submitBtn = document.getElementById('tapah-submit-btn');
    if (card) { card.style.display = 'block'; card.style.opacity = '1'; card.style.transform = 'none'; }
    if (done) done.style.display = 'none';
    if (submitBtn) submitBtn.style.display = 'none';
    renderFlashCard(_flashCardIndex);
};

function updateTapahTotals() {
    let anukulTotal = 0, pratikulTotal = 0;
    ANUKUL_QUESTIONS.forEach(q => { const a = _tapahAnswers[q.id]; if (a) anukulTotal += getAanukulScore(a.val); });
    PRATIKUL_QUESTIONS.forEach(q => { const a = _tapahAnswers[q.id]; if (a) pratikulTotal += getPratikulScore(a.val); });
    const total = anukulTotal + pratikulTotal;
    const percent = Math.round((total / 50) * 100);
    const ad = document.getElementById('anukul-score-display');
    const pd = document.getElementById('pratikul-score-display');
    const td = document.getElementById('tapah-total-display');
    const pp = document.getElementById('tapah-percent-display');
    if (ad) { ad.textContent = `${anukulTotal}/25`; ad.style.color = anukulTotal >= 15 ? '#27ae60' : anukulTotal >= 8 ? '#f39c12' : '#e74c3c'; }
    if (pd) { pd.textContent = `${pratikulTotal}/25`; pd.style.color = pratikulTotal >= 15 ? '#27ae60' : pratikulTotal >= 5 ? '#f39c12' : '#e74c3c'; }
    if (td) { td.textContent = `${total}/50`; td.style.color = total >= 35 ? '#27ae60' : total >= 20 ? '#f39c12' : '#e74c3c'; }
    if (pp) pp.textContent = `${percent}%`;
}

// Restore button states when editing past entry
function restoreTapahButtons(anukulAnswers, pratikulAnswers) {
    ALL_TAPAH_QUESTIONS.forEach(q => {
        const src = q.section === 'anukul' ? anukulAnswers : pratikulAnswers;
        const val = src[q.id];
        if (val && val !== 'nr') _tapahAnswers[q.id] = { val, type: q.section };
    });
    updateTapahTotals();
    renderFlashCard(_flashCardIndex);
}

// Edit a past Tapah entry (called from report edit buttons)
window.editTapahEntry = async (dateStr) => {
    switchMainTab('tapah');
    switchSubTab('tapah', 'entry');
    const sel = document.getElementById('tapah-date');
    if (sel) { sel.value = dateStr; sel.disabled = false; }
    await onTapahDateChange(dateStr);
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// Submit tapah (called by the Submit button shown on done screen)
window.submitTapahFromFlash = async () => {
    if (!currentUser) { alert('Please login first'); return; }
    const date = document.getElementById('tapah-date')?.value;
    if (!date) { alert('Please select a date.'); return; }

    const unanswered = ALL_TAPAH_QUESTIONS.filter(q => !_tapahAnswers[q.id]);
    if (unanswered.length > 0) {
        const go = confirm(`${unanswered.length} question(s) unanswered. Review before submitting?`);
        if (go) { window.tapahFlashReview(); return; }
    }

    const anukulScores = {}, pratikulScores = {}, anukulAnswers = {}, pratikulAnswers = {};
    let anukulTotal = 0, pratikulTotal = 0;
    ANUKUL_QUESTIONS.forEach(q => {
        const val = _tapahAnswers[q.id]?.val || 'no';
        anukulAnswers[q.id] = val;
        anukulScores[q.id] = getAanukulScore(val);
        anukulTotal += anukulScores[q.id];
    });
    PRATIKUL_QUESTIONS.forEach(q => {
        const val = _tapahAnswers[q.id]?.val || 'no';
        pratikulAnswers[q.id] = val;
        pratikulScores[q.id] = getPratikulScore(val);
        pratikulTotal += pratikulScores[q.id];
    });
    const total = anukulTotal + pratikulTotal;
    const percent = Math.round((total / 50) * 100);

    try {
        await db.collection('users').doc(currentUser.uid).collection('tapah').doc(date).set({
            anukul: anukulAnswers, pratikul: pratikulAnswers,
            anukulScores, pratikulScores, anukulTotal, pratikulTotal,
            totalScore: total, percent,
            submittedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        const isEdit = tapahEditingDate !== null;
        alert(`${isEdit ? 'Updated' : 'Saved'}! Tapah Score: ${total}/50 (${percent}%)`);
        resetTapahForm();
    } catch (err) {
        alert('Could not save Tapah. Please check your internet and try again.');
    }
};

// Legacy no-op — tapah form no longer exists as HTML form
window.selectTapahOption = () => {};

// ── END TAPAH MODULE ──

// ══════════════════════════════════════════════
// --- TAPAH-2 MODULE ---
// ══════════════════════════════════════════════

// Flat list of all questions — each sub-item is its own card
const TAPAH2_QUESTIONS = [
    // Focus on Chanting – 5 marks (5 × 1)
    { id: 'ch_q1', cat: 'chanting', catLabel: 'Focus on Chanting',           catEmoji: '🧘‍♂️', label: 'Pray with Heart',                                         max: 1 },
    { id: 'ch_q2', cat: 'chanting', catLabel: 'Focus on Chanting',           catEmoji: '🧘‍♂️', label: 'No Use anything except Chanting',                         max: 1 },
    { id: 'ch_q3', cat: 'chanting', catLabel: 'Focus on Chanting',           catEmoji: '🧘‍♂️', label: 'Clear Pronunciation / Hearing',                           max: 1 },
    { id: 'ch_q4', cat: 'chanting', catLabel: 'Focus on Chanting',           catEmoji: '🧘‍♂️', label: 'Minimum 10 Rounds in one position',                       max: 1 },
    { id: 'ch_q5', cat: 'chanting', catLabel: 'Focus on Chanting',           catEmoji: '🧘‍♂️', label: 'Complete with one slot',                                  max: 1 },
    // No Prajalpa – 5 marks (5 × 1)
    { id: 'pr_q1', cat: 'prajalpa', catLabel: 'No Prajalpa',                 catEmoji: '🧘',   label: 'No superfluous talk',                                      max: 1 },
    { id: 'pr_q2', cat: 'prajalpa', catLabel: 'No Prajalpa',                 catEmoji: '🧘',   label: 'Social media control (1 Hr/Day)',                          max: 1 },
    { id: 'pr_q3', cat: 'prajalpa', catLabel: 'No Prajalpa',                 catEmoji: '🧘',   label: 'Avoid unnecessary hearing',                                max: 1 },
    { id: 'pr_q4', cat: 'prajalpa', catLabel: 'No Prajalpa',                 catEmoji: '🧘',   label: 'Sattam Kirtanam (internal remembrance)',                   max: 1 },
    { id: 'pr_q5', cat: 'prajalpa', catLabel: 'No Prajalpa',                 catEmoji: '🧘',   label: 'Hourly Prayer',                                            max: 1 },
    // Vaishnav Aparadha – 4 marks (4 × 1)
    { id: 'va_q1', cat: 'vaishnav', catLabel: 'Vaishnav Aparadha',        catEmoji: '🙏',   label: 'No Vaishnav Fault Discussion (Authority Except)',          max: 1 },
    { id: 'va_q2', cat: 'vaishnav', catLabel: 'Vaishnav Aparadha',        catEmoji: '🙏',   label: 'No debate (accept & learn)',                               max: 1 },
    { id: 'va_q3', cat: 'vaishnav', catLabel: 'Vaishnav Aparadha',        catEmoji: '🙏',   label: 'Mentally offer obeisances',                                max: 1 },
    { id: 'va_q4', cat: 'vaishnav', catLabel: 'Vaishnav Aparadha',        catEmoji: '🙏',   label: 'Non-Critical Vision (Jeev Ninda)',                         max: 1 },
    // Interaction Discipline (Maryada) – 5 marks (5 × 1)
    { id: 'ma_q1', cat: 'maryada',  catLabel: 'Interaction Discipline',      catEmoji: '🚫',   label: 'No unnecessary talk',                                      max: 1 },
    { id: 'ma_q2', cat: 'maryada',  catLabel: 'Interaction Discipline',      catEmoji: '🚫',   label: 'No joking / casual talk',                                  max: 1 },
    { id: 'ma_q3', cat: 'maryada',  catLabel: 'Interaction Discipline',      catEmoji: '🚫',   label: 'Physical Boundaries',                                      max: 1 },
    { id: 'ma_q4', cat: 'maryada',  catLabel: 'Interaction Discipline',      catEmoji: '🚫',   label: 'Focused Awareness',                                        max: 1 },
    { id: 'ma_q5', cat: 'maryada',  catLabel: 'Interaction Discipline',      catEmoji: '🚫',   label: 'No Private meeting',                                       max: 1 },
    // Harmonium / Skill – 15 marks (3 × 5)
    { id: 'sk_q1', cat: 'skill',    catLabel: 'Harmonium / Skill',           catEmoji: '🎹',   label: 'Harmonium practice 30 min',                                max: 5 },
    { id: 'sk_q2', cat: 'skill',    catLabel: 'Harmonium / Skill',           catEmoji: '🎹',   label: 'DRLR + speaking + Words',                                  max: 5 },
    { id: 'sk_q3', cat: 'skill',    catLabel: 'Harmonium / Skill',           catEmoji: '🎹',   label: 'Weekly weakness notes',                                    max: 5 },
    // Tolerance – 6 marks (6 × 1)
    { id: 'to_q1', cat: 'tolerance',catLabel: 'Tolerance',                   catEmoji: '🌿',   label: 'No Reaction (Control Response)',                            max: 1 },
    { id: 'to_q2', cat: 'tolerance',catLabel: 'Tolerance',                   catEmoji: '🌿',   label: 'Situation Acceptance',                                     max: 1 },
    { id: 'to_q3', cat: 'tolerance',catLabel: 'Tolerance',                   catEmoji: '🌿',   label: 'Respect Even When Hurt',                                   max: 1 },
    { id: 'to_q4', cat: 'tolerance',catLabel: 'Tolerance',                   catEmoji: '🌿',   label: 'Steady in Dualities (Sukha/Dukha)',                         max: 1 },
    { id: 'to_q5', cat: 'tolerance',catLabel: 'Tolerance',                   catEmoji: '🌿',   label: 'Forgiveness Practice (Chhodo, Aage Bado)',                  max: 1 },
    { id: 'to_q6', cat: 'tolerance',catLabel: 'Tolerance',                   catEmoji: '🌿',   label: 'Continue Seva Despite Difficulty (Mood ho Ya Na ho)',       max: 1 },
];

// Category definitions for grouping (reports / mini-badges)
const TAPAH2_CATS = [
    { id: 'chanting',  label: 'Focus on Chanting',           emoji: '🧘‍♂️' },
    { id: 'prajalpa',  label: 'No Prajalpa',                 emoji: '🧘'   },
    { id: 'vaishnav',  label: 'Vaishnav Aparadha',        emoji: '🙏'   },
    { id: 'maryada',   label: 'Interaction Discipline',      emoji: '🚫'   },
    { id: 'skill',     label: 'Harmonium / Skill',           emoji: '🎹'   },
    { id: 'tolerance', label: 'Tolerance',                   emoji: '🌿'   },
];

const TAPAH2_MAX = TAPAH2_QUESTIONS.reduce((s, q) => s + q.max, 0); // 5+5+4+5+15+6 = 40

let _tapah2Index     = 0;
let _tapah2Scores    = {}; // { questionId: number }
let _tapah2EditingDate = null;
// (no binary auto-advance — all questions use numeric input)
let _tapah2Chart     = null;

function setupTapah2DateSelect() {
    const s = document.getElementById('tapah2-date');
    if (!s) return;
    const todayStr = toLocalDateStr(new Date());
    s.min = APP_START_DATE;
    s.max = todayStr;
    s.value = todayStr;
    s.disabled = false;
    updateTapah2DateStatus(todayStr);
}

function updateTapah2DateStatus(dateStr) {
    const badge = document.getElementById('tapah2-date-status');
    const hint  = document.getElementById('tapah2-date-hint');
    if (!badge) return;
    const todayStr = toLocalDateStr(new Date());
    if (!dateStr) { badge.textContent = '—'; badge.style.background = '#f0f0f0'; badge.style.color = '#888'; return; }
    if (dateStr === todayStr) {
        badge.textContent = '📆 Today';
        badge.style.background = '#fef0e7'; badge.style.color = '#e67e22';
        if (hint) hint.textContent = 'Filling today\'s entry';
    } else {
        badge.textContent = '⏳ Checking…';
        badge.style.background = '#f0f0f0'; badge.style.color = '#888';
    }
}

window.onTapah2DateChange = async (dateStr) => {
    if (!dateStr || !currentUser) return;
    const badge = document.getElementById('tapah2-date-status');
    const hint  = document.getElementById('tapah2-date-hint');
    const todayStr = toLocalDateStr(new Date());

    // Reset state (keep date)
    _tapah2Scores = {};
    _tapah2Index  = 0;
    _tapah2EditingDate = null;
    const banner  = document.getElementById('tapah2-edit-banner');
    const submit  = document.getElementById('tapah2-submit-btn');
    const done    = document.getElementById('tapah2-done-screen');
    const card    = document.getElementById('tapah2-card');
    if (banner) banner.style.display = 'none';
    if (submit) submit.style.display = 'none';
    if (done)   done.style.display   = 'none';
    if (card)   { card.style.display = 'block'; card.style.opacity = '1'; card.style.transform = 'none'; }

    if (badge) { badge.textContent = '⏳'; badge.style.background = '#f0f0f0'; badge.style.color = '#888'; }

    try {
        const snap = await db.collection('users').doc(currentUser.uid).collection('tapah2').doc(dateStr).get();
        if (snap.exists) {
            const d = snap.data();
            TAPAH2_QUESTIONS.forEach(q => {
                if (d.scores && d.scores[q.id] !== undefined) _tapah2Scores[q.id] = d.scores[q.id];
            });
            _tapah2EditingDate = dateStr;
            const bannerText = document.getElementById('tapah2-edit-banner-text');
            if (banner) banner.style.display = 'flex';
            if (bannerText) bannerText.textContent = `Editing Tapah-2: ${dateStr}`;
            if (badge) { badge.textContent = '✅ Filled'; badge.style.background = '#e8f8f0'; badge.style.color = '#27ae60'; }
            if (hint) hint.textContent = 'Entry exists — editing it now';
        } else {
            if (badge) {
                if (dateStr === todayStr) {
                    badge.textContent = '📆 Today'; badge.style.background = '#fef0e7'; badge.style.color = '#e67e22';
                    if (hint) hint.textContent = 'New entry for today';
                } else {
                    badge.textContent = '⚠️ NR'; badge.style.background = '#fff3cd'; badge.style.color = '#856404';
                    if (hint) hint.textContent = 'No entry yet — filling now';
                }
            }
        }
    } catch (err) {
        if (badge) { badge.textContent = '❌ Error'; badge.style.background = '#fde8e8'; badge.style.color = '#e74c3c'; }
        if (hint) hint.textContent = err.code || err.message;
    }
    renderTapah2Card(0);
    updateTapah2Totals();
};

function resetTapah2Form() {
    _tapah2Scores      = {};
    _tapah2Index       = 0;
    _tapah2EditingDate = null;
    setupTapah2DateSelect();
    const banner  = document.getElementById('tapah2-edit-banner');
    const submit  = document.getElementById('tapah2-submit-btn');
    const done    = document.getElementById('tapah2-done-screen');
    const card    = document.getElementById('tapah2-card');
    if (banner) banner.style.display = 'none';
    if (submit) submit.style.display = 'none';
    if (done)   done.style.display   = 'none';
    if (card)   { card.style.display = 'block'; card.style.opacity = '1'; card.style.transform = 'none'; }
    renderTapah2Card(0);
    updateTapah2Totals();
}

window.cancelTapah2Edit = () => {
    resetTapah2Form();
    const badge = document.getElementById('tapah2-date-status');
    const hint  = document.getElementById('tapah2-date-hint');
    if (badge) { badge.textContent = '📆 Today'; badge.style.background = '#fef0e7'; badge.style.color = '#e67e22'; }
    if (hint)  hint.textContent = 'Filling today\'s entry';
};

// ── Card renderer — one card per category ──────
function renderTapah2Card(idx) {
    const cat = TAPAH2_CATS[idx];
    if (!cat) return;
    const card    = document.getElementById('tapah2-card');
    const counter = document.getElementById('tapah2-card-counter');
    const bar     = document.getElementById('tapah2-progress-bar');
    if (!card) return;

    if (counter) counter.textContent = `Part ${idx + 1} / ${TAPAH2_CATS.length}`;
    if (bar)     bar.style.width = `${(idx / TAPAH2_CATS.length) * 100}%`;

    const catQs  = TAPAH2_QUESTIONS.filter(q => q.cat === cat.id);
    const catMax = catQs.reduce((s, q) => s + q.max, 0);
    const isLast = idx === TAPAH2_CATS.length - 1;

    const questionsHTML = catQs.map(q => {
        const existing   = _tapah2Scores[q.id];
        const rangeLabel = q.max === 1 ? '−1 to +1' : `−${q.max} to +${q.max}`;
        return `<div style="padding:11px 0;border-bottom:1px solid #f0f0f0;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                <div style="flex:1;">
                    <div style="font-size:14px;font-weight:600;color:#2c3e50;line-height:1.4;">${q.label}</div>
                    <div style="font-size:11px;color:#bbb;margin-top:2px;">${rangeLabel}</div>
                </div>
                <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
                    <input type="number" id="tapah2-input-${q.id}" min="-${q.max}" max="${q.max}" step="1"
                        placeholder="0" value="${existing !== undefined ? existing : ''}"
                        style="width:62px;padding:8px 4px;border:2px solid #e67e22;border-radius:8px;font-size:18px;font-weight:800;text-align:center;background:#fef9f5;color:#e67e22;"
                        oninput="updateTapah2Totals()">
                    <span style="font-size:12px;color:#aaa;font-weight:700;">/${q.max}</span>
                </div>
            </div>
        </div>`;
    }).join('');

    const catScore = catQs.reduce((s, q) => s + (_tapah2Scores[q.id] !== undefined ? _tapah2Scores[q.id] : 0), 0);
    const subtotalColor = catScore > 0 ? '#27ae60' : catScore < 0 ? '#e74c3c' : '#aaa';

    card.innerHTML = `<div style="padding:16px 20px 16px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:12px;border-bottom:2px solid #fde8d0;">
            <span style="font-size:22px;line-height:1;">${cat.emoji}</span>
            <div>
                <div style="font-size:19px;font-weight:800;color:#2c3e50;line-height:1.2;">${cat.label}</div>
                <div style="font-size:12px;color:#aaa;margin-top:2px;">Part ${idx + 1} of ${TAPAH2_CATS.length} &nbsp;·&nbsp; max ${catMax}</div>
            </div>
        </div>
        ${questionsHTML}
        <div id="tapah2-cat-subtotal" style="margin-top:10px;text-align:right;font-size:13px;font-weight:700;color:${subtotalColor};">
            ${cat.label}: ${catScore > 0 ? '+' : ''}${catScore} / ${catMax}
        </div>
        <div style="display:flex;gap:10px;margin-top:14px;">
            <button type="button" onclick="tapah2CardBack()"
                style="flex:1;padding:12px;border-radius:10px;border:2px solid #ddd;background:#f8f9fa;color:#555;font-weight:700;font-size:13px;width:auto;margin:0;cursor:pointer;">
                ← Back
            </button>
            <button type="button" onclick="tapah2CardNext()"
                style="flex:2;padding:12px;border-radius:10px;border:none;background:#e67e22;color:white;font-weight:700;font-size:14px;width:auto;margin:0;cursor:pointer;">
                ${isLast ? '✅ Done' : 'Next →'}
            </button>
        </div>
    </div>`;
    // Focus first input
    setTimeout(() => {
        const first = document.getElementById(`tapah2-input-${catQs[0].id}`);
        if (first) { first.focus(); first.select(); }
    }, 250);
}

// ── Slide animation helper ──────────────────────
function tapah2Animate(targetIdx, direction) {
    const card = document.getElementById('tapah2-card');
    const outX = direction === 'forward' ? '-20px' : '20px';
    const inX  = direction === 'forward' ? '20px'  : '-20px';
    if (card) { card.style.opacity = '0'; card.style.transform = `translateX(${outX})`; }
    setTimeout(() => {
        _tapah2Index = targetIdx;
        renderTapah2Card(targetIdx);
        if (card) {
            card.style.transition = 'none';
            card.style.transform  = `translateX(${inX})`;
            card.style.opacity    = '0';
            setTimeout(() => {
                card.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
                card.style.opacity    = '1';
                card.style.transform  = 'translateX(0)';
            }, 20);
        }
        updateTapah2Totals();
    }, 220);
}

// ── Save all inputs for the current category card ──
function _tapah2SaveCurrentCard() {
    const cat = TAPAH2_CATS[_tapah2Index];
    if (!cat) return;
    TAPAH2_QUESTIONS.filter(q => q.cat === cat.id).forEach(q => {
        const inp = document.getElementById(`tapah2-input-${q.id}`);
        if (!inp) return;
        const raw = parseInt(inp.value, 10);
        if (!isNaN(raw)) _tapah2Scores[q.id] = Math.max(-q.max, Math.min(q.max, raw));
        // if empty/incomplete, leave existing _tapah2Scores[q.id] unchanged
    });
}

// ── Next / Back navigation ──────────────────────
window.tapah2CardNext = () => {
    _tapah2SaveCurrentCard();
    const next = _tapah2Index + 1;
    if (next < TAPAH2_CATS.length) tapah2Animate(next, 'forward');
    else showTapah2DoneScreen();
};

window.tapah2CardBack = () => {
    if (_tapah2Index === 0) return;
    _tapah2SaveCurrentCard();
    tapah2Animate(_tapah2Index - 1, 'backward');
};

// ── Live totals & mini-badges ───────────────────
// Safe score getter — uses explicit undefined check so 0 and negatives are preserved
function _t2s(id) { return _tapah2Scores[id] !== undefined ? _tapah2Scores[id] : 0; }

function updateTapah2Totals() {
    // Step 1: flush ALL visible inputs on the current card into _tapah2Scores
    const activeCat = TAPAH2_CATS[_tapah2Index];
    if (activeCat) {
        TAPAH2_QUESTIONS.filter(q => q.cat === activeCat.id).forEach(q => {
            const inp = document.getElementById(`tapah2-input-${q.id}`);
            if (!inp) return;
            const raw = parseInt(inp.value, 10);
            if (!isNaN(raw)) {
                const cl = Math.max(-q.max, Math.min(q.max, raw));
                _tapah2Scores[q.id] = cl;
                if (inp.value !== String(cl)) inp.value = cl;
            }
            // if input is empty/incomplete (e.g. just typed '-'), leave _tapah2Scores as-is
        });

        // Update the category subtotal on the card
        const catQs  = TAPAH2_QUESTIONS.filter(q => q.cat === activeCat.id);
        const catMax = catQs.reduce((s, q) => s + q.max, 0);
        const catScore = catQs.reduce((s, q) => s + _t2s(q.id), 0);
        const sub = document.getElementById('tapah2-cat-subtotal');
        if (sub) {
            const col = catScore > 0 ? '#27ae60' : catScore < 0 ? '#e74c3c' : '#aaa';
            sub.style.color = col;
            sub.textContent = `${activeCat.label}: ${catScore > 0 ? '+' : ''}${catScore} / ${catMax}`;
        }
    }

    // Step 2: compute grand total from _tapah2Scores (all questions, explicit check)
    let total = 0;
    TAPAH2_QUESTIONS.forEach(q => { total += _t2s(q.id); });
    const pct   = Math.round((total / TAPAH2_MAX) * 100);
    const color = pct >= 50 ? '#27ae60' : pct >= 0 ? '#f39c12' : '#e74c3c';

    const td = document.getElementById('tapah2-total-display');
    const pp = document.getElementById('tapah2-percent-display');
    if (td) { td.textContent = `${total > 0 ? '+' : ''}${total}/${TAPAH2_MAX}`; td.style.color = color; }
    if (pp) { pp.textContent = `${pct}%`; pp.style.color = color; }

    // Mini category badges
    const catEl = document.getElementById('tapah2-category-totals');
    if (catEl) {
        catEl.innerHTML = TAPAH2_CATS.map(cat => {
            const catQs   = TAPAH2_QUESTIONS.filter(q2 => q2.cat === cat.id);
            const catMax  = catQs.reduce((s, q2) => s + q2.max, 0);
            const catSc   = catQs.reduce((s, q2) => s + _t2s(q2.id), 0);
            const anyDone = catQs.some(q2 => _tapah2Scores[q2.id] !== undefined);
            const cp      = anyDone ? Math.round((catSc / catMax) * 100) : null;
            const col     = !anyDone ? '#ccc' : cp >= 50 ? '#27ae60' : cp >= 0 ? '#f39c12' : '#e74c3c';
            return `<div style="flex:1;min-width:70px;background:white;border-radius:8px;padding:6px 6px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.07);border-top:3px solid ${col};">
                <div style="font-size:10px;color:#888;line-height:1.2;margin-bottom:2px;">${cat.emoji} ${cat.label.split(' ').slice(0,2).join(' ')}</div>
                <div style="font-size:13px;font-weight:700;color:${col};">${anyDone ? (catSc > 0 ? '+' : '') + catSc + '/' + catMax : '–'}</div>
            </div>`;
        }).join('');
    }
}

// ── Done screen ─────────────────────────────────
function showTapah2DoneScreen() {
    const card   = document.getElementById('tapah2-card');
    const done   = document.getElementById('tapah2-done-screen');
    const submit = document.getElementById('tapah2-submit-btn');
    const bar    = document.getElementById('tapah2-progress-bar');

    if (card) card.style.display = 'none';
    if (bar)  bar.style.width = '100%';

    let total = 0;
    TAPAH2_QUESTIONS.forEach(q => { total += _t2s(q.id); });
    const pct   = Math.round((total / TAPAH2_MAX) * 100);
    const color = pct >= 50 ? '#27ae60' : pct >= 0 ? '#f39c12' : '#e74c3c';

    const doneScore = document.getElementById('tapah2-done-score');
    const donePct   = document.getElementById('tapah2-done-pct');
    if (doneScore) { doneScore.textContent = `${total > 0 ? '+' : ''}${total} / ${TAPAH2_MAX}`; doneScore.style.color = color; }
    if (donePct)   { donePct.textContent = `${pct}%`; donePct.style.color = color; }
    if (done)   done.style.display   = 'block';
    if (submit) submit.style.display = 'block';
}

window.tapah2FlashReview = () => {
    // Go to first category that has any unfilled question, else first category
    const firstIncompleteCat = TAPAH2_CATS.findIndex(cat =>
        TAPAH2_QUESTIONS.filter(q => q.cat === cat.id).some(q => _tapah2Scores[q.id] === undefined)
    );
    _tapah2Index = firstIncompleteCat >= 0 ? firstIncompleteCat : 0;
    const card   = document.getElementById('tapah2-card');
    const done   = document.getElementById('tapah2-done-screen');
    const submit = document.getElementById('tapah2-submit-btn');
    if (card)   { card.style.display = 'block'; card.style.opacity = '1'; card.style.transform = 'none'; }
    if (done)   done.style.display   = 'none';
    if (submit) submit.style.display = 'none';
    renderTapah2Card(_tapah2Index);
    updateTapah2Totals();
};

// ── Submit ──────────────────────────────────────
window.submitTapah2 = async () => {
    if (!currentUser) { alert('Please login first'); return; }
    const date = document.getElementById('tapah2-date')?.value;
    if (!date) { alert('Please select a date.'); return; }

    const unfilled = TAPAH2_QUESTIONS.filter(q => _tapah2Scores[q.id] === undefined);
    if (unfilled.length > 0) {
        const go = confirm(`${unfilled.length} question(s) not answered. Submit anyway (counted as 0)?`);
        if (!go) { window.tapah2FlashReview(); return; }
    }

    const scores = {};
    let total = 0;
    TAPAH2_QUESTIONS.forEach(q => {
        scores[q.id] = Math.max(-q.max, Math.min(q.max, _t2s(q.id)));
        total += scores[q.id];
    });
    const percent = Math.round((total / TAPAH2_MAX) * 100);

    try {
        await db.collection('users').doc(currentUser.uid).collection('tapah2').doc(date).set({
            scores, totalScore: total, percent,
            submittedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        const isEdit = _tapah2EditingDate !== null;
        alert(`${isEdit ? 'Updated' : 'Saved'}! Tapah-2 Score: ${total}/${TAPAH2_MAX} (${percent}%)`);
        resetTapah2Form();
    } catch (err) {
        alert('Could not save Tapah-2.\nError: ' + (err.code || err.message));
    }
};

// ── Edit past entry (called from report edit buttons) ───
window.editTapah2Entry = async (dateStr) => {
    switchMainTab('tapah2');
    switchSubTab('tapah2', 'entry');
    const sel = document.getElementById('tapah2-date');
    if (sel) { sel.value = dateStr; sel.disabled = false; }
    await onTapah2DateChange(dateStr);
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ── TAPAH-2 REPORT ──────────────────────────────

const _tapah2Expanded = new Set();

window.toggleTapah2Group = (key) => {
    if (_tapah2Expanded.has(key)) _tapah2Expanded.delete(key);
    else _tapah2Expanded.add(key);
    renderTapah2Report(window._tapah2AllData || {});
};

async function loadTapah2Report() {
    const container = document.getElementById('tapah2-report-container');
    if (!container) return;
    container.innerHTML = '<p style="color:#aaa;text-align:center;padding:30px;">Loading Tapah-2 data…</p>';
    try {
        const snap = await db.collection('users').doc(currentUser.uid).collection('tapah2').get();
        const allData = {};
        snap.forEach(doc => { allData[doc.id] = doc.data(); });
        window._tapah2AllData = allData;
        // Auto-expand current month + week so marks are visible immediately
        const _today = new Date();
        const _sun   = new Date(_today); _sun.setDate(_today.getDate() - _today.getDay());
        _tapah2Expanded.add('month_' + toLocalDateStr(_sun).slice(0, 7));
        _tapah2Expanded.add('week_'  + toLocalDateStr(_sun));
        renderTapah2Report(allData);
    } catch (err) {
        container.innerHTML = `<div style="text-align:center;padding:30px;background:#fff0f0;border-radius:10px;color:#e74c3c;">
            <div style="font-size:24px;margin-bottom:8px;">⚠️</div>
            <div style="font-weight:700;">Could not load Tapah-2 data</div>
            <div style="font-size:13px;color:#666;margin:6px 0 6px;">Check your internet connection.</div>
            <div style="font-size:11px;color:#aaa;margin-bottom:14px;font-family:monospace;">${err.code || err.message}</div>
            <button onclick="loadTapah2Report()" style="padding:8px 20px;background:#3498db;color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;width:auto;">🔄 Retry</button>
        </div>`;
    }
}

function renderTapah2Report(allData) {
    const container = document.getElementById('tapah2-report-container');
    if (!container) return;

    const today          = new Date();
    const todayStr       = toLocalDateStr(today);
    const thisWeekSun    = new Date(today); thisWeekSun.setDate(today.getDate() - today.getDay());
    const thisWeekSunStr = toLocalDateStr(thisWeekSun);

    const allDates = new Set(Object.keys(allData).filter(d => d >= APP_START_DATE));
    for (let i = 0; i < 7; i++) {
        const d = new Date(thisWeekSun); d.setDate(thisWeekSun.getDate() + i);
        const ds = toLocalDateStr(d);
        if (ds <= todayStr && ds >= APP_START_DATE) allDates.add(ds);
    }
    if (allDates.size === 0) {
        container.innerHTML = '<p style="color:#aaa;text-align:center;padding:30px;">No Tapah-2 data yet. Start tracking!</p>';
        return;
    }

    // Group by week then month
    const weekMap = {};
    [...allDates].sort().forEach(ds => {
        const d = new Date(ds + 'T00:00:00');
        const sun = new Date(d); sun.setDate(d.getDate() - d.getDay());
        const sunStr = toLocalDateStr(sun);
        if (!weekMap[sunStr]) weekMap[sunStr] = [];
        weekMap[sunStr].push(ds);
    });
    const monthMap = {};
    Object.keys(weekMap).sort().forEach(sunStr => {
        const mk = weekMap[sunStr][0].slice(0, 7);
        if (!monthMap[mk]) monthMap[mk] = [];
        monthMap[mk].push(sunStr);
    });

    const T2M  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const T2ML = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const fmtD = ds => { const d = new Date(ds+'T00:00:00'); return `${String(d.getDate()).padStart(2,'0')} ${T2M[d.getMonth()]}`; };
    const fmtM = ym => { const [y,m] = ym.split('-'); return `${T2ML[parseInt(m,10)-1]} ${y}`; };
    const fmtW = sun => { const s = new Date(sun+'T00:00:00'); const e = new Date(s); e.setDate(s.getDate()+6); return `${fmtD(sun)} – ${fmtD(toLocalDateStr(e))}`; };
    const sCol = pct => pct >= 70 ? '#27ae60' : pct >= 50 ? '#f39c12' : '#e74c3c';

    // Helper: compute category score from an entry
    const catScore = (entry, catId) => {
        if (!entry) return null;
        const catQs = TAPAH2_QUESTIONS.filter(q => q.cat === catId);
        return catQs.reduce((s, q) => s + (entry.scores?.[q.id] ?? 0), 0);
    };
    const catMax = catId => TAPAH2_QUESTIONS.filter(q => q.cat === catId).reduce((s,q) => s+q.max, 0);

    let html = '';
    Object.keys(monthMap).sort().reverse().forEach(mk => {
        const weeks = monthMap[mk].slice().reverse();
        const mFilled  = weeks.flatMap(w => weekMap[w]).filter(d => allData[d]);
        const mTotal   = mFilled.reduce((s,d) => s+(allData[d]?.totalScore||0), 0);
        const mElapsed = weeks.reduce((sum, s) => sum + (s === thisWeekSunStr ? weekMap[s].length : 7), 0);
        const mMax     = mElapsed * TAPAH2_MAX;
        const mPct     = mMax > 0 ? Math.round(mTotal/mMax*100) : 0;
        const mExpand  = _tapah2Expanded.has('month_'+mk);

        html += `<div style="margin-bottom:10px;">
            <div onclick="toggleTapah2Group('month_${mk}')"
                style="background:#2c3e50;color:white;padding:12px 16px;border-radius:${mExpand?'8px 8px 0 0':'8px'};cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
                <div style="font-weight:700;font-size:14px;">${fmtM(mk)}</div>
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:13px;color:${sCol(mPct)};font-weight:700;">${mPct}%</span>
                    <span style="font-size:11px;opacity:0.7;">${mExpand?'▼':'▶'}</span>
                </div>
            </div>`;

        if (mExpand) {
            html += `<div style="background:#f8f9fa;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;padding:8px;">`;
            weeks.forEach(sunStr => {
                const wDates   = weekMap[sunStr];
                const wFilled  = wDates.filter(d => allData[d]);
                const wTotal   = wFilled.reduce((s,d) => s+(allData[d]?.totalScore||0), 0);
                const isCur    = sunStr === thisWeekSunStr;
                const wElapsed = isCur ? wDates.length : 7;
                const wMax     = wElapsed * TAPAH2_MAX;
                const wPct     = wMax > 0 ? Math.round(wTotal/wMax*100) : 0;
                const wExpand  = _tapah2Expanded.has('week_'+sunStr);

                html += `<div style="margin-bottom:6px;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
                    <div onclick="toggleTapah2Group('week_${sunStr}')"
                        style="background:white;padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-left:4px solid #e67e22;">
                        <div>
                            <div style="font-weight:700;font-size:13px;color:#2c3e50;">${fmtW(sunStr)}${isCur?' <span style="font-size:10px;background:#e67e22;color:white;padding:1px 7px;border-radius:10px;margin-left:4px;">Current</span>':''}</div>
                            <div style="font-size:11px;color:#888;margin-top:2px;">${wFilled.length} day(s) filled · ${wTotal}/${wMax} pts</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:15px;font-weight:700;color:${sCol(wPct)};">${wPct}%</span>
                            <span style="font-size:11px;color:#aaa;">${wExpand?'▼':'▶'}</span>
                        </div>
                    </div>`;

                if (wExpand) {
                    html += `<div style="overflow-x:auto;background:white;border-top:1px solid #f0f0f0;">
                        <table style="width:100%;border-collapse:collapse;font-size:12px;">
                            <thead><tr>
                                <th style="padding:8px 10px;background:#fef0e7;text-align:left;color:#2c3e50;font-weight:700;white-space:nowrap;min-width:140px;">Category</th>
                                <th style="padding:8px;background:#fef0e7;text-align:center;color:#888;font-weight:600;">Max</th>`;
                    wDates.forEach(ds => {
                        const d = new Date(ds+'T00:00:00');
                        const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
                        html += `<th style="padding:8px;background:#fef0e7;text-align:center;color:#2c3e50;font-weight:600;white-space:nowrap;">${day}<br><span style="font-weight:400;font-size:10px;">${fmtD(ds)}</span></th>`;
                    });
                    html += `<th style="padding:8px;background:#fef0e7;text-align:center;color:#e67e22;font-weight:700;">Total</th></tr></thead><tbody>`;

                    TAPAH2_CATS.forEach((cat, ci) => {
                        const cm   = catMax(cat.id);
                        const rowBg = ci % 2 === 0 ? '#fff' : '#fafafa';
                        let rowTotal = 0;
                        let cells = '';
                        wDates.forEach(ds => {
                            const entry = allData[ds];
                            const sc    = entry ? catScore(entry, cat.id) : null;
                            if (sc !== null) rowTotal += sc;
                            const cp  = (sc !== null && sc !== undefined) ? Math.round((sc/cm)*100) : null;
                            const col = !entry ? '#ccc' : sCol(cp);
                            cells += `<td style="padding:8px;text-align:center;background:${rowBg};color:${col};font-weight:${entry?'700':'400'};">${entry ? sc : '–'}</td>`;
                        });
                        html += `<tr>
                            <td style="padding:8px 10px;background:${rowBg};color:#2c3e50;font-weight:600;">${cat.emoji} ${cat.label}</td>
                            <td style="padding:8px;text-align:center;background:${rowBg};color:#aaa;">${cm}</td>
                            ${cells}
                            <td style="padding:8px;text-align:center;background:${rowBg};font-weight:700;color:#e67e22;">${rowTotal}</td>
                        </tr>`;
                    });

                    // Totals row
                    html += `<tr style="background:#fef0e7;border-top:2px solid #e67e22;">
                        <td style="padding:8px 10px;font-weight:700;color:#e67e22;">Total</td>
                        <td style="padding:8px;text-align:center;color:#aaa;font-weight:700;">${TAPAH2_MAX}</td>`;
                    wDates.forEach(ds => {
                        const entry = allData[ds];
                        const sc    = entry?.totalScore;
                        const cp    = sc !== undefined ? Math.round((sc/TAPAH2_MAX)*100) : null;
                        const col   = !entry ? '#ccc' : sCol(cp);
                        html += `<td style="padding:8px;text-align:center;font-weight:700;color:${col};">${entry ? sc : '–'}</td>`;
                    });
                    html += `<td style="padding:8px;text-align:center;font-weight:700;color:#e67e22;">${wFilled.reduce((s,d)=>s+(allData[d]?.totalScore||0),0)}</td></tr>`;

                    const editBtns = wFilled.map(ds =>
                        `<button onclick="editTapah2Entry('${ds}')" style="width:auto;padding:4px 10px;font-size:11px;background:#e67e22;color:white;border:none;border-radius:6px;cursor:pointer;margin:0;">✏️ ${fmtD(ds)}</button>`
                    ).join('');
                    if (editBtns) html += `<tr><td colspan="${wDates.length+3}" style="padding:8px;background:#fff;"><div style="display:flex;gap:6px;flex-wrap:wrap;">${editBtns}</div></td></tr>`;

                    html += `</tbody></table></div>`;
                }
                html += `</div>`; // end week
            });
            html += `</div>`; // end month body
        }
        html += `</div>`; // end month
    });

    container.innerHTML = html || '<p style="color:#aaa;text-align:center;padding:30px;">No Tapah-2 data yet. Start tracking!</p>';
}

// ── TAPAH-2 PROGRESS ────────────────────────────

async function loadTapah2Progress() {
    const ringEl = document.getElementById('tapah2-score-ring-container');
    if (!ringEl) return;
    ringEl.innerHTML = '<div style="text-align:center;color:#aaa;padding:20px;">Loading…</div>';

    const today       = new Date();
    const todayStr    = toLocalDateStr(today);
    const thisWeekSun = new Date(today); thisWeekSun.setDate(today.getDate() - today.getDay());

    try {
        // Fetch ALL tapah2 data (no range query — avoids index issues)
        const snap = await db.collection('users').doc(currentUser.uid).collection('tapah2').get();
        const allData = {};
        snap.forEach(doc => { allData[doc.id] = doc.data(); });

        // Current week ring
        const weekDates = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(thisWeekSun); d.setDate(thisWeekSun.getDate() + i);
            const ds = toLocalDateStr(d);
            if (ds <= todayStr && ds >= APP_START_DATE) weekDates.push(ds);
        }
        const filled    = weekDates.filter(d => allData[d]);
        const wTotal    = filled.reduce((s,d) => s+(allData[d]?.totalScore??0), 0);
        const wMax      = weekDates.length * TAPAH2_MAX;
        const wPct      = wMax > 0 ? Math.round(wTotal/wMax*100) : 0;
        const ringColor = wPct >= 70 ? '#27ae60' : wPct >= 50 ? '#f39c12' : '#e74c3c';

        const r = 54, circ = Math.round(2*Math.PI*r);
        const dash = Math.round(circ * Math.max(0,wPct) / 100);

        const catRows = TAPAH2_CATS.map(cat => {
            const cm    = TAPAH2_QUESTIONS.filter(q=>q.cat===cat.id).reduce((s,q)=>s+q.max,0);
            const cTot  = filled.reduce((s,d) => {
                const catQs = TAPAH2_QUESTIONS.filter(q=>q.cat===cat.id);
                return s + catQs.reduce((ss,q) => ss+(allData[d]?.scores?.[q.id]??0), 0);
            }, 0);
            const cMax  = weekDates.length * cm;
            const cp    = cMax > 0 ? Math.round(cTot/cMax*100) : 0;
            const cc    = cp >= 70 ? '#27ae60' : cp >= 50 ? '#f39c12' : '#e74c3c';
            return `<div style="display:flex;align-items:center;gap:6px;margin-top:5px;font-size:12px;">
                <span style="font-size:14px;">${cat.emoji}</span>
                <span style="flex:1;color:#555;">${cat.label}</span>
                <span style="font-size:10px;color:#aaa;white-space:nowrap;">max ${cm}/day</span>
                <span style="font-weight:700;color:${cc};min-width:36px;text-align:right;">${cTot}/${cMax||'—'}</span>
            </div>`;
        }).join('');

        ringEl.innerHTML = `<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
            <div style="position:relative;flex-shrink:0;">
                <svg width="130" height="130" style="transform:rotate(-90deg)">
                    <circle cx="65" cy="65" r="${r}" fill="none" stroke="#e0e0e0" stroke-width="10"/>
                    <circle cx="65" cy="65" r="${r}" fill="none" stroke="${ringColor}" stroke-width="10"
                        stroke-dasharray="${dash} ${circ}" stroke-linecap="round"/>
                </svg>
                <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">
                    <div style="font-size:22px;font-weight:800;color:${ringColor};">${wPct}%</div>
                    <div style="font-size:10px;color:#888;">This week</div>
                </div>
            </div>
            <div style="flex:1;min-width:160px;">
                <div style="font-weight:700;font-size:14px;color:#2c3e50;margin-bottom:6px;">📿 Tapah-2 — This Week</div>
                <div style="font-size:12px;color:#666;margin-bottom:2px;">${filled.length} of ${weekDates.length} day(s) filled</div>
                <div style="font-size:11px;color:#aaa;margin-bottom:6px;">Max ${TAPAH2_MAX} marks/day</div>
                <div style="font-size:15px;font-weight:700;color:${ringColor};margin-bottom:8px;">${wTotal} / ${wMax||'—'} pts</div>
                ${catRows}
            </div>
        </div>`;

        // Line chart (last 28 days, filter from allData)
        const from28Str = toLocalDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 27));
        const dates28   = [];
        for (let i=27;i>=0;i--) { const d=new Date(today);d.setDate(today.getDate()-i);const ds=toLocalDateStr(d);if(ds>=APP_START_DATE)dates28.push(ds); }
        const labels    = dates28.map(ds=>{const d=new Date(ds+'T00:00:00');return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;});
        const chartData = dates28.map(ds => {
            if (allData[ds]) return allData[ds].totalScore ?? 0;
            if (ds >= APP_START_DATE && ds < todayStr) return 0; // NR past day — drop to 0
            return null; // today (unfilled) or pre-app-start — skip
        });

        const canvas = document.getElementById('tapah2-score-chart');
        if (!canvas) return;
        if (_tapah2Chart) { _tapah2Chart.destroy(); _tapah2Chart = null; }
        _tapah2Chart = new Chart(canvas, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Tapah-2', data: chartData, borderColor: '#e67e22', backgroundColor: 'rgba(230,126,34,0.08)', borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#e67e22', spanGaps: true, tension: 0.3 }] },
            options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} / ${TAPAH2_MAX}` } } },
                scales: { y: { max: TAPAH2_MAX, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { stepSize: Math.ceil(TAPAH2_MAX/5) } }, x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } } } }
        });
    } catch (err) {
        if (ringEl) ringEl.innerHTML = `<div style="color:#e74c3c;padding:20px;text-align:center;">⚠️ Error loading Tapah-2 progress:<br><span style="font-size:12px;font-family:monospace;">${err.code || err.message}</span></div>`;
    }
}

// ── END TAPAH-2 MODULE ──

// ══════════════════════════════════════════════
// --- ACTIVITY ANALYSIS MODAL ---
// ══════════════════════════════════════════════

window.openActivityAnalysis = () => {
    // Remove existing modal
    const existing = document.getElementById('activity-analysis-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'activity-analysis-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;';
    modal.innerHTML = `
        <div style="background:white;border-radius:16px;max-width:560px;width:100%;margin-top:20px;box-shadow:0 10px 40px rgba(0,0,0,0.25);overflow:hidden;">
            <!-- Header -->
            <div style="background:linear-gradient(135deg,#2c3e50,#3498db);padding:18px 20px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:22px;">📊</span>
                        <strong style="color:white;font-size:17px;">Activity Analysis</strong>
                    </div>
                    <div id="aa-user-name" style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:2px;">${userProfile?.name || ''}</div>
                </div>
                <button onclick="document.getElementById('activity-analysis-modal').remove()"
                    style="width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.2);color:white;border:none;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;margin:0;flex-shrink:0;">✕</button>
            </div>

            <!-- Period toggle -->
            <div style="display:flex;gap:0;padding:14px 16px 0;">
                <button id="aa-btn-this" onclick="loadActivityAnalysis('this')"
                    style="flex:1;padding:8px;border-radius:20px 0 0 20px;background:#3498db;color:white;border:1px solid #3498db;font-weight:700;font-size:13px;cursor:pointer;margin:0;">
                    This Week
                </button>
                <button id="aa-btn-last" onclick="loadActivityAnalysis('last')"
                    style="flex:1;padding:8px;border-radius:0 20px 20px 0;background:#f8f9fa;color:#666;border:1px solid #ddd;font-weight:600;font-size:13px;cursor:pointer;margin:0;">
                    Last Week
                </button>
            </div>

            <!-- Content -->
            <div id="aa-content" style="padding:16px 20px 20px;">
                <div style="text-align:center;padding:30px;color:#aaa;">Loading…</div>
            </div>
        </div>`;
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    loadActivityAnalysis('this');
};

async function loadActivityAnalysis(period) {
    // Update button styles
    const thisBtn = document.getElementById('aa-btn-this');
    const lastBtn = document.getElementById('aa-btn-last');
    if (thisBtn && lastBtn) {
        if (period === 'this') {
            thisBtn.style.background = '#3498db'; thisBtn.style.color = 'white'; thisBtn.style.borderColor = '#3498db';
            lastBtn.style.background = '#f8f9fa'; lastBtn.style.color = '#666'; lastBtn.style.borderColor = '#ddd';
        } else {
            lastBtn.style.background = '#3498db'; lastBtn.style.color = 'white'; lastBtn.style.borderColor = '#3498db';
            thisBtn.style.background = '#f8f9fa'; thisBtn.style.color = '#666'; thisBtn.style.borderColor = '#ddd';
        }
    }

    const content = document.getElementById('aa-content');
    if (!content) return;
    content.innerHTML = '<div style="text-align:center;padding:30px;color:#aaa;">Loading…</div>';

    const today = new Date();
    const thisWeekSun = new Date(today);
    thisWeekSun.setDate(today.getDate() - today.getDay());

    const weekSun = new Date(thisWeekSun);
    if (period === 'last') weekSun.setDate(weekSun.getDate() - 7);

    const weekDates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(weekSun);
        d.setDate(weekSun.getDate() + i);
        const ds = toLocalDateStr(d);
        if (ds <= toLocalDateStr(today) && ds >= APP_START_DATE) weekDates.push(ds);
    }

    if (weekDates.length === 0) {
        if (content) content.innerHTML = '<div style="text-align:center;color:#aaa;padding:20px;">No dates available for this week.</div>';
        return;
    }

    try {
        const snap = await db.collection('users').doc(currentUser.uid)
            .collection('sadhana')
            .where(firebase.firestore.FieldPath.documentId(), '>=', weekDates[0])
            .where(firebase.firestore.FieldPath.documentId(), '<=', weekDates[weekDates.length - 1])
            .get();

        const data = {};
        snap.forEach(doc => { data[doc.id] = doc.data(); });

        const filledDates = weekDates.filter(d => data[d]);
        const totalScore = filledDates.reduce((s, d) => s + (data[d].totalScore ?? 0), 0);
        const maxScore = weekDates.length * 175;
        const fairMax = filledDates.length * 175;
        const fairPct = fairMax > 0 ? Math.round(totalScore / fairMax * 100) : 0;

        // Activity totals
        const acts = {
            Sleep:    { key: 'sleep',          max: 175, total: 0 },
            'Wake-up':{ key: 'wakeup',         max: 175, total: 0 },
            Chanting: { key: 'chanting',       max: 175, total: 0 },
            Reading:  { key: 'reading',        max: 175, total: 0 },
            Hearing:  { key: 'hearing',        max: 175, total: 0 },
            'Morn.Prog':{ key: 'morningProgram',max:175, total: 0 },
            'Day Sleep':{ key: 'daySleep',      max: 70,  total: 0 },
        };
        filledDates.forEach(d => {
            Object.values(acts).forEach(a => {
                a.total += data[d]?.scores?.[a.key] ?? 0;
            });
        });

        // Date range label
        const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const fmt = d => `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]}`;
        const weekEnd = new Date(weekSun); weekEnd.setDate(weekSun.getDate() + 6);
        const dateRange = `${fmt(weekSun)} – ${fmt(weekEnd)}`;

        // Score ring SVG
        const color = fairPct >= 70 ? '#27ae60' : fairPct >= 50 ? '#f39c12' : '#e74c3c';
        const ringLabel = fairPct >= 70 ? 'Good' : fairPct >= 50 ? 'OK' : 'Needs work';
        const r = 48, circ = Math.round(2 * Math.PI * r);
        const dash = Math.round(circ * Math.max(0, fairPct) / 100);

        // Bar chart rows
        const barRows = Object.entries(acts).map(([name, a]) => {
            const max = filledDates.length * (a.max === 70 ? 10 : 25);
            const pct = max > 0 ? Math.round(a.total / max * 100) : 0;
            const barColor = a.total < 0 ? '#e74c3c' : pct >= 70 ? '#27ae60' : pct >= 40 ? '#f39c12' : '#e74c3c';
            const barW = max > 0 ? Math.max(0, Math.min(100, (a.total / (filledDates.length * (a.max === 70 ? 10 : 25))) * 100)) : 0;
            const displayPts = (a.total >= 0 ? '+' : '') + a.total;
            return `
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <div style="width:72px;font-size:12px;color:#555;text-align:right;flex-shrink:0;">${name}</div>
                    <div style="flex:1;background:#f0f0f0;border-radius:20px;height:18px;overflow:hidden;position:relative;">
                        <div style="height:100%;width:${Math.max(0, Math.min(100, barW))}%;background:${barColor};border-radius:20px;transition:width 0.5s ease;"></div>
                    </div>
                    <div style="width:36px;font-size:12px;font-weight:700;color:${barColor};text-align:right;flex-shrink:0;">${displayPts}</div>
                </div>`;
        }).join('');

        content.innerHTML = `
            <!-- Date + days info -->
            <div style="font-size:13px;color:#888;margin-bottom:14px;">${dateRange} · ${filledDates.length} day${filledDates.length !== 1 ? 's' : ''} · ${totalScore} pts</div>

            <!-- Score ring -->
            <div style="display:flex;align-items:center;gap:20px;margin-bottom:20px;flex-wrap:wrap;">
                <div style="position:relative;width:110px;height:110px;flex-shrink:0;">
                    <svg width="110" height="110" viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="${r}" fill="none" stroke="#eee" stroke-width="14"/>
                        <circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="14"
                            stroke-dasharray="${dash} ${circ - dash}"
                            stroke-linecap="round" transform="rotate(-90 60 60)"/>
                    </svg>
                    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">
                        <div style="font-size:20px;font-weight:700;color:${color};">${fairPct}%</div>
                        <div style="font-size:10px;color:#aaa;">week score</div>
                    </div>
                </div>
                <div>
                    <div style="font-weight:700;font-size:15px;color:#2c3e50;margin-bottom:4px;">Weekly Score %</div>
                    <div style="font-size:12px;color:#666;margin-bottom:8px;">Total marks earned ÷ max possible for submitted days (same as WCR).</div>
                    <div style="font-size:12px;">
                        <span style="color:#27ae60;font-weight:700;">≥70%</span> Good &nbsp;
                        <span style="color:#f39c12;font-weight:700;">50–69%</span> OK &nbsp;
                        <span style="color:#e74c3c;font-weight:700;">&lt;50%</span> Needs work
                    </div>
                    <div style="margin-top:6px;padding:3px 10px;background:${color}18;border-left:3px solid ${color};border-radius:4px;font-size:12px;color:${color};font-weight:700;">${ringLabel}</div>
                </div>
            </div>

            <!-- Activity breakdown -->
            <div style="font-weight:700;color:#3498db;font-size:14px;margin-bottom:12px;">Activity Breakdown <span style="font-size:12px;color:#aaa;font-weight:400;">(total pts this week)</span></div>
            ${filledDates.length === 0
                ? '<div style="text-align:center;color:#aaa;padding:20px;">No data submitted for this week yet.</div>'
                : barRows
            }`;

    } catch (err) {
        content.innerHTML = `<div style="text-align:center;color:#e74c3c;padding:20px;">Error loading data: ${err.message}</div>`;
    }
}

window.loadActivityAnalysis = loadActivityAnalysis;


// ══════════════════════════════════════════════
window.switchReport = (type) => {
    const sadPanel   = document.getElementById('sadhana-reports-panel');
    const tapPanel   = document.getElementById('tapah-reports-panel');
    const sadBtn     = document.getElementById('report-sadhana-btn');
    const tapBtn     = document.getElementById('report-tapah-btn');
    if (!sadPanel || !tapPanel) return;

    if (type === 'sadhana') {
        sadPanel.style.display = 'block';
        tapPanel.style.display = 'none';
        if (sadBtn) { sadBtn.style.background = 'var(--secondary)'; sadBtn.style.color = 'white'; }
        if (tapBtn) { tapBtn.style.background = '#eee'; tapBtn.style.color = '#666'; }
    } else {
        sadPanel.style.display = 'none';
        tapPanel.style.display = 'block';
        if (sadBtn) { sadBtn.style.background = '#eee'; sadBtn.style.color = '#666'; }
        if (tapBtn) { tapBtn.style.background = '#764ba2'; tapBtn.style.color = 'white'; }
        loadTapahReport();
    }
};

// ══════════════════════════════════════════════
// --- TAPAH REPORT ---
// ══════════════════════════════════════════════

// Which collapsed groups are currently expanded (set of keys like 'week_2026-03-01' or 'month_2026-03')
const _tapahExpanded = new Set();

window.toggleTapahGroup = (key) => {
    if (_tapahExpanded.has(key)) _tapahExpanded.delete(key);
    else _tapahExpanded.add(key);
    renderTapahReport(window._tapahAllData || {});
};

// ── TAPAH PROGRESS ──────────────────────────────
async function loadTapahProgress() {
    const ringEl = document.getElementById('tapah-score-ring-container');
    if (!ringEl) return;
    ringEl.innerHTML = '<div style="text-align:center;color:#aaa;padding:20px;">Loading…</div>';

    const today       = new Date();
    const todayStr    = toLocalDateStr(today);
    const thisWeekSun = new Date(today); thisWeekSun.setDate(today.getDate() - today.getDay());
    const TAPAH_MAX   = 50;
    const ANUKUL_MAX  = ANUKUL_QUESTIONS.length * 5;   // 5 × 5 = 25
    const PRATIKUL_MAX = PRATIKUL_QUESTIONS.length * 5; // 5 × 5 = 25

    try {
        // Fetch ALL tapah data (no range query — avoids index issues)
        const snap = await db.collection('users').doc(currentUser.uid).collection('tapah').get();
        const allData = {};
        snap.forEach(doc => { allData[doc.id] = doc.data(); });

        // Filter last 28 days locally
        const from28Str = toLocalDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 27));
        const data = {};
        Object.keys(allData).forEach(k => { if (k >= from28Str && k <= todayStr) data[k] = allData[k]; });

        // Current week ring
        const weekDates = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(thisWeekSun); d.setDate(thisWeekSun.getDate() + i);
            const ds = toLocalDateStr(d);
            if (ds <= todayStr && ds >= APP_START_DATE) weekDates.push(ds);
        }
        const filled     = weekDates.filter(d => allData[d]);
        const wTotal     = filled.reduce((s, d) => s + (allData[d]?.totalScore || 0), 0);
        const wMax       = weekDates.length * TAPAH_MAX;  // max = all elapsed days × 50
        const wPct       = wMax > 0 ? Math.round(wTotal / wMax * 100) : 0;
        const ringColor  = wPct >= 70 ? '#27ae60' : wPct >= 50 ? '#f39c12' : '#e74c3c';

        const r = 54, circ = Math.round(2 * Math.PI * r);
        const dash = Math.round(circ * Math.max(0, wPct) / 100);

        const anukulTot    = filled.reduce((s, d) => s + (allData[d]?.anukulTotal   || 0), 0);
        const pratikulTot  = filled.reduce((s, d) => s + (allData[d]?.pratikulTotal || 0), 0);
        const anukulMax    = weekDates.length * ANUKUL_MAX;
        const pratikulMax  = weekDates.length * PRATIKUL_MAX;
        const mkColor = (got, max) => max > 0 ? (got/max >= 0.7 ? '#27ae60' : got/max >= 0.5 ? '#f39c12' : '#e74c3c') : '#aaa';

        const secRows = [
            { label: '🌿 Anukulasya (Favourable)',   got: anukulTot,   max: anukulMax,   perDay: ANUKUL_MAX   },
            { label: '🚫 Pratikulasya (Unfavourable)', got: pratikulTot, max: pratikulMax, perDay: PRATIKUL_MAX },
        ].map(sec => `<div style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:12px;">
            <span style="flex:1;color:#555;">${sec.label}</span>
            <span style="font-size:10px;color:#aaa;white-space:nowrap;">max ${sec.perDay}/day</span>
            <span style="font-weight:700;color:${mkColor(sec.got, sec.max)};min-width:42px;text-align:right;">${sec.got}/${sec.max || '—'}</span>
        </div>`).join('');

        ringEl.innerHTML = `<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
            <div style="position:relative;flex-shrink:0;">
                <svg width="130" height="130" style="transform:rotate(-90deg)">
                    <circle cx="65" cy="65" r="${r}" fill="none" stroke="#e0e0e0" stroke-width="10"/>
                    <circle cx="65" cy="65" r="${r}" fill="none" stroke="${ringColor}" stroke-width="10"
                        stroke-dasharray="${dash} ${circ}" stroke-linecap="round"/>
                </svg>
                <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">
                    <div style="font-size:22px;font-weight:800;color:${ringColor};">${wPct}%</div>
                    <div style="font-size:10px;color:#888;">This week</div>
                </div>
            </div>
            <div style="flex:1;min-width:160px;">
                <div style="font-weight:700;font-size:14px;color:#2c3e50;margin-bottom:6px;">🌿 Tapah — This Week</div>
                <div style="font-size:12px;color:#666;margin-bottom:2px;">${filled.length} of ${weekDates.length} day(s) filled</div>
                <div style="font-size:11px;color:#aaa;margin-bottom:6px;">Max ${TAPAH_MAX} marks/day</div>
                <div style="font-size:15px;font-weight:700;color:${ringColor};margin-bottom:8px;">${wTotal} / ${wMax} pts</div>
                ${secRows}
            </div>
        </div>`;

        // Line chart (last 28 days)
        const dates28   = [];
        for (let i = 27; i >= 0; i--) { const d = new Date(today); d.setDate(today.getDate() - i); const ds = toLocalDateStr(d); if (ds >= APP_START_DATE) dates28.push(ds); }
        const labels    = dates28.map(ds => { const d = new Date(ds + 'T00:00:00'); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; });
        const chartData = dates28.map(ds => {
            if (allData[ds]) return allData[ds].totalScore ?? 0;
            if (ds >= APP_START_DATE && ds < todayStr) return 0; // NR past day — drop to 0
            return null; // today (unfilled) or pre-app-start — skip
        });

        const canvas = document.getElementById('tapah-score-chart');
        if (!canvas) return;
        if (_tapahChart) { _tapahChart.destroy(); _tapahChart = null; }
        _tapahChart = new Chart(canvas, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Tapah', data: chartData, borderColor: '#764ba2', backgroundColor: 'rgba(118,75,162,0.08)', borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#764ba2', spanGaps: true, tension: 0.3 }] },
            options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} / ${TAPAH_MAX}` } } },
                scales: { y: { max: TAPAH_MAX, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { stepSize: 10 } }, x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } } } }
        });
    } catch (err) {
        if (ringEl) ringEl.innerHTML = `<div style="color:#e74c3c;padding:20px;text-align:center;">⚠️ Error loading Tapah progress:<br><span style="font-size:12px;font-family:monospace;">${err.code || err.message}</span></div>`;
    }
}

async function loadTapahReport() {
    const container = document.getElementById('tapah-report-container');
    if (!container) return;
    container.innerHTML = '<p style="color:#aaa;text-align:center;padding:30px;">Loading Tapah data…</p>';

    try {
        const snap = await db.collection('users').doc(currentUser.uid).collection('tapah').get();
        const allData = {};
        snap.forEach(doc => { allData[doc.id] = doc.data(); });
        window._tapahAllData = allData;
        // Auto-expand current month + week
        const _tn = new Date();
        const _ts = new Date(_tn); _ts.setDate(_tn.getDate() - _tn.getDay());
        _tapahExpanded.add('month_' + toLocalDateStr(_ts).slice(0, 7));
        _tapahExpanded.add('week_'  + toLocalDateStr(_ts));
        renderTapahReport(allData);
    } catch (err) {
        container.innerHTML = `
            <div style="text-align:center;padding:30px;background:#fff0f0;border-radius:10px;color:#e74c3c;">
                <div style="font-size:24px;margin-bottom:8px;">⚠️</div>
                <div style="font-weight:700;">Could not load Tapah data</div>
                <div style="font-size:13px;color:#666;margin:6px 0 14px;">Please check your internet connection and try again.</div>
                <button onclick="loadTapahReport()" style="padding:8px 20px;background:#3498db;color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;width:auto;">
                    🔄 Retry
                </button>
            </div>`;
    }
}

function renderTapahReport(allData) {
    const container = document.getElementById('tapah-report-container');
    if (!container) return;

    const today          = new Date();
    const todayStr       = toLocalDateStr(today);
    const thisWeekSun    = new Date(today); thisWeekSun.setDate(today.getDate() - today.getDay());
    const thisWeekSunStr = toLocalDateStr(thisWeekSun);

    const TM  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const TML = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const fmtD = ds => { const d = new Date(ds+'T00:00:00'); return `${String(d.getDate()).padStart(2,'0')} ${TM[d.getMonth()]}`; };
    const fmtM = ym => { const [y,m] = ym.split('-'); return `${TML[parseInt(m,10)-1]} ${y}`; };
    const fmtW = sun => { const s = new Date(sun+'T00:00:00'); const e = new Date(s); e.setDate(s.getDate()+6); return `${fmtD(sun)} – ${fmtD(toLocalDateStr(e))}`; };
    const sCol = pct => pct >= 70 ? '#27ae60' : pct >= 50 ? '#f39c12' : '#e74c3c';

    // Build date set — only actual data dates
    const allDates = new Set(Object.keys(allData).filter(d => d >= APP_START_DATE));
    // Also include current week dates up to today
    for (let i = 0; i < 7; i++) {
        const d = new Date(thisWeekSun); d.setDate(thisWeekSun.getDate() + i);
        const ds = toLocalDateStr(d);
        if (ds <= todayStr && ds >= APP_START_DATE) allDates.add(ds);
    }
    if (allDates.size === 0) {
        container.innerHTML = '<p style="color:#aaa;text-align:center;padding:30px;">No Tapah data yet. Start tracking!</p>';
        return;
    }

    // Group into week → month
    const weekMap = {};
    [...allDates].sort().forEach(ds => {
        const d = new Date(ds+'T00:00:00');
        const sun = new Date(d); sun.setDate(d.getDate() - d.getDay());
        const sunStr = toLocalDateStr(sun);
        if (!weekMap[sunStr]) weekMap[sunStr] = [];
        weekMap[sunStr].push(ds);
    });
    const monthMap = {};
    Object.keys(weekMap).sort().forEach(sunStr => {
        const mk = weekMap[sunStr][0].slice(0, 7);
        if (!monthMap[mk]) monthMap[mk] = [];
        monthMap[mk].push(sunStr);
    });

    // Cell value helpers
    const ansColor = (val, sec) => {
        if (!val) return { bg: '#f8f9fa', tc: '#ccc' };
        if (sec === 'anukul') {
            if (val === 'yes')     return { bg: '#c8f7c5', tc: '#27ae60' };
            if (val === 'partial') return { bg: '#fff3cd', tc: '#f39c12' };
            return { bg: '#fde8e8', tc: '#e74c3c' };
        } else {
            if (val === 'yes')     return { bg: '#fde8e8', tc: '#e74c3c' };
            if (val === 'partial') return { bg: '#fff3cd', tc: '#f39c12' };
            return { bg: '#c8f7c5', tc: '#27ae60' };
        }
    };
    const scoreLabel = (val, sec) => {
        if (!val) return '–';
        const sc = sec === 'anukul' ? getAanukulScore(val) : getPratikulScore(val);
        const ans = val === 'yes' ? 'Y' : val === 'partial' ? 'P' : 'N';
        return `${ans} <span style="font-size:10px;opacity:0.8;">(${sc>=0?'+':''}${sc})</span>`;
    };

    let html = '';
    Object.keys(monthMap).sort().reverse().forEach(mk => {
        const weeks = monthMap[mk].slice().reverse();
        const mFilled  = weeks.flatMap(w => weekMap[w]).filter(d => allData[d]);
        const mTotal   = mFilled.reduce((s,d) => s+(allData[d]?.totalScore||0), 0);
        const mElapsed = weeks.reduce((sum, s) => sum + (s === thisWeekSunStr ? weekMap[s].length : 7), 0);
        const mMax     = mElapsed * 50;
        const mPct     = mMax > 0 ? Math.round(mTotal/mMax*100) : 0;
        const mExpand  = _tapahExpanded.has('month_'+mk);

        html += `<div style="margin-bottom:10px;">
            <div onclick="toggleTapahGroup('month_${mk}')"
                style="background:#2c3e50;color:white;padding:12px 16px;border-radius:${mExpand?'8px 8px 0 0':'8px'};cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
                <div style="font-weight:700;font-size:14px;">${fmtM(mk)}</div>
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:13px;color:${sCol(mPct)};font-weight:700;">${mPct}%</span>
                    <span style="font-size:11px;opacity:0.7;">${mExpand?'▼':'▶'}</span>
                </div>
            </div>`;

        if (mExpand) {
            html += `<div style="background:#f8f9fa;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;padding:8px;">`;
            weeks.forEach(sunStr => {
                const wDates   = weekMap[sunStr];
                const wFilled  = wDates.filter(d => allData[d]);
                const wTotal   = wFilled.reduce((s,d) => s+(allData[d]?.totalScore||0), 0);
                const isCur    = sunStr === thisWeekSunStr;
                const wElapsed = isCur ? wDates.length : 7;
                const wMax     = wElapsed * 50;
                const wPct     = wMax > 0 ? Math.round(wTotal/wMax*100) : 0;
                const wExpand  = _tapahExpanded.has('week_'+sunStr);

                html += `<div style="margin-bottom:6px;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
                    <div onclick="toggleTapahGroup('week_${sunStr}')"
                        style="background:white;padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-left:4px solid #764ba2;">
                        <div>
                            <div style="font-weight:700;font-size:13px;color:#2c3e50;">${fmtW(sunStr)}${isCur?' <span style="font-size:10px;background:#764ba2;color:white;padding:1px 7px;border-radius:10px;margin-left:4px;">Current</span>':''}</div>
                            <div style="font-size:11px;color:#888;margin-top:2px;">${wFilled.length} day(s) filled · ${wTotal}/${wMax} pts</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:15px;font-weight:700;color:${sCol(wPct)};">${wPct}%</span>
                            <span style="font-size:11px;color:#aaa;">${wExpand?'▼':'▶'}</span>
                        </div>
                    </div>`;

                if (wExpand) {
                    // Table: questions as rows, dates as columns
                    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                    html += `<div style="overflow-x:auto;background:white;border-top:1px solid #f0f0f0;">
                        <table style="width:100%;border-collapse:collapse;font-size:12px;">
                            <thead><tr>
                                <th style="padding:8px 10px;background:#f0eaf8;text-align:left;color:#2c3e50;font-weight:700;white-space:nowrap;min-width:200px;">Question</th>
                                <th style="padding:8px 6px;background:#f0eaf8;text-align:center;color:#888;font-weight:600;white-space:nowrap;">Max</th>`;
                    wDates.forEach(ds => {
                        const d = new Date(ds+'T00:00:00');
                        html += `<th style="padding:8px;background:#f0eaf8;text-align:center;color:#2c3e50;font-weight:600;white-space:nowrap;">${dayNames[d.getDay()]}<br><span style="font-weight:400;font-size:10px;">${fmtD(ds)}</span></th>`;
                    });
                    html += `<th style="padding:8px;background:#f0eaf8;text-align:center;color:#764ba2;font-weight:700;">Total</th></tr></thead><tbody>`;

                    // Anukul section
                    html += `<tr><td colspan="${3+wDates.length}" style="background:#e8f8f0;font-weight:700;color:#27ae60;padding:6px 10px;font-size:11px;letter-spacing:0.4px;">🌿 ANUKULASYA (Favourable) — max 5/day each</td></tr>`;
                    ANUKUL_QUESTIONS.forEach((q, qi) => {
                        const rowBg = qi % 2 === 0 ? '#fff' : '#fafafa';
                        let rowTotal = 0;
                        let cells = '';
                        wDates.forEach(ds => {
                            const entry = allData[ds];
                            const val = entry?.anukul?.[q.id] || null;
                            const sc = val ? getAanukulScore(val) : null;
                            if (sc !== null) rowTotal += sc;
                            const { bg, tc } = ansColor(val, 'anukul');
                            cells += `<td style="padding:7px 4px;text-align:center;background:${rowBg};">
                                ${entry ? `<span style="background:${bg};color:${tc};padding:2px 6px;border-radius:4px;font-weight:700;font-size:11px;white-space:nowrap;">${val==='yes'?'Y':val==='partial'?'P':val==='no'?'N':'–'} <span style="font-size:9px;">(${sc>=0?'+':''}${sc??'–'})</span></span>` : '<span style="color:#ccc;">–</span>'}
                            </td>`;
                        });
                        const rowMax = wElapsed * 5;
                        const rPct = rowMax > 0 ? Math.round(rowTotal/rowMax*100) : 0;
                        html += `<tr>
                            <td style="padding:7px 10px;background:${rowBg};color:#2c3e50;">${q.label}${q.target?`<span style="color:#aaa;font-size:10px;margin-left:4px;">(${q.target})</span>`:''}</td>
                            <td style="padding:7px 6px;background:${rowBg};text-align:center;color:#888;">5</td>
                            ${cells}
                            <td style="padding:7px 6px;text-align:center;background:${rowBg};font-weight:700;color:${sCol(rPct)};">${rowMax>0?rowTotal:'–'}</td>
                        </tr>`;
                    });

                    // Pratikul section
                    html += `<tr><td colspan="${3+wDates.length}" style="background:#fde8e8;font-weight:700;color:#e74c3c;padding:6px 10px;font-size:11px;letter-spacing:0.4px;">🚫 PRATIKULASYA (Unfavourable) — max 5/day each</td></tr>`;
                    PRATIKUL_QUESTIONS.forEach((q, qi) => {
                        const rowBg = qi % 2 === 0 ? '#fff' : '#fafafa';
                        let rowTotal = 0;
                        let cells = '';
                        wDates.forEach(ds => {
                            const entry = allData[ds];
                            const val = entry?.pratikul?.[q.id] || null;
                            const sc = val ? getPratikulScore(val) : null;
                            if (sc !== null) rowTotal += sc;
                            const { bg, tc } = ansColor(val, 'pratikul');
                            cells += `<td style="padding:7px 4px;text-align:center;background:${rowBg};">
                                ${entry ? `<span style="background:${bg};color:${tc};padding:2px 6px;border-radius:4px;font-weight:700;font-size:11px;white-space:nowrap;">${val==='yes'?'Y':val==='partial'?'P':val==='no'?'N':'–'} <span style="font-size:9px;">(${sc>=0?'+':''}${sc??'–'})</span></span>` : '<span style="color:#ccc;">–</span>'}
                            </td>`;
                        });
                        const rowMax = wElapsed * 5;
                        const rPct = rowMax > 0 ? Math.round(rowTotal/rowMax*100) : 0;
                        html += `<tr>
                            <td style="padding:7px 10px;background:${rowBg};color:#2c3e50;">${q.label}</td>
                            <td style="padding:7px 6px;background:${rowBg};text-align:center;color:#888;">5</td>
                            ${cells}
                            <td style="padding:7px 6px;text-align:center;background:${rowBg};font-weight:700;color:${sCol(rPct)};">${rowMax>0?rowTotal:'–'}</td>
                        </tr>`;
                    });

                    // Total row
                    let totalCells = '';
                    wDates.forEach(ds => {
                        const entry = allData[ds];
                        const sc = entry?.totalScore ?? null;
                        const bg = sc === null ? '#f8f9fa' : sc >= 35 ? '#c8f7c5' : sc >= 20 ? '#fff3cd' : '#fde8e8';
                        const tc = sc === null ? '#aaa' : sc >= 35 ? '#27ae60' : sc >= 20 ? '#f39c12' : '#e74c3c';
                        totalCells += `<td style="padding:8px 4px;text-align:center;background:${bg};font-weight:800;color:${tc};font-size:13px;">${sc !== null ? `${sc}<span style="font-size:10px;font-weight:400;">/50</span>` : '–'}</td>`;
                    });
                    html += `<tr style="border-top:2px solid #e0e0e0;">
                        <td colspan="2" style="padding:8px 10px;font-weight:700;font-size:12px;color:#2c3e50;background:#f8f9fa;">Total Score</td>
                        ${totalCells}
                        <td style="padding:8px 6px;text-align:center;background:#f0eaf8;font-weight:800;color:${sCol(wPct)};font-size:13px;">${wTotal}<span style="font-size:10px;font-weight:400;">/${wMax}</span></td>
                    </tr>`;

                    html += `</tbody></table></div>`;
                }
                html += `</div>`;
            });
            html += `</div>`;
        }
        html += `</div>`;
    });

    container.innerHTML = html || '<p style="color:#aaa;text-align:center;padding:30px;">No Tapah data yet. Start tracking!</p>';
}
function setupDateSelect() {
    const s = document.getElementById('sadhana-date');
    if (!s) return;
    s.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const iso = toLocalDateStr(d);
        const opt = document.createElement('option');
        opt.value = iso;
        // Show human-friendly label
        const label = i === 0 ? `Today (${iso})` : i === 1 ? `Yesterday (${iso})` : iso;
        opt.textContent = label;
        s.appendChild(opt);
    }
}

const profileForm = document.getElementById('profile-form');
if (profileForm) {
    profileForm.onsubmit = async (e) => {
        e.preventDefault();
        const data = { name: document.getElementById('profile-name').value.trim() };
        await db.collection('users').doc(currentUser.uid).set(data, { merge: true });
        alert("Name saved!");
        location.reload();
    };
}

const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const rememberMe = document.getElementById('remember-me').checked;

        if (!email || !password) { alert('Please enter both email and password'); return; }

        try {
            if (rememberMe) {
                await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            } else {
                await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
            }
            await auth.signInWithEmailAndPassword(email, password);
        } catch (err) {
            console.error('Login error:', err.code, err.message);
            let errorMsg = 'Login failed: ';
            switch (err.code) {
                case 'auth/invalid-email':        errorMsg += 'Invalid email address.'; break;
                case 'auth/user-disabled':        errorMsg += 'This account has been disabled.'; break;
                case 'auth/user-not-found':       errorMsg += 'No account found with this email.'; break;
                case 'auth/wrong-password':       errorMsg += 'Incorrect password.'; break;
                case 'auth/invalid-credential':   errorMsg += 'Invalid email or password.'; break;
                case 'auth/operation-not-allowed':
                    errorMsg += 'Email/Password login is not enabled in Firebase.\n\nGo to: Firebase Console → Authentication → Sign-in method → Enable Email/Password.';
                    break;
                case 'auth/network-request-failed':
                    errorMsg += 'Network error. Check your internet connection.'; break;
                case 'auth/too-many-requests':
                    errorMsg += 'Too many failed attempts. Try again later.'; break;
                default:
                    errorMsg += err.message + '\n\nError code: ' + err.code;
            }
            alert(errorMsg);
        }
    };
}

setTimeout(() => {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.onclick = () => auth.signOut();
}, 100);

window.openProfileEdit = () => {
    document.getElementById('profile-name').value = userProfile.name;
    document.getElementById('cancel-edit').classList.remove('hidden');
    // Show change password section in edit mode
    const pwSection = document.getElementById('change-password-section');
    if (pwSection) pwSection.classList.remove('hidden');
    // Reset password fields
    ['current-password','new-password','confirm-password'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    // Load existing profile pic
    loadProfilePic();
    showSection('profile');
};

// --- PROFILE PICTURE ---
function loadProfilePic() {
    const pic = userProfile?.photoBase64;
    const img = document.getElementById('profile-pic-preview');
    const placeholder = document.getElementById('profile-pic-placeholder');
    if (!img || !placeholder) return;
    if (pic) {
        img.src = pic;
        img.style.display = 'block';
        placeholder.style.display = 'none';
    } else {
        img.style.display = 'none';
        placeholder.style.display = 'flex';
    }
    // Also update dashboard avatar
    const dashAvatar = document.getElementById('dashboard-avatar');
    const dashPlaceholder = document.getElementById('dashboard-avatar-placeholder');
    if (dashAvatar && dashPlaceholder) {
        if (pic) {
            dashAvatar.src = pic;
            dashAvatar.style.display = 'block';
            dashPlaceholder.style.display = 'none';
        } else {
            dashAvatar.style.display = 'none';
            dashPlaceholder.style.display = 'flex';
        }
    }
}

window.handleProfilePicChange = async (input) => {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    if (file.size > 2 * 1024 * 1024) {
        alert('Image must be under 2 MB. Please choose a smaller photo.');
        return;
    }
    const hint = document.getElementById('profile-pic-hint');
    if (hint) hint.textContent = 'Uploading…';

    const reader = new FileReader();
    reader.onload = async (ev) => {
        const base64 = ev.target.result;
        // Resize to max 200×200 to keep Firestore doc small
        const resized = await resizeImage(base64, 200);
        try {
            await db.collection('users').doc(currentUser.uid).set(
                { photoBase64: resized }, { merge: true }
            );
            userProfile.photoBase64 = resized;
            loadProfilePic();
            if (hint) hint.textContent = '✅ Photo updated!';
            setTimeout(() => { if (hint) hint.textContent = 'Tap 📷 to change photo'; }, 2000);
        } catch (err) {
            alert('Could not save photo: ' + err.message);
            if (hint) hint.textContent = 'Tap 📷 to change photo';
        }
    };
    reader.readAsDataURL(file);
};

function resizeImage(base64, maxSize) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = base64;
    });
}

// --- EYE BUTTON: toggle password visibility ---
window.togglePw = (inputId, btn) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
        btn.title = 'Hide password';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
        btn.title = 'Show password';
    }
};

// --- CAPS LOCK DETECTION ---
window.checkCapsLock = (e, warningId) => {
    const warning = document.getElementById(warningId);
    if (!warning) return;
    // getModifierState works on keydown/keyup
    if (e.getModifierState) {
        const caps = e.getModifierState('CapsLock');
        warning.classList.toggle('show', caps);
    }
};

// --- FORGOT PASSWORD ---
window.showForgotPassword = () => {
    // Pre-fill email if already typed
    const emailVal = document.getElementById('login-email')?.value || '';

    // Remove existing modal if any
    const existing = document.getElementById('forgot-pw-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'forgot-pw-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
        <div style="background:white;border-radius:14px;max-width:400px;width:100%;padding:28px;box-shadow:0 10px 40px rgba(0,0,0,0.25);">
            <div style="text-align:center;margin-bottom:18px;">
                <div style="font-size:36px;">🔑</div>
                <h3 style="margin:6px 0 4px;color:#2c3e50;">Reset Password</h3>
                <p style="font-size:13px;color:#888;margin:0;">Enter your email and we'll send a reset link</p>
            </div>
            <input type="email" id="forgot-email" placeholder="Your email address"
                value="${emailVal}"
                style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;font-size:14px;margin-bottom:4px;">
            <div id="forgot-msg" style="display:none;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;margin-bottom:10px;"></div>
            <button onclick="sendResetEmail()" id="forgot-send-btn"
                style="width:100%;padding:12px;background:#3498db;color:white;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;margin-bottom:8px;">
                📧 Send Reset Link
            </button>
            <button onclick="document.getElementById('forgot-pw-modal').remove()"
                style="width:100%;padding:10px;background:#f8f9fa;color:#666;border:1px solid #ddd;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;">
                Cancel
            </button>
        </div>`;
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    // Focus email field
    setTimeout(() => document.getElementById('forgot-email')?.focus(), 100);
};

window.sendResetEmail = async () => {
    const emailInput = document.getElementById('forgot-email');
    const msgEl = document.getElementById('forgot-msg');
    const sendBtn = document.getElementById('forgot-send-btn');
    const email = emailInput?.value?.trim();

    if (!email) {
        msgEl.style.display = 'block';
        msgEl.style.background = '#ffebee';
        msgEl.style.color = '#e74c3c';
        msgEl.textContent = 'Please enter your email address.';
        return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    msgEl.style.display = 'none';

    try {
        await auth.sendPasswordResetEmail(email);
        msgEl.style.display = 'block';
        msgEl.style.background = '#e8f5e9';
        msgEl.style.color = '#27ae60';
        msgEl.innerHTML = '✅ Reset link sent! Check your inbox (and spam folder).';
        sendBtn.textContent = '✅ Email Sent';
        sendBtn.style.background = '#27ae60';
        // Auto close after 3 seconds
        setTimeout(() => {
            const modal = document.getElementById('forgot-pw-modal');
            if (modal) modal.remove();
        }, 3000);
    } catch (err) {
        sendBtn.disabled = false;
        sendBtn.textContent = '📧 Send Reset Link';
        msgEl.style.display = 'block';
        msgEl.style.background = '#ffebee';
        msgEl.style.color = '#e74c3c';
        switch (err.code) {
            case 'auth/user-not-found':
                msgEl.textContent = 'No account found with this email.'; break;
            case 'auth/invalid-email':
                msgEl.textContent = 'Invalid email address.'; break;
            case 'auth/too-many-requests':
                msgEl.textContent = 'Too many requests. Please wait a moment.'; break;
            default:
                msgEl.textContent = err.message;
        }
    }
};

// --- CHANGE PASSWORD FORM ---
const changePasswordForm = document.getElementById('change-password-form');
if (changePasswordForm) {
    changePasswordForm.onsubmit = async (e) => {
        e.preventDefault();
        const currentPw  = document.getElementById('current-password').value;
        const newPw      = document.getElementById('new-password').value;
        const confirmPw  = document.getElementById('confirm-password').value;

        if (newPw !== confirmPw) {
            alert('New passwords do not match. Please re-enter.'); return;
        }
        if (newPw.length < 6) {
            alert('New password must be at least 6 characters.'); return;
        }
        if (newPw === currentPw) {
            alert('New password must be different from your current password.'); return;
        }

        try {
            // Re-authenticate first (required by Firebase before sensitive operations)
            const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, currentPw);
            await currentUser.reauthenticateWithCredential(credential);
            await currentUser.updatePassword(newPw);
            alert('✅ Password updated successfully!');
            // Clear fields
            ['current-password','new-password','confirm-password'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.value = ''; el.type = 'password'; }
            });
            // Reset eye buttons
            document.querySelectorAll('.pw-eye').forEach(btn => { btn.textContent = '👁️'; });
        } catch (err) {
            let msg = 'Failed to update password: ';
            switch (err.code) {
                case 'auth/wrong-password':
                case 'auth/invalid-credential': msg += 'Current password is incorrect.'; break;
                case 'auth/weak-password':      msg += 'New password is too weak.'; break;
                case 'auth/requires-recent-login': msg += 'Please log out and log back in, then try again.'; break;
                default: msg += err.message;
            }
            alert(msg);
        }
    };
}
