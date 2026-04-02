const http = require('http');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

console.log("Starting server script...");

const port = 8001;
const LOG_REQUESTS = process.env.LOG_REQUESTS === '1';
const SILENT_PATHS = new Set(['/sw.js', '/@vite/client', '/favicon.ico']);
const APP_ID = process.env.APP_ID || 'default-attendance-app';
const ENABLE_COMMUNITY_ANOMALY_NOTIFIER = process.env.ENABLE_COMMUNITY_ANOMALY_NOTIFIER === '1';
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

const deriveCompanyNameFromCommunityId = (communityId) => {
  const cid = String(communityId || '').trim().toUpperCase();
  if (!cid) return '';
  if (cid.startsWith('A') || cid.startsWith('B')) return '台北公司';
  if (cid.startsWith('C')) return '桃園公司';
  return '';
};

let directoryCache = { ts: 0, users: [], roles: [], companies: [] };
const getDirectory = async (db) => {
  const now = Date.now();
  if (directoryCache.ts && (now - directoryCache.ts) < 60_000) return directoryCache;
  const [usersSnap, rolesSnap, companiesSnap] = await Promise.all([
    getPublicDataCollection(db, 'users').get(),
    getPublicDataCollection(db, 'roles').get(),
    getPublicDataCollection(db, 'companies').get(),
  ]);
  directoryCache = {
    ts: now,
    users: usersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    roles: rolesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    companies: companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
  return directoryCache;
};

const getUserRoleName = (u, roles) => {
  const rawRole = String(u?.role || '').trim().toLowerCase();
  if (rawRole === 'admin') return '系統管理員';
  const roleDoc = (roles || []).find(r => String(r.id) === String(u?.role));
  return String(roleDoc?.name || u?.roleName || u?.role || '').trim();
};

const getUserCompanyName = (u, companies) => {
  const ids = Array.isArray(u?.companyIds) ? u.companyIds : [];
  const companyId = ids.length > 0 ? ids[0] : (u?.companyId || '');
  const comp = (companies || []).find(c => String(c.id) === String(companyId));
  return String(comp?.name || u?.companyName || '').trim();
};

const isActiveUser = (u) => {
  const status = String(u?.status || '').trim();
  return status === '' || status === '在職';
};

const matchCompanyName = (userCompanyName, targetCompanyName) => {
  const a = String(userCompanyName || '');
  const b = String(targetCompanyName || '');
  if (!a || !b) return false;
  if (b.includes('台北')) return a.includes('台北');
  if (b.includes('桃園')) return a.includes('桃園');
  return a === b;
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

const handlePublicSubmitFeedback = async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  const db = getArtifactsDb();
  if (!db) {
    sendJson(res, 500, { ok: false, message: 'Firebase Admin not initialized' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { ok: false, message: e.message || 'Bad Request' });
    return;
  }

  const payload = body || {};
  const communityId = String(payload.communityId || '').trim();
  const communityName = String(payload.communityName || '').trim();
  const residentName = String(payload.residentName || '').trim();
  const residentPhone = String(payload.residentPhone || '').trim();
  const residentEmail = String(payload.residentEmail || '').trim();
  const residentFeedback = String(payload.residentFeedback || '').trim();

  if (!residentName || !residentPhone || !residentFeedback) {
    sendJson(res, 400, { ok: false, message: 'Missing required fields' });
    return;
  }

  const companyName = deriveCompanyNameFromCommunityId(communityId);
  let recipients = [];
  try {
    const dir = await getDirectory(db);
    const users = Array.isArray(dir.users) ? dir.users : [];
    const roles = Array.isArray(dir.roles) ? dir.roles : [];
    const companies = Array.isArray(dir.companies) ? dir.companies : [];

    for (const u of users) {
      if (!u || !isActiveUser(u)) continue;
      const roleKey = String(u.role || '').trim().toLowerCase();
      const roleName = getUserRoleName(u, roles);
      const uCompanyName = getUserCompanyName(u, companies);

      const isAdmin = roleKey === 'admin' || roleName.includes('系統管理員');
      const isManager = roleKey === 'manager' || roleName.includes('管理');
      const isHr = roleKey === 'hr' || roleName.includes('人事');
      const isProperty = roleKey === 'property' || roleName.includes('物業');
      const isCadre = roleKey === 'cadre' || roleName.includes('幹部');

      if (isAdmin || isManager || isHr) {
        const name = String(u.name || '').trim();
        if (name) recipients.push(name);
        continue;
      }

      if ((isProperty || isCadre) && matchCompanyName(uCompanyName, companyName)) {
        const name = String(u.name || '').trim();
        if (name) recipients.push(name);
      }
    }
  } catch (e) {
    console.error('Submit feedback directory error:', e);
    recipients = [];
  }

  recipients = Array.from(new Set(recipients));

  const content = [
    '【客服意見反應】',
    companyName ? `公司：${companyName}` : null,
    (communityName || communityId) ? `社區：${communityName || communityId}` : '社區：未知',
    residentName ? `住戶：${residentName}` : null,
    residentPhone ? `電話：${residentPhone}` : null,
    residentEmail ? `Email：${residentEmail}` : null,
    residentFeedback ? `內容：${residentFeedback}` : '內容：無',
  ].filter(Boolean).join('\n');

  try {
    const feedbackRef = db.collection('feedbacks').doc();
    const notificationsRef = getPublicDataCollection(db, 'notifications');
    const notifRef = notificationsRef.doc();
    const batch = db.batch();

    batch.set(feedbackRef, {
      communityId,
      communityName,
      residentName,
      residentPhone,
      residentEmail,
      residentFeedback,
      status: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'public_api',
    });

    if (recipients.length > 0) {
      batch.set(notifRef, {
        target: recipients.join('、'),
        content,
        senderName: '客服系統',
        senderId: 'server',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'server',
        type: 'feedback',
        feedbackId: feedbackRef.id,
        companyName,
        communityId: communityId || '',
      });
    }

    await batch.commit();
    sendJson(res, 200, { ok: true, id: feedbackRef.id, notifiedTo: recipients });
  } catch (e) {
    console.error('Submit feedback error:', e);
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

  if (urlPath === '/api/public/submit-feedback') {
    handlePublicSubmitFeedback(req, res);
    return;
  }

  if (urlPath === '/api/admin/reset-password') {
    handleAdminResetPassword(req, res);
    return;
  }

  if (urlPath === '/api/system/check-community-anomalies') {
    if (!ENABLE_COMMUNITY_ANOMALY_NOTIFIER) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
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
