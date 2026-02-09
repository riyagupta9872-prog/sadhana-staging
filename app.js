// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCZdmZJckSWJo1tFT14NVKVurUGsoKrRy8",
    authDomain: "rapd--sadhana-tracker.firebaseapp.com",
    projectId: "rapd--sadhana-tracker",
    storageBucket: "rapd--sadhana-tracker.firebasestorage.app",
    messagingSenderId: "811405448950",
    appId: "1:811405448950:web:8b711f3129e4bdf06dbed7",
    measurementId: "G-W92S4VDG2D"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
let currentUser = null;

// Helper: Time to minutes
function t2m(time, isPM) {
    const [h, m] = time.split(':').map(Number);
    if (isPM && h < 12) return (h + 12) * 60 + m;
    if (isPM && h === 12) return h * 60 + m;
    return h * 60 + m;
}

// Helper: Format date
function formatDate(date) {
    return new Date(date).toLocaleDateString('en-IN', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric' 
    });
}

// --- AUTHENTICATION ---
// Check if user is new or returning
function checkUserStatus() {
    const hasAccount = localStorage.getItem('hasAccount');
    const trustDevice = localStorage.getItem('trustDevice');
    
    if (!hasAccount) {
        // First time user - show Google signup
        document.querySelector('.login-form').style.display = 'none';
        document.getElementById('first-time-setup').style.display = 'block';
    } else {
        // Returning user - show email/password login
        document.querySelector('.login-form').style.display = 'block';
        document.getElementById('first-time-setup').style.display = 'none';
    }
}

// Initialize on load
checkUserStatus();

// Show/Hide forms
document.getElementById('show-signup').onclick = () => {
    document.querySelector('.login-form').style.display = 'none';
    document.getElementById('first-time-setup').style.display = 'block';
};

document.getElementById('show-login-from-setup').onclick = () => {
    document.getElementById('first-time-setup').style.display = 'none';
    document.getElementById('password-setup').style.display = 'none';
    document.querySelector('.login-form').style.display = 'block';
};

// Google Sign-up (First Time Only)
const googleProvider = new firebase.auth.GoogleAuthProvider();

document.getElementById('google-signup-btn').onclick = async () => {
    try {
        const result = await auth.signInWithPopup(googleProvider);
        const user = result.user;
        
        // Check if user doc exists
        const userDoc = await db.collection('users').doc(user.uid).get();
        
        if (!userDoc.exists) {
            // New user - show password setup
            document.getElementById('first-time-setup').style.display = 'none';
            document.getElementById('password-setup').style.display = 'block';
            document.getElementById('setup-email').value = user.email;
            
            // Store temp user info
            window.tempGoogleUser = {
                uid: user.uid,
                name: user.displayName,
                email: user.email
            };
        } else {
            // Existing user - they should use email/password
            await auth.signOut();
            alert('Account exists! Please login with your email and password.');
            document.getElementById('first-time-setup').style.display = 'none';
            document.querySelector('.login-form').style.display = 'block';
        }
    } catch (error) {
        alert('Google signup failed: ' + error.message);
    }
};

// Complete Setup (Set Password)
document.getElementById('complete-setup-btn').onclick = async () => {
    const password = document.getElementById('setup-password').value;
    const confirmPassword = document.getElementById('setup-password-confirm').value;
    const trustDevice = document.getElementById('trust-device').checked;
    
    if (password.length < 6) {
        alert('Password must be at least 6 characters');
        return;
    }
    
    if (password !== confirmPassword) {
        alert('Passwords do not match!');
        return;
    }
    
    try {
        const user = auth.currentUser;
        if (!user) {
            alert('Session expired. Please try again.');
            location.reload();
            return;
        }
        
        // Link email/password to Google account
        const credential = firebase.auth.EmailAuthProvider.credential(
            window.tempGoogleUser.email,
            password
        );
        await user.linkWithCredential(credential);
        
        // Create user document
        await db.collection('users').doc(user.uid).set({
            name: window.tempGoogleUser.name,
            email: window.tempGoogleUser.email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            setupCompleted: true
        });
        
        // Mark as having account
        localStorage.setItem('hasAccount', 'true');
        
        // Set trust device
        if (trustDevice) {
            localStorage.setItem('trustDevice', 'true');
            auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        } else {
            localStorage.setItem('trustDevice', 'false');
            auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
        }
        
        alert('Setup complete! You can now use email/password for daily login.');
        
        // User will be automatically logged in via auth state observer
        
    } catch (error) {
        alert('Setup failed: ' + error.message);
    }
};

// Email/Password Login
document.getElementById('login-btn').onclick = async () => {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const rememberMe = document.getElementById('remember-me').checked;
    
    try {
        // Set persistence before login
        if (rememberMe) {
            await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        } else {
            await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
        }
        
        await auth.signInWithEmailAndPassword(email, password);
        
        // Mark as having account
        localStorage.setItem('hasAccount', 'true');
        if (rememberMe) {
            localStorage.setItem('trustDevice', 'true');
        }
        
    } catch (error) {
        alert('Login failed: ' + error.message);
    }
};

// Logout
document.getElementById('logout-btn').onclick = () => {
    const trustDevice = localStorage.getItem('trustDevice');
    
    if (trustDevice !== 'true') {
        // Clear all if not trusted
        localStorage.removeItem('hasAccount');
        localStorage.removeItem('trustDevice');
    }
    
    auth.signOut();
};

// Auth State Observer
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('dashboard-screen').classList.add('active');
        document.getElementById('user-name').textContent = user.displayName || user.email;
        
        // Set today's date
        document.getElementById('sadhana-date').valueAsDate = new Date();
        document.getElementById('report-date').valueAsDate = new Date();
    } else {
        currentUser = null;
        document.getElementById('dashboard-screen').classList.remove('active');
        document.getElementById('login-screen').classList.add('active');
    }
});

// --- TAB NAVIGATION ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        const tab = btn.dataset.tab;
        
        // Update buttons
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update content
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(tab + '-tab').classList.add('active');
        
        // Refresh charts if charts tab
        if (tab === 'charts') {
            generateCharts();
        }
    };
});

// --- SCORING SYSTEM ---
document.getElementById('sadhana-form').onsubmit = async (e) => {
    e.preventDefault();
    
    const date = document.getElementById('sadhana-date').value;
    const slp = document.getElementById('sleep-time').value;
    const wak = document.getElementById('wakeup-time').value;
    const morningProgram = document.getElementById('morning-program-time').value;
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
    const mpM = t2m(morningProgram, false);
    if (mpM <= 285) sc.morningProgram = 25; // 4:45 AM
    else if (mpM <= 300) sc.morningProgram = 10; // 5:00 AM
    else if (mpM <= 305) sc.morningProgram = 5; // 5:05 AM
    else if (mpM <= 335) sc.morningProgram = 0; // 5:35 AM
    else sc.morningProgram = -5; // After 6:00 AM
    
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
        await db.collection('users').doc(currentUser.uid)
            .collection('sadhana').doc(date).set({
                sleepTime: slp,
                wakeupTime: wak,
                morningProgramTime: morningProgram,
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
        document.getElementById('sadhana-form').reset();
        document.getElementById('sadhana-date').valueAsDate = new Date();
    } catch (error) {
        alert('Error saving data: ' + error.message);
    }
};

// --- REPORTS ---
document.getElementById('generate-report-btn').onclick = async () => {
    const type = document.getElementById('report-type').value;
    const date = new Date(document.getElementById('report-date').value);
    
    if (type === 'daily') {
        await generateDailyReport(date);
    } else if (type === 'weekly') {
        await generateWeeklyReport(date);
    } else if (type === 'monthly') {
        await generateMonthlyReport(date);
    }
};

async function generateDailyReport(date) {
    const dateStr = date.toISOString().split('T')[0];
    const doc = await db.collection('users').doc(currentUser.uid)
        .collection('sadhana').doc(dateStr).get();
    
    if (!doc.exists) {
        document.getElementById('report-display').innerHTML = 
            '<p style="color: #999; text-align: center; padding: 40px;">No data found for this date</p>';
        return;
    }
    
    const data = doc.data();
    const sc = data.scores;
    
    const html = `
        <h3>Daily Report - ${formatDate(date)}</h3>
        <table class="report-table">
            <thead>
                <tr>
                    <th>Activity</th>
                    <th>Time/Duration</th>
                    <th>Score</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Sleep Time</td>
                    <td>${data.sleepTime}</td>
                    <td class="score-cell" style="background: ${getScoreColor(sc.sleep)}">${sc.sleep}</td>
                </tr>
                <tr>
                    <td>Wakeup Time</td>
                    <td>${data.wakeupTime}</td>
                    <td class="score-cell" style="background: ${getScoreColor(sc.wakeup)}">${sc.wakeup}</td>
                </tr>
                <tr>
                    <td>Morning Program</td>
                    <td>${data.morningProgramTime}</td>
                    <td class="score-cell" style="background: ${getScoreColor(sc.morningProgram)}">${sc.morningProgram}</td>
                </tr>
                <tr>
                    <td>Chanting Completion</td>
                    <td>${data.chantingTime}</td>
                    <td class="score-cell" style="background: ${getScoreColor(sc.chanting)}">${sc.chanting}</td>
                </tr>
                <tr>
                    <td>Reading</td>
                    <td>${data.readingMinutes} mins</td>
                    <td class="score-cell" style="background: ${getScoreColor(sc.reading)}">${sc.reading}</td>
                </tr>
                <tr>
                    <td>Hearing</td>
                    <td>${data.hearingMinutes} mins</td>
                    <td class="score-cell" style="background: ${getScoreColor(sc.hearing)}">${sc.hearing}</td>
                </tr>
                <tr>
                    <td>Notes Revision</td>
                    <td>${data.notesMinutes} mins</td>
                    <td class="score-cell" style="background: ${getScoreColor(sc.notes)}">${sc.notes}</td>
                </tr>
                <tr>
                    <td>Day Sleep</td>
                    <td>${data.daySleepMinutes} mins</td>
                    <td class="score-cell" style="background: ${getScoreColor(sc.daySleep)}">${sc.daySleep}</td>
                </tr>
                <tr style="font-weight: bold; background: #f5f5f5;">
                    <td colspan="2">TOTAL</td>
                    <td class="score-cell" style="background: ${getScoreColor(data.totalScore)}">${data.totalScore}/175 (${data.dayPercent}%)</td>
                </tr>
            </tbody>
        </table>
    `;
    
    document.getElementById('report-display').innerHTML = html;
}

async function generateWeeklyReport(date) {
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    
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
    
    const weekData = {};
    snapshot.forEach(doc => {
        weekData[doc.id] = doc.data();
    });
    
    // Calculate weekly totals
    let totalScore = 0;
    let totalReadingMins = 0;
    let totalHearingMins = 0;
    let totalNotesMins = 0;
    let totalReadingScore = 0;
    let totalHearingScore = 0;
    let totalNotesScore = 0;
    let daysPresent = 0;
    
    let tableRows = '';
    weekDates.forEach(dateStr => {
        const data = weekData[dateStr];
        if (data) {
            daysPresent++;
            totalScore += data.totalScore || 0;
            totalReadingMins += data.readingMinutes || 0;
            totalHearingMins += data.hearingMinutes || 0;
            totalNotesMins += data.notesMinutes || 0;
            totalReadingScore += data.scores?.reading || 0;
            totalHearingScore += data.scores?.hearing || 0;
            totalNotesScore += data.scores?.notes || 0;
            
            tableRows += `
                <tr>
                    <td>${formatDate(dateStr)}</td>
                    <td>${data.readingMinutes} mins (${data.scores?.reading})</td>
                    <td>${data.hearingMinutes} mins (${data.scores?.hearing})</td>
                    <td>${data.notesMinutes} mins (${data.scores?.notes})</td>
                    <td class="score-cell" style="background: ${getScoreColor(data.totalScore)}">${data.totalScore}/175</td>
                </tr>
            `;
        } else {
            tableRows += `
                <tr style="opacity: 0.5;">
                    <td>${formatDate(dateStr)}</td>
                    <td colspan="4" style="text-align: center; color: #999;">No data</td>
                </tr>
            `;
        }
    });
    
    // Apply weekly notes compensation
    let weeklyNotesScore = totalNotesScore;
    if (totalNotesMins >= 245) {
        weeklyNotesScore = 175; // Full marks for weekly target
    }
    
    const adjustedWeeklyTotal = totalScore - totalNotesScore + weeklyNotesScore;
    
    const html = `
        <h3>Weekly Report - Week of ${formatDate(weekStart)}</h3>
        <table class="report-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Reading</th>
                    <th>Hearing</th>
                    <th>Notes Revision</th>
                    <th>Daily Total</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows}
            </tbody>
        </table>
        
        <div class="weekly-summary">
            <h3>Weekly Summary</h3>
            <div class="summary-grid">
                <div class="summary-item">
                    <h4>Total Score</h4>
                    <div class="value">${totalScore}/1225</div>
                    <small>${Math.round((totalScore/1225)*100)}%</small>
                </div>
                <div class="summary-item">
                    <h4>Adjusted Score (Notes Compensation)</h4>
                    <div class="value">${adjustedWeeklyTotal}/1225</div>
                    <small>${totalNotesMins >= 245 ? '✓ Weekly target met!' : 'Target: 245 mins'}</small>
                </div>
                <div class="summary-item">
                    <h4>Reading</h4>
                    <div class="value">${totalReadingMins} mins</div>
                    <small>${totalReadingScore} marks</small>
                </div>
                <div class="summary-item">
                    <h4>Hearing</h4>
                    <div class="value">${totalHearingMins} mins</div>
                    <small>${totalHearingScore} marks</small>
                </div>
                <div class="summary-item">
                    <h4>Notes Revision</h4>
                    <div class="value">${totalNotesMins} mins</div>
                    <small>${weeklyNotesScore} marks ${totalNotesMins >= 245 ? '(Bonus!)' : ''}</small>
                </div>
                <div class="summary-item">
                    <h4>Days Tracked</h4>
                    <div class="value">${daysPresent}/7</div>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('report-display').innerHTML = html;
}

async function generateMonthlyReport(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);
    
    const snapshot = await db.collection('users').doc(currentUser.uid)
        .collection('sadhana')
        .where(firebase.firestore.FieldPath.documentId(), '>=', startDate.toISOString().split('T')[0])
        .where(firebase.firestore.FieldPath.documentId(), '<=', endDate.toISOString().split('T')[0])
        .get();
    
    let totalScore = 0;
    let daysPresent = 0;
    let tableRows = '';
    
    snapshot.forEach(doc => {
        const data = doc.data();
        daysPresent++;
        totalScore += data.totalScore || 0;
        
        tableRows += `
            <tr>
                <td>${formatDate(doc.id)}</td>
                <td class="score-cell" style="background: ${getScoreColor(data.totalScore)}">${data.totalScore}/175</td>
                <td>${data.dayPercent}%</td>
            </tr>
        `;
    });
    
    const monthName = date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const avgScore = daysPresent > 0 ? Math.round(totalScore / daysPresent) : 0;
    
    const html = `
        <h3>Monthly Report - ${monthName}</h3>
        <div class="weekly-summary" style="margin-bottom: 20px;">
            <h3>Monthly Summary</h3>
            <div class="summary-grid">
                <div class="summary-item">
                    <h4>Total Score</h4>
                    <div class="value">${totalScore}</div>
                </div>
                <div class="summary-item">
                    <h4>Days Tracked</h4>
                    <div class="value">${daysPresent}</div>
                </div>
                <div class="summary-item">
                    <h4>Average Score</h4>
                    <div class="value">${avgScore}/175</div>
                    <small>${Math.round((avgScore/175)*100)}%</small>
                </div>
            </div>
        </div>
        <table class="report-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Score</th>
                    <th>Percentage</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows || '<tr><td colspan="3" style="text-align: center; color: #999;">No data for this month</td></tr>'}
            </tbody>
        </table>
    `;
    
    document.getElementById('report-display').innerHTML = html;
}

function getScoreColor(score) {
    const maxScore = 25;
    const percentage = (score / maxScore) * 100;
    
    if (percentage >= 90) return '#c8e6c9'; // Light green
    if (percentage >= 70) return '#fff9c4'; // Light yellow
    if (percentage >= 50) return '#ffe0b2'; // Light orange
    return '#ffcdd2'; // Light red
}

// --- EXCEL DOWNLOAD ---
document.getElementById('download-excel-btn').onclick = async () => {
    const type = document.getElementById('report-type').value;
    const date = new Date(document.getElementById('report-date').value);
    
    if (type === 'weekly') {
        await downloadWeeklyExcel(date);
    } else if (type === 'monthly') {
        await downloadMonthlyExcel(date);
    } else {
        alert('Please select Weekly or Monthly report for Excel download');
    }
};

async function downloadWeeklyExcel(date) {
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    
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
    
    const weekData = {};
    snapshot.forEach(doc => {
        weekData[doc.id] = doc.data();
    });
    
    // Prepare Excel data
    const excelData = [
        ['RAPD SADHANA TRACKER - WEEKLY REPORT'],
        [`Week of ${formatDate(weekStart)}`],
        [],
        ['Date', 'Sleep', 'Wakeup', 'Morning Program', 'Chanting', 'Reading (mins)', 'Reading Score', 
         'Hearing (mins)', 'Hearing Score', 'Notes (mins)', 'Notes Score', 'Day Sleep', 'Total Score']
    ];
    
    let totalScore = 0;
    let totalReadingMins = 0;
    let totalHearingMins = 0;
    let totalNotesMins = 0;
    let totalNotesScore = 0;
    
    weekDates.forEach(dateStr => {
        const data = weekData[dateStr];
        if (data) {
            const sc = data.scores;
            totalScore += data.totalScore;
            totalReadingMins += data.readingMinutes;
            totalHearingMins += data.hearingMinutes;
            totalNotesMins += data.notesMinutes;
            totalNotesScore += sc.notes;
            
            excelData.push([
                formatDate(dateStr),
                sc.sleep,
                sc.wakeup,
                sc.morningProgram,
                sc.chanting,
                data.readingMinutes,
                sc.reading,
                data.hearingMinutes,
                sc.hearing,
                data.notesMinutes,
                sc.notes,
                sc.daySleep,
                data.totalScore
            ]);
        } else {
            excelData.push([formatDate(dateStr), 'No data', '', '', '', '', '', '', '', '', '', '', '']);
        }
    });
    
    // Weekly totals
    const weeklyNotesScore = totalNotesMins >= 245 ? 175 : totalNotesScore;
    const adjustedTotal = totalScore - totalNotesScore + weeklyNotesScore;
    
    excelData.push([]);
    excelData.push(['WEEKLY TOTALS', '', '', '', '', 
                    totalReadingMins, '', 
                    totalHearingMins, '', 
                    totalNotesMins, weeklyNotesScore, '', 
                    totalScore]);
    excelData.push(['ADJUSTED TOTAL (Notes Compensation)', '', '', '', '', '', '', '', '', '', '', '', adjustedTotal]);
    excelData.push([totalNotesMins >= 245 ? '✓ Weekly notes target achieved!' : `Target remaining: ${245 - totalNotesMins} mins`]);
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(excelData);
    
    // Styling
    ws['!cols'] = [
        {wch: 15}, {wch: 8}, {wch: 8}, {wch: 15}, {wch: 10}, 
        {wch: 12}, {wch: 12}, {wch: 12}, {wch: 12}, 
        {wch: 12}, {wch: 12}, {wch: 10}, {wch: 12}
    ];
    
    // Header styling (row 1 and 2)
    ws['A1'].s = {
        font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "667eea" } },
        alignment: { horizontal: "center" }
    };
    
    ws['A2'].s = {
        font: { bold: true, sz: 12 },
        fill: { fgColor: { rgb: "87CEEB" } }
    };
    
    // Column headers (row 4)
    for (let col = 0; col < 13; col++) {
        const cellAddr = XLSX.utils.encode_cell({ r: 3, c: col });
        if (!ws[cellAddr]) ws[cellAddr] = {};
        ws[cellAddr].s = {
            font: { bold: true, color: { rgb: "FFFFFF" } },
            fill: { fgColor: { rgb: "667eea" } },
            alignment: { horizontal: "center" }
        };
    }
    
    // Conditional formatting for scores (simplified - background colors)
    for (let row = 4; row < 4 + weekDates.length; row++) {
        // Score columns: B, C, D, E, G, I, K, L, M
        const scoreCols = [1, 2, 3, 4, 6, 8, 10, 11, 12];
        scoreCols.forEach(col => {
            const cellAddr = XLSX.utils.encode_cell({ r: row, c: col });
            if (ws[cellAddr] && typeof ws[cellAddr].v === 'number') {
                const score = ws[cellAddr].v;
                let bgColor = 'FFCDD2'; // Light red (default)
                
                if (score >= 20) bgColor = 'C8E6C9'; // Light green
                else if (score >= 15) bgColor = 'FFF9C4'; // Light yellow
                else if (score >= 10) bgColor = 'FFE0B2'; // Light orange
                
                ws[cellAddr].s = {
                    fill: { fgColor: { rgb: bgColor } },
                    alignment: { horizontal: "center" }
                };
            }
        });
    }
    
    XLSX.utils.book_append_sheet(wb, ws, 'Weekly Report');
    XLSX.writeFile(wb, `RAPD_Weekly_Report_${weekStart.toISOString().split('T')[0]}.xlsx`);
}

async function downloadMonthlyExcel(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);
    
    const snapshot = await db.collection('users').doc(currentUser.uid)
        .collection('sadhana')
        .where(firebase.firestore.FieldPath.documentId(), '>=', startDate.toISOString().split('T')[0])
        .where(firebase.firestore.FieldPath.documentId(), '<=', endDate.toISOString().split('T')[0])
        .get();
    
    const monthName = date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    
    const excelData = [
        ['RAPD SADHANA TRACKER - MONTHLY REPORT'],
        [monthName],
        [],
        ['Date', 'Sleep', 'Wakeup', 'Morning Program', 'Chanting', 'Reading', 'Hearing', 'Notes', 'Day Sleep', 'Total Score', 'Percentage']
    ];
    
    let totalScore = 0;
    let daysPresent = 0;
    
    const sortedDocs = [];
    snapshot.forEach(doc => sortedDocs.push({ id: doc.id, data: doc.data() }));
    sortedDocs.sort((a, b) => a.id.localeCompare(b.id));
    
    sortedDocs.forEach(({ id, data }) => {
        daysPresent++;
        totalScore += data.totalScore;
        const sc = data.scores;
        
        excelData.push([
            formatDate(id),
            sc.sleep,
            sc.wakeup,
            sc.morningProgram,
            sc.chanting,
            sc.reading,
            sc.hearing,
            sc.notes,
            sc.daySleep,
            data.totalScore,
            `${data.dayPercent}%`
        ]);
    });
    
    const avgScore = daysPresent > 0 ? Math.round(totalScore / daysPresent) : 0;
    
    excelData.push([]);
    excelData.push(['MONTHLY SUMMARY']);
    excelData.push(['Total Score', totalScore]);
    excelData.push(['Days Tracked', daysPresent]);
    excelData.push(['Average Score', `${avgScore}/175 (${Math.round((avgScore/175)*100)}%)`]);
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(excelData);
    
    ws['!cols'] = Array(11).fill({wch: 12});
    
    // Styling
    ws['A1'].s = {
        font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "667eea" } },
        alignment: { horizontal: "center" }
    };
    
    ws['A2'].s = {
        font: { bold: true, sz: 12 },
        fill: { fgColor: { rgb: "87CEEB" } }
    };
    
    XLSX.utils.book_append_sheet(wb, ws, 'Monthly Report');
    XLSX.writeFile(wb, `RAPD_Monthly_Report_${monthName.replace(' ', '_')}.xlsx`);
}

// --- CHARTS ---
let scoreChart = null;
let activityChart = null;

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
    
    const labels = dates.map(d => formatDate(d).split(' ')[0] + ' ' + formatDate(d).split(' ')[1]);
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
        
        labels.push(`Week ${formatDate(weekStart).split(' ')[0]}`);
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
        
        labels.push(month.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }));
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
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: 5,
                pointHoverRadius: 8,
                pointBackgroundColor: '#667eea',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointHoverBackgroundColor: '#764ba2',
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 3
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
                    position: 'top',
                    labels: {
                        font: {
                            size: 14,
                            weight: 'bold'
                        },
                        color: '#333'
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: '#667eea',
                    borderWidth: 2,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        title: function(context) {
                            return context[0].label;
                        },
                        label: function(context) {
                            const score = context.parsed.y;
                            const percentage = maxScore ? Math.round((score / maxScore) * 100) : 0;
                            return [
                                `Score: ${score}${maxScore ? '/' + maxScore : ''}`,
                                percentage ? `Percentage: ${percentage}%` : '',
                                score >= (maxScore * 0.8) ? '🌟 Excellent!' : 
                                score >= (maxScore * 0.6) ? '👍 Good!' : 
                                score >= (maxScore * 0.4) ? '📈 Keep going!' : '💪 You can do better!'
                            ].filter(Boolean);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: maxScore,
                    ticks: {
                        stepSize: maxScore ? maxScore / 5 : undefined,
                        font: {
                            size: 12
                        },
                        color: '#666'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    ticks: {
                        font: {
                            size: 11
                        },
                        color: '#666'
                    },
                    grid: {
                        display: false
                    }
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
        sleep: 'Sleep Time',
        wakeup: 'Wakeup Time',
        morning: 'Morning Program',
        chanting: 'Chanting',
        reading: 'Reading',
        hearing: 'Hearing',
        notes: 'Notes Revision'
    };
    
    const chartDatasets = Object.keys(datasets).map(key => ({
        label: activityNames[key] || key,
        data: datasets[key],
        borderColor: colors[key].border,
        backgroundColor: colors[key].bg,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBackgroundColor: colors[key].border,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverBackgroundColor: colors[key].border,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 3
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
                    position: 'top',
                    labels: {
                        font: {
                            size: 12
                        },
                        color: '#333',
                        padding: 15,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: '#667eea',
                    borderWidth: 2,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        title: function(context) {
                            return context[0].label;
                        },
                        label: function(context) {
                            const activity = context.dataset.label;
                            const score = context.parsed.y;
                            return [
                                `${activity}: ${score}/25`,
                                score >= 20 ? '🌟 Excellent!' : 
                                score >= 15 ? '👍 Very Good!' : 
                                score >= 10 ? '📈 Good!' : 
                                score >= 5 ? '💪 Keep improving!' : '⚠️ Needs attention'
                            ];
                        },
                        footer: function(context) {
                            const total = context.reduce((sum, item) => sum + item.parsed.y, 0);
                            return `Total for day: ${total}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 25,
                    ticks: {
                        stepSize: 5,
                        font: {
                            size: 12
                        },
                        color: '#666'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    ticks: {
                        font: {
                            size: 11
                        },
                        color: '#666'
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

document.getElementById('refresh-charts-btn').onclick = () => {
    generateCharts();
};

// Initial chart load
setTimeout(() => {
    if (currentUser) {
        generateCharts();
    }
}, 1000);
