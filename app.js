// --- 1. FIREBASE SETUP ---
const firebaseConfig = {
    apiKey: "AIzaSyCZdmZJckSWJo1tFT14NVKVurUGsoKrRy8",
    authDomain: "rapd--sadhana-tracker.firebaseapp.com",
    projectId: "rapd--sadhana-tracker",
    storageBucket: "rapd--sadhana-tracker.firebasestorage.app",
    messagingSenderId: "811405448950",
    appId: "1:811405448950:web:8b711f3129e4bdf06dbed7"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth(), db = firebase.firestore();
let currentUser = null, userProfile = null, activeListener = null;
let scoreChart = null, activityChart = null;

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
        readingMinutes: 0, hearingMinutes: 0, notesMinutes: 0, daySleepMinutes: 0,
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
            dataArray.push([`WEEK: ${week.label}`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
            
            // Column Headers
            dataArray.push([
                'Date', 'Bed', 'M', 'Wake', 'M', 'MP Time', 'M', 'Chant', 'M', 
                'Read(m)', 'M', 'Hear(m)', 'M', 'Notes(m)', 'M', 
                'Day Sleep(m)', 'M', 'Total', '%'
            ]);

            // Daily rows (Sun to Sat)
            let weekTotals = {
                sleepM: 0, wakeupM: 0, morningProgramM: 0, chantingM: 0,
                readingM: 0, hearingM: 0, notesM: 0, daySleepM: 0,
                readingMins: 0, hearingMins: 0, notesMins: 0, daySleepMins: 0,
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
                weekTotals.morningProgramM += entry.scores?.morningProgram ?? 0;
                weekTotals.chantingM += entry.scores?.chanting ?? 0;
                weekTotals.readingM += entry.scores?.reading ?? 0;
                weekTotals.hearingM += entry.scores?.hearing ?? 0;
                weekTotals.notesM += entry.scores?.notes ?? 0;
                weekTotals.daySleepM += entry.scores?.daySleep ?? 0;
                weekTotals.readingMins += entry.readingMinutes || 0;
                weekTotals.hearingMins += entry.hearingMinutes || 0;
                weekTotals.notesMins += entry.notesMinutes || 0;
                weekTotals.daySleepMins += entry.daySleepMinutes || 0;
                weekTotals.total += entry.totalScore ?? 0;

                dataArray.push([
                    dayLabel,
                    entry.sleepTime || 'NR',
                    entry.scores?.sleep ?? 0,
                    entry.wakeupTime || 'NR',
                    entry.scores?.wakeup ?? 0,
                    entry.morningProgramTime || 'NR',
                    entry.scores?.morningProgram ?? 0,
                    entry.chantingTime || 'NR',
                    entry.scores?.chanting ?? 0,
                    entry.readingMinutes || 0,
                    entry.scores?.reading ?? 0,
                    entry.hearingMinutes || 0,
                    entry.scores?.hearing ?? 0,
                    entry.notesMinutes || 0,
                    entry.scores?.notes ?? 0,
                    entry.daySleepMinutes || 0,
                    entry.scores?.daySleep ?? 0,
                    entry.totalScore ?? 0,
                    (entry.dayPercent ?? 0) + '%'
                ]);
            }

            // Apply weekly notes compensation
            let adjustedNotesM = weekTotals.notesM;
            if (weekTotals.notesMins >= 245) {
                adjustedNotesM = 175; // Full marks for weekly target
            }
            const adjustedTotal = weekTotals.total - weekTotals.notesM + adjustedNotesM;

            // Weekly Total Row
            const weekPercent = Math.round((adjustedTotal / 1225) * 100);
            dataArray.push([
                'WEEKLY TOTAL',
                '',
                weekTotals.sleepM,
                '',
                weekTotals.wakeupM,
                '',
                weekTotals.morningProgramM,
                '',
                weekTotals.chantingM,
                weekTotals.readingMins,
                weekTotals.readingM,
                weekTotals.hearingMins,
                weekTotals.hearingM,
                weekTotals.notesMins,
                adjustedNotesM,
                weekTotals.daySleepMins,
                weekTotals.daySleepM,
                adjustedTotal,
                weekPercent + '%'
            ]);

            // Weekly Percentage Summary Row
            dataArray.push([
                `WEEKLY PERCENTAGE: ${adjustedTotal} / 1225 = ${weekPercent}%${weekTotals.notesMins >= 245 ? ' ✓ Notes bonus applied!' : ''}`,
                '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''
            ]);

            // Blank rows between weeks
            if (weekIndex < sortedWeeks.length - 1) {
                dataArray.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
                dataArray.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
            }
        });

        const worksheet = XLSX.utils.aoa_to_sheet(dataArray);
        
        // Set column widths
        worksheet['!cols'] = [
            {wch: 10}, {wch: 8}, {wch: 4}, {wch: 8}, {wch: 4}, 
            {wch: 8}, {wch: 4}, {wch: 8}, {wch: 4},
            {wch: 10}, {wch: 4}, {wch: 10}, {wch: 4}, 
            {wch: 10}, {wch: 4}, {wch: 12}, {wch: 4}, {wch: 8}, {wch: 6}
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sadhana History');
        XLSX.writeFile(workbook, `${userName}_Sadhana_History.xlsx`);
        
    } catch (error) {
        console.error("Download error:", error);
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
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    const tabContent = document.getElementById(t + '-tab');
    if (tabContent) {
        tabContent.classList.remove('hidden');
        tabContent.classList.add('active');
    }
    
    const btn = document.querySelector(`button[onclick*="switchTab('${t}')"]`);
    if (btn) btn.classList.add('active');
    
    if (t === 'reports' && currentUser) loadReports(currentUser.uid, 'weekly-reports-container');
    if (t === 'charts' && currentUser) generateCharts();
};

// --- 5. AUTH STATE ---
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        const userDoc = await db.collection('users').doc(user.uid).get();
        
        if (!userDoc.exists || !userDoc.data().name) {
            showSection('profile');
            document.getElementById('profile-title').textContent = 'Set Your Name';
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

// --- 6. SCORING & FORM ---
const sadhanaForm = document.getElementById('sadhana-form');
if (sadhanaForm) {
    sadhanaForm.onsubmit = async (e) => {
        e.preventDefault();
        
        if (!currentUser) {
            alert('Please login first');
            return;
        }
        
        const date = document.getElementById('sadhana-date').value;
        const slp = document.getElementById('sleep-time').value;
        const wak = document.getElementById('wakeup-time').value;
        const mpTime = document.getElementById('morning-program-time').value;
        const chn = document.getElementById('chanting-time').value;
        const rMin = parseInt(document.getElementById('reading-mins').value) || 0;
        const hMin = parseInt(document.getElementById('hearing-mins').value) || 0;
        const nMin = parseInt(document.getElementById('notes-mins').value) || 0;
        const dsMin = parseInt(document.getElementById('day-sleep-minutes').value) || 0;
    
    const sc = { 
        sleep: -5, 
        wakeup: -5, 
        morningProgram: -5,
        chanting: -5, 
        reading: -5, 
        hearing: -5, 
        notes: -5, 
        daySleep: 0 
    };
    
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
    
    // Morning Program Score
    // 4:45 AM = 285 mins → 25
    // 5:00 AM = 300 mins → 10
    // 5:01-5:34 AM = 301-334 mins → 5
    // 5:35 AM = 335 mins → 0
    // 6:00 AM = 360 mins → -5
    const mpM = t2m(mpTime, false);
    if (mpM <= 285) sc.morningProgram = 25; // 4:45 AM or earlier
    else if (mpM <= 300) sc.morningProgram = 10; // 5:00 AM
    else if (mpM <= 334) sc.morningProgram = 5; // 5:01 to 5:34 AM
    else if (mpM <= 359) sc.morningProgram = 0; // 5:35 to 5:59 AM
    else sc.morningProgram = -5; // 6:00 AM or later
    
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
    
    // Reading & Hearing (40 mins target)
    const getActScore = (m) => {
        if (m >= 40) return 25;
        if (m >= 30) return 20;
        if (m >= 20) return 15;
        if (m >= 15) return 10;
        if (m >= 10) return 5;
        if (m >= 5) return 0;
        return -5;
    };
    
    sc.reading = getActScore(rMin);
    sc.hearing = getActScore(hMin);
    
    // Notes Revision (35 mins target for 25 marks)
    if (nMin >= 35) sc.notes = 25;
    else if (nMin >= 30) sc.notes = 20;
    else if (nMin >= 25) sc.notes = 15;
    else if (nMin >= 20) sc.notes = 10;
    else if (nMin >= 15) sc.notes = 5;
    else if (nMin >= 5) sc.notes = 0;
    else sc.notes = -5;
    
    const total = sc.sleep + sc.wakeup + sc.morningProgram + sc.chanting + 
                  sc.reading + sc.hearing + sc.notes + sc.daySleep;
    const dayPercent = Math.round((total / 175) * 100);
    
    try {
        await db.collection('users').doc(currentUser.uid).collection('sadhana').doc(date).set({
            sleepTime: slp,
            wakeupTime: wak,
            morningProgramTime: mpTime,
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
        
        alert(`Success! Score: ${total}/175 (${dayPercent}%)`);
        switchTab('reports');
    } catch (error) {
        alert('Error saving: ' + error.message);
    }
    };
}

// --- 7. REPORTS ---
async function loadReports(userId, containerId) {
    const container = document.getElementById(containerId);
    const snap = await db.collection('users').doc(userId).collection('sadhana').get();
    
    if (snap.empty) {
        container.innerHTML = '<p style="text-align:center; color:#999; padding:40px;">No sadhana data yet. Start tracking!</p>';
        return;
    }
    
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
    
    const sortedWeeks = Object.keys(weeksData).sort((a, b) => b.localeCompare(a));
    
    let html = '';
    sortedWeeks.forEach(sunStr => {
        const week = weeksData[sunStr];
        const weekStart = new Date(week.sunStr);
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        let weekTotals = {
            total: 0,
            readingMins: 0,
            hearingMins: 0,
            notesMins: 0,
            notesMarks: 0
        };
        
        let dailyHTML = '';
        for (let i = 0; i < 7; i++) {
            const currentDate = new Date(weekStart);
            currentDate.setDate(currentDate.getDate() + i);
            const dateStr = currentDate.toISOString().split('T')[0];
            const entry = week.days[dateStr] || getNRData(dateStr);
            
            weekTotals.total += entry.totalScore ?? 0;
            weekTotals.readingMins += entry.readingMinutes || 0;
            weekTotals.hearingMins += entry.hearingMinutes || 0;
            weekTotals.notesMins += entry.notesMinutes || 0;
            weekTotals.notesMarks += entry.scores?.notes || 0;
            
            const scoreClass = (entry.totalScore ?? 0) < 0 ? 'score-negative' : '';
            dailyHTML += `
                <div class="daily-entry">
                    <div class="daily-meta">
                        <span><strong>${dayNames[i]} ${currentDate.getDate()}</strong></span>
                        <span class="${scoreClass}">Total: ${entry.totalScore ?? 0}/175</span>
                    </div>
                    <div class="activity-details">
                        <span>Sleep: ${entry.sleepTime} (${entry.scores?.sleep ?? 0}) | Wake: ${entry.wakeupTime} (${entry.scores?.wakeup ?? 0})</span>
                        <span>MP: ${entry.morningProgramTime || 'NR'} (${entry.scores?.morningProgram ?? 0}) | Chant: ${entry.chantingTime} (${entry.scores?.chanting ?? 0})</span>
                        <span>Read: ${entry.readingMinutes || 0}m (${entry.scores?.reading ?? 0}) | Hear: ${entry.hearingMinutes || 0}m (${entry.scores?.hearing ?? 0})</span>
                        <span>Notes: ${entry.notesMinutes || 0}m (${entry.scores?.notes ?? 0}) | Day Sleep: ${entry.daySleepMinutes || 0}m (${entry.scores?.daySleep ?? 0})</span>
                    </div>
                </div>
            `;
        }
        
        // Apply weekly notes compensation
        let adjustedNotesMarks = weekTotals.notesMarks;
        if (weekTotals.notesMins >= 245) {
            adjustedNotesMarks = 175; // Full marks
        }
        const adjustedTotal = weekTotals.total - weekTotals.notesMarks + adjustedNotesMarks;
        const weekPercent = Math.round((adjustedTotal / 1225) * 100);
        
        const weekClass = adjustedTotal < 245 ? 'low-score' : '';
        
        html += `
            <div class="week-card ${weekClass}">
                <div class="week-header" onclick="this.nextElementSibling.classList.toggle('expanded'); this.querySelector('.toggle-icon').textContent = this.nextElementSibling.classList.contains('expanded') ? '▼' : '▶';">
                    <span>${week.label}</span>
                    <span>${adjustedTotal}/1225 (${weekPercent}%) <span class="toggle-icon">▶</span></span>
                </div>
                <div class="week-content">
                    ${dailyHTML}
                    <div style="margin-top: 15px; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                        <strong>Weekly Summary:</strong><br>
                        Reading: ${weekTotals.readingMins} mins | Hearing: ${weekTotals.hearingMins} mins<br>
                        Notes: ${weekTotals.notesMins} mins → ${adjustedNotesMarks} marks ${weekTotals.notesMins >= 245 ? '✓ Full bonus!' : ''}<br>
                        <strong>Total: ${adjustedTotal}/1225 (${weekPercent}%)</strong>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// --- 8. CHARTS ---
async function generateCharts() {
    const period = document.getElementById('chart-period').value;
    
    if (period === 'daily') {
        await generateDailyCharts();
    } else if (period === 'weekly') {
        await generateWeeklyCharts();
    } else if (period === 'monthly') {
        await generateMonthlyCharts();
    }
}

async function generateDailyCharts() {
    const today = new Date();
    const dates = [];
    
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        dates.push(d.toISOString().split('T')[0]);
    }
    
    const snapshot = await db.collection('users').doc(currentUser.uid)
        .collection('sadhana')
        .where(firebase.firestore.FieldPath.documentId(), 'in', dates)
        .get();
    
    const data = {};
    snapshot.forEach(doc => {
        data[doc.id] = doc.data();
    });
    
    const labels = dates.map(d => {
        const date = new Date(d);
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    });
    const scores = dates.map(d => data[d]?.totalScore || 0);
    const sleepScores = dates.map(d => data[d]?.scores?.sleep || 0);
    const wakeupScores = dates.map(d => data[d]?.scores?.wakeup || 0);
    const morningScores = dates.map(d => data[d]?.scores?.morningProgram || 0);
    const chantingScores = dates.map(d => data[d]?.scores?.chanting || 0);
    const readingScores = dates.map(d => data[d]?.scores?.reading || 0);
    const hearingScores = dates.map(d => data[d]?.scores?.hearing || 0);
    const notesScores = dates.map(d => data[d]?.scores?.notes || 0);
    
    renderScoreChart(labels, scores, 175);
    renderActivityChart(labels, {
        sleep: sleepScores,
        wakeup: wakeupScores,
        morning: morningScores,
        chanting: chantingScores,
        reading: readingScores,
        hearing: hearingScores,
        notes: notesScores
    });
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
    
    for (const weekStart of weeks) {
        const weekDates = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart);
            d.setDate(weekStart.getDate() + i);
            weekDates.push(d.toISOString().split('T')[0]);
        }
        
        const snapshot = await db.collection('users').doc(currentUser.uid)
            .collection('sadhana')
            .where(firebase.firestore.FieldPath.documentId(), 'in', weekDates)
            .get();
        
        let weekTotal = 0;
        snapshot.forEach(doc => {
            weekTotal += doc.data().totalScore || 0;
        });
        
        labels.push(`Week ${weekStart.getDate()}/${weekStart.getMonth() + 1}`);
        scores.push(weekTotal);
    }
    
    renderScoreChart(labels, scores, 1225);
}

async function generateMonthlyCharts() {
    const today = new Date();
    const months = [];
    
    for (let i = 5; i >= 0; i--) {
        const month = new Date(today.getFullYear(), today.getMonth() - i, 1);
        months.push(month);
    }
    
    const labels = [];
    const scores = [];
    
    for (const month of months) {
        const startDate = new Date(month.getFullYear(), month.getMonth(), 1);
        const endDate = new Date(month.getFullYear(), month.getMonth() + 1, 0);
        
        const snapshot = await db.collection('users').doc(currentUser.uid)
            .collection('sadhana')
            .where(firebase.firestore.FieldPath.documentId(), '>=', startDate.toISOString().split('T')[0])
            .where(firebase.firestore.FieldPath.documentId(), '<=', endDate.toISOString().split('T')[0])
            .get();
        
        let monthTotal = 0;
        snapshot.forEach(doc => {
            monthTotal += doc.data().totalScore || 0;
        });
        
        labels.push(month.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }));
        scores.push(monthTotal);
    }
    
    renderScoreChart(labels, scores, null);
}

function renderScoreChart(labels, data, maxScore) {
    const ctx = document.getElementById('score-chart').getContext('2d');
    
    if (scoreChart) {
        scoreChart.destroy();
    }
    
    scoreChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total Score',
                data: data,
                borderColor: '#4a90e2',
                backgroundColor: 'rgba(74, 144, 226, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: 5,
                pointHoverRadius: 8,
                pointBackgroundColor: '#4a90e2',
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    callbacks: {
                        label: function(context) {
                            const score = context.parsed.y;
                            const percentage = maxScore ? Math.round((score / maxScore) * 100) : 0;
                            return [
                                `Score: ${score}${maxScore ? '/' + maxScore : ''}`,
                                percentage ? `Percentage: ${percentage}%` : ''
                            ].filter(Boolean);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: maxScore
                }
            }
        }
    });
}

function renderActivityChart(labels, datasets) {
    const ctx = document.getElementById('activity-chart').getContext('2d');
    
    if (activityChart) {
        activityChart.destroy();
    }
    
    const colors = {
        sleep: { border: '#2196F3', bg: 'rgba(33, 150, 243, 0.2)' },
        wakeup: { border: '#4CAF50', bg: 'rgba(76, 175, 80, 0.2)' },
        morning: { border: '#FF9800', bg: 'rgba(255, 152, 0, 0.2)' },
        chanting: { border: '#9C27B0', bg: 'rgba(156, 39, 176, 0.2)' },
        reading: { border: '#F44336', bg: 'rgba(244, 67, 54, 0.2)' },
        hearing: { border: '#00BCD4', bg: 'rgba(0, 188, 212, 0.2)' },
        notes: { border: '#FFC107', bg: 'rgba(255, 193, 7, 0.2)' }
    };
    
    const activityNames = {
        sleep: 'Sleep',
        wakeup: 'Wakeup',
        morning: 'Morning Program',
        chanting: 'Chanting',
        reading: 'Reading',
        hearing: 'Hearing',
        notes: 'Notes'
    };
    
    const chartDatasets = Object.keys(datasets).map(key => ({
        label: activityNames[key],
        data: datasets[key],
        borderColor: colors[key].border,
        backgroundColor: colors[key].bg,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 7
    }));
    
    activityChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: chartDatasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 25
                }
            }
        }
    });
}

// --- 9. MISC FUNCTIONS ---
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
}

const profileForm = document.getElementById('profile-form');
if (profileForm) {
    profileForm.onsubmit = async (e) => {
        e.preventDefault();
        const data = { 
            name: document.getElementById('profile-name').value.trim(),
            role: userProfile?.role || 'user' 
        };
        await db.collection('users').doc(currentUser.uid).set(data, { merge: true });
        alert("Name saved!"); 
        location.reload();
    };
}

const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.onsubmit = async (e) => { 
        e.preventDefault();
        const rememberMe = document.getElementById('remember-me').checked;
        
        try {
            // Set persistence before login
            if (rememberMe) {
                await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            } else {
                await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
            }
            
            await auth.signInWithEmailAndPassword(
                document.getElementById('login-email').value, 
                document.getElementById('login-password').value
            );
        } catch (err) {
            alert(err.message);
        }
    };
}

document.getElementById('logout-btn').onclick = () => auth.signOut();

window.openProfileEdit = () => { 
    document.getElementById('profile-name').value = userProfile.name; 
    document.getElementById('cancel-edit').classList.remove('hidden'); 
    showSection('profile'); 
};
