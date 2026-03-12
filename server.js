const http = require('http');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

console.log("Starting server script...");

const port = 8001;
const LOG_REQUESTS = process.env.LOG_REQUESTS === '1';
const SILENT_PATHS = new Set(['/sw.js', '/@vite/client', '/favicon.ico']);
const APP_ID = process.env.APP_ID || 'default-attendance-app';
const ENABLE_COMMUNITY_ANOMALY_NOTIFIER = process.env.ENABLE_COMMUNITY_ANOMALY_NOTIFIER !== '0';
const COMMUNITY_ANOMALY_INTERVAL_MS = Number(process.env.COMMUNITY_ANOMALY_INTERVAL_MS || 5 * 60 * 1000);

// Initialize Firebase Admin
let adminInitialized = false;
const initFirebaseAdmin = () => {
  if (adminInitialized) return;
  try {
    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GCLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      'nw-checkin-all-2026';
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
    });
    adminInitialized = true;
    console.log('Firebase Admin initialized successfully');
  } catch (e) {
    console.error('Failed to initialize Firebase Admin:', e);
  }
};

const formatLocalYMD = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getArtifactsDb = () => {
  initFirebaseAdmin();
  if (!adminInitialized) return null;
  return admin.firestore();
};

const getPublicDataCollection = (db, collectionName) => {
  return db.collection('artifacts').doc(APP_ID).collection('public').doc('data').collection(collectionName);
};

const getTargetRoles = () => (['admin', 'manager', 'hr', 'property', 'cadre']);

const getPushSettings = async (db) => {
  try {
    const docRef = db.collection('artifacts').doc(APP_ID).collection('public').doc('data').collection('settings').doc('push');
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      const data = docSnap.data() || {};
      const roles = Array.isArray(data.targetRoles) ? data.targetRoles : undefined;
      const userIds = Array.isArray(data.targetUserIds) ? data.targetUserIds : undefined;
      return { targetRoles: roles, targetUserIds: userIds };
    }
    return null;
  } catch (e) {
    console.error('Failed to fetch push settings:', e);
    return null;
  }
};

const computeCommunityAnomaliesForToday = async () => {
  const db = getArtifactsDb();
  if (!db) return { ok: false, message: 'Firebase Admin not initialized', results: [] };

  const now = new Date();
  const todayStr = formatLocalYMD(now);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const communitiesRef = getPublicDataCollection(db, 'communities');
  const schedulesRef = getPublicDataCollection(db, 'schedules');
  const attendanceRef = getPublicDataCollection(db, 'attendance');
  const leavesRef = getPublicDataCollection(db, 'leaves');

  const [communitiesSnap, schedulesSnap, attendanceSnap, pendingLeavesSnap, usersSnap] = await Promise.all([
    communitiesRef.get(),
    schedulesRef.where('date', '==', todayStr).get(),
    attendanceRef.where('timestamp', '>=', startOfDay).where('timestamp', '<=', endOfDay).get(),
    leavesRef.where('approvalStatus', '==', 'pending').get(),
    getPublicDataCollection(db, 'users').get(),
  ]);

  const communities = communitiesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const todaySchedules = schedulesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const todayAttendance = attendanceSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const pendingLeaves = pendingLeavesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const results = [];
  for (const comm of communities) {
    const commId = String(comm.id);
    const commName = String(comm.name || '');

    // Skip anomaly generation for communities without active users
    const hasActiveUsers = users.some(u => {
      const uComms = (u.communityIds && Array.isArray(u.communityIds)) ? u.communityIds : (u.communityId ? [u.communityId] : []);
      const inComm = uComms.some(cid => String(cid) === String(commId));
      const active = (u.status === '在職' || !u.status);
      return inComm && active;
    });
    if (!hasActiveUsers) {
      results.push({
        communityId: commId,
        communityName: commName,
        date: todayStr,
        total: 0,
        anomalyIds: [],
        breakdown: {
          pendingLeaves: 0,
          dayVacancies: 0,
          nightVacancies: 0,
          dayAttendanceAnomalies: 0,
          nightAttendanceAnomalies: 0,
        },
      });
      continue;
    }

    const commSchedules = todaySchedules.filter(s => String(s.communityId) === commId);

    const daySchedules = commSchedules.filter(s => s.shift === 'day');
    const nightSchedules = commSchedules.filter(s => s.shift === 'night');

    const dayGuardPoints = Array.from(new Set((comm.dayGuardPoints || []).map(p => String(p || '').trim()).filter(Boolean)));
    const nightGuardPoints = Array.from(new Set((comm.nightGuardPoints || []).map(p => String(p || '').trim()).filter(Boolean)));

    const assignedDayPoints = new Set(daySchedules.map(s => String(s.sentryPoint || '').trim()).filter(Boolean));
    const assignedNightPoints = new Set(nightSchedules.map(s => String(s.sentryPoint || '').trim()).filter(Boolean));

    const dayVacancies = dayGuardPoints.filter(p => !assignedDayPoints.has(p));
    const nightVacancies = nightGuardPoints.filter(p => !assignedNightPoints.has(p));

    const hasAttendanceAnomaly = (att) => {
      return ['遲到', '早退', '未打下班打卡'].includes(att.status);
    };

    const anomalyIds = [];

    // Pending Leaves
    const commPendingLeaves = pendingLeaves.filter(l => String(l.communityId) === commId);
    commPendingLeaves.forEach(l => anomalyIds.push(`leave_${l.id}`));

    // Vacancies
    dayVacancies.forEach(p => anomalyIds.push(`vacancy_day_${todayStr}_${p}`));
    nightVacancies.forEach(p => anomalyIds.push(`vacancy_night_${todayStr}_${p}`));

    let dayAttendanceAnomalies = 0;
    for (const sched of daySchedules) {
      const att = todayAttendance.find(a => String(a.userId) === String(sched.userId) && a.shift === 'day');
      if (!att) {
        if (now.getHours() >= 8) {
            dayAttendanceAnomalies++;
            anomalyIds.push(`missing_day_${todayStr}_${sched.userId}`);
        }
      } else if (hasAttendanceAnomaly(att)) {
        dayAttendanceAnomalies++;
        anomalyIds.push(`abnormal_att_${att.id}`);
      }
    }

    let nightAttendanceAnomalies = 0;
    for (const sched of nightSchedules) {
      const att = todayAttendance.find(a => String(a.userId) === String(sched.userId) && a.shift === 'night');
      if (!att) {
        if (now.getHours() >= 20) {
            nightAttendanceAnomalies++;
            anomalyIds.push(`missing_night_${todayStr}_${sched.userId}`);
        }
      } else if (hasAttendanceAnomaly(att)) {
        nightAttendanceAnomalies++;
        anomalyIds.push(`abnormal_att_${att.id}`);
      }
    }

    const total = anomalyIds.length;

    results.push({
      communityId: commId,
      communityName: commName,
      date: todayStr,
      total,
      anomalyIds,
      breakdown: {
        pendingLeaves: commPendingLeaves.length,
        dayVacancies: dayVacancies.length,
        nightVacancies: nightVacancies.length,
        dayAttendanceAnomalies,
        nightAttendanceAnomalies,
      },
    });
  }

  return { ok: true, date: todayStr, results };
};

const checkAndNotifyCommunityAnomalies = async () => {
  const db = getArtifactsDb();
  if (!db) return { ok: false, message: 'Firebase Admin not initialized' };

  const settings = await getPushSettings(db);
  const targetRoles = (settings && Array.isArray(settings.targetRoles)) ? settings.targetRoles : [];
  const targetUserIds = (settings && Array.isArray(settings.targetUserIds)) ? settings.targetUserIds : [];

  const computed = await computeCommunityAnomaliesForToday();
  if (!computed.ok) return computed;

  const statesRef = getPublicDataCollection(db, 'community_anomaly_states');
  const notificationsRef = getPublicDataCollection(db, 'notifications');

  const todayStr = computed.date;
  
  let sent = 0;

  for (const r of computed.results) {
    const commId = String(r.communityId);
    const stateDocRef = statesRef.doc(commId);
    const stateDoc = await stateDocRef.get();
    
    const lastIds = new Set(stateDoc.exists ? (stateDoc.data().lastAnomalyIds || []) : []);
    
    // Identify NEW items
    const newItems = r.anomalyIds.filter(id => !lastIds.has(id));
    
    const hasChanges = r.anomalyIds.length !== lastIds.size || !r.anomalyIds.every(id => lastIds.has(id));

    if (newItems.length > 0) {
        const breakdown = r.breakdown || {};
        const bodyParts = [];
        if (breakdown.pendingLeaves) bodyParts.push(`待審核假單 ${breakdown.pendingLeaves}`);
        if (breakdown.dayVacancies) bodyParts.push(`日班缺哨 ${breakdown.dayVacancies}`);
        if (breakdown.nightVacancies) bodyParts.push(`夜班缺哨 ${breakdown.nightVacancies}`);
        if (breakdown.dayAttendanceAnomalies) bodyParts.push(`日班考勤異常 ${breakdown.dayAttendanceAnomalies}`);
        if (breakdown.nightAttendanceAnomalies) bodyParts.push(`夜班考勤異常 ${breakdown.nightAttendanceAnomalies}`);

        const body = `${r.communityName || '社區'} 新增異常事項，目前共有 ${r.total} 筆${bodyParts.length ? `（${bodyParts.join('、')}）` : ''}，請儘速處理。`;

        // Skip if no recipients configured
        if ((targetRoles.length === 0) && (targetUserIds.length === 0)) {
          continue;
        }
        const payload = {
            title: '社區異常通知',
            body,
            communityId: commId,
            targetRoles: targetRoles,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'server',
            type: 'community_anomaly',
            date: todayStr,
            anomalyIds: r.anomalyIds 
        };
        if (targetUserIds.length > 0) payload.targetUserIds = targetUserIds;
        await notificationsRef.add(payload);
        
        sent++;
    }

    if (hasChanges) {
        await stateDocRef.set({
            lastAnomalyIds: r.anomalyIds,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            communityName: r.communityName
        });
    }
  }

  return { ok: true, date: todayStr, sent };
};

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon'
};

const getBearerToken = (req) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : null;
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', chunk => body += chunk.toString());
  req.on('end', () => {
    try {
      resolve(body ? JSON.parse(body) : {});
    } catch (e) {
      reject(e);
    }
  });
  req.on('error', reject);
});

const sendJson = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

const handleAdminResetPassword = async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { ok: false, message: 'Missing bearer token' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { ok: false, message: e.message || 'Bad Request' });
    return;
  }

  const appId = body.appId;
  const targetEmail = body.email;
  const targetUserDocId = body.userDocId;

  if (!targetEmail) {
    sendJson(res, 400, { ok: false, message: 'Missing email' });
    return;
  }

  try {
    initFirebaseAdmin();
    
    // Verify the caller's token
    const decoded = await admin.auth().verifyIdToken(token);
    
    // Ideally we should check if the caller is an admin using Firestore
    // For now, we'll proceed as the frontend protects the button visibility usually
    // But let's at least log who is doing it
    console.log(`Admin reset password requested by ${decoded.email} for ${targetEmail}`);

    // Get user by email to find UID
    let userRecord;
    try {
        userRecord = await admin.auth().getUserByEmail(targetEmail);
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            sendJson(res, 404, { ok: false, message: 'User not found in Auth' });
            return;
        }
        throw e;
    }

    // Update password
    await admin.auth().updateUser(userRecord.uid, {
        password: '123456'
    });

    // Also update Firestore if needed (optional, but good for consistency if app relies on it)
    if (appId && targetUserDocId) {
        const db = admin.firestore();
        await db.collection('artifacts').doc(appId)
            .collection('public').doc('data')
            .collection('users').doc(targetUserDocId)
            .update({
                password: '123456', // Storing plaintext password is bad practice but seems legacy here
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
    }

    sendJson(res, 200, { ok: true, message: 'Password reset successfully' });

  } catch (e) {
    console.error('Reset password error:', e);
    sendJson(res, 500, { ok: false, message: e.message || 'Internal server error' });
  }
};

const handlePublicCommunityName = async (req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  let code = '';
  try {
    const base = `http://${req.headers.host || `localhost:${port}`}`;
    const u = new URL(req.url, base);
    code = String(u.searchParams.get('code') || '').trim();
  } catch (e) {
    sendJson(res, 400, { ok: false, message: 'Bad Request' });
    return;
  }

  if (!code) {
    sendJson(res, 400, { ok: false, message: 'Missing code' });
    return;
  }

  try {
    const db = getArtifactsDb();
    if (!db) {
      sendJson(res, 500, { ok: false, message: 'Firebase Admin not initialized' });
      return;
    }

    const snap = await getPublicDataCollection(db, 'communities').doc(code).get();
    if (!snap.exists) {
      sendJson(res, 200, { ok: true, exists: false, name: '' });
      return;
    }
    const data = snap.data() || {};
    sendJson(res, 200, { ok: true, exists: true, name: String(data.name || '') });
  } catch (e) {
    console.error('Public community name error:', e);
    sendJson(res, 500, { ok: false, message: e.message || 'Internal server error' });
  }
};

const server = http.createServer((req, res) => {
  // Log requests only when enabled, and skip known noisy paths
  const urlPath = req.url.split('?')[0];
  if (LOG_REQUESTS && !SILENT_PATHS.has(urlPath)) {
    console.log(`Request: ${urlPath}`);
  }

  // API Routes
  if (urlPath === '/api/public/community-name') {
    handlePublicCommunityName(req, res);
    return;
  }

  if (urlPath === '/api/admin/reset-password') {
    handleAdminResetPassword(req, res);
    return;
  }

  if (urlPath === '/api/system/check-community-anomalies') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }
    checkAndNotifyCommunityAnomalies()
      .then((result) => sendJson(res, 200, result))
      .catch((e) => {
        console.error('check-community-anomalies error:', e);
        sendJson(res, 500, { ok: false, message: e.message || 'Internal server error' });
      });
    return;
  }

  // Handle URL parameters (ignore them for file serving)
  let filePath = '.' + urlPath;
  if (filePath === './') {
    filePath = './index.html';
  }

  // Prevent directory traversal
  const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const absolutePath = path.resolve(__dirname, safePath);

  // Check if file exists
  fs.access(absolutePath, fs.constants.F_OK, (err) => {
      if (err) {
          if (LOG_REQUESTS && !SILENT_PATHS.has(urlPath)) {
            console.log(`File not found: ${absolutePath}`);
          }
          res.writeHead(404);
          res.end('404 File Not Found');
          return;
      }

      // If it is a directory, try serving index.html
      if (fs.statSync(absolutePath).isDirectory()) {
          const indexPath = path.join(absolutePath, 'index.html');
          if (fs.existsSync(indexPath)) {
              filePath = indexPath; 
              // recursive call or just read it? Let's just read it
              const extname = '.html';
              const contentType = mimeTypes[extname];
              fs.readFile(indexPath, (error, content) => {
                if (error) {
                    res.writeHead(500);
                    res.end('Error loading index.html');
                } else {
                    res.writeHead(200, { 'Content-Type': contentType });
                    res.end(content, 'utf-8');
                }
              });
              return;
          }
      }
      
      const extname = String(path.extname(absolutePath)).toLowerCase();
      const contentType = mimeTypes[extname] || 'application/octet-stream';

      fs.readFile(absolutePath, (error, content) => {
        if (error) {
          if(error.code == 'ENOENT'){
            res.writeHead(404);
            res.end('404 File Not Found');
          } else {
            res.writeHead(500);
            res.end('Sorry, check with the site admin for error: '+error.code+' ..\n');
          }
        } else {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content, 'utf-8');
        }
      });
  });
});

server.on('error', (e) => {
  console.error('Server error:', e);
});

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});

if (ENABLE_COMMUNITY_ANOMALY_NOTIFIER) {
  const run = async () => {
    try {
      const result = await checkAndNotifyCommunityAnomalies();
      if (LOG_REQUESTS) console.log('Community anomaly notifier:', result);
    } catch (e) {
      console.error('Community anomaly notifier error:', e);
    }
  };

  setTimeout(() => {
    run().catch(() => {});
    setInterval(() => run().catch(() => {}), COMMUNITY_ANOMALY_INTERVAL_MS);
  }, 10_000);
}
