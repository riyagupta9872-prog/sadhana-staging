// --- 1. FIREBASE SETUP ---
const firebaseConfig = {
    apiKey: "AIzaSyCZdmZJckSWJo1tFT14NVKVurUGsoKrRy8",
    authDomain: "rapd--sadhana-tracker.firebaseapp.com",
    projectId: "rapd--sadhana-tracker",
    storageBucket: "rapd--sadhana-tracker.firebasestorage.app",
    messagingSenderId: "811405448950",
    appId: "1:811405448950:web:8b711f3129e4bdf06dbed7"
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
const t2m = (t, isSleep = false) => {
    if (!t || t === "NR") return 9999;
    let [h, m] = t.split(':').map(Number);
    if (isSleep && h >= 0 && h <= 3) h += 24;
    return h * 60 + m;
};

function getWeekInfo(dateStr) {
    const d = new Date(dateStr);
    const sun = new Date(d); sun.setDate(d.getDate() - d.getDay());
    const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
    const fmt = (date) => {
        const day = String(date.getDate()).padStart(2, '0');
        const month = date.toLocaleString('en-GB', { month: 'short' });
        return `${day} ${month}`;
    };
    return { sunStr: sun.toISOString().split('T')[0], label: `${fmt(sun)} to ${fmt(sat)}_${sun.getFullYear()}` };
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
            const weekStart = new Date(week.sunStr);
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

            for (let i = 0; i < 7; i++) {
                const currentDate = new Date(weekStart);
                currentDate.setDate(currentDate.getDate() + i);
                const dateStr = currentDate.toISOString().split('T')[0];
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
    console.log('Auth state changed:', user ? 'LOGGED IN uid=' + user.uid : 'LOGGED OUT');
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
            setupDateSelect();
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
    return document.getElementById('mp-no-btn').classList.contains('mp-active');
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
                submittedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            const isEdit = editingDate !== null;
            cancelEdit();
            alert(`${isEdit ? 'Updated' : 'Saved'}! Score: ${total}/175 (${dayPercent}%)`);
            switchTab('reports');
        } catch (error) {
            console.error('SADHANA ERROR FULL:', error);
            console.error('Error code:', error.code);
            alert('Error saving: ' + error.message + '\n\nCode: ' + error.code + '\n\nPath: users/' + currentUser?.uid + '/sadhana/' + date);
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
    document.getElementById('edit-mode-banner').querySelector('span').textContent = `Editing: ${dateStr}`;
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
    // Reset morning program to default state
    toggleMorningProgram(false);
    document.getElementById('morning-program-time').value = '';
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

// --- SCORE BACKGROUND ---
function getScoreBackground(score) {
    if (score === null || score === undefined) return '#ffcdd2';
    if (score >= 20) return '#c8e6c9';
    if (score >= 15) return '#fff9c4';
    if (score >= 10) return '#ffe0b2';
    if (score >= 0) return '#ffebee';
    return '#ffcdd2';
}

// --- 8. REPORTS ---
async function loadReports(userId, containerId) {
    const container = document.getElementById(containerId);
    const snap = await db.collection('users').doc(userId).collection('sadhana').get();

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
    const last4Suns = new Set();
    for (let w = 0; w < 4; w++) {
        const sun = new Date(thisWeekSun);
        sun.setDate(thisWeekSun.getDate() - w * 7);
        const sunStr = sun.toISOString().split('T')[0];
        last4Suns.add(sunStr);
        // Ensure these weeks exist in weeksData even if empty
        if (!weeksData[sunStr]) {
            const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
            const fmt = d => `${String(d.getDate()).padStart(2,'0')} ${d.toLocaleString('en-GB',{month:'short'})}`;
            weeksData[sunStr] = { label: `${fmt(sun)} to ${fmt(sat)}_${sun.getFullYear()}`, sunStr, days: {} };
        }
    }

    // 4-week comparison (always runs with weeksData)
    generate4WeekComparison([], weeksData);

    if (snap.empty && Object.keys(weeksData).every(k => Object.keys(weeksData[k].days).length === 0)) {
        container.innerHTML = '<p style="text-align:center; color:#999; padding:40px;">No sadhana data yet. Start tracking!</p>';
        return;
    }

    // All weeks to display: last 4 + older filled weeks, newest first
    const allSuns = new Set([...last4Suns, ...Object.keys(weeksData)]);
    const sortedWeeks = Array.from(allSuns).sort((a, b) => b.localeCompare(a));

    let html = '';
    sortedWeeks.forEach(sunStr => {
        const week = weeksData[sunStr];
        const weekStart = new Date(sunStr);
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        let weekTotals = { total: 0, readingMins: 0, hearingMins: 0, notesMins: 0, notesMarks: 0, sleepMarks: 0, wakeupMarks: 0, morningMarks: 0, chantingMarks: 0, readingMarks: 0, hearingMarks: 0, daySleepMarks: 0 };

        let tableRows = '';
        for (let i = 0; i < 7; i++) {
            const currentDate = new Date(weekStart);
            currentDate.setDate(currentDate.getDate() + i);
            const dateStr = currentDate.toISOString().split('T')[0];
            const entry = week.days[dateStr] || getNRData(dateStr);
            const isNR = !week.days[dateStr];

            weekTotals.total += entry.totalScore ?? 0;
            weekTotals.readingMins += (entry.readingMinutes === 'NR' ? 0 : entry.readingMinutes) || 0;
            weekTotals.hearingMins += (entry.hearingMinutes === 'NR' ? 0 : entry.hearingMinutes) || 0;
            weekTotals.notesMins += (entry.notesMinutes === 'NR' ? 0 : entry.notesMinutes) || 0;
            weekTotals.notesMarks += entry.scores?.notes || 0;
            weekTotals.sleepMarks += entry.scores?.sleep || 0;
            weekTotals.wakeupMarks += entry.scores?.wakeup || 0;
            weekTotals.morningMarks += entry.scores?.morningProgram || 0;
            weekTotals.chantingMarks += entry.scores?.chanting || 0;
            weekTotals.readingMarks += entry.scores?.reading || 0;
            weekTotals.hearingMarks += entry.scores?.hearing || 0;
            weekTotals.daySleepMarks += entry.scores?.daySleep || 0;

            const dayPercent = entry.dayPercent ?? -23;
            const percentColor = dayPercent >= 80 ? 'green' : dayPercent >= 60 ? 'orange' : 'red';
            const mpDisplay = entry.morningProgramTime === 'Not Done' ? '<span style="color:#e74c3c;font-size:0.85em;">Not Done</span>' : (entry.morningProgramTime || 'NR');

            // CHANGE 2: Edit + History buttons on each day row
            const editBtn = !isNR
                ? `<button onclick="editEntry('${dateStr}')" style="padding:2px 8px;font-size:11px;background:#3498db;width:auto;margin:0 2px 2px 0;border-radius:4px;">✏️ Edit</button>
                   <button onclick="viewEditHistory('${dateStr}')" style="padding:2px 8px;font-size:11px;background:#9b59b6;width:auto;margin:0;border-radius:4px;">🕓 History</button>`
                : `<button onclick="editEntry('${dateStr}')" style="padding:2px 8px;font-size:11px;background:#27ae60;width:auto;margin:0;border-radius:4px;">+ Fill</button>`;

            tableRows += `
                <tr>
                    <td><strong>${dayNames[i]} ${currentDate.getDate()}</strong><br>${editBtn}</td>
                    <td>${entry.sleepTime}</td>
                    <td style="background:${getScoreBackground(entry.scores?.sleep)};font-weight:bold;">${entry.scores?.sleep}</td>
                    <td>${entry.wakeupTime}</td>
                    <td style="background:${getScoreBackground(entry.scores?.wakeup)};font-weight:bold;">${entry.scores?.wakeup}</td>
                    <td>${entry.chantingTime}</td>
                    <td style="background:${getScoreBackground(entry.scores?.chanting)};font-weight:bold;">${entry.scores?.chanting}</td>
                    <td>${mpDisplay}</td>
                    <td style="background:${getScoreBackground(entry.scores?.morningProgram)};font-weight:bold;">${entry.scores?.morningProgram ?? 0}</td>
                    <td>${entry.daySleepMinutes !== 'NR' ? entry.daySleepMinutes : 'NR'}</td>
                    <td style="background:${getScoreBackground(entry.scores?.daySleep)};font-weight:bold;">${entry.scores?.daySleep}</td>
                    <td>${entry.readingMinutes !== 'NR' ? entry.readingMinutes : 'NR'}</td>
                    <td style="background:${getScoreBackground(entry.scores?.reading)};font-weight:bold;">${entry.scores?.reading}</td>
                    <td>${entry.hearingMinutes !== 'NR' ? entry.hearingMinutes : 'NR'}</td>
                    <td style="background:${getScoreBackground(entry.scores?.hearing)};font-weight:bold;">${entry.scores?.hearing}</td>
                    <td>${entry.notesMinutes !== 'NR' ? entry.notesMinutes : 'NR'}</td>
                    <td style="background:${getScoreBackground(entry.scores?.notes)};font-weight:bold;">${entry.scores?.notes}</td>
                    <td style="color:${percentColor};font-weight:bold;">${dayPercent}%</td>
                </tr>
            `;
        }

        let adjustedNotesMarks = weekTotals.notesMarks;
        if (weekTotals.notesMins >= 245) adjustedNotesMarks = 175;
        const adjustedTotal = weekTotals.total - weekTotals.notesMarks + adjustedNotesMarks;
        // Fair denominator: count only past days (not future days in current week)
        let elapsedDays = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
            if (d <= new Date()) elapsedDays++;
        }
        const fairMax = elapsedDays * 175;
        const weekPercent = Math.round((adjustedTotal / 1225) * 100);
        const fairPercent = fairMax > 0 ? Math.round((adjustedTotal / fairMax) * 100) : 0;
        const weekClass = adjustedTotal < 735 ? 'low-score' : '';

        html += `
            <div class="week-card ${weekClass}">
                <div class="week-header" onclick="this.nextElementSibling.classList.toggle('expanded'); this.querySelector('.toggle-icon').textContent = this.nextElementSibling.classList.contains('expanded') ? '▼' : '▶';">
                    <span>${week.label.split('_')[0]}</span>
                    <span>${adjustedTotal}/${fairMax} &nbsp;|&nbsp; Fair: ${fairPercent}% &nbsp;|&nbsp; Overall: ${weekPercent}% <span class="toggle-icon">▶</span></span>
                </div>
                <div class="week-content">
                    <div style="overflow-x:auto;">
                    <table class="daily-table">
                        <thead>
                            <tr style="background:var(--secondary);color:black;">
                                <th>Day</th><th>Bed Time</th><th>Mks</th><th>Wake Up</th><th>Mks</th>
                                <th>Japa</th><th>Mks</th><th>Morn. Prog</th><th>Mks</th><th>Day Sleep</th><th>Mks</th>
                                <th>Pathan</th><th>Mks</th><th>Sarwan</th><th>Mks</th><th>Notes Rev.</th><th>Mks</th><th>Day %</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                            <tr style="background:#f0f4ff;font-weight:bold;">
                                <td>Total/1225</td><td>—</td>
                                <td style="background:lightgreen;">${weekTotals.sleepMarks}</td><td>—</td>
                                <td style="background:lightgreen;">${weekTotals.wakeupMarks}</td><td>—</td>
                                <td style="background:lightgreen;">${weekTotals.chantingMarks}</td><td>—</td>
                                <td style="background:lightgreen;">${weekTotals.morningMarks}</td><td>—</td>
                                <td style="background:lightgreen;">${weekTotals.daySleepMarks}</td>
                                <td>${weekTotals.readingMins}</td><td style="background:lightgreen;">${weekTotals.readingMarks}</td>
                                <td>${weekTotals.hearingMins}</td><td style="background:lightgreen;">${weekTotals.hearingMarks}</td>
                                <td>${weekTotals.notesMins}</td><td style="background:lightgreen;">${adjustedNotesMarks}</td><td>—</td>
                            </tr>
                            <tr style="background:#e8f5e9;font-weight:bold;">
                                <td>Sadhna %</td>
                                <td colspan="2" style="background:lightgreen;font-size:1.1em;">${Math.round((weekTotals.sleepMarks/175)*100)}%</td>
                                <td colspan="2" style="background:lightgreen;font-size:1.1em;">${Math.round((weekTotals.wakeupMarks/175)*100)}%</td>
                                <td colspan="2" style="background:lightgreen;font-size:1.1em;">${Math.round((weekTotals.chantingMarks/175)*100)}%</td>
                                <td colspan="2" style="background:lightgreen;font-size:1.1em;">${Math.round((weekTotals.morningMarks/175)*100)}%</td>
                                <td colspan="2" style="background:lightgreen;font-size:1.1em;">${Math.round((weekTotals.daySleepMarks/70)*100)}%</td>
                                <td colspan="2" style="background:lightgreen;font-size:1.1em;">${Math.round((weekTotals.readingMarks/175)*100)}%</td>
                                <td colspan="2" style="background:lightgreen;font-size:1.1em;">${Math.round((weekTotals.hearingMarks/175)*100)}%</td>
                                <td colspan="2" style="background:lightgreen;font-size:1.1em;">${Math.round((adjustedNotesMarks/175)*100)}%</td>
                                <td>—</td>
                            </tr>
                        </tbody>
                    </table>
                    </div>
                    <div style="margin-top:15px;padding:15px;background:var(--secondary);color:white;border-radius:8px;text-align:center;">
                        <strong style="font-size:1.2em;">OVERALL: ${adjustedTotal}/1225 (${weekPercent}%)</strong>
                        &nbsp;&nbsp;|&nbsp;&nbsp;
                        <strong style="font-size:1.2em;">Fair %: ${adjustedTotal}/${fairMax} (${fairPercent}%)</strong>
                        <div style="font-size:11px;opacity:0.85;margin-top:4px;">Fair % = score ÷ (${elapsedDays} elapsed days × 175)</div>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
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
        last4Suns.push(sun.toISOString().split('T')[0]);
    }

    // Compute stats for each of the 4 weeks (oldest first for trend calculation)
    const weekStats = last4Suns.map(sunStr => {
        const week = weeksData[sunStr];
        const weekStart = new Date(sunStr);
        let weekTotal = 0, weekNotesMins = 0, weekNotesMarks = 0, filledDays = 0;

        for (let i = 0; i < 7; i++) {
            const currentDate = new Date(weekStart);
            currentDate.setDate(weekStart.getDate() + i);
            const dateStr = currentDate.toISOString().split('T')[0];
            const isFuture = new Date(dateStr) > today;
            if (isFuture) continue; // skip future days entirely for fair denominator
            const entry = (week && week.days[dateStr]) ? week.days[dateStr] : getNRData(dateStr);
            const isFilled = !!(week && week.days[dateStr]);
            weekTotal += entry.totalScore ?? 0;
            weekNotesMins += (isFilled && entry.notesMinutes !== 'NR') ? (entry.notesMinutes || 0) : 0;
            weekNotesMarks += entry.scores?.notes || 0;
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
        const sunDate = new Date(sunStr);
        const sat = new Date(sunStr); sat.setDate(sunDate.getDate() + 6);
        const fmt = d => `${String(d.getDate()).padStart(2,'0')} ${d.toLocaleString('en-GB',{month:'short'})}`;
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
    const dates = [];
    for (let i = 27; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        dates.push(d.toISOString().split('T')[0]);
    }

    // Firestore v8 'in' limit is 10 — use date range query instead
    const snapshot = await db.collection('users').doc(currentUser.uid)
        .collection('sadhana')
        .where(firebase.firestore.FieldPath.documentId(), '>=', dates[0])
        .where(firebase.firestore.FieldPath.documentId(), '<=', dates[27])
        .get();

    const data = {};
    snapshot.forEach(doc => { data[doc.id] = doc.data(); });

    const labels = dates.map(d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }));
    const scores = dates.map(d => (data[d] !== undefined ? (data[d].totalScore ?? null) : null));

    // Activity-wise total marks (sum across all 28 days)
    _currentActivityTotals = {
        Sleep:           dates.reduce((s, d) => s + (data[d]?.scores?.sleep || 0), 0),
        'Wake-up':       dates.reduce((s, d) => s + (data[d]?.scores?.wakeup || 0), 0),
        'Morning Prog.': dates.reduce((s, d) => s + (data[d]?.scores?.morningProgram || 0), 0),
        Chanting:        dates.reduce((s, d) => s + (data[d]?.scores?.chanting || 0), 0),
        Reading:         dates.reduce((s, d) => s + (data[d]?.scores?.reading || 0), 0),
        Hearing:         dates.reduce((s, d) => s + (data[d]?.scores?.hearing || 0), 0),
        'Notes Rev.':    dates.reduce((s, d) => s + (data[d]?.scores?.notes || 0), 0),
        'Day Sleep':     dates.reduce((s, d) => s + (data[d]?.scores?.daySleep || 0), 0),
    };

    // Ring: based on days with data only (fair)
    const submittedDays = dates.filter(d => data[d]).length;
    const maxPossible = submittedDays * 175;
    const totalEarned = scores.filter(s => s !== null).reduce((a, b) => a + b, 0);
    const fairPercent = maxPossible > 0 ? Math.round((totalEarned / maxPossible) * 100) : 0;

    const ringContainer = document.getElementById('score-ring-container');
    if (ringContainer) ringContainer.style.display = submittedDays > 0 ? 'block' : 'none';
    if (submittedDays > 0) renderScoreRing(fairPercent, `${dates[0].slice(5).replace('-','/')} – ${dates[27].slice(5).replace('-','/')}`, submittedDays, totalEarned);

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
            weekDates.push(d.toISOString().split('T')[0]);
        }

        // Use range query — safe and no 'in' limit issue
        const snapshot = await db.collection('users').doc(currentUser.uid)
            .collection('sadhana')
            .where(firebase.firestore.FieldPath.documentId(), '>=', weekDates[0])
            .where(firebase.firestore.FieldPath.documentId(), '<=', weekDates[6])
            .get();

        let weekTotal = 0, weekDayCount = 0;
        const wData = {};
        snapshot.forEach(doc => { wData[doc.id] = doc.data(); weekTotal += doc.data().totalScore || 0; weekDayCount++; });

        labels.push(`Wk ${weekStart.getDate()}/${weekStart.getMonth() + 1}`);
        scores.push(weekDayCount > 0 ? weekTotal : null);

        if (wi === weeks.length - 1) {
            latestWeekTotal = weekTotal;
            latestWeekDays = weekDayCount;
            weekDates.forEach(d => {
                if (wData[d]) {
                    _currentActivityTotals['Sleep']          += wData[d]?.scores?.sleep || 0;
                    _currentActivityTotals['Wake-up']        += wData[d]?.scores?.wakeup || 0;
                    _currentActivityTotals['Morning Prog.']  += wData[d]?.scores?.morningProgram || 0;
                    _currentActivityTotals['Chanting']       += wData[d]?.scores?.chanting || 0;
                    _currentActivityTotals['Reading']        += wData[d]?.scores?.reading || 0;
                    _currentActivityTotals['Hearing']        += wData[d]?.scores?.hearing || 0;
                    _currentActivityTotals['Notes Rev.']     += wData[d]?.scores?.notes || 0;
                    _currentActivityTotals['Day Sleep']      += wData[d]?.scores?.daySleep || 0;
                }
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
            .where(firebase.firestore.FieldPath.documentId(), '>=', startDate.toISOString().split('T')[0])
            .where(firebase.firestore.FieldPath.documentId(), '<=', endDate.toISOString().split('T')[0])
            .get();

        let monthTotal = 0, monthDays = 0;
        snapshot.forEach(doc => { monthTotal += doc.data().totalScore || 0; monthDays++; });
        labels.push(month.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }));
        scores.push(monthDays > 0 ? monthTotal : null);
    }

    document.getElementById('score-ring-container').style.display = 'none';
    renderScoreLineChart(labels, scores, 'line');
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
                    beginAtZero: false,
                    grid: { color: 'rgba(0,0,0,0.06)' }
                },
                x: { grid: { display: false } }
            }
        }
    });
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
// --- TAPAH MODULE ---
// ══════════════════════════════════════════════

const ANUKUL_QUESTIONS = [
    { id: 'channelWork',    label: 'Did I work on Channel work?',                    target: '30 min'  },
    { id: 'lectureSewa',    label: 'Did I do Lecture Preparation & Lecture Sewa?',   target: '40 min'  },
    { id: 'shlokRecite',    label: 'Did I do One Shlok Recitation with meaning?',    target: '20 min'  },
    { id: 'healthChart',    label: 'Did I work on Health Chart?',                    target: '20 min'  },
    { id: 'dataValidation', label: 'Did I work on Data Validation Preaching?',       target: '30 min'  },
];

const PRATIKUL_QUESTIONS = [
    { id: 'personalProgram',  label: 'Did I do Personal Program?',                   note: 'Positive if done'   },
    { id: 'socialMedia',      label: 'Did I spend time on Social Media & Videos?',   note: 'Negative activity'  },
    { id: 'outsideFood',      label: 'Did I eat Outside Food?',                      note: 'Negative activity'  },
    { id: 'withoutBhoga',     label: 'Did I eat Without Bhoga Food?',                note: 'Negative activity'  },
    { id: 'withoutMantra',    label: 'Did I eat food without Mantra?',               note: 'Negative activity'  },
];

// Scoring rules
// Anukul:   Yes=5, Partial=2, No=0
// Pratikul: Yes=-5, Partial=2, No=5  (No = didn't do bad thing = good)
function getAanukulScore(val) { return val === 'yes' ? 5 : val === 'partial' ? 2 : 0; }
function getPratikulScore(val) { return val === 'yes' ? -5 : val === 'partial' ? 2 : 5; }

let tapahEditingDate = null;

// Render Yes/Partial/No toggle cards for a question list
function renderTapahQuestions(containerId, questions, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    questions.forEach((q, idx) => {
        const isAnukul = type === 'anukul';
        const div = document.createElement('div');
        div.style.cssText = 'margin-bottom:14px;padding:14px;background:#fafafa;border-radius:10px;border:1px solid #eee;';
        div.innerHTML = `
            <div style="margin-bottom:10px;">
                <span style="font-weight:600;font-size:14px;color:#2c3e50;">${idx + 1}. ${q.label}</span>
                ${q.target ? `<span style="font-size:11px;color:#888;margin-left:6px;">⏱ ${q.target}</span>` : ''}
                ${q.note   ? `<span style="font-size:11px;color:#aaa;margin-left:6px;">(${q.note})</span>` : ''}
            </div>
            <div style="display:flex;gap:8px;" data-qid="${q.id}" data-type="${type}">
                <button type="button"
                    onclick="selectTapahOption(this, '${q.id}', 'yes', '${type}')"
                    data-val="yes"
                    style="flex:1;padding:9px 4px;border-radius:8px;border:2px solid #ddd;background:#f8f9fa;color:#555;font-weight:600;width:auto;margin:0;font-size:13px;cursor:pointer;transition:all 0.15s;">
                    ✅ Yes
                </button>
                <button type="button"
                    onclick="selectTapahOption(this, '${q.id}', 'partial', '${type}')"
                    data-val="partial"
                    style="flex:1;padding:9px 4px;border-radius:8px;border:2px solid #ddd;background:#f8f9fa;color:#555;font-weight:600;width:auto;margin:0;font-size:13px;cursor:pointer;transition:all 0.15s;">
                    🔶 Partial
                </button>
                <button type="button"
                    onclick="selectTapahOption(this, '${q.id}', 'no', '${type}')"
                    data-val="no"
                    style="flex:1;padding:9px 4px;border-radius:8px;border:2px solid #ddd;background:#f8f9fa;color:#555;font-weight:600;width:auto;margin:0;font-size:13px;cursor:pointer;transition:all 0.15s;">
                    ❌ No
                </button>
            </div>
            <div id="tapah-score-preview-${q.id}" style="text-align:right;font-size:12px;color:#aaa;margin-top:5px;">Not answered</div>
        `;
        container.appendChild(div);
    });
}

// Better: track answers in a plain object
let _tapahAnswers = {};

window.selectTapahOption = (btn, qid, val, type) => {
    const group = btn.closest('[data-qid]');
    group.querySelectorAll('button').forEach(b => {
        b.style.border = '2px solid #ddd';
        b.style.background = '#f8f9fa';
        b.style.color = '#555';
    });
    const isAnukul = type === 'anukul';
    let color, bg;
    if (val === 'yes')     { color = isAnukul ? '#27ae60' : '#e74c3c'; bg = isAnukul ? '#e8f8f0' : '#fde8e8'; }
    if (val === 'partial') { color = '#f39c12'; bg = '#fff8e8'; }
    if (val === 'no')      { color = isAnukul ? '#e74c3c' : '#27ae60'; bg = isAnukul ? '#fde8e8' : '#e8f8f0'; }
    btn.style.border = `2px solid ${color}`;
    btn.style.background = bg;
    btn.style.color = color;

    _tapahAnswers[qid] = { val, type };

    const score = isAnukul ? getAanukulScore(val) : getPratikulScore(val);
    const preview = document.getElementById(`tapah-score-preview-${qid}`);
    if (preview) {
        preview.textContent = `Score: ${score >= 0 ? '+' : ''}${score}`;
        preview.style.color = score > 0 ? '#27ae60' : score < 0 ? '#e74c3c' : '#888';
    }

    updateTapahTotals();
};

function updateTapahTotals() {
    let anukulTotal = 0, pratikulTotal = 0;
    ANUKUL_QUESTIONS.forEach(q => {
        const ans = _tapahAnswers[q.id];
        if (ans) anukulTotal += getAanukulScore(ans.val);
    });
    PRATIKUL_QUESTIONS.forEach(q => {
        const ans = _tapahAnswers[q.id];
        if (ans) pratikulTotal += getPratikulScore(ans.val);
    });
    const total = anukulTotal + pratikulTotal;
    const percent = Math.round((total / 50) * 100);

    const ad = document.getElementById('anukul-score-display');
    const pd = document.getElementById('pratikul-score-display');
    const td = document.getElementById('tapah-total-display');
    const pp = document.getElementById('tapah-percent-display');

    if (ad) { ad.textContent = `${anukulTotal} / 25`; ad.style.color = anukulTotal >= 15 ? '#27ae60' : anukulTotal >= 8 ? '#f39c12' : '#e74c3c'; }
    if (pd) { pd.textContent = `${pratikulTotal} / 25`; pd.style.color = pratikulTotal >= 15 ? '#27ae60' : pratikulTotal >= 5 ? '#f39c12' : '#e74c3c'; }
    if (td) { td.textContent = `${total} / 50`; td.style.color = total >= 35 ? '#27ae60' : total >= 20 ? '#f39c12' : '#e74c3c'; }
    if (pp) { pp.textContent = `${percent}%`; }
}

function setupTapahDateSelect() {
    const s = document.getElementById('tapah-date');
    if (!s) return;
    s.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().split('T')[0];
        const opt = document.createElement('option');
        opt.value = iso;
        opt.textContent = i === 0 ? `Today (${iso})` : i === 1 ? `Yesterday (${iso})` : iso;
        s.appendChild(opt);
    }
}

function resetTapahForm() {
    _tapahAnswers = {};
    renderTapahQuestions('anukul-questions', ANUKUL_QUESTIONS, 'anukul');
    renderTapahQuestions('pratikul-questions', PRATIKUL_QUESTIONS, 'pratikul');
    updateTapahTotals();
    setupTapahDateSelect();
    const sel = document.getElementById('tapah-date');
    if (sel) sel.disabled = false;
    const btn = document.getElementById('tapah-submit-btn');
    if (btn) btn.textContent = '🔥 Submit Tapah';
    const banner = document.getElementById('tapah-edit-banner');
    if (banner) banner.style.display = 'none';
    tapahEditingDate = null;
}

window.cancelTapahEdit = () => resetTapahForm();

// Restore button states from saved answers
function restoreTapahButtons(anukulAnswers, pratikulAnswers) {
    const restore = (questions, answersObj, type) => {
        questions.forEach(q => {
            const val = answersObj[q.id];
            if (!val || val === 'nr') return;
            const group = document.querySelector(`[data-qid="${q.id}"]`);
            if (!group) return;
            const btn = [...group.querySelectorAll('button')].find(b => b.dataset.val === val);
            if (btn) window.selectTapahOption(btn, q.id, val, type);
        });
    };
    restore(ANUKUL_QUESTIONS, anukulAnswers, 'anukul');
    restore(PRATIKUL_QUESTIONS, pratikulAnswers, 'pratikul');
}

// Edit a past Tapah entry
window.editTapahEntry = async (dateStr) => {
    // Switch to tapah tab
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

    // Lock date
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
    document.getElementById('tapah-submit-btn').textContent = '💾 Update Tapah';
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// Tapah form submit
const tapahForm = document.getElementById('tapah-form');
if (tapahForm) {
    tapahForm.onsubmit = async (e) => {
        e.preventDefault();
        if (!currentUser) { alert('Please login first'); return; }

        const date = document.getElementById('tapah-date').value;

        // Validate all answered
        const allQids = [...ANUKUL_QUESTIONS, ...PRATIKUL_QUESTIONS].map(q => q.id);
        const unanswered = allQids.filter(id => !_tapahAnswers[id]);
        if (unanswered.length > 0) {
            alert(`Please answer all questions before submitting. (${unanswered.length} unanswered)`);
            return;
        }

        // Build scores
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
            console.log('Tapah submit — uid:', currentUser.uid, 'date:', date);
            console.log('Writing to path: users/' + currentUser.uid + '/tapah/' + date);
            await db.collection('users').doc(currentUser.uid).collection('tapah').doc(date).set({
                anukul: anukulAnswers,
                pratikul: pratikulAnswers,
                anukulScores,
                pratikulScores,
                anukulTotal,
                pratikulTotal,
                totalScore: total,
                percent,
                submittedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            const isEdit = tapahEditingDate !== null;
            alert(`${isEdit ? 'Updated' : 'Saved'}! Tapah Score: ${total}/50 (${percent}%)`);
            resetTapahForm();
        } catch (err) {
            console.error('TAPAH ERROR FULL:', err);
            console.error('Error code:', err.code);
            console.error('Error message:', err.message);
            alert('Error saving Tapah: ' + err.message + '\n\nCode: ' + err.code + '\n\nPath: users/' + currentUser?.uid + '/tapah/' + date);
        }
    };
}

// ── END TAPAH MODULE ──

// ══════════════════════════════════════════════
// --- REPORT SWITCHER ---
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

    const snap = await db.collection('users').doc(currentUser.uid).collection('tapah').get();
    const allData = {};
    snap.forEach(doc => { allData[doc.id] = doc.data(); });
    window._tapahAllData = allData;
    renderTapahReport(allData);
}

function renderTapahReport(allData) {
    const container = document.getElementById('tapah-report-container');
    if (!container) return;

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Get current week Sunday
    const thisWeekSun = new Date(today);
    thisWeekSun.setDate(today.getDate() - today.getDay());
    const thisWeekSunStr = thisWeekSun.toISOString().split('T')[0];

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
        const ds = d.toISOString().split('T')[0];
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
        const sunStr = sun.toISOString().split('T')[0];
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
    const scoreLabel = (val, section) => {
        if (!val || val === 'nr') return '–';
        const s = section === 'anukul' ? getAanukulScore(val) : getPratikulScore(val);
        return (s >= 0 ? '+' : '') + s;
    };

    // Format date label: "01 Mar"
    const fmtDate = (ds) => {
        const d = new Date(ds + 'T00:00:00');
        return `${String(d.getDate()).padStart(2,'0')} ${d.toLocaleString('en-GB',{month:'short'})}`;
    };
    const fmtMonth = (ym) => {
        const [y, m] = ym.split('-');
        return new Date(y, m-1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
    };
    const fmtWeek = (sunStr) => {
        const sun = new Date(sunStr + 'T00:00:00');
        const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
        return `${fmtDate(sunStr)} – ${fmtDate(sat.toISOString().split('T')[0])}`;
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

    // Auto-expand current week always
    const currentWeekDates = (weekMap[thisWeekSunStr] || []).filter(d => d <= todayStr);

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
        const iso = d.toISOString().split('T')[0];
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
        const data = { name: document.getElementById('profile-name').value.trim(), role: userProfile?.role || 'user' };
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
            let errorMsg = 'Login failed: ';
            switch (err.code) {
                case 'auth/invalid-email': errorMsg += 'Invalid email address'; break;
                case 'auth/user-disabled': errorMsg += 'This account has been disabled'; break;
                case 'auth/user-not-found': errorMsg += 'No account found with this email'; break;
                case 'auth/wrong-password': errorMsg += 'Incorrect password'; break;
                case 'auth/invalid-credential': errorMsg += 'Invalid email or password'; break;
                default: errorMsg += err.message;
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
    showSection('profile');
};

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
