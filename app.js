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
        scores: { sleep: -5, wakeup: -5, morningProgram: -5, chanting: -5, reading: -5, hearing: -5, notes: -5, daySleep: 0 }
    };
}

// --- 3. DOWNLOAD EXCEL LOGIC ---
window.downloadUserExcel = async (userId, userName) => {
    try {
        if (typeof XLSX === 'undefined') {
            alert("Excel Library not loaded. Please wait 2 seconds and try again.");
            return;
        }

        const snap = await db.collection('users').doc(userId).collection('sadhana').get();
        if (snap.empty) {
            alert("No data found to download.");
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

        const sortedWeeks = Object.keys(weeksData).sort((a, b) => b.localeCompare(a));
        const dataArray = [];

        sortedWeeks.forEach((sunStr, weekIndex) => {
            const week = weeksData[sunStr];
            dataArray.push([`WEEK: ${week.label}`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
            dataArray.push(['Day', '1.To Bed', 'Mks', '2. Wake Up', 'Mks', '3. Japa', 'Mks', '4. MP', 'Mks', '5. DS', 'Mks', '6. Pathan', 'Mks', '7. Sarwan', 'Mks', '8. Ntes Rev.', 'Mks', 'Day Wise']);

            let weekTotals = { sleepM: 0, wakeupM: 0, morningProgramM: 0, chantingM: 0, readingM: 0, hearingM: 0, notesM: 0, daySleepM: 0, readingMins: 0, hearingMins: 0, notesMins: 0, daySleepMins: 0, total: 0 };
            const weekStart = new Date(week.sunStr + 'T00:00:00');
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

            for (let i = 0; i < 7; i++) {
                const currentDate = new Date(weekStart);
                currentDate.setDate(currentDate.getDate() + i);
                const dateStr = toLocalDateStr(currentDate);
                const dayLabel = `${dayNames[i]} ${String(currentDate.getDate()).padStart(2, '0')}`;
                const entry = week.days[dateStr] || getNRData(dateStr);

                const readMins = entry.readingMinutes === 'NR' ? 0 : (entry.readingMinutes || 0);
                const hearMins = entry.hearingMinutes === 'NR' ? 0 : (entry.hearingMinutes || 0);
                const notesMins = entry.notesMinutes === 'NR' ? 0 : (entry.notesMinutes || 0);

                weekTotals.sleepM += entry.scores?.sleep ?? 0;
                weekTotals.wakeupM += entry.scores?.wakeup ?? 0;
                weekTotals.morningProgramM += entry.scores?.morningProgram ?? 0;
                weekTotals.chantingM += entry.scores?.chanting ?? 0;
                weekTotals.readingM += entry.scores?.reading ?? 0;
                weekTotals.hearingM += entry.scores?.hearing ?? 0;
                weekTotals.notesM += entry.scores?.notes ?? 0;
                weekTotals.daySleepM += entry.scores?.daySleep ?? 0;
                weekTotals.readingMins += readMins;
                weekTotals.hearingMins += hearMins;
                weekTotals.notesMins += notesMins;
                weekTotals.total += entry.totalScore ?? 0;

                dataArray.push([
                    dayLabel, entry.sleepTime || 'NR', entry.scores?.sleep ?? 0,
                    entry.wakeupTime || 'NR', entry.scores?.wakeup ?? 0,
                    entry.chantingTime || 'NR', entry.scores?.chanting ?? 0,
                    entry.morningProgramTime || 'NR', entry.scores?.morningProgram ?? 0,
                    entry.daySleepMinutes !== 'NR' ? entry.daySleepMinutes : 'NR', entry.scores?.daySleep ?? 0,
                    entry.readingMinutes !== 'NR' ? entry.readingMinutes : 'NR', entry.scores?.reading ?? 0,
                    entry.hearingMinutes !== 'NR' ? entry.hearingMinutes : 'NR', entry.scores?.hearing ?? 0,
                    entry.notesMinutes !== 'NR' ? entry.notesMinutes : 'NR', entry.scores?.notes ?? 0,
                    (entry.dayPercent ?? 0) + '%'
                ]);
            }

            let adjustedNotesM = weekTotals.notesM;
            if (weekTotals.notesMins >= 245) adjustedNotesM = 175;
            const adjustedTotal = weekTotals.total - weekTotals.notesM + adjustedNotesM;
            const weekPercent = Math.round((adjustedTotal / 1225) * 100);

            dataArray.push(['Total/1225', '', weekTotals.sleepM, '', weekTotals.wakeupM, '', weekTotals.chantingM, '', weekTotals.morningProgramM, '', weekTotals.daySleepM, weekTotals.readingMins, weekTotals.readingM, weekTotals.hearingMins, weekTotals.hearingM, weekTotals.notesMins, adjustedNotesM, '']);
            dataArray.push(['Sadhna %', '', Math.round((weekTotals.sleepM/175)*100)+'%', '', Math.round((weekTotals.wakeupM/175)*100)+'%', '', Math.round((weekTotals.chantingM/175)*100)+'%', '', Math.round((weekTotals.morningProgramM/175)*100)+'%', '', Math.round((weekTotals.daySleepM/70)*100)+'%', '', Math.round((weekTotals.readingM/175)*100)+'%', '', Math.round((weekTotals.hearingM/175)*100)+'%', '', Math.round((adjustedNotesM/175)*100)+'%', '']);
            dataArray.push(['OVERALL', weekPercent + '%', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);

            if (weekIndex < sortedWeeks.length - 1) {
                dataArray.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
                dataArray.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
            }
        });

        const worksheet = XLSX.utils.aoa_to_sheet(dataArray);
        worksheet['!cols'] = [{wch:10},{wch:8},{wch:4},{wch:8},{wch:4},{wch:8},{wch:4},{wch:8},{wch:4},{wch:10},{wch:4},{wch:10},{wch:4},{wch:10},{wch:4},{wch:12},{wch:4},{wch:8},{wch:6}];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sadhana History');
        XLSX.writeFile(workbook, `${userName}_Sadhana_History.xlsx`);
    } catch (error) {
        alert("Error downloading Excel: " + error.message);
    }
};

// --- 4. UI NAVIGATION ---
function showSection(section) {
    ['auth', 'profile', 'dashboard'].forEach(s => {
        document.getElementById(`${s}-section`).classList.add('hidden');
    });
    document.getElementById(`${section}-section`).classList.remove('hidden');
}

window.switchTab = (t) => {
    document.querySelectorAll('.tab-content').forEach(el => { el.classList.remove('active'); el.classList.add('hidden'); });
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

    const tabContent = document.getElementById(t + '-tab');
    if (tabContent) { tabContent.classList.remove('hidden'); tabContent.classList.add('active'); }

    const btn = document.querySelector(`button[onclick*="switchTab('${t}')"]`);
    if (btn) btn.classList.add('active');

    if (t === 'reports' && currentUser) {
        _reportsLoading = false; // allow fresh load on manual tab switch
        loadReports(currentUser.uid, 'weekly-reports-container');
        // Reload tapah report too if it's the active panel
        const tapPanel = document.getElementById('tapah-reports-panel');
        if (tapPanel && tapPanel.style.display !== 'none') loadTapahReport();
    }
    if (t === 'charts' && currentUser) generateCharts();
    if (t === 'tapah') { resetTapahForm(); }
    // Reset edit mode when leaving Daily Entry
    if (t !== 'sadhana') cancelEdit();
};

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
            _reportsLoading = false; // always reset on fresh login (auth fires twice on mobile)
            _tapahAnswering = false; // reset tapah debounce on login
            loadReports(currentUser.uid, 'weekly-reports-container');
        }
    } else {
        showSection('auth');
        currentUser = null;
        userProfile = null;
    }
});

// --- 6. SCORING ENGINE ---
function computeScores(slp, wak, mpTime, mpNotDone, chn, rMin, hMin, nMin, dsMin) {
    const sc = { sleep: -5, wakeup: -5, morningProgram: -5, chanting: -5, reading: -5, hearing: -5, notes: -5, daySleep: 0 };

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
            alert('Error saving: ' + error.message);
        }
    };
}

// --- CHANGE 2: Edit from reports ---
window.editEntry = async (dateStr) => {
    // Switch to Daily Entry tab
    document.querySelectorAll('.tab-content').forEach(el => { el.classList.remove('active'); el.classList.add('hidden'); });
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const tabContent = document.getElementById('sadhana-tab');
    tabContent.classList.remove('hidden'); tabContent.classList.add('active');
    const btn = document.querySelector(`button[onclick*="switchTab('sadhana')"]`);
    if (btn) btn.classList.add('active');

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
    if (submitBtn) submitBtn.textContent = '✅ Submit Sadhana';
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
                <div style="font-size:13px;color:#666;margin-bottom:16px;">${err.message}</div>
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

    // Always show last 4 weeks in detailed reports, even if all NR
    // Only show "no data" if we have zero weeks to show at all (impossible since we always add 4)
    const allSuns = new Set([...last4Suns, ...Object.keys(weeksData)]);
    const sortedWeeks = Array.from(allSuns).sort((a, b) => b.localeCompare(a));

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

            // Future dates — skip entirely, no row shown
            if (isFuture) continue;

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
                    <td style="text-align:center;padding:7px 5px;">${pfBadge}</td>
                    <td style="white-space:nowrap;padding:7px 8px;font-size:13px;">${dateLabel}</td>
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
                    <span>📅 ${week.label.split('_')[0]}</span>
                    <span style="color:${fairPercent>=50?'#27ae60':'#e74c3c'};">${adjustedTotal}/${fairMax} (${fairPercent}%) <span class="toggle-icon">▶</span></span>
                </div>
                <div class="week-content">
                    <div style="overflow-x:auto;">
                    <table class="daily-table" style="font-size:13px;">
                        <thead>
                            <tr style="background:#2c3e50;color:white;font-size:12px;">
                                <th style="padding:8px 5px;text-align:center;min-width:44px;">P/F</th>
                                <th style="padding:8px 6px;white-space:nowrap;min-width:52px;">Date</th>
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
                                <td colspan="2" style="padding:7px 8px;color:#2c3e50;">Total</td>
                                <td style="padding:7px 4px;text-align:center;color:#888;">—</td>
                                ${totCell(weekTotals.sleepMarks, 175)}
                                <td style="padding:7px 4px;text-align:center;color:#888;">—</td>
                                ${totCell(weekTotals.wakeupMarks, 175)}
                                <td style="padding:7px 4px;text-align:center;color:#888;">—</td>
                                ${totCell(weekTotals.chantingMarks, 175)}
                                <td style="padding:7px 4px;text-align:center;color:#888;">—</td>
                                ${totCell(weekTotals.morningMarks, 175)}
                                <td style="padding:7px 4px;text-align:center;color:#888;">—</td>
                                ${totCell(weekTotals.daySleepMarks, 70)}
                                <td style="padding:7px 4px;text-align:center;font-size:11px;color:#555;">${weekTotals.readingMins}m</td>
                                ${totCell(weekTotals.readingMarks, 175)}
                                <td style="padding:7px 4px;text-align:center;font-size:11px;color:#555;">${weekTotals.hearingMins}m</td>
                                ${totCell(weekTotals.hearingMarks, 175)}
                                <td style="padding:7px 4px;text-align:center;font-size:11px;color:#555;">${weekTotals.notesMins}m</td>
                                ${totCell(adjustedNotesMarks, 175)}
                                <td colspan="2" style="padding:7px 4px;text-align:center;color:#888;">—</td>
                            </tr>
                            <tr style="background:#e8f0fe;font-weight:bold;font-size:12px;">
                                <td colspan="2" style="padding:6px 8px;color:#2c3e50;">Sadhna %</td>
                                ${pctCell(weekTotals.sleepMarks, 175)}
                                ${pctCell(weekTotals.wakeupMarks, 175)}
                                ${pctCell(weekTotals.chantingMarks, 175)}
                                ${pctCell(weekTotals.morningMarks, 175)}
                                ${pctCell(weekTotals.daySleepMarks, 70)}
                                ${pctCell(weekTotals.readingMarks, 175)}
                                ${pctCell(weekTotals.hearingMarks, 175)}
                                ${pctCell(adjustedNotesMarks, 175)}
                                <td colspan="2" style="padding:6px 4px;text-align:center;color:#888;">—</td>
                            </tr>
                        </tbody>
                    </table>
                    </div>
                    <div style="margin-top:12px;padding:12px 16px;background:${fairPercent>=50?'#27ae60':'#e74c3c'};color:white;border-radius:8px;text-align:center;">
                        <strong style="font-size:1.2em;">OVERALL: ${adjustedTotal}/${fairMax} (${fairPercent}%)</strong>
                        <div style="font-size:11px;opacity:0.85;margin-top:3px;">Based on ${elapsedDays} elapsed days × 175 pts each</div>
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

    // Display newest week first
    const displayStats = [...weekStatsWithTrend].reverse();

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
        dates.push(toLocalDateStr(d));  // IST-safe local date
    }

    // Use date range query — works for any number of dates
    const snapshot = await db.collection('users').doc(currentUser.uid)
        .collection('sadhana')
        .where(firebase.firestore.FieldPath.documentId(), '>=', dates[0])
        .where(firebase.firestore.FieldPath.documentId(), '<=', dates[27])
        .get();

    const data = {};
    snapshot.forEach(doc => { data[doc.id] = doc.data(); });

    const labels = dates.map(d => (() => { const _d = new Date(d + 'T00:00:00'); const _M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return String(_d.getDate()).padStart(2,'0')+' '+_M[_d.getMonth()]; })());
    // NR past days = -40 shown on chart; today unfilled = null (gap, no penalty yet)
    const scores = dates.map(d => {
        if (data[d] !== undefined) return data[d].totalScore ?? null;
        if (d === todayStr) return null;
        return -40;
    });

    // Activity totals: NR past days contribute penalty scores (same as getNRData)
    const NR_SCORES = { sleep: -5, wakeup: -5, morningProgram: -5, chanting: -5, reading: -5, hearing: -5, notes: -5, daySleep: 0 };
    const getS = (d, key) => data[d] ? (data[d]?.scores?.[key] ?? 0) : (d === todayStr ? 0 : NR_SCORES[key]);
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

    // Ring: include NR past days at -40, exclude today if not yet filled
    const datesForRing = dates.filter(d => d !== todayStr || data[d]);
    const totalEarned = datesForRing.reduce((s, d) => s + (data[d] ? (data[d].totalScore ?? 0) : -40), 0);
    const maxPossible = datesForRing.length * 175;
    const fairPercent = maxPossible > 0 ? Math.round((totalEarned / maxPossible) * 100) : 0;

    const ringContainer = document.getElementById('score-ring-container');
    if (ringContainer) ringContainer.style.display = datesForRing.length > 0 ? 'block' : 'none';
    if (datesForRing.length > 0) renderScoreRing(fairPercent, `${dates[0].slice(5).replace('-','/')} – ${dates[27].slice(5).replace('-','/')}`, datesForRing.length, totalEarned);

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

        // Count all past days in week (submitted or NR), skip future
        weekDates.forEach(dateStr => {
            if (dateStr > todayStr2) return; // future day — skip
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
                <div style="font-weight:700;font-size:15px;color:#2c3e50;margin-bottom:4px;">Weekly Score %</div>
                <div style="font-size:13px;color:#555;margin-bottom:6px;">${dateRange} · ${days} day${days !== 1 ? 's' : ''} · ${totalPts} pts</div>
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

    const pointColors = scores.map(s => {
        if (s === null) return 'rgba(200,200,200,0.5)';
        const pct = s / 175 * 100;
        return pct >= 70 ? '#27ae60' : pct >= 50 ? '#f39c12' : '#e74c3c';
    });

    scoreChart = new Chart(scoreCtx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Score',
                data: scores,
                borderColor: '#3498db',
                backgroundColor: 'rgba(52,152,219,0.08)',
                borderWidth: 2.5,
                pointBackgroundColor: pointColors,
                pointRadius: 5,
                pointHoverRadius: 7,
                tension: 0.35,
                fill: true,
                spanGaps: false,
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
            ctx2.fillText('No data yet — submit your first Sadhana entry!', canvas.width / 2, canvas.height / 2);
            ctx2.restore();
        }, 100);
    }
}

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
    const actColors = filteredVals.map(v => v >= 50 ? '#27ae60' : v >= 0 ? '#f39c12' : '#e74c3c');

    const actCtx = document.getElementById('activity-chart').getContext('2d');
    activityChart = new Chart(actCtx, {
        type: 'bar',
        data: {
            labels: filteredKeys,
            datasets: [{
                label: 'Total pts',
                data: filteredVals,
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
                tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} pts` } }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    min: -175,
                    grid: { color: 'rgba(0,0,0,0.06)' },
                    ticks: { callback: v => v + ' pts' }
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

// Flat list of all questions with section tag
const ALL_TAPAH_QUESTIONS = [
    ...ANUKUL_QUESTIONS.map(q => ({ ...q, section: 'anukul' })),
    ...PRATIKUL_QUESTIONS.map(q => ({ ...q, section: 'pratikul' })),
];

let _flashCardIndex = 0; // current card index (0–9)

function resetTapahForm() {
    _tapahAnswers = {};
    _flashCardIndex = 0;
    _tapahAnswering = false; // clear any pending debounce on reset
    setupTapahDateSelect();
    const sel = document.getElementById('tapah-date');
    if (sel) sel.disabled = false;
    const banner = document.getElementById('tapah-edit-banner');
    if (banner) banner.style.display = 'none';
    tapahEditingDate = null;
    const submitBtn = document.getElementById('tapah-submit-btn');
    if (submitBtn) submitBtn.style.display = 'none';
    const doneScreen = document.getElementById('tapah-done-screen');
    if (doneScreen) doneScreen.style.display = 'none';
    const card = document.getElementById('tapah-card');
    if (card) {
        card.style.display = 'block';
        card.style.opacity = '1';
        card.style.transform = 'none';
        card.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    }
    renderFlashCard(0);
    updateTapahTotals();
}

window.cancelTapahEdit = () => resetTapahForm();

function setupTapahDateSelect() {
    const s = document.getElementById('tapah-date');
    if (!s) return;
    s.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const iso = toLocalDateStr(d);
        const opt = document.createElement('option');
        opt.value = iso;
        opt.textContent = i === 0 ? `Today (${iso})` : i === 1 ? `Yesterday (${iso})` : iso;
        s.appendChild(opt);
    }
}

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

// Edit a past Tapah entry
window.editTapahEntry = async (dateStr) => {
    document.querySelectorAll('.tab-content').forEach(el => { el.classList.remove('active'); el.classList.add('hidden'); });
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const tab = document.getElementById('tapah-tab');
    if (tab) { tab.classList.remove('hidden'); tab.classList.add('active'); }
    const btn = document.querySelector(`button[onclick*="switchTab('tapah')"]`);
    if (btn) btn.classList.add('active');

    resetTapahForm();

    const snap = await db.collection('users').doc(currentUser.uid).collection('tapah').doc(dateStr).get();
    if (snap.exists) {
        const d = snap.data();
        restoreTapahButtons(d.anukul || {}, d.pratikul || {});
    }

    const sel = document.getElementById('tapah-date');
    let found = false;
    if (sel) {
        for (const opt of sel.options) { if (opt.value === dateStr) { opt.selected = true; found = true; break; } }
        if (!found) {
            const opt = document.createElement('option');
            opt.value = dateStr; opt.textContent = dateStr;
            sel.insertBefore(opt, sel.firstChild);
            sel.value = dateStr;
        }
        sel.disabled = true;
    }

    tapahEditingDate = dateStr;
    const banner = document.getElementById('tapah-edit-banner');
    const bannerText = document.getElementById('tapah-edit-banner-text');
    if (banner) banner.style.display = 'flex';
    if (bannerText) bannerText.textContent = `Editing Tapah: ${dateStr}`;
    const editSubmitBtn = document.getElementById('tapah-submit-btn');
    if (editSubmitBtn) { editSubmitBtn.style.display = 'none'; editSubmitBtn.textContent = '💾 Update Tapah'; }
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
        alert('Error saving Tapah: ' + err.message);
    }
};

// Legacy no-op — tapah form no longer exists as HTML form
window.selectTapahOption = () => {};

// ── END TAPAH MODULE ──

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
        if (ds <= toLocalDateStr(today)) weekDates.push(ds);
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

async function loadTapahReport() {
    const container = document.getElementById('tapah-report-container');
    if (!container) return;
    container.innerHTML = '<p style="color:#aaa;text-align:center;padding:30px;">Loading Tapah data…</p>';

    try {
        const snap = await db.collection('users').doc(currentUser.uid).collection('tapah').get();
        const allData = {};
        snap.forEach(doc => { allData[doc.id] = doc.data(); });
        window._tapahAllData = allData;
        renderTapahReport(allData);
    } catch (err) {
        container.innerHTML = `
            <div style="text-align:center;padding:30px;background:#fff0f0;border-radius:10px;color:#e74c3c;">
                <div style="font-size:24px;margin-bottom:8px;">⚠️</div>
                <div style="font-weight:700;">Could not load Tapah data</div>
                <div style="font-size:13px;color:#666;margin:6px 0 14px;">${err.message}</div>
                <button onclick="loadTapahReport()" style="padding:8px 20px;background:#3498db;color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;width:auto;">
                    🔄 Retry
                </button>
            </div>`;
    }
}

function renderTapahReport(allData) {
    const container = document.getElementById('tapah-report-container');
    if (!container) return;

    const today = new Date();
    const todayStr = toLocalDateStr(today);

    // Get current week Sunday
    const thisWeekSun = new Date(today);
    thisWeekSun.setDate(today.getDate() - today.getDay());
    const thisWeekSunStr = toLocalDateStr(thisWeekSun);

    // All questions list
    const allQuestions = [
        ...ANUKUL_QUESTIONS.map(q => ({ ...q, section: 'anukul' })),
        ...PRATIKUL_QUESTIONS.map(q => ({ ...q, section: 'pratikul' }))
    ];

    // --- Build timeline: group dates into weeks, weeks into months ---
    // Find all dates that have data OR are in the current week
    const allDates = new Set(Object.keys(allData));

    // Always include current week dates up to today
    for (let i = 0; i < 7; i++) {
        const d = new Date(thisWeekSun);
        d.setDate(thisWeekSun.getDate() + i);
        const ds = toLocalDateStr(d);
        if (ds <= todayStr) allDates.add(ds);
    }

    if (allDates.size === 0) {
        container.innerHTML = '<p style="color:#aaa;text-align:center;padding:30px;">No Tapah data yet. Start tracking!</p>';
        return;
    }

    // Group dates by week (Sun–Sat)
    const weekMap = {};
    [...allDates].sort().forEach(dateStr => {
        const d = new Date(dateStr + 'T00:00:00');
        const sun = new Date(d); sun.setDate(d.getDate() - d.getDay());
        const sunStr = toLocalDateStr(sun);
        if (!weekMap[sunStr]) weekMap[sunStr] = [];
        weekMap[sunStr].push(dateStr);
    });

    // Group weeks by month
    const monthMap = {};
    Object.keys(weekMap).sort().forEach(sunStr => {
        // Use the month of the majority of days in the week
        const firstDay = weekMap[sunStr][0];
        const monthKey = firstDay.slice(0, 7); // YYYY-MM
        if (!monthMap[monthKey]) monthMap[monthKey] = [];
        monthMap[monthKey].push(sunStr);
    });

    const sortedMonths = Object.keys(monthMap).sort();

    // Helper: cell color based on answer
    const cellColor = (val, section) => {
        if (!val || val === 'nr') return '#f8f9fa';
        if (val === 'yes')     return section === 'anukul' ? '#c8f7c5' : '#ffd5d5';
        if (val === 'partial') return '#fff3cd';
        if (val === 'no')      return section === 'anukul' ? '#ffd5d5' : '#c8f7c5';
        return '#f8f9fa';
    };
    const cellTextColor = (val, section) => {
        if (!val || val === 'nr') return '#aaa';
        if (val === 'yes')     return section === 'anukul' ? '#27ae60' : '#e74c3c';
        if (val === 'partial') return '#f39c12';
        if (val === 'no')      return section === 'anukul' ? '#e74c3c' : '#27ae60';
        return '#aaa';
    };
    const cellLabel = (val) => {
        if (!val || val === 'nr') return '–';
        if (val === 'yes') return 'Y';
        if (val === 'partial') return 'P';
        if (val === 'no') return 'N';
        return '–';
    };
    // scoreLabel removed - was unused dead code

    // Format date label: "01 Mar"
    const _TAPAH_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const _TAPAH_MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const fmtDate = (ds) => {
        const d = new Date(ds + 'T00:00:00');
        return `${String(d.getDate()).padStart(2,'0')} ${_TAPAH_MONTHS[d.getMonth()]}`;
    };
    const fmtMonth = (ym) => {
        const [y, m] = ym.split('-');
        return `${_TAPAH_MONTHS_LONG[parseInt(m,10)-1]} ${y}`;
    };
    const fmtWeek = (sunStr) => {
        const sun = new Date(sunStr + 'T00:00:00');
        const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
        return `${fmtDate(sunStr)} – ${fmtDate(toLocalDateStr(sat))}`;
    };

    // Score summary for a list of dates
    const summarize = (dates) => {
        const totals = {}; // qid → total score
        let grandTotal = 0, maxPossible = 0;
        allQuestions.forEach(q => { totals[q.id] = 0; });
        dates.forEach(ds => {
            const entry = allData[ds];
            if (!entry) return;
            maxPossible += 50;
            grandTotal += entry.totalScore || 0;
            allQuestions.forEach(q => {
                const ans = entry[q.section]?.[q.id];
                const sc = q.section === 'anukul' ? getAanukulScore(ans || 'no') : getPratikulScore(ans || 'no');
                totals[q.id] += sc;
            });
        });
        return { totals, grandTotal, maxPossible };
    };

    // ---- BUILD HTML ----
    // Fixed left columns: Sr, Particular, T-Dur
    // Then dynamic columns based on expanded/collapsed state

    // Build column definitions
    // Each column is either: { type:'day', date } | { type:'week', sunStr, dates } | { type:'month', monthKey, dates }
    const columns = [];
    const isCurrentWeek = (sunStr) => sunStr === thisWeekSunStr;

    sortedMonths.forEach(monthKey => {
        const weeksInMonth = monthMap[monthKey];
        const monthDates = weeksInMonth.flatMap(w => weekMap[w]).filter(d => allData[d] || d <= todayStr);
        const monthExpanded = _tapahExpanded.has('month_' + monthKey);

        if (monthExpanded) {
            // Show each week inside this month
            weeksInMonth.forEach(sunStr => {
                const weekDates = weekMap[sunStr].filter(d => d <= todayStr);
                const weekExpanded = _tapahExpanded.has('week_' + sunStr) || isCurrentWeek(sunStr);

                if (weekExpanded) {
                    // Show individual days
                    weekDates.forEach(ds => {
                        columns.push({ type: 'day', date: ds, parentWeek: sunStr, parentMonth: monthKey });
                    });
                    // Week total column (collapsible back)
                    columns.push({ type: 'weekTotal', sunStr, dates: weekDates, parentMonth: monthKey });
                } else {
                    // Show collapsed week column
                    columns.push({ type: 'week', sunStr, dates: weekDates, parentMonth: monthKey });
                }
            });
            // Month total column (collapsible back)
            columns.push({ type: 'monthTotal', monthKey, dates: monthDates });
        } else {
            // Show collapsed month column
            columns.push({ type: 'month', monthKey, dates: monthDates });
        }
    });

    // Build header row
    let headerCells = '';
    columns.forEach(col => {
        if (col.type === 'day') {
            const isToday = col.date === todayStr;
            headerCells += `<th style="min-width:44px;padding:6px 3px;font-size:11px;background:#3498db;color:white;text-align:center;white-space:nowrap;${isToday?'background:#1a5276;':''}">${fmtDate(col.date)}</th>`;
        } else if (col.type === 'week') {
            headerCells += `<th onclick="toggleTapahGroup('week_${col.sunStr}')" style="min-width:80px;padding:6px 4px;font-size:11px;background:#2980b9;color:white;text-align:center;cursor:pointer;white-space:nowrap;" title="Click to expand">${fmtWeek(col.sunStr)} ▶</th>`;
        } else if (col.type === 'weekTotal') {
            headerCells += `<th onclick="toggleTapahGroup('week_${col.sunStr}')" style="min-width:60px;padding:6px 4px;font-size:11px;background:#1a6b9a;color:white;text-align:center;cursor:pointer;white-space:nowrap;" title="Click to collapse">Wk Total ◀</th>`;
        } else if (col.type === 'month') {
            headerCells += `<th onclick="toggleTapahGroup('month_${col.monthKey}')" style="min-width:90px;padding:6px 4px;font-size:11px;background:#8e44ad;color:white;text-align:center;cursor:pointer;white-space:nowrap;" title="Click to expand">${fmtMonth(col.monthKey)} ▶</th>`;
        } else if (col.type === 'monthTotal') {
            headerCells += `<th onclick="toggleTapahGroup('month_${col.monthKey}')" style="min-width:70px;padding:6px 4px;font-size:11px;background:#6c3483;color:white;text-align:center;cursor:pointer;white-space:nowrap;" title="Click to collapse">Mo Total ◀</th>`;
        }
    });

    // Build section rows
    let bodyRows = '';

    // Section header: ANUKULASYA
    bodyRows += `<tr><td colspan="3" style="background:#e8f8f0;font-weight:700;color:#27ae60;padding:8px 10px;font-size:12px;letter-spacing:0.5px;">🌿 ANUKULASYA (Favourable)</td>${columns.map(col => `<td style="background:#e8f8f0;"></td>`).join('')}</tr>`;

    ANUKUL_QUESTIONS.forEach((q, idx) => {
        let cells = '';
        columns.forEach(col => {
            if (col.type === 'day') {
                const entry = allData[col.date];
                const val = entry?.anukul?.[q.id] || null;
                const isFuture = col.date > todayStr;
                if (isFuture) {
                    cells += `<td style="background:#f8f9fa;text-align:center;font-size:11px;color:#ccc;">–</td>`;
                } else {
                    cells += `<td style="background:${cellColor(val,'anukul')};text-align:center;font-size:12px;font-weight:600;color:${cellTextColor(val,'anukul')};padding:5px 2px;" title="${val||'No entry'}">${cellLabel(val)}</td>`;
                }
            } else {
                // Summary column
                const { totals, maxPossible } = summarize(col.dates.filter(d => allData[d]));
                const sc = totals[q.id] || 0;
                const maxSc = col.dates.filter(d => allData[d]).length * 5;
                const pct = maxSc > 0 ? Math.round(sc / maxSc * 100) : 0;
                const bg = pct >= 70 ? '#c8f7c5' : pct >= 40 ? '#fff3cd' : maxSc > 0 ? '#ffd5d5' : '#f8f9fa';
                const tc = pct >= 70 ? '#27ae60' : pct >= 40 ? '#f39c12' : maxSc > 0 ? '#e74c3c' : '#aaa';
                cells += `<td style="background:${bg};text-align:center;font-size:12px;font-weight:700;color:${tc};padding:5px 2px;">${maxSc > 0 ? sc : '–'}</td>`;
            }
        });
        bodyRows += `<tr>
            <td style="padding:6px 8px;font-size:12px;text-align:center;color:#555;">${idx+1}</td>
            <td style="padding:6px 8px;font-size:12px;color:#2c3e50;">${q.label}</td>
            <td style="padding:6px 8px;font-size:11px;color:#888;text-align:center;white-space:nowrap;">${q.target||''}</td>
            ${cells}
        </tr>`;
    });

    // Section header: PRATIKULASYA
    bodyRows += `<tr><td colspan="3" style="background:#fde8e8;font-weight:700;color:#e74c3c;padding:8px 10px;font-size:12px;letter-spacing:0.5px;">🚫 PRATIKULASYA (Unfavourable)</td>${columns.map(col => `<td style="background:#fde8e8;"></td>`).join('')}</tr>`;

    PRATIKUL_QUESTIONS.forEach((q, idx) => {
        let cells = '';
        columns.forEach(col => {
            if (col.type === 'day') {
                const entry = allData[col.date];
                const val = entry?.pratikul?.[q.id] || null;
                const isFuture = col.date > todayStr;
                if (isFuture) {
                    cells += `<td style="background:#f8f9fa;text-align:center;font-size:11px;color:#ccc;">–</td>`;
                } else {
                    cells += `<td style="background:${cellColor(val,'pratikul')};text-align:center;font-size:12px;font-weight:600;color:${cellTextColor(val,'pratikul')};padding:5px 2px;" title="${val||'No entry'}">${cellLabel(val)}</td>`;
                }
            } else {
                const { totals } = summarize(col.dates.filter(d => allData[d]));
                const sc = totals[q.id] || 0;
                const maxSc = col.dates.filter(d => allData[d]).length * 5;
                const pct = maxSc > 0 ? Math.round(sc / maxSc * 100) : 0;
                const bg = pct >= 70 ? '#c8f7c5' : pct >= 40 ? '#fff3cd' : maxSc > 0 ? '#ffd5d5' : '#f8f9fa';
                const tc = pct >= 70 ? '#27ae60' : pct >= 40 ? '#f39c12' : maxSc > 0 ? '#e74c3c' : '#aaa';
                cells += `<td style="background:${bg};text-align:center;font-size:12px;font-weight:700;color:${tc};padding:5px 2px;">${maxSc > 0 ? sc : '–'}</td>`;
            }
        });
        bodyRows += `<tr>
            <td style="padding:6px 8px;font-size:12px;text-align:center;color:#555;">${idx+1}</td>
            <td style="padding:6px 8px;font-size:12px;color:#2c3e50;">${q.label}</td>
            <td style="padding:6px 8px;font-size:11px;color:#888;text-align:center;"></td>
            ${cells}
        </tr>`;
    });

    // Total row
    let totalCells = '';
    columns.forEach(col => {
        const datesWithData = col.dates ? col.dates.filter(d => allData[d]) : (allData[col.date] ? [col.date] : []);
        if (col.type === 'day') {
            const entry = allData[col.date];
            const sc = entry?.totalScore ?? null;
            const isFuture = col.date > todayStr;
            if (isFuture) {
                totalCells += `<td style="background:#f8f9fa;text-align:center;font-size:11px;color:#ccc;font-weight:700;">–</td>`;
            } else {
                const bg = sc === null ? '#f8f9fa' : sc >= 35 ? '#c8f7c5' : sc >= 20 ? '#fff3cd' : '#ffd5d5';
                const tc = sc === null ? '#aaa' : sc >= 35 ? '#27ae60' : sc >= 20 ? '#f39c12' : '#e74c3c';
                totalCells += `<td style="background:${bg};text-align:center;font-size:12px;font-weight:700;color:${tc};padding:5px 2px;">${sc !== null ? sc : '–'}</td>`;
            }
        } else {
            const { grandTotal, maxPossible } = summarize(datesWithData);
            const pct = maxPossible > 0 ? Math.round(grandTotal / maxPossible * 100) : 0;
            const bg = pct >= 70 ? '#c8f7c5' : pct >= 40 ? '#fff3cd' : maxPossible > 0 ? '#ffd5d5' : '#f8f9fa';
            const tc = pct >= 70 ? '#27ae60' : pct >= 40 ? '#f39c12' : maxPossible > 0 ? '#e74c3c' : '#aaa';
            totalCells += `<td style="background:${bg};text-align:center;font-size:12px;font-weight:700;color:${tc};padding:5px 2px;">${maxPossible > 0 ? grandTotal : '–'}</td>`;
        }
    });

    // % row
    let pctCells = '';
    columns.forEach(col => {
        const datesWithData = col.dates ? col.dates.filter(d => allData[d]) : (allData[col.date] ? [col.date] : []);
        if (col.type === 'day') {
            const entry = allData[col.date];
            const pct = entry ? Math.round((entry.totalScore || 0) / 50 * 100) : null;
            const isFuture = col.date > todayStr;
            if (isFuture) {
                pctCells += `<td style="text-align:center;font-size:11px;color:#ccc;">–</td>`;
            } else {
                const tc = pct === null ? '#aaa' : pct >= 70 ? '#27ae60' : pct >= 40 ? '#f39c12' : '#e74c3c';
                pctCells += `<td style="text-align:center;font-size:11px;font-weight:700;color:${tc};">${pct !== null ? pct+'%' : '–'}</td>`;
            }
        } else {
            const { grandTotal, maxPossible } = summarize(datesWithData);
            const pct = maxPossible > 0 ? Math.round(grandTotal / maxPossible * 100) : null;
            const tc = pct === null ? '#aaa' : pct >= 70 ? '#27ae60' : pct >= 40 ? '#f39c12' : '#e74c3c';
            pctCells += `<td style="text-align:center;font-size:11px;font-weight:700;color:${tc};">${pct !== null ? pct+'%' : '–'}</td>`;
        }
    });

    // Legend
    const legend = `
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;font-size:12px;align-items:center;">
            <span style="font-weight:600;color:#555;">Legend:</span>
            <span style="background:#c8f7c5;color:#27ae60;padding:2px 10px;border-radius:4px;font-weight:600;">Y = Yes</span>
            <span style="background:#fff3cd;color:#f39c12;padding:2px 10px;border-radius:4px;font-weight:600;">P = Partial</span>
            <span style="background:#ffd5d5;color:#e74c3c;padding:2px 10px;border-radius:4px;font-weight:600;">N = No</span>
            <span style="color:#888;font-size:11px;">| Click week/month headers to expand ▶ or collapse ◀</span>
        </div>`;

    container.innerHTML = `
        ${legend}
        <div style="overflow-x:auto;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,0.08);">
        <table style="border-collapse:collapse;width:100%;font-family:'Segoe UI',sans-serif;min-width:400px;">
            <thead>
                <tr style="background:#2c3e50;color:white;">
                    <th style="padding:8px 6px;font-size:12px;text-align:center;min-width:32px;">Sr</th>
                    <th style="padding:8px 10px;font-size:12px;text-align:left;min-width:180px;">Particular</th>
                    <th style="padding:8px 6px;font-size:11px;text-align:center;min-width:48px;">T-Dur</th>
                    ${headerCells}
                </tr>
            </thead>
            <tbody>
                ${bodyRows}
                <tr style="background:#f0f4ff;">
                    <td colspan="3" style="padding:7px 10px;font-weight:700;font-size:12px;color:#2c3e50;">Total (50)</td>
                    ${totalCells}
                </tr>
                <tr style="background:#e8f0fe;">
                    <td colspan="3" style="padding:7px 10px;font-weight:700;font-size:12px;color:#2c3e50;">Percentage</td>
                    ${pctCells}
                </tr>
            </tbody>
        </table>
        </div>`;
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
    // Also update dashboard avatar if exists
    const dashAvatar = document.getElementById('dashboard-avatar');
    if (dashAvatar && pic) { dashAvatar.src = pic; dashAvatar.style.display = 'block'; }
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
