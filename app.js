

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
        id: date, totalScore: -35, dayPercent: -22,
        sleepTime: "NR", wakeupTime: "NR", chantingTime: "NR",
        readingMinutes: 0, hearingMinutes: 0, serviceMinutes: 0, notesMinutes: 0, daySleepMinutes: 0,
        scores: { sleep: -5, wakeup: -5, chanting: -5, reading: -5, hearing: -5, service: -5, notes: -5, daySleep: 0 }
    };
}

// --- 3. DOWNLOAD LOGIC ---
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

        // Organize data by weeks
        const weeksData = {};
        snap.forEach(doc => {
            const weekInfo = getWeekInfo(doc.id);
            if (!weeksData[weekInfo.sunStr]) {
                weeksData[weekInfo.sunStr] = { 
                    label: weekInfo.label, 
                    sunStr: weekInfo.sunStr,
                    days: {} 
                };
            }
            weeksData[weekInfo.sunStr].days[doc.id] = doc.data();
        });

        // Sort weeks by Sunday date (latest first)
        const sortedWeeks = Object.keys(weeksData).sort((a, b) => b.localeCompare(a));

        const dataArray = [];

        sortedWeeks.forEach((sunStr, weekIndex) => {
            const week = weeksData[sunStr];

            // Week Header Row (merged)
            dataArray.push([`WEEK: ${week.label}`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);

            // Column Headers
            dataArray.push([
                'Date', 'Bed', 'M', 'Wake', 'M', 'Chant', 'M', 
                'Read(m)', 'M', 'Hear(m)', 'M', 'Seva(m)', 'M', 
                'Notes(m)', 'M', 'Day Sleep(m)', 'M', 'Total', '%'
            ]);

            // Daily rows (Sun to Sat)
            let weekTotals = {
                sleepM: 0, wakeupM: 0, chantingM: 0,
                readingM: 0, hearingM: 0, serviceM: 0, notesM: 0, daySleepM: 0,
                readingMins: 0, hearingMins: 0, serviceMins: 0, notesMins: 0, daySleepMins: 0,
                total: 0
            };

            const weekStart = new Date(week.sunStr);
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

            for (let i = 0; i < 7; i++) {
                const currentDate = new Date(weekStart);
                currentDate.setDate(currentDate.getDate() + i);
                const dateStr = currentDate.toISOString().split('T')[0];
                const dayNum = currentDate.getDate();
                const dayLabel = `${dayNames[i]} ${String(dayNum).padStart(2, '0')}`;

                const entry = week.days[dateStr] || getNRData(dateStr);

                // Add to weekly totals
                weekTotals.sleepM += entry.scores?.sleep ?? 0;
                weekTotals.wakeupM += entry.scores?.wakeup ?? 0;
                weekTotals.chantingM += entry.scores?.chanting ?? 0;
                weekTotals.readingM += entry.scores?.reading ?? 0;
                weekTotals.hearingM += entry.scores?.hearing ?? 0;
                weekTotals.serviceM += entry.scores?.service ?? 0;
                weekTotals.notesM += entry.scores?.notes ?? 0;
                weekTotals.daySleepM += entry.scores?.daySleep ?? 0;
                weekTotals.readingMins += entry.readingMinutes || 0;
                weekTotals.hearingMins += entry.hearingMinutes || 0;
                weekTotals.serviceMins += entry.serviceMinutes || 0;
                weekTotals.notesMins += entry.notesMinutes || 0;
                weekTotals.daySleepMins += entry.daySleepMinutes || 0;
                weekTotals.total += entry.totalScore ?? 0;

                dataArray.push([
                    dayLabel,
                    entry.sleepTime || 'NR',
                    entry.scores?.sleep ?? 0,
                    entry.wakeupTime || 'NR',
                    entry.scores?.wakeup ?? 0,
                    entry.chantingTime || 'NR',
                    entry.scores?.chanting ?? 0,
                    entry.readingMinutes || 0,
                    entry.scores?.reading ?? 0,
                    entry.hearingMinutes || 0,
                    entry.scores?.hearing ?? 0,
                    entry.serviceMinutes || 0,
                    entry.scores?.service ?? 0,
                    entry.notesMinutes || 0,
                    entry.scores?.notes ?? 0,
                    entry.daySleepMinutes || 0,
                    entry.scores?.daySleep ?? 0,
                    entry.totalScore ?? 0,
                    (entry.dayPercent ?? 0) + '%'
                ]);
            }

            // Weekly Total Row
            const weekPercent = Math.round((weekTotals.total / 1120) * 100);
            dataArray.push([
                'WEEKLY TOTAL',
                '',
                weekTotals.sleepM,
                '',
                weekTotals.wakeupM,
                '',
                weekTotals.chantingM,
                weekTotals.readingMins,
                weekTotals.readingM,
                weekTotals.hearingMins,
                weekTotals.hearingM,
                weekTotals.serviceMins,
                weekTotals.serviceM,
                weekTotals.notesMins,
                weekTotals.notesM,
                weekTotals.daySleepMins,
                weekTotals.daySleepM,
                weekTotals.total,
                weekPercent + '%'
            ]);

            // Weekly Percentage Summary Row
            dataArray.push([
                `WEEKLY PERCENTAGE: ${weekTotals.total} / 1120 = ${weekPercent}%`,
                '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''
            ]);

            // Blank rows between weeks
            if (weekIndex < sortedWeeks.length - 1) {
                dataArray.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
                dataArray.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
            }
        });

        const worksheet = XLSX.utils.aoa_to_sheet(dataArray);

        // Apply styling and merges
        const merges = [];
        let currentRow = 0;

        sortedWeeks.forEach((weekLabel, weekIndex) => {
            // Merge week header (row 0 = week header spanning all columns)
            merges.push({
                s: { r: currentRow, c: 0 },
                e: { r: currentRow, c: 18 }
            });

            // Merge weekly percentage row
            merges.push({
                s: { r: currentRow + 9, c: 0 },
                e: { r: currentRow + 9, c: 18 }
            });

            currentRow += 12; // 1 header + 1 column header + 7 days + 1 total + 1 summary + 2 blank
        });

        worksheet['!merges'] = merges;

        // Set column widths
        worksheet['!cols'] = [
            {wch: 10}, {wch: 8}, {wch: 4}, {wch: 8}, {wch: 4}, {wch: 8}, {wch: 4},
            {wch: 10}, {wch: 4}, {wch: 10}, {wch: 4}, {wch: 10}, {wch: 4},
            {wch: 10}, {wch: 4}, {wch: 12}, {wch: 4}, {wch: 8}, {wch: 6}
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Sadhana_Weekly");

        const fileName = `${userName.replace(/\s+/g, '_')}_Sadhana_Weekly.xlsx`;
        XLSX.writeFile(workbook, fileName);

    } catch (error) {
        console.error("Download Error:", error);
        alert("Download Failed! Technical Error: " + error.message);
    }
};

window.downloadMasterReport = async () => {
    try {
        const usersSnap = await db.collection('users').get();

        // Get all unique weeks from all users
        const allWeeksSet = new Set();
        const userData = [];

        for (const uDoc of usersSnap.docs) {
            const u = uDoc.data();
            const sSnap = await uDoc.ref.collection('sadhana').get();
            const sEntries = sSnap.docs.map(d => ({ date: d.id, score: d.data().totalScore || 0 }));

            // Find all weeks for this user
            sEntries.forEach(entry => {
                const week = getWeekInfo(entry.date);
                allWeeksSet.add(week.label);
            });

            userData.push({ user: u, entries: sEntries });
        }

        // Convert to array and sort (latest first)
        const allWeeks = Array.from(allWeeksSet).sort((a, b) => b.localeCompare(a));

        const rows = [["User Name", "Position Level", "Chanting Category", ...allWeeks.map(w => w + " (%)")]];

        // Calculate weekly percentages for each user
        userData.forEach(({ user, entries }) => {
            const userRow = [user.name, user.level || 'Senior Batch', user.chantingCategory || 'Level-1'];
            const weeklyMax = 1120;

            allWeeks.forEach(weekLabel => {
                // Find the Sunday of this week
                const weekParts = weekLabel.split('_');
                const year = weekParts[1];
                const dateParts = weekLabel.split(' to ')[0].split(' ');
                const day = parseInt(dateParts[0]);
                const monthStr = dateParts[1];

                // Create date from week label
                const monthMap = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
                const weekStart = new Date(parseInt(year), monthMap[monthStr], day);

                let weekTotal = 0;
                for (let i = 0; i < 7; i++) {
                    const curr = new Date(weekStart);
                    curr.setDate(curr.getDate() + i);
                    const ds = curr.toISOString().split('T')[0];
                    const entry = entries.find(e => e.date === ds);
                    weekTotal += entry ? entry.score : -35;
                }

                userRow.push(Math.round((weekTotal / weeklyMax) * 100) + "%");
            });

            rows.push(userRow);
        });

        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Master_Report");
        XLSX.writeFile(wb, "Master_Sadhana_Report.xlsx");
    } catch (e) { 
        console.error("Master Download Error:", e);
        alert("Master Download Failed: " + e.message); 
    }
};

// --- 4. AUTH & NAVIGATION ---
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        const doc = await db.collection('users').doc(user.uid).get();
        if (doc.exists) {
            userProfile = doc.data();
            document.getElementById('user-display-name').textContent = `${userProfile.name} (${userProfile.level || 'Senior Batch'})`;
            if (userProfile.role === 'admin') document.getElementById('admin-tab-btn').classList.remove('hidden');
            showSection('dashboard'); switchTab('sadhana'); setupDateSelect();
        } else showSection('profile');
    } else showSection('auth');
});

window.switchTab = (t) => {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(t + '-tab').classList.remove('hidden');
    const btn = document.querySelector(`button[onclick*="switchTab('${t}')"]`);
    if (btn) btn.classList.add('active');
    if (t === 'reports') loadReports(currentUser.uid, 'weekly-reports-container');
    if (t === 'admin' && userProfile?.role === 'admin') loadAdminPanel();
};

function showSection(sec) {
    ['auth-section', 'profile-section', 'dashboard-section'].forEach(s => document.getElementById(s).classList.add('hidden'));
    document.getElementById(sec + '-section').classList.remove('hidden');
}

// --- 5. REPORTS ---
function loadReports(userId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (activeListener) activeListener();
    activeListener = db.collection('users').doc(userId).collection('sadhana').onSnapshot(snap => {
        const weeks = {};

        // Get exactly 4 weeks from today
        const weeksList = [];
        for (let weekNum = 0; weekNum < 4; weekNum++) {
            const d = new Date();
            d.setDate(d.getDate() - (weekNum * 7)); // Go back by weeks
            const weekInfo = getWeekInfo(d.toISOString().split('T')[0]);
            weeksList.push(weekInfo);
        }

        // Initialize weeks
        weeksList.forEach(w => {
            weeks[w.label] = { range: w.label, sunStr: w.sunStr, data: [], total: 0 };
        });

        // Process existing sadhana data
        snap.forEach(doc => {
            const data = doc.data();
            const week = getWeekInfo(doc.id);

            // Only include if this week is in our 4 weeks list
            if (weeks[week.label]) {
                weeks[week.label].data.push({ id: doc.id, ...data });
                weeks[week.label].total += data.totalScore || 0;
            }
        });

        // Add NR for missing dates in these 4 weeks only
        weeksList.forEach(weekInfo => {
            const week = weeks[weekInfo.label];
            let curr = new Date(weekInfo.sunStr);

            for (let i = 0; i < 7; i++) {
                const dateStr = curr.toISOString().split('T')[0];
                const exists = week.data.find(e => e.id === dateStr);

                if (!exists) {
                    const nrData = getNRData(dateStr);
                    week.data.push(nrData);
                    week.total += nrData.totalScore;
                }

                curr.setDate(curr.getDate() + 1);
            }
        });

        container.innerHTML = '';

        // Display weeks in order - current week (Week 0) first, then Week 1, 2, 3
        // weeksList is already in correct order (0, 1, 2, 3)
        weeksList.forEach(weekInfo => {
            const week = weeks[weekInfo.label];
            const div = document.createElement('div');
            div.className = 'week-card';
            div.innerHTML = `<div class="week-header" onclick="this.nextElementSibling.classList.toggle('hidden')"><span>📅 ${week.range}</span><strong>Score: ${week.total} ▼</strong></div>
                <div class="week-content hidden" style="overflow-x:auto;"><table class="admin-table">
                <thead><tr><th>Date</th><th>Bed</th><th>M</th><th>Wake</th><th>M</th><th>Chant</th><th>M</th><th>Read</th><th>M</th><th>Hear</th><th>M</th><th>Seva</th><th>M</th><th>Notes</th><th>M</th><th>Day Sleep</th><th>M</th><th>Total</th><th>%</th></tr></thead>
                <tbody>${week.data.sort((a,b) => b.id.localeCompare(a.id)).map(e => {
                    const rowStyle = e.sleepTime === 'NR' ? 'style="background:#fff5f5; color:red;"' : '';
                    const getColorStyle = (val) => val < 0 ? 'style="color:red; font-weight:bold;"' : '';
                    return `<tr ${rowStyle}><td>${e.id.split('-').slice(1).join('/')}</td>
                        <td>${e.sleepTime}</td><td ${getColorStyle(e.scores?.sleep ?? 0)}>${e.scores?.sleep ?? 0}</td>
                        <td>${e.wakeupTime}</td><td ${getColorStyle(e.scores?.wakeup ?? 0)}>${e.scores?.wakeup ?? 0}</td>
                        <td>${e.chantingTime}</td><td ${getColorStyle(e.scores?.chanting ?? 0)}>${e.scores?.chanting ?? 0}</td>
                        <td>${e.readingMinutes || 0}m</td><td ${getColorStyle(e.scores?.reading ?? 0)}>${e.scores?.reading ?? 0}</td>
                        <td>${e.hearingMinutes || 0}m</td><td ${getColorStyle(e.scores?.hearing ?? 0)}>${e.scores?.hearing ?? 0}</td>
                        <td>${e.serviceMinutes || 0}m</td><td ${getColorStyle(e.scores?.service ?? 0)}>${e.scores?.service ?? 0}</td>
                        <td>${e.notesMinutes || 0}m</td><td ${getColorStyle(e.scores?.notes ?? 0)}>${e.scores?.notes ?? 0}</td>
                        <td>${e.daySleepMinutes || 0}m</td><td ${getColorStyle(e.scores?.daySleep ?? 0)}>${e.scores?.daySleep ?? 0}</td>
                        <td ${getColorStyle(e.totalScore ?? 0)}>${e.totalScore ?? 0}</td><td>${e.dayPercent ?? 0}%</td></tr>`;
                }).join('')}</tbody></table></div>`;
            container.appendChild(div);
        });
    });
}

// --- 6. SCORING & FORM ---
document.getElementById('sadhana-form').onsubmit = async (e) => {
    e.preventDefault();
    const date = document.getElementById('sadhana-date').value;
    const level = userProfile.level || "Senior Batch";
    const slp = document.getElementById('sleep-time').value;
    const wak = document.getElementById('wakeup-time').value;
    const chn = document.getElementById('chanting-time').value;
    const rMin = parseInt(document.getElementById('reading-mins').value) || 0;
    const hMin = parseInt(document.getElementById('hearing-mins').value) || 0;
    const sMin = parseInt(document.getElementById('service-mins')?.value) || 0;
    const nMin = parseInt(document.getElementById('notes-mins')?.value) || 0;
    const dsMin = parseInt(document.getElementById('day-sleep-minutes').value) || 0;

    const sc = { sleep: -5, wakeup: -5, chanting: -5, reading: -5, hearing: -5, service: -5, notes: -5, daySleep: 0 };

    // Sleep Score (Target 10:30 PM / 1350 mins)
    const slpM = t2m(slp, true);
    if (slpM <= 1350) sc.sleep = 25;
    else if (slpM <= 1355) sc.sleep = 20;
    else if (slpM <= 1360) sc.sleep = 15;
    else if (slpM <= 1365) sc.sleep = 10;
    else if (slpM <= 1370) sc.sleep = 5;
    else if (slpM <= 1375) sc.sleep = 0;
    else sc.sleep = -5;

    // Wakeup Score (Target 5:05 AM / 305 mins)
    const wakM = t2m(wak, false);
    if (wakM <= 305) sc.wakeup = 25;
    else if (wakM <= 310) sc.wakeup = 20;
    else if (wakM <= 315) sc.wakeup = 15;
    else if (wakM <= 320) sc.wakeup = 10;
    else if (wakM <= 325) sc.wakeup = 5;
    else if (wakM <= 330) sc.wakeup = 0;
    else sc.wakeup = -5;

    // Chanting Score (Fixed slots)
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

    // Reading & Hearing Patterns
    const getActScore = (m, threshold) => {
        if (m >= threshold) return 25;
        if (m >= threshold - 10) return 20;
        if (m >= 20) return 15;
        if (m >= 15) return 10;
        if (m >= 10) return 5;
        if (m >= 5) return 0;
        return -5;
    };

    const isSeniorBatch = level === "Senior Batch";
    const thresh = isSeniorBatch ? 40 : 30;
    sc.reading = getActScore(rMin, thresh);
    sc.hearing = getActScore(hMin, thresh);

    let total = sc.sleep + sc.wakeup + sc.chanting + sc.reading + sc.hearing + sc.daySleep;

    // Level Specific Service & Notes
    if (isSeniorBatch) {
        // Service (Max 10)
        if (sMin >= 15) sc.service = 10;
        else if (sMin >= 10) sc.service = 5;
        else if (sMin >= 5) sc.service = 0;
        else sc.service = -5;

        // Notes (Max 15)
        if (nMin >= 20) sc.notes = 15;
        else if (nMin >= 15) sc.notes = 10;
        else if (nMin >= 10) sc.notes = 5;
        else if (nMin >= 5) sc.notes = 0;
        else sc.notes = -5;

        total += (sc.service + sc.notes);
    } else {
        // Coordinator Service (Max 25)
        sc.service = getActScore(sMin, 30);
        total += sc.service;
        sc.notes = 0; // Coordinators don't have notes
    }

    const dayPercent = Math.round((total / 160) * 100);

    await db.collection('users').doc(currentUser.uid).collection('sadhana').doc(date).set({
        sleepTime: slp, wakeupTime: wak, chantingTime: chn, 
        readingMinutes: rMin, hearingMinutes: hMin, 
        serviceMinutes: sMin, notesMinutes: nMin, 
        daySleepMinutes: dsMin,
        scores: sc, totalScore: total, dayPercent: dayPercent, 
        levelAtSubmission: level, 
        submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    alert(`Success! Score: ${total} (${dayPercent}%)`); 
    switchTab('reports');
};

// --- 7. ADMIN PANEL ---
async function loadAdminPanel() {
    const tableContainer = document.getElementById('admin-comparative-reports-container');
    const usersList = document.getElementById('admin-users-list');
    const weeks = [];
    for (let i = 0; i < 4; i++) {
        const d = new Date(); d.setDate(d.getDate() - (i * 7));
        weeks.push(getWeekInfo(d.toISOString().split('T')[0]));
    }
    weeks.reverse();
    const usersSnap = await db.collection('users').get();
    let html = `<table class="admin-table"><thead><tr><th>User</th><th>Position</th><th>Chanting Cat</th>${weeks.map(w => `<th>${w.label} (%)</th>`).join('')}</tr></thead><tbody>`;
    usersList.innerHTML = '';

    for (const uDoc of usersSnap.docs) {
        const u = uDoc.data();
        html += `<tr><td>${u.name}</td><td>${u.level || 'Senior Batch'}</td><td>${u.chantingCategory || 'N/A'}</td>`;
        const sSnap = await uDoc.ref.collection('sadhana').get();
        const sEntries = sSnap.docs.map(d => ({ date: d.id, score: d.data().totalScore || 0 }));
        const weeklyMax = 1120;

        weeks.forEach(w => {
            let weekTotal = 0; let curr = new Date(w.sunStr);
            for (let i = 0; i < 7; i++) {
                const ds = curr.toISOString().split('T')[0];
                const entry = sEntries.find(e => e.date === ds);
                weekTotal += entry ? entry.score : -35;
                curr.setDate(curr.getDate() + 1);
            }
            html += `<td>${Math.round((weekTotal/weeklyMax)*100)}%</td>`;
        });
        html += `</tr>`;

        const uDiv = document.createElement('div');
        uDiv.className = 'card'; 
        uDiv.style = "margin-bottom:10px; padding:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;";
        uDiv.innerHTML = `<div><strong>${u.name}</strong><br><small>${u.level || 'Senior Batch'} | ${u.role || 'user'}</small></div>
            <div style="display:flex; gap:5px;">
                <button onclick="openUserModal('${uDoc.id}', '${u.name}')" style="width:auto; padding:5px 10px; font-size:12px;">History</button>
                <button onclick="downloadUserExcel('${uDoc.id}', '${u.name}')" style="width:auto; padding:5px 10px; font-size:12px; background:green;">Excel</button>
                <button onclick="handleAdminChange('${uDoc.id}', '${u.role === 'admin' ? 'user' : 'admin'}')" style="width:auto; padding:5px 10px; font-size:12px; background:orange;">${u.role === 'admin' ? 'Revoke Admin' : 'Make Admin'}</button>
            </div>`;
        usersList.appendChild(uDiv);
    }
    tableContainer.innerHTML = html + `</tbody></table>`;
}

window.handleAdminChange = async (uid, newRole) => {
    if (confirm(`Change user to ${newRole}?`)) {
        if (confirm("Final confirmation?")) {
            await db.collection('users').doc(uid).update({ role: newRole });
            alert("Updated!"); loadAdminPanel();
        }
    }
};

function setupDateSelect() {
    const s = document.getElementById('sadhana-date'); 
    if (!s) return; 
    s.innerHTML = '';

    for (let i = 0; i < 2; i++) {
        const d = new Date(); 
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().split('T')[0];
        const opt = document.createElement('option'); 
        opt.value = iso; 
        opt.textContent = iso;
        s.appendChild(opt);
    }

    // Show/hide Notes field based on position
    const notesArea = document.getElementById('notes-area');
    if (notesArea && userProfile?.level === 'Senior Batch') {
        notesArea.classList.remove('hidden');
    } else if (notesArea) {
        notesArea.classList.add('hidden');
    }
}

document.getElementById('profile-form').onsubmit = async (e) => {
    e.preventDefault();
    const data = { 
        name: document.getElementById('profile-name').value, 
        level: document.getElementById('profile-level').value,
        chantingCategory: document.getElementById('profile-chanting').value, 
        exactRounds: document.getElementById('profile-exact-rounds').value, 
        role: userProfile?.role || 'user' 
    };
    await db.collection('users').doc(currentUser.uid).set(data, { merge: true });
    alert("Profile Saved!"); 
    location.reload();
};

document.getElementById('login-form').onsubmit = (e) => { 
    e.preventDefault(); 
    auth.signInWithEmailAndPassword(
        document.getElementById('login-email').value, 
        document.getElementById('login-password').value
    ).catch(err => alert(err.message)); 
};

document.getElementById('logout-btn').onclick = () => auth.signOut();

window.openUserModal = (id, name) => { 
    document.getElementById('user-report-modal').classList.remove('hidden'); 
    document.getElementById('modal-user-name').textContent = name; 
    loadReports(id, 'modal-report-container'); 
};

window.closeUserModal = () => document.getElementById('user-report-modal').classList.add('hidden');

window.openProfileEdit = () => { 
    document.getElementById('profile-name').value = userProfile.name; 
    document.getElementById('profile-level').value = userProfile.level || 'Senior Batch';
    document.getElementById('profile-chanting').value = userProfile.chantingCategory; 
    document.getElementById('profile-exact-rounds').value = userProfile.exactRounds; 
    document.getElementById('cancel-edit').classList.remove('hidden'); 
    showSection('profile'); 
};