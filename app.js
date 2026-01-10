// --- 1. CONFIG & AUTH ---
const firebaseConfig = {
    apiKey: "AIzaSyDbRy8ZMJAWeTyZVnTphwRIei6jAckagjA",
    authDomain: "sadhana-tracker-b65ff.firebaseapp.com",
    projectId: "sadhana-tracker-b65ff",
    storageBucket: "sadhana-tracker-b65ff.firebasestorage.app",
    messagingSenderId: "926961218888",
    appId: "1:926961218888:web:db8f12ef8256d13f036f7d"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth(), db = firebase.firestore();
let currentUser = null, userProfile = null, activeListener = null;

// --- 2. DATE & NR HELPER ---
function getWeekInfo(dateStr) {
    const d = new Date(dateStr);
    const sun = new Date(d); sun.setDate(d.getDate() - d.getDay());
    const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
    const fmt = (date) => {
        const day = String(date.getDate()).padStart(2, '0');
        const month = date.toLocaleString('en-GB', { month: 'short' });
        return `${day} ${month}`;
    };
    return { 
        sunStr: sun.toISOString().split('T')[0], 
        label: `${fmt(sun)} to ${fmt(sat)}_${sun.getFullYear()}` 
    };
}

function getNRData(date) {
    return {
        id: date, totalScore: -30, dayPercent: 0,
        sleepTime: "NR", wakeupTime: "NR", chantingTime: "NR",
        readingMinutes: 0, hearingMinutes: 0, serviceMinutes: 0, daySleepMinutes: 0,
        scores: { sleep: -5, wakeup: -5, chanting: -5, reading: -5, hearing: -5, service: -5, daySleep: 0 }
    };
}

// --- 3. REPORTS UI (FIXED: Added Day Sleep Marks & Dynamic Highlighting) ---
function loadReports(userId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (activeListener) activeListener();

    activeListener = db.collection('users').doc(userId).collection('sadhana').orderBy('submittedAt', 'desc').limit(20).onSnapshot(snap => {
        const entries = {};
        snap.forEach(doc => entries[doc.id] = doc.data());
        const weeks = {};
        
        for (let i = 0; i < 14; i++) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const ds = d.toISOString().split('T')[0];
            const w = getWeekInfo(ds);
            if (!weeks[w.sunStr]) weeks[w.sunStr] = { range: w.label, data: [], total: 0 };
            const dayData = entries[ds] ? { id: ds, ...entries[ds] } : getNRData(ds);
            weeks[w.sunStr].data.push(dayData);
            weeks[w.sunStr].total += dayData.totalScore;
        }

        container.innerHTML = '';
        Object.keys(weeks).sort((a,b) => b.localeCompare(a)).forEach(key => {
            const week = weeks[key];
            const div = document.createElement('div');
            div.className = 'week-card';
            div.innerHTML = `
                <div class="week-header" onclick="this.nextElementSibling.classList.toggle('hidden')">
                    <span>📅 ${week.range}</span><strong>Score: ${week.total} ▼</strong>
                </div>
                <div class="week-content hidden" style="overflow-x:auto;">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Date</th><th>Bed</th><th>M</th><th>Wake</th><th>M</th><th>Chant</th><th>M</th>
                                <th>Read</th><th>M</th><th>Hear</th><th>M</th><th>Seva</th><th>M</th>
                                <th>DS(m)</th><th>M</th><th>Total</th><th>%</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${week.data.sort((a,b) => b.id.localeCompare(a.id)).map(e => {
                                const rM = e.scores?.reading ?? 0;
                                const hM = e.scores?.hearing ?? 0;
                                const isL12 = e.levelAtSubmission?.includes('Level-1') || e.levelAtSubmission?.includes('Level-2');
                                
                                return `
                                <tr style="${e.sleepTime === 'NR' ? 'color: red; background: #fff5f5;' : ''}">
                                    <td>${e.id.split('-').slice(1).join('/')}</td>
                                    <td>${e.sleepTime}</td><td>${e.scores?.sleep ?? 0}</td>
                                    <td>${e.wakeupTime}</td><td>${e.scores?.wakeup ?? 0}</td>
                                    <td>${e.chantingTime}</td><td>${e.scores?.chanting ?? 0}</td>
                                    <td style="${isL12 && rM >= hM ? 'font-weight:bold; color:green;' : ''}">${e.readingMinutes}m</td><td>${rM}</td>
                                    <td style="${isL12 && hM > rM ? 'font-weight:bold; color:green;' : ''}">${e.hearingMinutes}m</td><td>${hM}</td>
                                    <td>${e.serviceMinutes || 0}m</td><td>${e.scores?.service ?? 0}</td>
                                    <td>${e.daySleepMinutes || 0}m</td><td>${e.scores?.daySleep ?? 0}</td>
                                    <td><strong>${e.totalScore}</strong></td>
                                    <td>${e.dayPercent}%</td>
                                </tr>`}).join('')}
                        </tbody>
                    </table>
                </div>`;
            container.appendChild(div);
        });
    });
}

// --- 4. EXCEL DOWNLOADS (Updated with Day Sleep Marks) ---
document.getElementById('user-download-btn').onclick = () => {
    if(currentUser && userProfile) downloadUserExcel(currentUser.uid, userProfile.name);
};

window.downloadUserExcel = async (userId, userName) => {
    try {
        const snap = await db.collection('users').doc(userId).collection('sadhana').orderBy('submittedAt', 'asc').get();
        const rows = [["Date", "Bed", "M", "Wake", "M", "Chant", "M", "Read(m)", "M", "Hear(m)", "M", "Seva(m)", "M", "Day Sleep", "DS M", "Total", "%"]];
        snap.forEach(doc => {
            const e = doc.data();
            rows.push([
                doc.id, e.sleepTime, e.scores?.sleep, e.wakeupTime, e.scores?.wakeup, 
                e.chantingTime, e.scores?.chanting, e.readingMinutes, e.scores?.reading, 
                e.hearingMinutes, e.scores?.hearing, e.serviceMinutes||0, e.scores?.service, 
                e.daySleepMinutes || 0, e.scores?.daySleep, e.totalScore, e.dayPercent+"%"
            ]);
        });
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "History");
        XLSX.writeFile(wb, `${userName}_Sadhana_Report.xlsx`);
    } catch (e) { alert("Download Failed"); }
};

window.downloadMasterReport = async () => {
    try {
        const weeks = [];
        for (let i = 0; i < 4; i++) {
            const d = new Date(); d.setDate(d.getDate() - (i*7));
            weeks.push(getWeekInfo(d.toISOString().split('T')[0]));
        }
        weeks.reverse();
        const usersSnap = await db.collection('users').get();
        const rows = [["User Name", "Category", ...weeks.map(w => w.label)]];
        for (const uDoc of usersSnap.docs) {
            const u = uDoc.data();
            const sSnap = await uDoc.ref.collection('sadhana').get();
            const sEntries = sSnap.docs.map(d => ({ date: d.id, score: d.data().totalScore || 0 }));
            const userRow = [u.name, u.chantingCategory || 'N/A'];
            weeks.forEach(w => {
                let weekTotal = 0; let curr = new Date(w.sunStr);
                for (let i = 0; i < 7; i++) {
                    const ds = curr.toISOString().split('T')[0];
                    const entry = sEntries.find(e => e.date === ds);
                    weekTotal += entry ? entry.score : -30;
                    curr.setDate(curr.getDate() + 1);
                }
                userRow.push(weekTotal);
            });
            rows.push(userRow);
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Comparative");
        XLSX.writeFile(wb, "Master_Comparative_Report.xlsx");
    } catch (e) { alert("Master Download Failed"); }
};

// --- 5. FORM SUBMISSIONS (LOCKED SCORING ENGINE) ---
document.getElementById('sadhana-form').onsubmit = async (e) => {
    e.preventDefault();
    const date = document.getElementById('sadhana-date').value;
    const level = userProfile.chantingCategory || "Level-1";

    const sleepVal = document.getElementById('sleep-time').value;
    const wakeVal = document.getElementById('wakeup-time').value;
    const chantVal = document.getElementById('chanting-time').value;
    const readMins = (parseInt(document.getElementById('reading-hrs').value) || 0) * 60 + (parseInt(document.getElementById('reading-mins').value) || 0);
    const hearMins = (parseInt(document.getElementById('hearing-hrs').value) || 0) * 60 + (parseInt(document.getElementById('hearing-mins').value) || 0);
    const serviceMins = (parseInt(document.getElementById('service-hrs')?.value) || 0) * 60 + (parseInt(document.getElementById('service-mins')?.value) || 0);
    const dsMins = parseInt(document.getElementById('day-sleep-minutes').value) || 0;

    // REPLACE WITH THIS FIXED BLOCK:
const t2m = (t, isSleep = false) => {
    if (!t || t === "NR") return 9999;
    let [h, m] = t.split(':').map(Number);
    
    // Sirf Sleep ke liye 12AM-3AM ko 24+ maanna hai
    // Wakeup ke liye 3AM ko 3:00 hi rehne dena hai
    if (isSleep && h >= 0 && h <= 3) h += 24; 
    
    return h * 60 + m;
};
    const scores = { sleep: -5, wakeup: -5, chanting: -5, reading: 0, hearing: 0, service: 0, daySleep: 0 };

    // Nidra
    const sMin = t2m(sleepVal, true);
    if (sMin <= 1350) scores.sleep = 25;
    else if (sMin <= 1355) scores.sleep = 20;
    else if (sMin <= 1360) scores.sleep = 15;
    else if (sMin <= 1365) scores.sleep = 10;
    else if (sMin <= 1370) scores.sleep = 5;
    else if (sMin <= 1375) scores.sleep = 0;
    else scores.sleep = -5;

    // Jagran
    const wMin = t2m(wakeVal, false);
    const isLevel1or2 = level.includes("Level-1") || level.includes("Level-2");
    const targetWake = isLevel1or2 ? 365 : 305;
    if (wMin <= targetWake) scores.wakeup = 25;
    else if (wMin <= targetWake + 5) scores.wakeup = 20;
    else if (wMin <= targetWake + 10) scores.wakeup = 15;
    else if (wMin <= targetWake + 15) scores.wakeup = 10;
    else if (wMin <= targetWake + 20) scores.wakeup = 5;
    else if (wMin <= targetWake + 25) scores.wakeup = 0;
    else scores.wakeup = -5;

    // Chanting
    if (chantVal) {
        const cMin = t2m(chantVal);
        if (cMin <= 540) scores.chanting = 25;
        else if (cMin <= 570) scores.chanting = 20;
        else if (cMin <= 660) scores.chanting = 15;
        else if (cMin <= 870) scores.chanting = 10;
        else if (cMin <= 1020) scores.chanting = 5;
        else if (cMin <= 1140) scores.chanting = 0;
        else scores.chanting = -5;
    }

    // Day Sleep
    scores.daySleep = (dsMins <= 60) ? 10 : -5;

    // Reading / Hearing / Service
    const getDurationScore = (mins, isL4 = false) => {
        const target = isL4 ? 40 : 30;
        if (mins >= target) return 25;
        else if (mins >= (target - 10)) return 20;
        else if (mins >= 20) return 15;
        else if (mins >= 15) return 10;
        else if (mins >= 10) return 5;
        else if (mins >= 5) return 0;
        return -5;
    };

    const isL4 = level.includes("Level-4");
    const rScoreRaw = getDurationScore(readMins, isL4);
    const hScoreRaw = getDurationScore(hearMins, isL4);
    const sevScoreRaw = getDurationScore(serviceMins, false);

    let finalActivityScore = 0;
    let maxObtainable = 110;

    if (isLevel1or2) {
        scores.reading = Math.max(0, rScoreRaw);
        scores.hearing = Math.max(0, hScoreRaw);
        scores.service = 0;
        finalActivityScore = Math.max(scores.reading, scores.hearing);
        maxObtainable = 110;
    } else {
        scores.reading = rScoreRaw;
        scores.hearing = hScoreRaw;
        scores.service = sevScoreRaw;
        finalActivityScore = scores.reading + scores.hearing + scores.service;
        maxObtainable = 160;
    }

    const totalScore = scores.sleep + scores.wakeup + scores.chanting + scores.daySleep + finalActivityScore;
    const dayPercent = Math.round((totalScore / maxObtainable) * 100);

    const entry = {
        sleepTime: sleepVal, wakeupTime: wakeVal, chantingTime: chantVal,
        readingMinutes: readMins, hearingMinutes: hearMins, serviceMinutes: serviceMins, daySleepMinutes: dsMins,
        scores: scores, totalScore: totalScore, dayPercent: dayPercent,
        levelAtSubmission: level, submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('users').doc(currentUser.uid).collection('sadhana').doc(date).set(entry);
    alert(`Sadhana Submitted! Score: ${totalScore} (${dayPercent}%)`);
    switchTab('reports');
};

document.getElementById('profile-form').onsubmit = async (e) => {
    e.preventDefault();
    const data = {
        name: document.getElementById('profile-name').value,
        chantingCategory: document.getElementById('profile-chanting').value,
        exactRounds: document.getElementById('profile-exact-rounds').value,
        role: userProfile?.role || 'user'
    };
    await db.collection('users').doc(currentUser.uid).set(data, { merge: true });
    alert("Profile Saved!");
    location.reload();
};

// --- 6. CORE LOGIC ---
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        const doc = await db.collection('users').doc(user.uid).get();
        if (doc.exists) {
            userProfile = doc.data();
            document.getElementById('user-display-name').textContent = `${userProfile.name} (${userProfile.chantingCategory})`;
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
    if (t === 'admin') loadAdminPanel();
};

function showSection(id) {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById(id + '-section').classList.remove('hidden');
}

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
    let tableHtml = `<table class="admin-table"><thead><tr><th>User</th><th>Cat</th>${weeks.map(w => `<th>${w.label}</th>`).join('')}</tr></thead><tbody>`;
    usersList.innerHTML = '';
    for (const uDoc of usersSnap.docs) {
        const u = uDoc.data();
        tableHtml += `<tr><td>${u.name}</td><td>${u.chantingCategory || 'N/A'}</td>`;
        const sSnap = await uDoc.ref.collection('sadhana').get();
        const sEntries = sSnap.docs.map(d => ({ date: d.id, score: d.data().totalScore || 0 }));
        weeks.forEach(w => {
            let weekTotal = 0; let curr = new Date(w.sunStr);
            for (let i = 0; i < 7; i++) {
                const ds = curr.toISOString().split('T')[0];
                const entry = sEntries.find(e => e.date === ds);
                weekTotal += entry ? entry.score : -30;
                curr.setDate(curr.getDate() + 1);
            }
            tableHtml += `<td>${weekTotal}</td>`;
        });
        tableHtml += `</tr>`;

        const uDiv = document.createElement('div');
        uDiv.className = 'card';
        uDiv.style = "margin-bottom:10px; padding:12px; display:flex; justify-content:space-between; align-items:center;";
        uDiv.innerHTML = `
            <div><strong>${u.name}</strong><br><small>${u.role || 'user'}</small></div>
            <div style="display:flex; gap:5px;">
                <button onclick="openUserModal('${uDoc.id}', '${u.name}')" style="width:auto; padding:5px; font-size:12px;">History</button>
                <button onclick="downloadUserExcel('${uDoc.id}', '${u.name}')" style="width:auto; padding:5px; font-size:12px; background:green;">Excel</button>
                ${u.role === 'admin' ? 
                    `<button onclick="removeAdmin('${uDoc.id}')" style="width:auto; padding:5px; font-size:12px; background:red;">Remove Admin</button>` : 
                    `<button onclick="makeAdmin('${uDoc.id}')" style="width:auto; padding:5px; font-size:12px; background:orange;">Make Admin</button>`
                }
            </div>`;
        usersList.appendChild(uDiv);
    }
    tableContainer.innerHTML = tableHtml + `</tbody></table>`;
}

window.makeAdmin = async (uid) => { if (confirm("Promote?")) { await db.collection('users').doc(uid).update({ role: 'admin' }); loadAdminPanel(); } };
window.removeAdmin = async (uid) => { if (confirm("Remove?")) { await db.collection('users').doc(uid).update({ role: 'user' }); loadAdminPanel(); } };
window.openUserModal = (id, name) => { document.getElementById('user-report-modal').classList.remove('hidden'); document.getElementById('modal-user-name').textContent = name; loadReports(id, 'modal-report-container'); };
window.closeUserModal = () => document.getElementById('user-report-modal').classList.add('hidden');
window.openProfileEdit = () => {
    document.getElementById('profile-name').value = userProfile.name || "";
    document.getElementById('profile-chanting').value = userProfile.chantingCategory || "";
    document.getElementById('profile-exact-rounds').value = userProfile.exactRounds || "";
    document.getElementById('cancel-edit').classList.remove('hidden');
    showSection('profile');
};

function setupDateSelect() {
    const s = document.getElementById('sadhana-date'); if (!s) return; s.innerHTML = '';
    for (let i = 0; i < 2; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const iso = d.toISOString().split('T')[0];
        const opt = document.createElement('option'); opt.value = iso; opt.textContent = iso;
        s.appendChild(opt);
    }
    const sArea = document.getElementById('service-area');
    if (sArea && userProfile.chantingCategory.match(/Level-3|Level-4/)) sArea.classList.remove('hidden');
}

document.getElementById('login-form').onsubmit = (e) => { e.preventDefault(); auth.signInWithEmailAndPassword(document.getElementById('login-email').value, document.getElementById('login-password').value).catch(err => alert(err.message)); };
document.getElementById('logout-btn').onclick = () => auth.signOut();
