// --- 1. FIREBASE SETUP ---
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
        id: date, totalScore: -30, dayPercent: -27,
        sleepTime: "NR", wakeupTime: "NR", chantingTime: "NR",
        readingMinutes: 0, hearingMinutes: 0, serviceMinutes: 0, daySleepMinutes: 0,
        scores: { sleep: -5, wakeup: -5, chanting: -5, reading: -5, hearing: -5, service: -5, daySleep: 0 }
    };
}

// --- 3. DOWNLOAD LOGIC (REBUILT) ---
window.downloadUserExcel = async (userId, userName) => {
    try {
        if (typeof XLSX === 'undefined') {
            alert("Excel Library not loaded. Please wait 2 seconds and try again.");
            return;
        }

        const snap = await db.collection('users').doc(userId).collection('sadhana').orderBy('submittedAt', 'asc').get();
        if (snap.empty) {
            alert("No data found to download.");
            return;
        }

        const dataArray = [["Date", "Bed", "M", "Wake", "M", "Chant", "M", "Read(m)", "M", "Hear(m)", "M", "Seva(m)", "M", "Day Sleep", "DS M", "Total", "%"]];
        
        snap.forEach(doc => {
            const e = doc.data();
            dataArray.push([
                doc.id, e.sleepTime || "NR", e.scores?.sleep ?? 0, 
                e.wakeupTime || "NR", e.scores?.wakeup ?? 0, 
                e.chantingTime || "NR", e.scores?.chanting ?? 0, 
                e.readingMinutes || 0, e.scores?.reading ?? 0, 
                e.hearingMinutes || 0, e.scores?.hearing ?? 0, 
                e.serviceMinutes || 0, e.scores?.service ?? 0, 
                e.daySleepMinutes || 0, e.scores?.daySleep ?? 0, 
                e.totalScore ?? 0, (e.dayPercent ?? 0) + "%"
            ]);
        });

        const worksheet = XLSX.utils.aoa_to_sheet(dataArray);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Sadhana_Sheet");
        
        const fileName = `${userName.replace(/\s+/g, '_')}_Sadhana.xlsx`;
        XLSX.writeFile(workbook, fileName);

    } catch (error) {
        console.error("Download Error:", error);
        alert("Download Failed! Technical Error: " + error.message);
    }
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
        const rows = [["User Name", "Category", ...weeks.map(w => w.label + " (%)")]];
        
        for (const uDoc of usersSnap.docs) {
            const u = uDoc.data();
            const sSnap = await uDoc.ref.collection('sadhana').get();
            const sEntries = sSnap.docs.map(d => ({ date: d.id, score: d.data().totalScore || 0 }));
            const userRow = [u.name, u.chantingCategory || 'Level-1'];
            const isL12 = userRow[1].includes("Level-1") || userRow[1].includes("Level-2");
            const weeklyMax = isL12 ? 770 : 1120;

            weeks.forEach(w => {
                let weekTotal = 0; let curr = new Date(w.sunStr);
                for (let i = 0; i < 7; i++) {
                    const ds = curr.toISOString().split('T')[0];
                    const entry = sEntries.find(e => e.date === ds);
                    weekTotal += entry ? entry.score : -30;
                    curr.setDate(curr.getDate() + 1);
                }
                userRow.push(Math.round((weekTotal / weeklyMax) * 100) + "%");
            });
            rows.push(userRow);
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Master_Report");
        XLSX.writeFile(wb, "Master_Sadhana_Report.xlsx");
    } catch (e) { alert("Master Download Failed"); }
};

// --- 4. AUTH & NAVIGATION ---
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

// --- 5. REPORT UI (NR RED COLOR FIX) ---
function loadReports(userId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (activeListener) activeListener();
    activeListener = db.collection('users').doc(userId).collection('sadhana').orderBy('submittedAt', 'desc').limit(20).onSnapshot(snap => {
        const entries = {}; snap.forEach(doc => entries[doc.id] = doc.data());
        const weeks = {};
        for (let i = 0; i < 14; i++) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const ds = d.toISOString().split('T')[0];
            const w = getWeekInfo(ds);
            if (!weeks[w.sunStr]) weeks[w.sunStr] = { range: w.label, data: [], total: 0 };
            const dayData = entries[ds] ? { id: ds, ...entries[ds] } : getNRData(ds);
            weeks[w.sunStr].data.push(dayData); weeks[w.sunStr].total += dayData.totalScore;
        }
        container.innerHTML = '';
        Object.keys(weeks).sort((a,b) => b.localeCompare(a)).forEach(key => {
            const week = weeks[key];
            const div = document.createElement('div');
            div.className = 'week-card';
            div.innerHTML = `<div class="week-header" onclick="this.nextElementSibling.classList.toggle('hidden')"><span>📅 ${week.range}</span><strong>Score: ${week.total} ▼</strong></div>
                <div class="week-content hidden" style="overflow-x:auto;"><table class="admin-table">
                <thead><tr><th>Date</th><th>Bed</th><th>M</th><th>Wake</th><th>M</th><th>Chant</th><th>M</th><th>Read</th><th>M</th><th>Hear</th><th>M</th><th>Total</th><th>%</th></tr></thead>
                <tbody>${week.data.sort((a,b) => b.id.localeCompare(a.id)).map(e => {
                    const rowStyle = e.sleepTime === 'NR' ? 'style="background:#fff5f5; color:red;"' : '';
                    return `<tr ${rowStyle}><td>${e.id.split('-').slice(1).join('/')}</td><td>${e.sleepTime}</td><td>${e.scores?.sleep}</td><td>${e.wakeupTime}</td><td>${e.scores?.wakeup}</td><td>${e.chantingTime}</td><td>${e.scores?.chanting}</td><td>${e.readingMinutes}m</td><td>${e.scores?.reading}</td><td>${e.hearingMinutes}m</td><td>${e.scores?.hearing}</td><td>${e.totalScore}</td><td>${e.dayPercent}%</td></tr>`;
                }).join('')}</tbody></table></div>`;
            container.appendChild(div);
        });
    });
}

// --- 6. SCORING & FORM ---
document.getElementById('sadhana-form').onsubmit = async (e) => {
    e.preventDefault();
    const date = document.getElementById('sadhana-date').value;
    const level = userProfile.chantingCategory || "Level-1";
    const slp = document.getElementById('sleep-time').value;
    const wak = document.getElementById('wakeup-time').value;
    const chn = document.getElementById('chanting-time').value;
    const rMin = (parseInt(document.getElementById('reading-hrs').value) || 0) * 60 + (parseInt(document.getElementById('reading-mins').value) || 0);
    const hMin = (parseInt(document.getElementById('hearing-hrs').value) || 0) * 60 + (parseInt(document.getElementById('hearing-mins').value) || 0);
    const sMin = (parseInt(document.getElementById('service-hrs')?.value) || 0) * 60 + (parseInt(document.getElementById('service-mins')?.value) || 0);
    const dsMin = parseInt(document.getElementById('day-sleep-minutes').value) || 0;

    const sc = { sleep: -5, wakeup: -5, chanting: -5, reading: -5, hearing: -5, service: -5, daySleep: 0 };
    const slpM = t2m(slp, true);
    if (slpM <= 1350) sc.sleep = 25; else if (slpM <= 1355) sc.sleep = 20; else if (slpM <= 1360) sc.sleep = 15; else if (slpM <= 1365) sc.sleep = 10; else if (slpM <= 1370) sc.sleep = 5; else if (slpM <= 1375) sc.sleep = 0;

    const wakM = t2m(wak, false);
    const isL12 = level.includes("Level-1") || level.includes("Level-2");
    const targetW = isL12 ? 365 : 305;
    if (wakM <= targetW) sc.wakeup = 25; else if (wakM <= targetW+5) sc.wakeup = 20; else if (wakM <= targetW+10) sc.wakeup = 15; else if (wakM <= targetW+15) sc.wakeup = 10; else if (wakM <= targetW+20) sc.wakeup = 5; else if (wakM <= targetW+25) sc.wakeup = 0;

    const chnM = t2m(chn, false);
    if (chnM <= 540) sc.chanting = 25; else if (chnM <= 570) sc.chanting = 20; else if (chnM <= 660) sc.chanting = 15; else if (chnM <= 870) sc.chanting = 10; else if (chnM <= 1020) sc.chanting = 5; else if (chnM <= 1140) sc.chanting = 0;

    sc.daySleep = (dsMin <= 60) ? 10 : -5;
    const getScore = (m, isL4) => {
        const tgt = isL4 ? 40 : 30;
        if (m >= tgt) return 25; if (m >= tgt-10) return 20; if (m >= 20) return 15; if (m >= 15) return 10; if (m >= 10) return 5; if (m >= 5) return 0; return -5;
    };
    const isL4 = level.includes("Level-4");
    const rRaw = getScore(rMin, isL4); const hRaw = getScore(hMin, isL4); const sRaw = getScore(sMin, false);
    let actScore = 0; let maxM = 160;
    if (isL12) {
        sc.reading = Math.max(0, rRaw); sc.hearing = Math.max(0, hRaw); sc.service = 0;
        actScore = Math.max(sc.reading, sc.hearing); maxM = 110;
    } else {
        sc.reading = rRaw; sc.hearing = hRaw; sc.service = sRaw;
        actScore = sc.reading + sc.hearing + sc.service;
    }
    const total = sc.sleep + sc.wakeup + sc.chanting + sc.daySleep + actScore;
    await db.collection('users').doc(currentUser.uid).collection('sadhana').doc(date).set({
        sleepTime: slp, wakeupTime: wak, chantingTime: chn, readingMinutes: rMin, hearingMinutes: hMin, serviceMinutes: sMin, daySleepMinutes: dsMin,
        scores: sc, totalScore: total, dayPercent: Math.round((total/maxM)*100), levelAtSubmission: level, submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    alert("Success! Score: " + total); switchTab('reports');
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
    let html = `<table class="admin-table"><thead><tr><th>User</th><th>Cat</th>${weeks.map(w => `<th>${w.label} (%)</th>`).join('')}</tr></thead><tbody>`;
    usersList.innerHTML = '';
    for (const uDoc of usersSnap.docs) {
        const u = uDoc.data();
        html += `<tr><td>${u.name}</td><td>${u.chantingCategory || 'N/A'}</td>`;
        const sSnap = await uDoc.ref.collection('sadhana').get();
        const sEntries = sSnap.docs.map(d => ({ date: d.id, score: d.data().totalScore || 0 }));
        const isL12 = (u.chantingCategory || "").includes("Level-1") || (u.chantingCategory || "").includes("Level-2");
        const weeklyMax = isL12 ? 770 : 1120;
        weeks.forEach(w => {
            let weekTotal = 0; let curr = new Date(w.sunStr);
            for (let i = 0; i < 7; i++) {
                const ds = curr.toISOString().split('T')[0];
                const entry = sEntries.find(e => e.date === ds);
                weekTotal += entry ? entry.score : -30;
                curr.setDate(curr.getDate() + 1);
            }
            html += `<td>${Math.round((weekTotal/weeklyMax)*100)}%</td>`;
        });
        html += `</tr>`;
        const uDiv = document.createElement('div');
        uDiv.className = 'card'; uDiv.style = "margin-bottom:10px; padding:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;";
        uDiv.innerHTML = `<div><strong>${u.name}</strong><br><small>${u.role || 'user'}</small></div>
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
    const s = document.getElementById('sadhana-date'); if (!s) return; s.innerHTML = '';
    for (let i = 0; i < 2; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const iso = d.toISOString().split('T')[0];
        const opt = document.createElement('option'); opt.value = iso; opt.textContent = iso;
        s.appendChild(opt);
    }
    const sArea = document.getElementById('service-area');
    if (sArea && userProfile?.chantingCategory?.match(/Level-3|Level-4/)) sArea.classList.remove('hidden');
}

document.getElementById('profile-form').onsubmit = async (e) => {
    e.preventDefault();
    const data = { name: document.getElementById('profile-name').value, chantingCategory: document.getElementById('profile-chanting').value, exactRounds: document.getElementById('profile-exact-rounds').value, role: userProfile?.role || 'user' };
    await db.collection('users').doc(currentUser.uid).set(data, { merge: true });
    alert("Profile Saved!"); location.reload();
};
document.getElementById('login-form').onsubmit = (e) => { e.preventDefault(); auth.signInWithEmailAndPassword(document.getElementById('login-email').value, document.getElementById('login-password').value).catch(err => alert(err.message)); };
document.getElementById('logout-btn').onclick = () => auth.signOut();
window.openUserModal = (id, name) => { document.getElementById('user-report-modal').classList.remove('hidden'); document.getElementById('modal-user-name').textContent = name; loadReports(id, 'modal-report-container'); };
window.closeUserModal = () => document.getElementById('user-report-modal').classList.add('hidden');
window.openProfileEdit = () => { document.getElementById('profile-name').value = userProfile.name; document.getElementById('profile-chanting').value = userProfile.chantingCategory; document.getElementById('profile-exact-rounds').value = userProfile.exactRounds; document.getElementById('cancel-edit').classList.remove('hidden'); showSection('profile'); };
