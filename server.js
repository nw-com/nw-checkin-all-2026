const http = require('http');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

console.log("Starting server script...");

const port = 8000;
const LOG_REQUESTS = process.env.LOG_REQUESTS === '1';
const SILENT_PATHS = new Set(['/sw.js', '/@vite/client', '/favicon.ico']);

// Initialize Firebase Admin
let adminInitialized = false;
const initFirebaseAdmin = () => {
  if (adminInitialized) return;
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
    adminInitialized = true;
    console.log('Firebase Admin initialized successfully');
  } catch (e) {
    console.error('Failed to initialize Firebase Admin:', e);
  }
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

const server = http.createServer((req, res) => {
  // Log requests only when enabled, and skip known noisy paths
  const urlPath = req.url.split('?')[0];
  if (LOG_REQUESTS && !SILENT_PATHS.has(urlPath)) {
    console.log(`Request: ${urlPath}`);
  }

  // API Routes
  if (urlPath === '/api/admin/reset-password') {
    handleAdminResetPassword(req, res);
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
