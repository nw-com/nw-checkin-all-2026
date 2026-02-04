import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js";
import { initializeFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, where, setLogLevel, onSnapshot, writeBatch, addDoc, orderBy, deleteField, limit } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

// === Error Suppression Logic ===
// Note: Global error suppression is now handled in the <head> of each HTML file.


function initGlobalLayout() {
  // Only apply to Community Admin (body has class "admin")
  if (!document.body.classList.contains('admin')) return;
  
  if (document.getElementById('global-layout')) return;
  const body = document.body;
  const layout = document.createElement('div');
  layout.id = 'global-layout';
  layout.style.cssText = 'display: flex; width: 100vw; height: 100vh; overflow: hidden;';
  const left = document.createElement('div');
  left.id = 'layout-left';
  left.style.cssText = 'width: 100%; height: 100%; position: relative; overflow-y: auto; overflow-x: hidden; transform: translate(0,0);';
  const right = document.createElement('div');
  right.id = 'layout-right';
  right.style.cssText = 'display: none; width: 10%; height: 100%; background: #ffffff; border-left: 1px solid #e5e7eb; position: relative; z-index: 99999;';
  while (body.firstChild) {
    left.appendChild(body.firstChild);
  }
  layout.appendChild(left);
  layout.appendChild(right);
  body.appendChild(layout);
  body.style.margin = '0';
  body.style.padding = '0';
  body.style.overflow = 'hidden';
}
initGlobalLayout();

function showLoading(text = "處理中...") {
  const overlay = document.createElement("div");
  overlay.className = "loading-overlay";
  overlay.id = "global-loading-overlay";
  overlay.innerHTML = `
    <div class="loading-spinner"></div>
    <div class="loading-text">${text}</div>
  `;
  document.body.appendChild(overlay);
}

function hideLoading() {
  const overlay = document.getElementById("global-loading-overlay");
  if (overlay) overlay.remove();
}

// === Phone Lookup Sync Helper ===
async function syncUserLookup(oldPhone, newPhone, email) {
  // Normalize phones (trim)
  oldPhone = oldPhone ? oldPhone.trim() : "";
  newPhone = newPhone ? newPhone.trim() : "";
  
  // If no change, but email might need update (if phone exists)
  if (oldPhone === newPhone) {
    if (newPhone && email) {
       try {
         await setDoc(doc(db, "user_lookup", newPhone), { email }, { merge: true });
       } catch(e) { console.warn("Sync phone lookup email failed", e); }
    }
    return;
  }

  // 1. Remove old mapping if exists
  if (oldPhone) {
    try {
      await deleteDoc(doc(db, "user_lookup", oldPhone));
    } catch (e) {
      console.warn("Failed to delete old phone lookup", e);
    }
  }

  // 2. Add new mapping if exists
  if (newPhone && email) {
    try {
      await setDoc(doc(db, "user_lookup", newPhone), { email });
    } catch (e) {
      console.warn("Failed to set new phone lookup", e);
    }
  }
}

const defaultFirebaseConfig = {
  apiKey: "AIzaSyDJKCa2QtJXLiXPsy0P7He_yuZEN__iQ6E",
  authDomain: "nw-app-all.firebaseapp.com",
  projectId: "nw-app-all",
  storageBucket: "nw-app-all.firebasestorage.app",
  messagingSenderId: "205108931232",
  appId: "1:205108931232:web:ee7868f73ed883253577c5",
  measurementId: "G-8F1WD772LP"
};

let firebaseConfig = defaultFirebaseConfig;
try {
  const savedConfig = localStorage.getItem("nw_firebase_config");
  if (savedConfig) {
    firebaseConfig = { ...defaultFirebaseConfig, ...JSON.parse(savedConfig) };
    console.log("Loaded custom firebase config");
  }
} catch (e) {
  console.warn("Failed to load custom config", e);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false
});
const storage = getStorage(app);
setLogLevel("silent");

// Secondary app for admin account creation to avoid switching current session
const createApp = initializeApp(firebaseConfig, "create-admin");
const createAuth = getAuth(createApp);

const communityConfigs = {
  default: firebaseConfig
};
const tenantApps = {};
function ensureTenant(slug) {
  const key = slug || "default";
  const cfg = communityConfigs[key] || communityConfigs.default;
  if (!tenantApps[key]) {
    const tapp = initializeApp(cfg, "tenant-" + key);
    tenantApps[key] = {
      app: tapp,
      db: initializeFirestore(tapp, {
        experimentalForceLongPolling: true,
        useFetchStreams: false
      }),
      storage: getStorage(tapp)
    };
  }
  return tenantApps[key];
}
function getQueryParam(name) {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has(name)) return params.get(name);
  } catch {}
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  } catch { return null; }
}
function getSlugFromPath() {
  try {
    const p = window.location.pathname;
    const m = p.match(/(?:front|admin)_([^.]+)\.html$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function ensureQrLib() {
  if (window.QRCode && window.QRCode.toDataURL) return;
  if (window._qrLibLoading) {
    await window._qrLibLoading;
    if (window.QRCode && window.QRCode.toDataURL) return;
    window._qrLibLoading = null; // Retry if failed
  }
  
  const sources = [
    'https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js', 
    'https://cdn.jsdelivr.net/gh/soldair/node-qrcode/build/qrcode.min.js'
  ];

  window._qrLibLoading = new Promise((resolve) => {
    let idx = 0;
    const tryLoad = () => {
      if (window.QRCode && window.QRCode.toDataURL) return resolve();
      if (idx >= sources.length) return resolve(); // All failed
      
      const s = document.createElement('script');
      s.src = sources[idx++];
      s.onload = () => resolve();
      s.onerror = () => tryLoad(); // Try next source
      document.head.appendChild(s);
    };
    tryLoad();
  });
  
  await window._qrLibLoading;
}

async function ensureXlsxLib() {
  if (window.XLSX) return;
  if (window._xlsxLibLoading) return window._xlsxLibLoading;
  const sources = [
    'https://cdn.jsdelivr.net/npm/xlsx@0.20.2/dist/xlsx.full.min.js',
    'https://unpkg.com/xlsx@0.20.2/dist/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.20.2/xlsx.full.min.js'
  ];
  window._xlsxLibLoading = new Promise((resolve) => {
    let idx = 0;
    const tryLoad = () => {
      if (window.XLSX) return resolve();
      if (idx >= sources.length) return resolve();
      const s = document.createElement('script');
      s.src = sources[idx++];
      s.onload = () => resolve();
      s.onerror = () => tryLoad();
      document.head.appendChild(s);
      setTimeout(() => {
        if (!window.XLSX) tryLoad();
      }, 5000);
    };
    tryLoad();
  });
  await window._xlsxLibLoading;
}

async function getQrDataUrl(text, size) {
  try {
    await ensureQrLib();
    if (window.QRCode && window.QRCode.toDataURL) {
      return await window.QRCode.toDataURL(text, { width: size || 64, margin: 0 });
    }
    console.warn("QR Lib not loaded, using fallback API.");
  } catch (e) {
    console.error("QR Gen Error:", e);
  }
  // Fallback to online API
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size||150}x${size||150}&data=${encodeURIComponent(text)}`;
}
function checkPagePermission(role, path) {
  const p = path || window.location.pathname;
  if (p.includes("sys")) {
    return role === "系統管理員";
  } else if (p.includes("admin")) {
    return role === "系統管理員" || role === "管理員" || role === "總幹事" || role === "社區";
  } else if (p.includes("front")) {
    return role === "系統管理員" || role === "住戶" || role === "管理員" || role === "總幹事" || role === "社區";
  }
  return true;
}
async function getUserCommunity(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const d = snap.data();
      return d.community || "default";
    }
  } catch {}
  return "default";
}

const el = {
  authCard: document.getElementById("auth-card"),
  profileCard: document.getElementById("profile-card"),
  hint: document.getElementById("auth-hint"),
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  btnLogin: document.getElementById("btn-login"),
  btnRegister: document.getElementById("btn-register"),
  btnReset: document.getElementById("btn-reset"),
  btnSignout: document.getElementById("btn-signout"),
  profileEmail: document.getElementById("profile-email"),
  profileRole: document.getElementById("profile-role"),
};

const brand = document.querySelector(".brand-logo");
let lastTap = 0;
if (brand) {
  brand.addEventListener("dblclick", () => {
    location.href = "admin.html";
  });
  brand.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTap < 300) {
      location.href = "admin.html";
    }
    lastTap = now;
  }, { passive: true });
}

const frontStack = document.getElementById("front-stack");
const adminStack = document.getElementById("admin-stack");
const sysStack = document.getElementById("sys-stack");
const mainContainer = document.querySelector("main.container");
const btnSignoutFront = document.getElementById("btn-signout-front");
const btnSignoutAdmin = document.getElementById("btn-signout-admin");
const btnSignoutSys = document.getElementById("btn-signout-sys");
const btnAdminSecret = document.getElementById("btn-admin-secret");
const rememberMe = document.getElementById("remember-me");
const btnTogglePassword = document.getElementById("btn-toggle-password");

if (btnAdminSecret) {
  btnAdminSecret.addEventListener("click", () => {
    location.href = "sys.html";
  });
}

window.addEventListener('offline', () => {
  showHint("網路已斷線，請檢查您的網際網路連線", "error");
});
window.addEventListener('online', () => {
  showHint("網路已恢復連線", "success");
});

function showConfirmModal(title, message, confirmText, confirmClass, onConfirm) {
  const body = `
    <div class="modal-dialog" style="max-width: 400px;">
      <div class="modal-head">
        <div class="modal-title">${title}</div>
      </div>
      <div class="modal-body">
        <div style="padding: 20px; font-size: 16px; line-height: 1.5;">${message}</div>
      </div>
      <div class="modal-foot">
        <button class="btn action-btn" onclick="closeModal()">取消</button>
        <button id="btn-modal-confirm" class="btn action-btn ${confirmClass}">${confirmText}</button>
      </div>
    </div>
  `;
  openModal(body);
  const btn = document.getElementById("btn-modal-confirm");
  if (btn) {
    btn.onclick = async () => {
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = "處理中...";
      try {
        await onConfirm();
        closeModal();
      } catch (e) {
        console.error(e);
        btn.disabled = false;
        btn.textContent = originalText;
        alert("操作失敗: " + e.message);
      }
    };
  }
}

function openModal(html) {
  let root = document.getElementById("sys-modal");
  if (!root) {
    root = document.createElement("div");
    root.id = "sys-modal";
    root.className = "modal hidden";
    document.body.appendChild(root);
  }
  root.innerHTML = html;
  root.classList.remove("hidden");
}
function closeModal() {
  const root = document.getElementById("sys-modal");
  if (!root) return;
  root.classList.add("hidden");
  root.innerHTML = "";
}
window.closeModal = closeModal;
async function openUserProfileModal() {
  const u = auth.currentUser;
  const email = (u && u.email) || "";
  let name = (u && u.displayName) || "";
  let photo = (u && u.photoURL) || "";
  let phone = "";
  let status = "啟用";
  let role = "住戶";
  let qrCodeText = "";
  let houseNo = "";
  let subNo = "";
  let points = 0;
  if (u) {
    try {
      const snap = await getDoc(doc(db, "users", u.uid));
      if (snap.exists()) {
        const d = snap.data();
        name = name || d.displayName || "";
        photo = photo || d.photoURL || "";
        phone = d.phone || "";
        status = d.status || status;
        role = d.role || role;
        qrCodeText = d.qrCodeText || "";
        houseNo = d.houseNo || "";
        subNo = d.subNo !== undefined ? d.subNo : "";
        
        const community = d.community || "default";
        if (houseNo) {
          let found = false;
          
          // 0. Try User Doc (Optimization)
          if (typeof d.points === 'number') {
              points = d.points;
              found = true;
          }

          if (!found) {
            try {
              const bdoc = await getDoc(doc(db, `communities/${community}/app_modules/points_balances/${houseNo}`));
              if (bdoc.exists()) {
                points = bdoc.data().balance || 0;
                found = true;
              }
            } catch (e) {
              console.log("Points fetch error (primary):", e);
            }
          }
          
          if (!found) {
            try {
              const pdoc = await getDoc(doc(db, `communities/${community}/app_modules/points`));
              if (pdoc.exists()) {
                const data = pdoc.data();
                const bmap = data.balances || {};
                points = typeof bmap[houseNo] === "number" ? bmap[houseNo] : 0;
              }
            } catch (e) {
              console.log("Points fetch error (fallback):", e);
            }
          }
        }
      }
    } catch {}
  }
  
  let qrCodeUrl = "";
  if (qrCodeText) {
    qrCodeUrl = await getQrDataUrl(qrCodeText, 150);
  }

  const title = `個人資訊-${role} ${name}`;
  const houseInfo = (houseNo || subNo) ? `<div style="font-size: 18px; font-weight: 600; color: #333; margin-bottom: 8px;">${houseNo} - ${subNo}</div>` : '';

  const body = `
    <div class="modal-dialog">
      <div class="modal-head"><div class="modal-title">${title}</div></div>
      <div class="modal-body" style="display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 20px; gap: 20px;">
        ${houseInfo}
        <img class="avatar-preview" src="${photo || ""}" style="width: 120px; height: 120px;">
        ${qrCodeUrl ? `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <img src="${qrCodeUrl}" style="width: 150px; height: 150px;">
                <div style="font-size: 16px; color: #333; font-weight: 500;">${qrCodeText}</div>
            </div>
        ` : ''}
        <div style="font-size: 16px; color: #555; margin-top: -10px;">目前點數: <span style="font-weight: 600; color: #d32f2f;">${points}</span></div>
      </div>
      <div class="modal-foot">
        <button id="profile-close" class="btn action-btn danger">關閉</button>
        <button id="profile-signout" class="btn action-btn">登出</button>
      </div>
    </div>
  `;
  openModal(body);
  const btnClose = document.getElementById("profile-close");
  const btnSignout = document.getElementById("profile-signout");
  btnClose && btnClose.addEventListener("click", () => closeModal());
  btnSignout && btnSignout.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } finally {
      redirectAfterSignOut();
    }
  });
}

function showHint(text, type = "info") {
  if (!el.hint) {
    if (type === "error" || type === "success") alert(text);
    return;
  }
  el.hint.textContent = text;
  el.hint.style.color = type === "error" ? "#b71c1c" : type === "success" ? "#0ea5e9" : "#6b7280";
}

function redirectAfterSignOut() {
  const p = window.location.pathname;
  if (p.includes("sys")) {
    location.href = "sys.html";
  } else if (p.includes("admin")) {
    location.reload();
  } else {
    location.href = "index.html";
  }
}

function toggleAuth(showAuth) {
  if (document.body.classList.contains('admin')) {
    const left = document.getElementById('layout-left');
    const right = document.getElementById('layout-right');
    if (left && right) {
      if (showAuth) {
        left.style.width = '100%';
        right.style.display = 'none';
      } else {
        left.style.width = '90%';
        right.style.display = 'block';
      }
    }
  }
  if (showAuth) {
    if (el.authCard) el.authCard.classList.remove("hidden");
    el.profileCard && el.profileCard.classList.add("hidden");
    frontStack && frontStack.classList.add("hidden");
    adminStack && adminStack.classList.add("hidden");
    sysStack && sysStack.classList.add("hidden");
    mainContainer && mainContainer.classList.remove("hidden");
  } else {
    if (el.authCard) el.authCard.classList.add("hidden");
    if (el.profileCard) el.profileCard.classList.add("hidden");
  }
}

async function getOrCreateUserRole(uid, email) {
  const ref = doc(db, "users", uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      // Superadmin by email override
      if (email === "nwapp.eason@gmail.com") {
        if (data.role !== "系統管理員") {
          try {
            await setDoc(ref, { role: "系統管理員", status: "啟用" }, { merge: true });
          } catch {}
        }
        return "系統管理員";
      }
      if (data.status === "停用") return "停用";
      return data.role || "住戶";
    }
    try {
      const base = { email, role: email === "nwapp.eason@gmail.com" ? "系統管理員" : "住戶", status: "啟用", createdAt: Date.now() };
      await setDoc(ref, base, { merge: true });
    } catch {}
    return email === "nwapp.eason@gmail.com" ? "系統管理員" : "住戶";
  } catch {
    return email === "nwapp.eason@gmail.com" ? "系統管理員" : "住戶";
  }
}

const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const loginInput = el.email.value.trim();
    const password = el.password.value;
    if (!loginInput || !password) return showHint("請輸入帳號密碼", "error");

    el.btnLogin.disabled = true;
    el.btnLogin.textContent = "登入中...";
    try {
      let emailToAuth = loginInput;
      // Simple email check
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginInput);
      
      if (!isEmail) {
         // Assume phone number - lookup email
         try {
           const phoneDocRef = doc(db, "user_lookup", loginInput);
           const phoneDoc = await getDoc(phoneDocRef);
           if (!phoneDoc.exists()) {
              throw { code: 'custom/user-not-found' };
           }
           emailToAuth = phoneDoc.data().email;
         } catch (lookupErr) {
           if (lookupErr.code === 'custom/user-not-found') {
             throw lookupErr;
           }
           console.error("Phone lookup error:", lookupErr);
           // If we can't query (e.g. permission denied before auth), this strategy fails.
           // However, usually login requires no auth to read some data? 
           // Actually, standard Firestore rules might BLOCK reading users if not authenticated.
           // If rules are "allow read: if request.auth != null", then we CANNOT lookup phone before login.
           // WE NEED TO CHECK FIREBASE RULES.
           throw lookupErr; 
        }
      }

      const cred = await signInWithEmailAndPassword(auth, emailToAuth, password);
      const role = await getOrCreateUserRole(cred.user.uid, cred.user.email);
      if (role === "停用") {
        showHint("帳號已停用，請聯繫管理員", "error");
        await signOut(auth);
        el.btnLogin.disabled = false;
        el.btnLogin.textContent = "登入";
        return;
      }
      showHint("登入成功", "success");
      // Strict Login Check based on Page
      if (!checkPagePermission(role, window.location.pathname)) {
         showHint("權限不足", "error");
         await signOut(auth);
         el.btnLogin.disabled = false;
         el.btnLogin.textContent = "登入";
         // Stay on login page, do not redirect
         return;
      }

      handleRoleRedirect(role);
    } catch (err) {
      console.error(err);
      let msg = "登入失敗";
      if (err.code === 'auth/invalid-credential') msg = "帳號或密碼錯誤";
      else if (err.code === 'auth/too-many-requests') msg = "嘗試次數過多，請稍後再試";
      showHint(msg, "error");
      el.btnLogin.disabled = false;
      el.btnLogin.textContent = "登入";
    }
  });
}

async function handleRoleRedirect(role) {
  if (role === "停用") {
    showHint("帳號已停用，請聯繫管理員", "error");
    await signOut(auth);
    return;
  }
  // Simple role based redirect logic
  if (window.location.pathname.includes("sys")) {
      if (role === "系統管理員") {
        toggleAuth(false);
        if (sysStack) sysStack.classList.remove("hidden");
        if (mainContainer) mainContainer.classList.add("hidden");
        
        const titleEl = sysStack.querySelector(".sys-title");
        if (titleEl) {
           titleEl.style.cursor = "pointer";
           titleEl.style.textDecoration = "underline";
           titleEl.title = "點擊切換社區";
           titleEl.addEventListener("click", () => openCommunitySwitcher("front"));
        }
      } else {
         showHint("權限不足", "error");
         await signOut(auth);
         // Stay on login page
      }
      return;
  }
  
  async function renderSettingsResidentsLegacy() {
    if (!sysNav.content) return;
    const u = auth.currentUser;
    const slug = u ? await getUserCommunity(u.uid) : "default";
    let cname = slug;
    let loadError = false;
    try {
      const csnap = await getDoc(doc(db, "communities", slug));
      if (csnap.exists()) {
        const c = csnap.data();
        cname = c.name || slug;
      }
    } catch {
      loadError = true;
    }
    let residents = [];
    try {
      const q = query(collection(db, "users"), where("community", "==", slug));
      const snapList = await getDocs(q);
      residents = snapList.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(a => (a.role || "住戶") === "住戶");
    } catch {
      loadError = true;
    }
    const rows = residents.map(a => {
      const nm = a.displayName || (a.email || "").split("@")[0] || "住戶";
      const av = a.photoURL
        ? `<img class="avatar" src="${a.photoURL}" alt="avatar">`
        : `<span class="avatar">${(nm || a.email || "住")[0]}</span>`;
      return `
        <tr data-uid="${a.id}">
          <td>${cname}</td>
          <td>${av}</td>
          <td>${nm}</td>
          <td>${a.phone || ""}</td>
          <td>••••••</td>
          <td>${a.email || ""}</td>
          <td>${a.role || "住戶"}</td>
          <td class="status">${a.status || "停用"}</td>
          <td class="actions">
            <button class="btn small action-btn btn-edit-resident">編輯</button>
            <button class="btn small action-btn danger btn-delete-resident">刪除</button>
          </td>
        </tr>
      `;
    }).join("");
    sysNav.content.innerHTML = `
      <div class="card data-card">
        <div class="card-head">
          <h1 class="card-title">住戶帳號列表（${cname}）</h1>
        </div>
        <div class="table-wrap">
          <table class="table">
            <colgroup>
              <col><col><col><col><col><col><col><col><col>
            </colgroup>
            <thead>
              <tr>
                <th>所屬社區</th>
                <th>大頭照</th>
                <th>姓名</th>
                <th>手機號碼</th>
                <th>密碼</th>
                <th>電子郵件</th>
                <th>角色</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${(!rows || rows === "") ? `<div class="empty-hint">${loadError ? "讀取失敗，請重新整理或稍後再試" : "目前沒有住戶資料"}</div>` : ""}
        </div>
      </div>
    `;
    const btnExportLegacy2 = document.getElementById("btn-export-resident");
    btnExportLegacy2 && btnExportLegacy2.addEventListener("click", async () => {
      btnExportLegacy2.disabled = true;
      btnExportLegacy2.textContent = "匯出中...";
      try {
        await ensureXlsxLib();
        if (!window.XLSX) throw new Error("Excel Library not found");
        const data = residents.map((r, idx) => ({
          "大頭照": r.photoURL || "",
          "序號": r.seq || "",
          "戶號": r.houseNo || "",
          "子戶號": r.subNo !== undefined ? r.subNo : "",
          "QR code": r.qrCodeText || "",
          "姓名": r.displayName || "",
          "地址": r.address || "",
          "坪數": r.area || "",
          "區分權比": r.ownershipRatio || "",
          "手機號碼": r.phone || "",
          "電子郵件": r.email || "",
          "狀態": r.status || "啟用"
        }));
        const ws = window.XLSX.utils.json_to_sheet(data);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Residents");
        window.XLSX.writeFile(wb, `${cname}_residents_${new Date().toISOString().slice(0,10)}.xlsx`);
      } catch(e) {
        console.error(e);
        alert("匯出失敗");
      } finally {
        btnExportLegacy2.disabled = false;
        btnExportLegacy2.textContent = "匯出 Excel";
      }
    });

    const btnImportLegacy2 = document.getElementById("btn-import-resident");
    btnImportLegacy2 && btnImportLegacy2.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".xlsx, .xls, .csv";
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        let overlay = document.getElementById("import-overlay");
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.id = "import-overlay";
          overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;justify-content:center;align-items:center;color:#fff;flex-direction:column;font-size:1.2rem;";
          document.body.appendChild(overlay);
        }
        overlay.style.display = "flex";
        overlay.innerHTML = `<div class="spinner"></div><div id="import-msg" style="margin-top:15px;">準備匯入中...</div>`;
        btnImportLegacy2.disabled = true;
        btnImportLegacy2.textContent = "匯入中...";
        try {
          await ensureXlsxLib();
          if (!window.XLSX) throw new Error("Excel Library not found");
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              const data = new Uint8Array(e.target.result);
              const workbook = window.XLSX.read(data, { type: 'array' });
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
              if (jsonData.length === 0) {
                alert("檔案內容為空");
                overlay.style.display = "none";
                return;
              }
              if (!confirm(`即將匯入 ${jsonData.length} 筆資料，確定嗎？`)) {
                overlay.style.display = "none";
                return;
              }
              let successCount = 0;
              let failCount = 0;
              const total = jsonData.length;
              const updateProgress = (processed) => {
                 const el = document.getElementById("import-msg");
                 if (el) el.textContent = `匯入中... ${processed} / ${total}`;
              };
              const CHUNK_SIZE = 20; 
              for (let i = 0; i < total; i += CHUNK_SIZE) {
                const chunk = jsonData.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);
                let hasWrites = false;
                const promises = chunk.map(async (row) => {
                    try {
                        const email = (row["電子郵件"] || "").trim();
                        const password = (row["密碼"] || "123456").trim();
                        const displayName = (row["姓名"] || "").trim();
                        const phone = (row["手機號碼"] || "").toString().trim();
                        const seq = (row["序號"] || "").toString().trim();
                        const houseNo = (row["戶號"] || "").toString().trim();
                        const subNoRaw = row["子戶號"];
                        const qrCodeText = (row["QR code"] || "").trim();
                        const address = (row["地址"] || "").trim();
                        const area = (row["坪數"] || "").toString().trim();
                        const ownershipRatio = (row["區分權比"] || "").toString().trim();
                        const status = (row["狀態"] || "停用").trim();
                        const photoURL = (row["大頭照"] || "").trim();
                        if (!email) { failCount++; return null; }
                        let uid = null;
                        try {
                            const cred = await createUserWithEmailAndPassword(createAuth, email, password);
                            uid = cred.user.uid;
                            await updateProfile(cred.user, { displayName, photoURL });
                            await signOut(createAuth);
                        } catch (authErr) {
                            if (authErr.code === 'auth/email-already-in-use') {
                                const qUser = query(collection(db, "users"), where("email", "==", email));
                                const snapUser = await getDocs(qUser);
                                if (!snapUser.empty) uid = snapUser.docs[0].id;
                            }
                            if (!uid) { failCount++; return null; }
                        }
                        if (uid) {
                            const docRef = doc(db, "users", uid);
                            const payload = {
                                email, role: "住戶", status, displayName, phone, photoURL,
                                community: selectedSlug, seq, houseNo,
                                ...(subNoRaw !== undefined && subNoRaw !== "" ? { subNo: parseInt(subNoRaw, 10) } : {}),
                                qrCodeText, address, area, ownershipRatio, createdAt: Date.now()
                            };
                            return { docRef, payload };
                        }
                    } catch (err) { failCount++; }
                    return null;
                });
                const results = await Promise.all(promises);
                results.forEach(res => {
                    if (res) {
                        batch.set(res.docRef, res.payload, { merge: true });
                        hasWrites = true;
                        successCount++;
                    }
                });
                if (hasWrites) await batch.commit();
                updateProgress(Math.min(i + CHUNK_SIZE, total));
              }
              overlay.innerHTML = `
                <div style="background:white;color:black;padding:20px;border-radius:8px;text-align:center;min-width:300px;">
                    <h2 style="margin-top:0;color:#333;">匯入完成</h2>
                    <p style="font-size:1.1rem;margin:10px 0;">成功：<span style="color:green;font-weight:bold;">${successCount}</span> 筆</p>
                    <p style="font-size:1.1rem;margin:10px 0;">失敗：<span style="color:red;font-weight:bold;">${failCount}</span> 筆</p>
                    <button id="close-overlay-btn" class="btn action-btn primary" style="margin-top:15px;width:100%;">確定</button>
                </div>
              `;
              const closeBtn = document.getElementById("close-overlay-btn");
              if (closeBtn) {
                  closeBtn.onclick = async () => {
                      overlay.style.display = "none";
                      await renderSettingsResidents();
                  };
              }
            } catch (e) {
              console.error(e);
              alert("讀取 Excel 失敗");
              overlay.style.display = "none";
            } finally {
              btnImportLegacy2.disabled = false;
              btnImportLegacy2.textContent = "匯入 Excel";
            }
          };
          reader.readAsArrayBuffer(file);
        } catch(e) {
          console.error(e);
          alert("匯入失敗");
          btnImportLegacy2.disabled = false;
          btnImportLegacy2.textContent = "匯入 Excel";
          if (overlay) overlay.style.display = "none";
        }
      };
      input.click();
    });

    sysNav.content.addEventListener("change", (e) => {
      if (e.target.id === "check-all-residents") {
        const checked = e.target.checked;
        const checkboxes = sysNav.content.querySelectorAll(".check-resident");
        checkboxes.forEach(cb => cb.checked = checked);
        updateDeleteSelectedBtn();
      } else if (e.target.classList.contains("check-resident")) {
        updateDeleteSelectedBtn();
      }
    });

    function updateDeleteSelectedBtn() {
       const btn = document.getElementById("btn-delete-selected");
       const checked = sysNav.content.querySelectorAll(".check-resident:checked");
       if (btn) {
         if (checked.length > 0) {
           btn.style.display = "inline-block";
           btn.textContent = `刪除選取項目 (${checked.length})`;
         } else {
           btn.style.display = "none";
         }
       }
    }

    const btnDeleteSelected = document.getElementById("btn-delete-selected");
    if (btnDeleteSelected) {
      btnDeleteSelected.addEventListener("click", async () => {
         const checked = sysNav.content.querySelectorAll(".check-resident:checked");
         if (checked.length === 0) return;
         if (!confirm(`確定要刪除選取的 ${checked.length} 位住戶嗎？此操作將永久刪除資料，且無法復原。`)) return;
         btnDeleteSelected.disabled = true;
         btnDeleteSelected.textContent = "刪除中...";
         let successCount = 0;
         let failCount = 0;
         const allIds = Array.from(checked).map(cb => cb.value);
         try {
            const limit = 10;
            const processItem = async (uid) => {
               try {
                 try {
                    const snap = await getDoc(doc(db, "users", uid));
                    if (snap.exists()) {
                        const d = snap.data();
                        if (d.phone) await syncUserLookup(d.phone, null, null);
                    }
                 } catch(err) { console.warn("Fetch user for delete failed", err); }
                 
                 await deleteDoc(doc(db, "users", uid));
                 successCount++;
               } catch (e) {
                 console.error(e);
                 failCount++;
               }
            };
            for (let i = 0; i < allIds.length; i += limit) {
               const batchIds = allIds.slice(i, i + limit);
               await Promise.all(batchIds.map(uid => processItem(uid)));
            }
            showHint(`已刪除 ${successCount} 筆，失敗 ${failCount} 筆`, "success");
            await renderSettingsResidents();
         } catch (err) {
           console.error(err);
           showHint("批次刪除發生錯誤", "error");
         } finally {
           if (btnDeleteSelected) {
             btnDeleteSelected.disabled = false;
             btnDeleteSelected.textContent = "刪除選取項目";
           }
         }
      });
    }

    const btnEdits = sysNav.content.querySelectorAll(".btn-edit-resident");
    btnEdits.forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!sysNav.content) return;
        const tr = btn.closest("tr");
        const targetUid = tr && tr.getAttribute("data-uid");
        const currentUser = auth.currentUser;
        const isSelf = currentUser && currentUser.uid === targetUid;
        let target = { id: targetUid, displayName: "", email: "", phone: "", photoURL: "", role: "住戶", status: "啟用" };
        try {
          const snap = await getDoc(doc(db, "users", targetUid));
          if (snap.exists()) {
            const d = snap.data();
            target.displayName = d.displayName || target.displayName;
            target.email = d.email || target.email;
            target.phone = d.phone || target.phone;
            target.photoURL = d.photoURL || target.photoURL;
            target.status = d.status || target.status;
            target.seq = d.seq;
            target.houseNo = d.houseNo;
            target.subNo = d.subNo;
            target.qrCodeText = d.qrCodeText;
            target.address = d.address;
            target.area = d.area;
            target.ownershipRatio = d.ownershipRatio;
          }
        } catch {}
        openEditModal(target, isSelf, "community-admin");
      });
    });

    const btnExport = document.getElementById("btn-export-resident");
    btnExport && btnExport.addEventListener("click", async () => {
      btnExport.disabled = true;
      btnExport.textContent = "匯出中...";
      try {
        await ensureXlsxLib();
        if (!window.XLSX) throw new Error("Excel Library not found");
        const data = residents.map((r, idx) => ({
          "大頭照": r.photoURL || "",
          "序號": r.seq || "",
          "戶號": r.houseNo || "",
          "子戶號": r.subNo !== undefined ? r.subNo : "",
          "QR code": r.qrCodeText || "",
          "姓名": r.displayName || "",
          "地址": r.address || "",
          "坪數": r.area || "",
          "區分權比": r.ownershipRatio || "",
          "手機號碼": r.phone || "",
          "電子郵件": r.email || "",
          "狀態": r.status || "啟用"
        }));
        const ws = window.XLSX.utils.json_to_sheet(data);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Residents");
        window.XLSX.writeFile(wb, `${cname}_residents_${new Date().toISOString().slice(0,10)}.xlsx`);
      } catch(e) {
        console.error(e);
        alert("匯出失敗");
      } finally {
        btnExport.disabled = false;
        btnExport.textContent = "匯出 Excel";
      }
    });

    const btnImport = document.getElementById("btn-import-resident");
    btnImport && btnImport.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".xlsx, .xls, .csv";
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        let overlay = document.getElementById("import-overlay");
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.id = "import-overlay";
          overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;justify-content:center;align-items:center;color:#fff;flex-direction:column;font-size:1.2rem;";
          document.body.appendChild(overlay);
        }
        overlay.style.display = "flex";
        overlay.innerHTML = `<div class="spinner"></div><div id="import-msg" style="margin-top:15px;">準備匯入中...</div>`;
        btnImport.disabled = true;
        btnImport.textContent = "匯入中...";
        try {
          await ensureXlsxLib();
          if (!window.XLSX) throw new Error("Excel Library not found");
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              const data = new Uint8Array(e.target.result);
              const workbook = window.XLSX.read(data, { type: 'array' });
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
              if (jsonData.length === 0) {
                alert("檔案內容為空");
                overlay.style.display = "none";
                return;
              }
              if (!confirm(`即將匯入 ${jsonData.length} 筆資料，確定嗎？`)) {
                overlay.style.display = "none";
                return;
              }
              let successCount = 0;
              let failCount = 0;
              const total = jsonData.length;
              const updateProgress = (processed) => {
                 const el = document.getElementById("import-msg");
                 if (el) el.textContent = `匯入中... ${processed} / ${total}`;
              };
              const CHUNK_SIZE = 20; 
              for (let i = 0; i < total; i += CHUNK_SIZE) {
                const chunk = jsonData.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);
                let hasWrites = false;
                const promises = chunk.map(async (row) => {
                    try {
                        const email = (row["電子郵件"] || "").trim();
                        const password = (row["密碼"] || "123456").trim();
                        const displayName = (row["姓名"] || "").trim();
                        const phone = (row["手機號碼"] || "").toString().trim();
                        const seq = (row["序號"] || "").toString().trim();
                        const houseNo = (row["戶號"] || "").toString().trim();
                        const subNoRaw = row["子戶號"];
                        const qrCodeText = (row["QR code"] || "").trim();
                        const address = (row["地址"] || "").trim();
                        const area = (row["坪數"] || "").toString().trim();
                        const ownershipRatio = (row["區分權比"] || "").toString().trim();
                        const status = (row["狀態"] || "停用").trim();
                        const photoURL = (row["大頭照"] || "").trim();
                        if (!email) { failCount++; return null; }
                        let uid = null;
                        try {
                            const cred = await createUserWithEmailAndPassword(createAuth, email, password);
                            uid = cred.user.uid;
                            await updateProfile(cred.user, { displayName, photoURL });
                            await signOut(createAuth);
                        } catch (authErr) {
                            if (authErr.code === 'auth/email-already-in-use') {
                                const qUser = query(collection(db, "users"), where("email", "==", email));
                                const snapUser = await getDocs(qUser);
                                if (!snapUser.empty) uid = snapUser.docs[0].id;
                            }
                            if (!uid) { failCount++; return null; }
                        }
                        if (uid) {
                            const docRef = doc(db, "users", uid);
                            const payload = {
                                email, role: "住戶", status, displayName, phone, photoURL,
                                community: selectedSlug, seq, houseNo,
                                ...(subNoRaw !== undefined && subNoRaw !== "" ? { subNo: parseInt(subNoRaw, 10) } : {}),
                                qrCodeText, address, area, ownershipRatio, createdAt: Date.now()
                            };
                            return { docRef, payload };
                        }
                    } catch (err) { failCount++; }
                    return null;
                });
                const results = await Promise.all(promises);
                results.forEach(res => {
                    if (res) {
                        batch.set(res.docRef, res.payload, { merge: true });
                        hasWrites = true;
                        successCount++;
                    }
                });
                if (hasWrites) await batch.commit();
                updateProgress(Math.min(i + CHUNK_SIZE, total));
              }
              overlay.innerHTML = `
                <div style="background:white;color:black;padding:20px;border-radius:8px;text-align:center;min-width:300px;">
                    <h2 style="margin-top:0;color:#333;">匯入完成</h2>
                    <p style="font-size:1.1rem;margin:10px 0;">成功：<span style="color:green;font-weight:bold;">${successCount}</span> 筆</p>
                    <p style="font-size:1.1rem;margin:10px 0;">失敗：<span style="color:red;font-weight:bold;">${failCount}</span> 筆</p>
                    <button id="close-overlay-btn" class="btn action-btn primary" style="margin-top:15px;width:100%;">確定</button>
                </div>
              `;
              const closeBtn = document.getElementById("close-overlay-btn");
              if (closeBtn) {
                  closeBtn.onclick = async () => {
                      overlay.style.display = "none";
                      await renderSettingsResidents();
                  };
              }
            } catch (e) {
              console.error(e);
              alert("讀取 Excel 失敗");
              overlay.style.display = "none";
            } finally {
              btnImport.disabled = false;
              btnImport.textContent = "匯入 Excel";
            }
          };
          reader.readAsArrayBuffer(file);
        } catch(e) {
          console.error(e);
          alert("匯入失敗");
          btnImport.disabled = false;
          btnImport.textContent = "匯入 Excel";
          if (overlay) overlay.style.display = "none";
        }
      };
      input.click();
    });

    sysNav.content.addEventListener("change", (e) => {
      if (e.target.id === "check-all-residents") {
        const checked = e.target.checked;
        const checkboxes = sysNav.content.querySelectorAll(".check-resident");
        checkboxes.forEach(cb => cb.checked = checked);
        updateDeleteSelectedBtn();
      } else if (e.target.classList.contains("check-resident")) {
        updateDeleteSelectedBtn();
      }
    });

    function updateDeleteSelectedBtn() {
       const btn = document.getElementById("btn-delete-selected");
       const checked = sysNav.content.querySelectorAll(".check-resident:checked");
       if (btn) {
         if (checked.length > 0) {
           btn.style.display = "inline-block";
           btn.textContent = `刪除選取項目 (${checked.length})`;
         } else {
           btn.style.display = "none";
         }
       }
    }

    const btnDeleteSelectedLegacy2 = document.getElementById("btn-delete-selected");
    if (btnDeleteSelectedLegacy2) {
      btnDeleteSelectedLegacy2.addEventListener("click", async () => {
         const checked = sysNav.content.querySelectorAll(".check-resident:checked");
         if (checked.length === 0) return;
         if (!confirm(`確定要刪除選取的 ${checked.length} 位住戶嗎？此操作將永久刪除資料，且無法復原。`)) return;
         btnDeleteSelectedLegacy2.disabled = true;
         btnDeleteSelectedLegacy2.textContent = "刪除中...";
         let successCount = 0;
         let failCount = 0;
         const allIds = Array.from(checked).map(cb => cb.value);
         try {
            const limit = 10;
            const processItem = async (uid) => {
               try {
                 await deleteDoc(doc(db, "users", uid));
                 successCount++;
               } catch (e) {
                 console.error(e);
                 failCount++;
               }
            };
            for (let i=0; i<allIds.length; i+=limit) {
                const chunk = allIds.slice(i, i+limit);
                await Promise.all(chunk.map(processItem));
            }
            alert(`刪除完成\n成功：${successCount}\n失敗：${failCount}`);
            await renderSettingsResidents();
         } catch(e) {
            console.error(e);
            alert("刪除過程發生錯誤");
         } finally {
            btnDeleteSelectedLegacy2.disabled = false;
            btnDeleteSelectedLegacy2.textContent = "刪除選取項目";
            btnDeleteSelectedLegacy2.style.display = "none";
         }
      });
    }
  }
  
  // Removed premature redirect logic that was causing parameter loss

}


async function setupPersonalTab(slug) {
  const navHome = document.getElementById("nav-home");
  const navPersonal = document.getElementById("nav-personal");
  const homeSections = document.querySelectorAll(".home-section");
  const personalTabs = document.querySelector(".personal-tabs");
  const personalContent = document.querySelector(".personal-content");
  const frontStack = document.querySelector(".stack.front");
  const subTabs = document.querySelectorAll(".sub-tab-item");
  const panes = document.querySelectorAll(".personal-pane");

  if (!navHome || !navPersonal) return;

  function switchMainTab(tab) {
    if (tab === "home") {
      if (window.personalUnsubs) {
        window.personalUnsubs.forEach(u => u && u());
        window.personalUnsubs = [];
      }
      navHome.classList.add("active");
      navPersonal.classList.remove("active");
      homeSections.forEach(el => el.classList.remove("hidden"));
      if (personalTabs) personalTabs.classList.add("hidden");
      if (personalContent) personalContent.classList.add("hidden");
      if (frontStack) frontStack.classList.remove("personal-view");
    } else {
      navHome.classList.remove("active");
      navPersonal.classList.add("active");
      homeSections.forEach(el => el.classList.add("hidden"));
      if (personalTabs) personalTabs.classList.remove("hidden");
      if (personalContent) personalContent.classList.remove("hidden");
      if (frontStack) frontStack.classList.add("personal-view");
      loadPersonalData(slug);
    }
  }

  navHome.addEventListener("click", () => switchMainTab("home"));
  navPersonal.addEventListener("click", () => switchMainTab("personal"));

  subTabs.forEach(btn => {
    btn.addEventListener("click", () => {
      subTabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.tab;
      panes.forEach(p => {
        p.classList.remove("active");
        if (p.id === `pane-${target}`) p.classList.add("active");
      });
    });
  });
}

async function loadPersonalData(slug) {
  if (window.personalUnsubs) {
    window.personalUnsubs.forEach(u => u && u());
    window.personalUnsubs = [];
  }

  const u = auth.currentUser;
  if (!u) return;
  
  let houseNo = "";
  let subNo = "0";
  
  const bookingPane = document.getElementById("pane-booking");
  const notifPane = document.getElementById("pane-notification");
  const pointsPane = document.getElementById("pane-points");
  const mailPane = document.getElementById("pane-mail");

  const elHouse = document.getElementById("personal-house-info");
  const elAvatar = document.getElementById("personal-avatar");
  const elName = document.getElementById("personal-name");
  const elQr = document.getElementById("personal-qrcode");
  const elQrText = document.getElementById("personal-qrcode-text");
  const elPoints = document.getElementById("personal-points");

  let currentPoints = 0;
  
  if(elAvatar) elAvatar.src = u.photoURL || "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y";
  
  // 1. Fetch User Details & Points
  try {
     const snap = await getDoc(doc(db, "users", u.uid));
     if (snap.exists()) {
       const d = snap.data();
       houseNo = d.houseNo || "";
       subNo = (d.subNo !== undefined && d.subNo !== null && d.subNo !== "") ? d.subNo : "0";
       const name = d.displayName || d.realName || "住戶";
       const photo = d.photoURL;
       const qrCodeText = d.qrCodeText || "";
       const community = d.community || slug || "default";

       if(elHouse) elHouse.textContent = houseNo ? `${houseNo}-${subNo}` : "尚未設定戶號";
       if(elName) elName.textContent = name;
       if(elAvatar && photo) elAvatar.src = photo;

       if(elQr && qrCodeText) {
           try {
               const url = await getQrDataUrl(qrCodeText, 150);
               elQr.src = url;
               elQr.style.display = "block";
               if(elQrText) elQrText.textContent = qrCodeText;
           } catch(e) { console.error("QR Error", e); }
       }

       if(houseNo) {
          let found = false;
          
          if (typeof d.points === 'number') {
              currentPoints = d.points;
              found = true;
          }

          if (!found) {
            try {
              const bdoc = await getDoc(doc(db, `communities/${community}/app_modules/points_balances/${houseNo}`));
              if (bdoc.exists()) {
                currentPoints = bdoc.data().balance || 0;
                found = true;
              }
            } catch (e) {}
          }
          
          if (!found) {
            try {
              const pdoc = await getDoc(doc(db, `communities/${community}/app_modules/points`));
              if (pdoc.exists()) {
                const data = pdoc.data();
                const bmap = data.balances || {};
                currentPoints = typeof bmap[houseNo] === "number" ? bmap[houseNo] : 0;
              }
            } catch (e) {}
          }
          if (elPoints) elPoints.textContent = currentPoints;
       } else if (elPoints) {
           elPoints.textContent = "0";
       }
     }
  } catch (e) {
    console.error("Personal data load error:", e);
  }

  // 2. Fetch Reservations
  if (bookingPane) {
      bookingPane.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">載入中...</div>';
      
      let selfReservations = [];
      let adminReservations = [];
      let facilityMap = { 'gym': '健身房' };
      
      const renderReservations = () => {
          const allRes = [...selfReservations];
          const seenIds = new Set(selfReservations.map(r => r.id));
          
          adminReservations.forEach(r => {
              if (!seenIds.has(r.id)) {
                  allRes.push(r);
                  seenIds.add(r.id);
              }
          });
          
          allRes.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
          
          if (allRes.length === 0) {
              bookingPane.innerHTML = '<div style="text-align:center; color:#999; padding:40px 0;">尚無預約記錄</div>';
              return;
          }
          
          let html = '<div class="list-group" style="padding: 10px;">';
          allRes.forEach(res => {
              let stText = '已預約';
              let stColor = '#2563eb';
              let divBg = '#fff';
              let divBorder = '#e5e7eb';
              
              const fName = facilityMap[res.facility] || res.facility || '未知設施';
              
              let onclickAttr = '';
              let divStyle = '';
              
              let isPast = false;
              try {
                  const endD = new Date(`${res.date}T${res.endTime}`);
                  if (endD < new Date()) isPast = true;
              } catch(e) {}

              if (res.status === 'valid' || !res.status || res.status === '已預約') {
                  if (isPast) {
                      stText = `${res.date} 未報到`;
                      stColor = '#b45309'; // Dark Orange
                      divBg = '#fff7ed';   // Light Orange
                      onclickAttr = '';    // No action
                      divStyle = 'cursor: default;';
                  } else {
                      stText = `${res.date} 已預約`;
                      stColor = '#2563eb';
                      divBg = '#fff';
                      onclickAttr = `onclick="openCancelReservationModal('${slug}', '${res.id}', '${fName}', '${res.date}', '${res.startTime}', '${res.endTime}')"`;
                      divStyle = 'cursor: pointer;'; 
                  }
              } else if (res.status === '已報到') {
                  stText = `${res.date} 已報到`;
                  stColor = '#059669';
                  divBg = '#f0fdf4';
              } else if (res.status === 'cancelled' || res.status === '已取消') {
                  stText = `${res.date} 已取消`;
                  stColor = '#dc2626';
                  divBg = '#fef2f2';
              } else {
                  stText = `${res.date} ${res.status}`;
                  stColor = '#4b5563';
                  divBg = '#fff';
              }
              
              let createdStr = "";
              if (res.createdAt) {
                  let d;
                  if (typeof res.createdAt.toDate === 'function') {
                      d = res.createdAt.toDate();
                  } else {
                      d = new Date(res.createdAt);
                  }
                  const y = d.getFullYear();
                  const m = String(d.getMonth()+1).padStart(2,'0');
                  const dd = String(d.getDate()).padStart(2,'0');
                  const h = String(d.getHours()).padStart(2,'0');
                  const min = String(d.getMinutes()).padStart(2,'0');
                  const s = String(d.getSeconds()).padStart(2,'0');
                  createdStr = `${y}-${m}-${dd} ${h}:${min}:${s}`;
              }

              const sourceStr = (res.createdBy === u.uid) ? "(APP)" : "(櫃台)";

              html += `
                <div ${onclickAttr} style="background:${divBg}; border:1px solid ${divBorder}; border-radius:12px; padding:16px; margin-bottom:12px; box-shadow:0 1px 2px rgba(0,0,0,0.05); ${divStyle}">
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px; align-items:center;">
                        <span style="font-weight:600; font-size:16px; color:#1f2937;">${fName}</span>
                        <span style="font-size:14px;"><span style="color:${stColor}; font-weight:500;">${stText}</span></span>
                    </div>
                    <div style="color:#4b5563; font-size:14px; display:flex; flex-direction:column; gap:4px;">
                        <div><span style="color:#9ca3af; margin-right:4px;">預約日期:</span> ${res.date}</div>
                        <div><span style="color:#9ca3af; margin-right:4px;">預約時段:</span> ${res.startTime} ~ ${res.endTime}</div>
                        ${createdStr ? `<div><span style="color:#9ca3af; margin-right:4px;">操作時間:</span> ${createdStr} 預約 ${sourceStr}</div>` : ''}
                    </div>
                    ${res.note ? `<div style="color:#6b7280; font-size:13px; margin-top:8px; padding-top:8px; border-top:1px solid #f3f4f6;">備註: ${res.note}</div>` : ''}
                </div>
              `;
          });
          html += '</div>';
          bookingPane.innerHTML = html;
      };
      
      getDoc(doc(db, "communities", slug, "settings", "nav")).then(snap => {
          if (snap.exists()) {
             const tabs = snap.data().facility_tabs || [];
             tabs.forEach(t => {
                 if (typeof t === 'string') {
                     facilityMap[t] = t; 
                 } else if (t.key && t.label) {
                     facilityMap[t.key] = t.label;
                 }
             });
          }
          renderReservations();
      }).catch(e => console.error("Nav fetch error", e));

      try {
          const q1 = query(
             collection(db, "communities", slug, "reservations"),
             where("createdBy", "==", u.uid)
          );
          const unsub1 = onSnapshot(q1, (snap) => {
              selfReservations = snap.docs.map(d => ({id:d.id, ...d.data()}));
              renderReservations();
          });
          window.personalUnsubs.push(unsub1);
      } catch(e) { console.error("Self res listener error", e); }
      
      if (houseNo) {
          try {
              // Use broader query (HouseNo prefix only) to catch all household members and potential subNo format mismatches
              // e.g. "250011TP-1-Name" (Admin) vs "250011TP-01-Name" (User subNo)
              // We will filter client-side if necessary, but showing household reservations is generally acceptable/desired.
              const prefix = `${houseNo}-`;
              const q2 = query(
                 collection(db, "communities", slug, "reservations"),
                 where("bookerName", ">=", prefix),
                 where("bookerName", "<=", prefix + "\uf8ff")
              );
              const unsub2 = onSnapshot(q2, (snap) => {
                  adminReservations = snap.docs.map(d => ({id:d.id, ...d.data()}));
                  renderReservations();
              });
              window.personalUnsubs.push(unsub2);
          } catch(e) { console.error("Admin res listener error", e); }
      }
  }

  // 3. Fetch Notifications (Announcements as fallback)
  if (notifPane) {
      notifPane.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">載入中...</div>';
      try {
           const q = query(
              collection(db, "communities", slug, "announcements"),
              orderBy("createdAt", "desc"),
              limit(5)
          );
          const snap = await getDocs(q);
          if (snap.empty) {
              notifPane.innerHTML = '<div style="text-align:center; color:#999; padding:40px 0;">尚無新通知</div>';
          } else {
              let html = '<div class="list-group" style="padding: 10px;">';
              snap.forEach(doc => {
                  const d = doc.data();
                  // Format date: YYYY-MM-DD
                  let dateStr = "";
                  if (d.createdAt) {
                      const date = new Date(d.createdAt);
                      const y = date.getFullYear();
                      const m = String(date.getMonth()+1).padStart(2,'0');
                      const day = String(date.getDate()).padStart(2,'0');
                      dateStr = `${y}-${m}-${day}`;
                  }
                  
                  html += `
                    <div style="background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:16px; margin-bottom:12px; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.05);" onclick="window.location.href='preview.html?c=${slug}&tab=${d.category}&title=公告列表'">
                        <div style="font-weight:600; margin-bottom:8px; color:#1f2937; font-size:16px;">${d.title}</div>
                        <div style="display:flex; justify-content:space-between; color:#6b7280; font-size:13px;">
                            <span style="background:#f3f4f6; padding:2px 8px; border-radius:4px;">${d.category || '公告'}</span>
                            <span>${dateStr}</span>
                        </div>
                    </div>
                  `;
              });
              html += '</div>';
              notifPane.innerHTML = html;
          }
      } catch (e) {
          console.warn("Fetch notifications failed", e);
          notifPane.innerHTML = '<div style="text-align:center; color:#999; padding:40px 0;">尚無新通知</div>';
      }
  }
  // 4. Fetch Points Logs (New)
  if (pointsPane) {
      pointsPane.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">載入中...</div>';
      try {
          // Find user's houseNo first
          const uSnap = await getDoc(doc(db, "users", u.uid));
          const userData = uSnap.exists() ? uSnap.data() : {};
          const houseNo = userData.houseNo;

          if (houseNo) {
             let snap;
             try {
                 const q = query(
                     collection(db, "communities", slug, "points_logs"),
                     where("houseNo", "==", houseNo),
                     orderBy("createdAt", "desc")
                 );
                 snap = await getDocs(q);
             } catch (err) {
                 if (err.message && err.message.includes("index")) {
                     console.warn("Missing index for points_logs, falling back to client sort");
                     const q2 = query(
                         collection(db, "communities", slug, "points_logs"),
                         where("houseNo", "==", houseNo)
                     );
                     snap = await getDocs(q2);
                 } else {
                     throw err;
                 }
             }
             
             if (snap.empty) {
                 pointsPane.innerHTML = `
                    <div style="background:#fff; border-radius:12px; padding:20px; margin:10px; margin-bottom:0; box-shadow:0 1px 2px rgba(0,0,0,0.05); display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-weight:600; font-size:16px; color:#374151;">目前點數</span>
                        <span style="font-weight:700; font-size:24px; color:#dc2626;">${currentPoints}</span>
                    </div>
                    <div style="text-align:center; color:#999; padding:40px 0;">尚無點數記錄</div>`;
             } else {
                 let docs = snap.docs.map(d => d.data());
                 // Client-side sort
                 docs.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));

                 let html = `
                    <div style="background:#fff; border-radius:12px; padding:20px; margin:10px; margin-bottom:0; box-shadow:0 1px 2px rgba(0,0,0,0.05); display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-weight:600; font-size:16px; color:#374151;">目前點數</span>
                        <span style="font-weight:700; font-size:24px; color:#dc2626;">${currentPoints}</span>
                    </div>
                    <div class="list-group" style="padding: 10px;">`;
                 docs.forEach(d => {
                     // Format date
                     let dateObj = d.createdAt;
                     if (dateObj && typeof dateObj.toDate === 'function') {
                         dateObj = dateObj.toDate();
                     } else if (dateObj) {
                         dateObj = new Date(dateObj);
                     } else {
                         dateObj = new Date();
                     }
                     
                     const y = dateObj.getFullYear();
                     const m = String(dateObj.getMonth()+1).padStart(2,'0');
                     const day = String(dateObj.getDate()).padStart(2,'0');
                     const hh = String(dateObj.getHours()).padStart(2,'0');
                     const mm = String(dateObj.getMinutes()).padStart(2,'0');
                     const dateStr = `${y}-${m}-${day} ${hh}:${mm}`;

                     const isPositive = (d.delta || 0) > 0;
                     const deltaStr = isPositive ? `+${d.delta}` : `${d.delta}`;
                     const color = isPositive ? '#059669' : '#dc2626';

                     html += `
                       <div style="background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:16px; margin-bottom:12px; box-shadow:0 1px 2px rgba(0,0,0,0.05);">
                           <div style="display:flex; justify-content:space-between; margin-bottom:8px; align-items:center;">
                               <span style="font-weight:600; font-size:16px; color:#1f2937;">${d.reason || '點數異動'}</span>
                               <span style="font-weight:700; font-size:18px; color:${color};">${deltaStr}</span>
                           </div>
                           <div style="color:#6b7280; font-size:13px; display:flex; justify-content:space-between;">
                               <span>${dateStr}</span>
                               <span>${d.operatorName || ''}</span>
                           </div>
                       </div>
                     `;
                 });
                 html += '</div>';
                 pointsPane.innerHTML = html;
             }
          } else {
             pointsPane.innerHTML = '<div style="text-align:center; color:#999; padding:40px 0;">無法取得戶號資訊</div>';
          }
      } catch (e) {
          console.error("Fetch points logs failed", e);
          pointsPane.innerHTML = '<div style="text-align:center; color:#ef4444; padding:20px;">載入失敗</div>';
      }
  }
}

  // Auto login check
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      if (el.authCard) el.authCard.classList.add("hidden");
      
      const pathNow = window.location.pathname || "";
      // Explicitly disable root redirect for now to debug parameter stripping
      /*
      if (
        (pathNow.endsWith("/") || pathNow.includes("index.html")) &&
        !pathNow.includes("front") && !pathNow.includes("admin") && !pathNow.includes("sys")
      ) {
        try {
          const userSlug = await getUserCommunity(user.uid);
          const target = (userSlug && userSlug !== "default") ? `front.html?c=${userSlug}` : "front.html";
          console.log("Root redirect to:", target);
          location.replace(target);
          return;
        } catch {
          location.replace("front.html");
          return;
        }
      }
      */
      
      let role = "住戶";
      try {
        role = await getOrCreateUserRole(user.uid, user.email);
      } catch {}

      // Strict Page Access Check
      if (!checkPagePermission(role, window.location.pathname)) {
          if (el.authCard) el.authCard.classList.remove("hidden");
          if (sysStack) sysStack.classList.add("hidden");
          if (adminStack) adminStack.classList.add("hidden");
          if (frontStack) frontStack.classList.add("hidden");
          if (mainContainer) mainContainer.classList.remove("hidden");
          showHint("權限不足，已自動登出", "error");
          await signOut(auth);
          return; 
      }

      
      if (
        (pathNow.endsWith("/") || pathNow.includes("index.html")) &&
        !pathNow.includes("front") && !pathNow.includes("admin") && !pathNow.includes("sys")
      ) {
          const userSlug = await getUserCommunity(user.uid);
          if (role === "系統管理員") {
             location.href = "sys.html";
          } else if (role === "管理員" || role === "總幹事" || role === "社區") {
             location.href = `admin.html?c=${userSlug}`;
          } else {
             location.href = `front.html?c=${userSlug}`;
          }
          return;
      }

      // If we are on specific pages, handle display
      if (window.location.pathname.includes("sys")) {
          // Role check passed (System Admin)
          toggleAuth(false);
         if (sysStack) sysStack.classList.remove("hidden");
         if (mainContainer) mainContainer.classList.add("hidden");
         const tipSys = document.getElementById("orientation-tip");
         tipSys && tipSys.classList.add("hidden");
            const btn = document.getElementById("btn-avatar-sys");
            if (btn) {
              const u = auth.currentUser;
              let photo = (u && u.photoURL) || "";
              let name = (u && u.displayName) || "";
              try {
                const snap = await getDoc(doc(db, "users", u.uid));
                if (snap.exists()) {
                  const d = snap.data();
                  photo = photo || d.photoURL || "";
                  name = name || d.displayName || "";
                }
              } catch {}
              const w = document.getElementById("welcome-sys");
              if (w) {
                const emailPart = (u && u.email && u.email.split("@")[0]) || "";
                w.textContent = `歡迎~${name || emailPart || "使用者"}`;
              }
              btn.innerHTML = photo ? `<img class="avatar" src="${photo}" alt="${name}">` : `<span class="avatar">${(name || (u && u.email) || "用")[0]}</span>`;
              btn.addEventListener("click", () => openUserProfileModal());
            }
  } else if (window.location.pathname.includes("front")) {
        // Role check passed (Resident or System Admin)
        const pathSlug = getSlugFromPath();
        const qp = getQueryParam("c");
        const userSlug = await getUserCommunity(user.uid);
        const reqSlug = pathSlug || qp || null;
        console.log("Front Page Check:", { role, reqSlug, userSlug, pathSlug, qp });

        if (role === "系統管理員") {
           // System Admin: Do NOT redirect
        } else if (reqSlug && reqSlug !== userSlug) {
          console.log("Redirecting to user slug:", userSlug);
          location.replace(`front.html?c=${userSlug}`);
          return;
        }
        const slug = role === "系統管理員" ? (reqSlug || userSlug) : userSlug;
        
        let cname = slug;
        try {
          const csnap = await getDoc(doc(db, "communities", slug));
          if (csnap.exists()) {
            const c = csnap.data();
            communityConfigs[slug] = {
              apiKey: c.apiKey,
              authDomain: c.authDomain,
              projectId: c.projectId,
              storageBucket: c.storageBucket,
              messagingSenderId: c.messagingSenderId,
              appId: c.appId,
              measurementId: c.measurementId
            };
            cname = c.name || slug;
          }
        } catch {}
        const t = ensureTenant(slug);
        window.currentTenantSlug = slug;
        window.tenant = t;
        const titleEl = frontStack ? frontStack.querySelector(".sys-title") : document.querySelector(".sys-title");
        if (titleEl) {
           let displayName = cname;
           // 如果是預設值(無社區)，系統管理員顯示"系統管理員"，住戶顯示"西北e生活"
           if (!displayName || displayName === "default") {
             displayName = role === "系統管理員" ? "系統管理員" : "西北e生活";
           } else {
             // 若有社區名稱，系統管理員也應顯示社區名稱
             displayName = cname;
           }
           titleEl.textContent = displayName;
           
           if (role === "系統管理員") {
             titleEl.style.cursor = "pointer";
             titleEl.style.textDecoration = "underline";
             titleEl.title = "點擊切換社區";
             // 移除舊的 event listener 比較麻煩，但這裡通常是頁面刷新或單次執行
             // 為避免重複綁定，可以使用 onclick 屬性或確保只綁一次
             titleEl.onclick = () => openCommunitySwitcher("front");
         }
      }

      // Update branding elements for Front Page
      const brandTextFront = document.getElementById("brand-text-front");
      if (slug && slug !== "default") {
         if (brandTextFront) brandTextFront.textContent = cname;
         document.title = `${cname}｜前台`;
      } else {
         if (brandTextFront) brandTextFront.textContent = "西北e生活";
         document.title = "西北e生活｜前台";
      }

      const wFront = document.getElementById("welcome-front");
        if (wFront) {
          const u = auth.currentUser;
          const emailPart = (u && u.email && u.email.split("@")[0]) || "";
          const snap = await getDoc(doc(db, "users", u.uid));
          let name = "";
          if (snap.exists()) {
            const d = snap.data();
            name = d.displayName || "";
          }
          wFront.textContent = `歡迎~${name || emailPart || "使用者"}`;
        }
        if (frontStack) frontStack.classList.remove("hidden");
        if (mainContainer) mainContainer.classList.add("hidden");
        const tip = document.getElementById("orientation-tip");
        tip && tip.classList.add("hidden");

        const btnAvatar = document.getElementById("btn-avatar-front");
        if (btnAvatar) {
           const u = auth.currentUser;
           let photo = (u && u.photoURL) || "";
           let name = (u && u.displayName) || "";
           try {
             const snap = await getDoc(doc(db, "users", u.uid));
             if (snap.exists()) {
               const d = snap.data();
               photo = photo || d.photoURL || "";
               name = name || d.displayName || "";
             }
           } catch {}
           btnAvatar.innerHTML = photo ? `<img class="avatar" src="${photo}" alt="${name}">` : `<span class="avatar">${(name || (u && u.email) || "用")[0]}</span>`;
            btnAvatar.addEventListener("click", () => openUserProfileModal());
        }
        loadFrontAds(slug);
        loadFrontButtons(slug);
        subscribeFrontButtons(slug);
        subscribeFrontAds(slug);
        startFrontPolling(slug);
        setupPersonalTab(slug);

        const btnSOS = document.querySelector(".btn-sos");
        if (btnSOS) {
          btnSOS.addEventListener("click", () => {
             console.log("SOS button clicked. Current slug:", slug);
             const body = `
               <div class="modal-dialog">
                 <div class="modal-head"><div class="modal-title" style="color: #ef4444;">緊急求救 SOS</div></div>
                 <div class="modal-body" style="text-align: center; padding: 20px;">
                   <p style="font-size: 1.2rem; margin-bottom: 20px;">請輸入求救原因或訊息，並按下按鈕發送</p>
                   <textarea id="sos-message" rows="3" placeholder="請輸入求救訊息..." style="width: 100%; margin-bottom: 20px; padding: 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem;"></textarea>
                   <button id="btn-sos-confirm" class="btn action-btn danger" style="width: 100%; height: 80px; font-size: 24px; border-radius: 12px;">送出</button>
                 </div>
                 <div class="modal-foot">
                   <button class="btn action-btn" onclick="closeModal()">取消</button>
                 </div>
               </div>
             `;
             openModal(body);
             setTimeout(() => {
                const btnConfirm = document.getElementById("btn-sos-confirm");
                if(btnConfirm) {
                  btnConfirm.addEventListener("click", async () => {
                    const txtMessage = document.getElementById("sos-message");
                    const msgContent = txtMessage ? txtMessage.value.trim() : "";
                    console.log("SOS Message Content:", msgContent);

                    btnConfirm.disabled = true;
                    btnConfirm.textContent = "發送中...";
                    try {
                      const u = auth.currentUser;
                      let userData = {};
                      if (u) {
                        const snap = await getDoc(doc(db, "users", u.uid));
                        if (snap.exists()) userData = snap.data();
                      }
                      
                      const alertData = {
                        community: slug || "default",
                        houseNo: userData.houseNo || "",
                        subNo: userData.subNo || "",
                        name: userData.displayName || "",
                        address: userData.address || "",
                        message: msgContent,
                        status: "active",
                        createdAt: Date.now()
                      };
                      console.log("Sending SOS alert:", alertData);
                      
                      await addDoc(collection(db, "sos_alerts"), alertData);
                      
                      closeModal();
                      showHint("求救訊號已發送", "success");
                    } catch(e) {
                      console.error("SOS Send Error:", e);
                      showHint("發送失敗，請重試", "error");
                      btnConfirm.disabled = false;
                      btnConfirm.textContent = "送出";
                    }
                  });
                }
             }, 100);
          });
        }
    } else if (window.location.pathname.includes("admin")) {
        // Role check passed (Community Admin or System Admin)
          const pathSlug = getSlugFromPath();
          const qp = getQueryParam("c");
          const userSlug = await getUserCommunity(user.uid);
          const reqSlug = pathSlug || qp || null;
          console.log("Admin Page Check:", { role, reqSlug, userSlug, pathSlug, qp });

          if (role === "系統管理員") {
             // System Admin: Do NOT redirect, just use the requested slug
          } else if (reqSlug && reqSlug !== userSlug) {
            console.log("Redirecting to user slug:", userSlug);
            location.replace(`admin.html?c=${userSlug}`);
            return;
          }
          const slug = role === "系統管理員" ? (reqSlug || userSlug) : userSlug;

          // Ensure global slug is set and re-render nav to load custom names immediately
          window.currentAdminCommunitySlug = slug;
          localStorage.setItem("adminCurrentCommunity", slug);
          const savedMain = localStorage.getItem("adminActiveMain");
          // adminSubMenus is global, defined later but hoisted or available
          const initialMain = (savedMain && typeof adminSubMenus !== 'undefined' && adminSubMenus[savedMain]) ? savedMain : "shortcuts";
          if (typeof setActiveAdminNav === 'function') {
            setActiveAdminNav(initialMain);
          }
          
          toggleAuth(false);
          if (adminStack) adminStack.classList.remove("hidden");
          if (mainContainer) mainContainer.classList.add("hidden");
          const tip2 = document.getElementById("orientation-tip");
          tip2 && tip2.classList.add("hidden");

          let cname = slug;
          try {
             if(slug && slug !== "default") {
               const csnap = await getDoc(doc(db, "communities", slug));
               if (csnap.exists()) {
                 const c = csnap.data();
                 cname = c.name || slug;
               }
             }
          } catch {}
          const titleEl = adminStack.querySelector(".sys-title");
          if (titleEl) {
             let displayName = cname;
             
             if (slug && slug !== "default") {
               // 顯示社區名稱
               titleEl.textContent = `${displayName} 社區後台`;
             } else {
               titleEl.textContent = "西北e生活 社區後台";
             }

             if (role === "系統管理員") {
                console.log("Binding click event to sys-title for System Admin");
                titleEl.style.cursor = "pointer";
                titleEl.style.textDecoration = "underline";
                titleEl.title = "點擊切換社區";
                titleEl.onclick = (e) => {
                  console.log("sys-title clicked");
                  openCommunitySwitcher("admin");
                };
             }
          }
          
          // Update branding elements
          const brandText = document.getElementById("brand-text");
          const brandTextMobile = document.getElementById("brand-text-mobile");
          if (slug && slug !== "default") {
             if (brandText) brandText.textContent = cname;
             if (brandTextMobile) brandTextMobile.textContent = cname;
             document.title = `${cname}｜後台登入`;
          } else {
             if (brandText) brandText.textContent = "西北e生活";
             if (brandTextMobile) brandTextMobile.textContent = "西北e生活";
             document.title = "西北e生活｜後台登入";
          }
          
          const btnSysBack = document.getElementById("admin-tab-sys-back");
          if (btnSysBack) {
            if (role === "系統管理員") {
              btnSysBack.classList.remove("hidden");
              btnSysBack.onclick = () => location.href = "sys.html";
            } else {
              btnSysBack.classList.add("hidden");
            }
          }

          const btnAvatarAdmin = document.getElementById("btn-avatar-admin");
          if (btnAvatarAdmin) {
            const u = auth.currentUser;
            let photo = (u && u.photoURL) || "";
            let name = (u && u.displayName) || "";
            try {
              const snap = await getDoc(doc(db, "users", u.uid));
              if (snap.exists()) {
                const d = snap.data();
                photo = photo || d.photoURL || "";
                name = name || d.displayName || "";
              }
            } catch {}
            const wAdmin = document.getElementById("welcome-admin");
            if (wAdmin) {
              const emailPart = (u && u.email && u.email.split("@")[0]) || "";
              wAdmin.textContent = `歡迎~${name || emailPart || "使用者"}`;
            }
            btnAvatarAdmin.innerHTML = photo ? `<img class="avatar" src="${photo}" alt="${name}">` : `<span class="avatar">${(name || (u && u.email) || "管")[0]}</span>`;
            btnAvatarAdmin.addEventListener("click", () => openUserProfileModal());
          }

          // SOS System - Global Alert Listener
          let sosUnsub = null;
          const activeAlertsState = new Map(); // Key: docId, Value: { data, snoozeTimer, visualInterval, modal, badge }

          function checkGlobalSound() {
             const ringing = Array.from(activeAlertsState.values()).some(state => state.modal !== null);
             if (ringing) {
                 startAlarm();
             } else {
                 stopAlarm();
             }
          }

          function stopAlarm() {
             if(window.sosAlarmTimer) {
               clearInterval(window.sosAlarmTimer);
               window.sosAlarmTimer = null;
             }
             // Optional: close audio context if needed
          }
          
          function startAlarm() {
             if(window.sosAlarmTimer) return;
             
             let ctx;
             try {
               ctx = new (window.AudioContext || window.webkitAudioContext)();
             } catch(e) {
               console.error("AudioContext not supported", e);
               return;
             }
             
             const beep = () => {
               if(ctx.state === 'suspended') {
                 ctx.resume().catch(err => console.log("AudioContext resume failed", err));
               }
               
               try {
                 const osc = ctx.createOscillator();
                 const gain = ctx.createGain();
                 osc.connect(gain);
                 gain.connect(ctx.destination);
                 osc.frequency.setValueAtTime(800, ctx.currentTime);
                 osc.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.5);
                 osc.type = "sawtooth";
                 osc.start();
                 gain.gain.setValueAtTime(0.5, ctx.currentTime);
                 gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
                 osc.stop(ctx.currentTime + 0.5);
               } catch(e) {
                 console.error("Beep error", e);
               }
             };
             
             beep();
             window.sosAlarmTimer = setInterval(beep, 1000);
          }

          function stopAlert(id) {
            const state = activeAlertsState.get(id);
            if (!state) return;

            if (state.snoozeTimer) clearTimeout(state.snoozeTimer);
            if (state.visualInterval) clearInterval(state.visualInterval);
            if (state.modal) state.modal.remove();
            if (state.badge) state.badge.remove();
            
            // Reset buttons for this ID
            const trs = document.querySelectorAll(`tr[data-id="${id}"]`);
            trs.forEach(tr => {
                const btn = tr.querySelector(".btn-resolve-sos");
                if (btn) btn.textContent = "解除";
            });

            activeAlertsState.delete(id);
            checkGlobalSound();
          }

          function startAlert(docId, data) {
             let state = activeAlertsState.get(docId);
             
             if (state) {
                 state.data = data;
                 // If modal is currently shown, update its content
                 if (state.modal) {
                     updateSOSModalContent(docId, data);
                 }
                 return;
             }
             
             // New alert
             state = {
                 id: docId,
                 data: data,
                 snoozeTimer: null,
                 visualInterval: null,
                 modal: null,
                 badge: null
             };
             activeAlertsState.set(docId, state);
             showSOSModal(docId, data);
             checkGlobalSound();
          }

          function getBadgeContainer() {
             // 1. Check if we have a global layout right sidebar (Community Admin)
             const layoutRight = document.getElementById('layout-right');
             if (layoutRight) {
                let container = document.getElementById("sos-badge-container");
                if (!container) {
                    container = document.createElement("div");
                    container.id = "sos-badge-container";
                    container.style.cssText = `
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                        padding: 10px;
                        width: 100%;
                        height: 100%;
                        overflow-y: auto;
                        align-items: center;
                        /* Hide scrollbar for cleaner look but allow scrolling */
                        scrollbar-width: thin;
                        -ms-overflow-style: none;
                    `;
                    // Add style to hide scrollbar for webkit
                    if (!document.getElementById('style-hide-scroll')) {
                        const style = document.createElement('style');
                        style.id = 'style-hide-scroll';
                        style.innerHTML = '#sos-badge-container::-webkit-scrollbar { display: none; }';
                        document.head.appendChild(style);
                    }
                    layoutRight.appendChild(container);
                }
                return container;
             }

             // 2. Fallback to existing logic for other pages
             let container = document.getElementById("sos-badge-container");
             if (container) return container;
             
             // Try to find the top bar in the current active stack
             let targetBar = null;
             if (document.querySelector('.stack.admin:not(.hidden) .bar')) {
                 targetBar = document.querySelector('.stack.admin:not(.hidden) .bar');
             } else if (document.querySelector('.stack.sys:not(.hidden) .bar')) {
                 targetBar = document.querySelector('.stack.sys:not(.hidden) .bar');
             } else if (document.querySelector('.stack.front:not(.hidden) .bar')) {
                 targetBar = document.querySelector('.stack.front:not(.hidden) .bar');
             }
             
             // Fallback
             if (!targetBar) {
                 targetBar = document.querySelector('.stack.admin .bar') || document.querySelector('.stack.sys .bar') || document.querySelector('.bar');
             }
             
             container = document.createElement("div");
             container.id = "sos-badge-container";
             container.style.cssText = `
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                display: flex;
                flex-direction: column;
                gap: 10px;
                z-index: 100001;
                pointer-events: none; /* Allow clicks to pass through container, but children will catch them */
             `;
             
             if (targetBar) {
                 const computedStyle = window.getComputedStyle(targetBar);
                 if (computedStyle.position === 'static') {
                     targetBar.style.position = 'relative';
                 }
                 targetBar.appendChild(container);
             } else {
                 // Absolute fallback
                 container.style.position = "fixed";
                 container.style.bottom = "20px";
                 container.style.right = "20px";
                 container.style.left = "auto";
                 container.style.top = "auto";
                 container.style.transform = "none";
                 document.body.appendChild(container);
             }
             
             return container;
          }

          function startSnoozeCountdown(docId, seconds) {
             const state = activeAlertsState.get(docId);
             if (!state) return;
             
             // Clear existing visual timers for this alert
             if (state.visualInterval) clearInterval(state.visualInterval);
             
             // Create floating badge if not exists
             if (!state.badge) {
                 state.badge = document.createElement("div");
                 state.badge.id = `sos-snooze-badge-${docId}`;
                 state.badge.style.cssText = `
                    background: #ef4444;
                    color: white;
                    padding: 8px 12px;
                    border-radius: 8px;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                    font-size: 0.9rem;
                    font-weight: bold;
                    display: flex;
                    flex-direction: column; /* Stack content vertically for sidebar width */
                    align-items: center;
                    gap: 5px;
                    cursor: pointer;
                    animation: pulse-red 2s infinite;
                    pointer-events: auto;
                    width: 100%; /* Fill container width */
                    text-align: center;
                 `;
                 
                 const container = getBadgeContainer();
                 container.appendChild(state.badge);
                 
                 // Handle Click
                state.badge.onclick = () => {
                    // Navigate
                    localStorage.setItem("adminActiveSub", "警報");
                    if (typeof setActiveAdminNav === "function") {
                        setActiveAdminNav("residents");
                    } else {
                        const btn = document.getElementById("admin-tab-residents");
                        if (btn) btn.click();
                    }
                    
                    // Re-open modal WITHOUT resetting timer or triggering alarm
                    showSOSModal(docId, state.data, true); // true = silent mode
                };
            }
             
             if (!document.getElementById("style-pulse-red")) {
                 const style = document.createElement("style");
                 style.id = "style-pulse-red";
                 style.innerHTML = `@keyframes pulse-red { 0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); } 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }`;
                 document.head.appendChild(style);
             }
             
             const render = (sec) => {
                 const info = `${state.data.houseNo || '?'}戶<br>${state.data.name || '?'}`;
                 state.badge.innerHTML = `<span style="font-size: 12px; line-height: 1.2;">⚠️ ${info}</span> <span style="background:white; color:#ef4444; padding:2px 8px; border-radius:10px; font-size:12px;">${sec}s</span>`;
                 
                 // Update SPECIFIC Table Button
                 const trs = document.querySelectorAll(`tr[data-id="${docId}"]`);
                 trs.forEach(tr => {
                     const btn = tr.querySelector(".btn-resolve-sos");
                     if (btn) btn.textContent = `解除...${sec}s`;
                 });
             };
             
             let left = seconds;
             render(left);
             
             state.visualInterval = setInterval(() => {
                 left--;
                 if (left <= 0) {
                     clearInterval(state.visualInterval);
                     state.visualInterval = null;
                     showSOSModal(docId, state.data);
                 } else {
                     render(left);
                 }
             }, 1000);
          }

          function showSOSModal(docId, data, silent = false) {
             const state = activeAlertsState.get(docId);
             if (!state) return; 

             // If NOT silent (normal alert), clear timer and remove badge
             if (!silent) {
                 if (state.visualInterval) {
                     clearInterval(state.visualInterval);
                     state.visualInterval = null;
                 }
                 if (state.badge) {
                     state.badge.remove();
                     state.badge = null;
                 }
             }
             
             // Create or update modal
             if (!state.modal) {
               state.modal = document.createElement("div");
               state.modal.id = `sos-alert-modal-${docId}`;
               state.modal.className = "modal sos-alert-modal"; 
               document.body.appendChild(state.modal);
             }
             
             const allKeys = Array.from(activeAlertsState.keys());
             const index = allKeys.indexOf(docId);
             
             state.modal.style.cssText = `
       display: flex;
       position: fixed;
       z-index: ${99999 + index};
       left: 0;
       top: 0;
       width: 100%;
       height: 100%;
       background-color: ${index === 0 ? 'rgba(0,0,0,0.1)' : 'transparent'};
       align-items: center;
       justify-content: center;
       pointer-events: none;
    `;
    
    // Dialog offset logic
    const dialogStyle = `
       border: 4px solid #ef4444; 
       box-shadow: 0 0 20px rgba(239, 68, 68, 0.5);
       position: relative;
       top: ${index * 30}px;
       left: ${index * 30}px;
       pointer-events: auto;
    `;

             state.modal.innerHTML = `
               <div class="modal-dialog" style="${dialogStyle}">
                 <div class="modal-head" style="background: #ef4444; color: white;">
                   <div class="modal-title">⚠️ 緊急求救警報 (${index + 1}) ⚠️</div>
                   <button type="button" class="btn-close-header" style="background:transparent; border:none; color:white; font-size:24px; cursor:pointer; padding:0 8px; line-height:1;">&times;</button>
                 </div>
                 <div class="modal-body" style="font-size: 1.2rem;">
                   <div class="modal-row"><label>戶號：</label> <strong style="font-size:1.5rem">${data.houseNo || ""}</strong></div>
                   <div class="modal-row"><label>子戶號：</label> <strong>${data.subNo || ""}</strong></div>
                   <div class="modal-row"><label>姓名：</label> <strong>${data.name || ""}</strong></div>
                   <div class="modal-row"><label>地址：</label> <strong>${data.address || ""}</strong></div>
                   <div class="modal-row"><label>時間：</label> <span>${new Date(data.createdAt).toLocaleString()}</span></div>
                 </div>
                 <div class="modal-foot">
                   <button class="btn action-btn danger btn-close-sos-alarm" style="width:100%; font-size:1.2rem;">${silent ? '關閉視窗 (倒數繼續)' : '收到，暫時關閉警報 (60秒後若未解除將再次提醒)'}</button>
                 </div>
               </div>
             `;
             state.modal.classList.remove("hidden");
             
             const handleClose = () => {
                 state.modal.remove();
                 state.modal = null;
                 
                 // If silent, DO NOT reset timer, just close window
                 if (silent) {
                    // Do nothing else, timer continues in background
                 } else {
                    checkGlobalSound(); 
                    startSnoozeCountdown(docId, 60);
                 }
             };

             const btnClose = state.modal.querySelector(".btn-close-sos-alarm");
             if(btnClose) btnClose.addEventListener("click", handleClose);
             
             const btnCloseHeader = state.modal.querySelector(".btn-close-header");
             if(btnCloseHeader) btnCloseHeader.addEventListener("click", handleClose);

             // Enable Dragging (Draggable Modal)
             const dialogEl = state.modal.querySelector(".modal-dialog");
             const headerEl = state.modal.querySelector(".modal-head");
             if (dialogEl && headerEl) {
                 headerEl.style.cursor = "move";
                 headerEl.style.userSelect = "none"; // Prevent text selection
                 
                 headerEl.addEventListener("mousedown", (e) => {
                     // Prevent drag if clicking buttons (like close button)
                     if (e.target.tagName.toLowerCase() === "button" || e.target.closest("button")) return;
                     
                     const startX = e.clientX;
                     const startY = e.clientY;
                     // Parse current top/left (which are relative offsets in this flex layout)
                     const initialLeft = parseFloat(dialogEl.style.left) || 0;
                     const initialTop = parseFloat(dialogEl.style.top) || 0;
                     
                     const onMouseMove = (ev) => {
                         const dx = ev.clientX - startX;
                         const dy = ev.clientY - startY;
                         dialogEl.style.left = `${initialLeft + dx}px`;
                         dialogEl.style.top = `${initialTop + dy}px`;
                     };
                     
                     const onMouseUp = () => {
                         document.removeEventListener("mousemove", onMouseMove);
                         document.removeEventListener("mouseup", onMouseUp);
                     };
                     
                     document.addEventListener("mousemove", onMouseMove);
                     document.addEventListener("mouseup", onMouseUp);
                 });
             }
             
             if (!silent) {
                checkGlobalSound();
             }
          }

          function updateSOSModalContent(docId, data) {
              const state = activeAlertsState.get(docId);
              if (!state || !state.modal) return;
              showSOSModal(docId, data);
          }

          if (sosUnsub) sosUnsub();
          
          const listenSlug = slug || "default";
          console.log("Starting SOS listener for community:", listenSlug);
          
          if (listenSlug) {
              const qSos = query(collection(db, "sos_alerts"), where("community", "==", listenSlug));
              sosUnsub = onSnapshot(qSos, (snap) => {
                 const activeDocs = snap.docs.map(d => ({id: d.id, ...d.data()}))
                                           .filter(d => d.status === "active" || !d.status);
                 
                 console.log("SOS Snapshot update. Total:", snap.size, "Active:", activeDocs.length);
                 
                 const currentIds = new Set(activeDocs.map(d => d.id));
                 
                 // 1. Remove alerts that are no longer active
                 for (const [id, state] of activeAlertsState) {
                     if (!currentIds.has(id)) {
                         stopAlert(id);
                     }
                 }
                 
                 // 2. Add or Update active alerts
                 activeDocs.forEach(doc => {
                     startAlert(doc.id, doc);
                 });
                 
                 checkGlobalSound();
              });
          }
    }
    
    if (el.profileEmail) el.profileEmail.textContent = user.email;
    // We can fetch role here if needed for profile card
    } else {
      toggleAuth(true);
      const pathNow = window.location.pathname || "";
      if (pathNow.includes("front")) {
        location.replace("index.html");
        return;
      }
    }
  });

async function openCommunitySwitcher(type) {
  console.log("openCommunitySwitcher called", type);
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.style.display = "flex"; // Force visible
  
  let communities = [];
  try {
    const q = query(collection(db, "communities"));
    const snap = await getDocs(q);
    communities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) {
    console.error(e);
    return alert("無法載入社區列表");
  }

  modal.innerHTML = `
    <div class="modal-dialog" style="max-height: 80vh; overflow-y: auto;">
      <div class="modal-head">
        <div class="modal-title">切換社區 (${type === 'admin' ? '後台' : '前台'})</div>
      </div>
      <div class="modal-body"></div>
      <div class="modal-foot">
        <button class="btn action-btn close-btn">關閉</button>
      </div>
    </div>
  `;

  const bodyEl = modal.querySelector(".modal-body");
  if (communities.length === 0) {
    bodyEl.innerHTML = '<div style="padding:20px;text-align:center">無社區資料</div>';
  } else {
    communities.forEach(c => {
      const row = document.createElement("div");
      row.className = "modal-row";
      row.style.cssText = "cursor:pointer; padding: 10px; border-bottom: 1px solid #eee;";
      row.innerHTML = `<strong>${c.name || c.id}</strong> <span style="color:#888">(${c.id})</span>`;
      row.addEventListener("click", async (e) => {
        if (type === 'admin' && location.pathname.includes('admin')) {
          e.preventDefault();
          window.currentAdminCommunitySlug = c.id;
          try {
            localStorage.setItem("adminCurrentCommunity", c.id);
            const url = new URL(window.location);
            url.searchParams.set("c", c.id);
            window.history.pushState({}, "", url);
          } catch {}

          if (typeof updateAdminBrandTitle === 'function') await updateAdminBrandTitle();
          
          const savedMain = localStorage.getItem('adminActiveMain') || 'shortcuts';
          if (typeof setActiveAdminNav === 'function') {
            setActiveAdminNav(savedMain);
            // Force re-render to ensure content updates immediately
            if (adminNav.subContainer) {
              const activeSub = adminNav.subContainer.querySelector('.sub-nav-item.active');
              if (activeSub) {
                const label = (activeSub.getAttribute('data-label') || activeSub.textContent || '').replace(/\u200B/g, '').trim();
                renderAdminContent(savedMain, label);
              } else {
                renderAdminSubNav(savedMain);
              }
            }
          }
          
          modal.remove();
        } else {
          location.href = `${type}.html?c=${c.id}`;
        }
      });
      bodyEl.appendChild(row);
    });
  }

  modal.querySelector(".close-btn").addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);
}


// Sign out handlers
[btnSignoutFront, btnSignoutAdmin, btnSignoutSys, el.btnSignout].forEach(btn => {
  if (btn) {
    btn.addEventListener("click", async () => {
      await signOut(auth);
      redirectAfterSignOut();
    });
  }
});

// Admin signout specifically needs to find the button again if it was added dynamically or just ensure it works
if (!btnSignoutAdmin) {
    // If it wasn't found initially (maybe because it was in hidden section?), try to bind it if it exists now
    const retryBtn = document.getElementById("btn-signout-admin");
    if (retryBtn) {
        retryBtn.addEventListener("click", async () => {
          await signOut(auth);
          redirectAfterSignOut();
        });
    }
}

// Password toggle
if (btnTogglePassword) {
  const iconShow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  const iconHide = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
  
  btnTogglePassword.innerHTML = iconShow;
  
  btnTogglePassword.addEventListener("click", () => {
    const isPassword = el.password.getAttribute("type") === "password";
    el.password.setAttribute("type", isPassword ? "text" : "password");
    btnTogglePassword.innerHTML = isPassword ? iconHide : iconShow;
  });
}

// System Admin Page Navigation Logic
const sysNav = {
  home: document.getElementById("sys-nav-home"),
  notify: document.getElementById("sys-nav-notify"),
  settings: document.getElementById("sys-nav-settings"),
  app: document.getElementById("sys-nav-app"),
  subContainer: document.getElementById("sys-sub-nav"),
  content: document.getElementById("sys-content")
};

const sysSubMenus = {
  home: ["總覽", "社區"],
  notify: ["系統", "社區", "住戶"],
  settings: ["一般", "社區", "系統"],
  app: ["廣告", "按鈕"]
};

if (sysNav.subContainer) {
  const adminAccounts = [
    // Use current authenticated admin account
  ];
  
  async function renderSettingsGeneral() {
    if (!sysNav.content) return;
    const user = auth.currentUser;
    const email = (user && user.email) || "nwapp.eason@gmail.com";
    const uid = user && user.uid;
    let role = "系統管理員";
    let status = "啟用";
    let name = (user && user.displayName) || "系統管理員";
    let phone = "";
    let photoURL = (user && user.photoURL) || "";
    if (uid) {
      try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
          const d = snap.data();
          phone = d.phone || phone;
          name = name || d.displayName || name;
          photoURL = photoURL || d.photoURL || photoURL;
        }
      } catch (e) {
        console.warn("Fetch user doc failed", e);
      }
    }
    const avatarHtml = photoURL 
      ? `<img class="avatar" src="${photoURL}" alt="avatar">`
      : `<span class="avatar">${(name || email)[0]}</span>`;
    // Fetch all users list from Firestore
    let admins = [];
    let communities = [];
    try {
      const [snapList, snapComm] = await Promise.all([
        getDocs(query(collection(db, "users"))),
        getDocs(query(collection(db, "communities")))
      ]);
      admins = snapList.docs.map(d => ({ id: d.id, ...d.data() }));
      communities = snapComm.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn("Query data failed", e);
    }
    if (!admins.length) {
      admins = [{ id: uid || "me", email, role, status, displayName: name, phone, photoURL }];
    }

    const communityOptions = communities.map(c => `<option value="${c.id}">${c.name || c.id}</option>`).join("");

    sysNav.content.innerHTML = `
      <div class="card data-card">
        <div class="card-head">
          <h1 class="card-title">帳號列表</h1>
          <div style="display: flex; gap: 8px;">
            <button id="btn-export-admin" class="btn small action-btn" style="background-color: #10b981; color: white;">匯出</button>
            <button id="btn-create-admin" class="btn small action-btn" style="background-color: #ef4444; color: white;">新增</button>
          </div>
        </div>
        
        <div class="card-filters" style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap; padding: 0 20px 15px 20px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="font-weight:bold;">所屬社區:</label>
            <select id="filter-community" style="padding: 6px; border-radius: 4px; border: 1px solid #ddd;">
                <option value="全部">全部</option>
                ${communityOptions}
            </select>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="font-weight:bold;">角色:</label>
            <select id="filter-role" style="padding: 6px; border-radius: 4px; border: 1px solid #ddd;">
                <option value="全部">全部</option>
                <option value="系統管理員">系統管理員</option>
                <option value="社區">社區</option>
                <option value="住戶">住戶</option>
            </select>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="font-weight:bold;">姓名關鍵字:</label>
            <input type="text" id="filter-name" placeholder="輸入姓名搜尋" style="padding: 6px; border-radius: 4px; border: 1px solid #ddd; width: 150px;">
          </div>
        </div>

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>角色</th>
                <th>權限</th>
                <th>所屬公司</th>
                <th>大頭照</th>
                <th>姓名</th>
                <th>電子郵件</th>
                <th>手機號碼</th>
                <th>密碼</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;

    const renderTable = () => {
        const commFilter = document.getElementById("filter-community").value;
        const roleFilter = document.getElementById("filter-role").value;
        const nameFilter = document.getElementById("filter-name").value.trim().toLowerCase();

        let filtered = admins.filter(a => {
            // Filter by Community
            if (commFilter !== "全部") {
                 // SysAdmin shows "All" so they don't belong to a specific community
                 if (a.role === "系統管理員") return false; 
                 if (a.community !== commFilter) return false;
            }

            // Filter by Role
            if (roleFilter !== "全部" && a.role !== roleFilter) return false;
            
            // Filter by Name
            if (nameFilter) {
                const n = (a.displayName || "").toLowerCase();
                if (!n.includes(nameFilter)) return false;
            }
            return true;
        });

        // Sort: System Admin -> Community -> Resident (by houseNo)
        filtered.sort((a, b) => {
            const getPriority = (role) => {
                if (role === "系統管理員") return 1;
                if (role === "住戶") return 3;
                return 2;
            };
            const pA = getPriority(a.role);
            const pB = getPriority(b.role);
            if (pA !== pB) return pA - pB;
            
            if (a.role === "住戶") {
                const hA = (a.houseNo || "").toString();
                const hB = (b.houseNo || "").toString();
                return hA.localeCompare(hB, undefined, { numeric: true, sensitivity: 'base' });
            }
            return 0;
        });

        const rows = filtered.map(a => {
            const nm = a.displayName || a.role || "使用者";
            let companyVal = "全部";
            if (a.role !== "系統管理員") {
                const cObj = communities.find(c => c.id === a.community);
                companyVal = cObj ? (cObj.name || a.community) : (a.community || "");
            }
            const av = a.photoURL 
                ? `<img class="avatar" src="${a.photoURL}" alt="avatar">`
                : `<span class="avatar">${(nm || a.email)[0]}</span>`;
            
            // Determine permissions
            const isSys = a.role === "系統管理員";
            const isBack = isSys || ["社區管理員", "總幹事", "管理委員會", "社區"].includes(a.role);
            const isFront = a.status === "啟用"; // Front is based on Status being active

            const permButtons = `
                <button class="perm-btn btn-perm-sys ${isSys ? 'active' : 'inactive'}">系</button>
                <button class="perm-btn btn-perm-back ${isBack ? 'active' : 'inactive'}">後</button>
                <button class="perm-btn btn-perm-front ${isFront ? 'active' : 'inactive'}">前</button>
            `;

            let statusHtml = "";
            if (a.role === "系統管理員") {
                statusHtml = `<span class="status">永遠啟用</span>`;
            } else {
                const isChecked = a.status === "停用" ? "checked" : "";
                statusHtml = `
                <label class="switch">
                    <input type="checkbox" class="status-toggle" ${isChecked}>
                    <span class="slider round"></span>
                </label>
                `;
            }

            return `
                <tr data-uid="${a.id}">
                <td>${a.role}</td>
                <td class="perm-cell">${permButtons}</td>
                <td>${companyVal}</td>
                <td>${av}</td>
                <td>${nm}</td>
                <td>${a.email}</td>
                <td>${a.phone || ""}</td>
                <td><button class="btn small action-btn btn-reset-pwd">重設</button></td>
                <td>${statusHtml}</td>
                <td>
                    <div class="actions">
                    <button class="btn small action-btn btn-edit-admin">編輯</button>
                    <button class="btn small action-btn danger btn-delete-admin">刪除</button>
                    </div>
                </td>
                </tr>
            `;
        }).join("");

        sysNav.content.querySelector("tbody").innerHTML = rows;
        bindRowEvents();
    };

    const bindRowEvents = () => {
        // Bind Permission Buttons
        sysNav.content.querySelectorAll(".btn-perm-sys").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const tr = e.target.closest("tr");
                const uid = tr.getAttribute("data-uid");
                if (!uid) return;
                const isActive = btn.classList.contains("active");
                
                let newRole = "社區"; // Default downgrade
                if (!isActive) newRole = "系統管理員"; // Upgrade
                
                try {
                    await setDoc(doc(db, "users", uid), { role: newRole }, { merge: true });
                    showHint("權限已更新", "success");
                    // Update local data and re-render to avoid full fetch
                    const user = admins.find(u => u.id === uid);
                    if(user) user.role = newRole;
                    renderTable(); 
                } catch (err) {
                    console.error(err);
                    showHint("更新失敗", "error");
                }
            });
        });

        sysNav.content.querySelectorAll(".btn-perm-back").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const tr = e.target.closest("tr");
                const uid = tr.getAttribute("data-uid");
                if (!uid) return;
                const isActive = btn.classList.contains("active");

                let newRole = "住戶"; // Default downgrade
                if (!isActive) newRole = "社區"; // Upgrade
                
                try {
                    await setDoc(doc(db, "users", uid), { role: newRole }, { merge: true });
                    showHint("權限已更新", "success");
                    const user = admins.find(u => u.id === uid);
                    if(user) user.role = newRole;
                    renderTable();
                } catch (err) {
                    console.error(err);
                    showHint("更新失敗", "error");
                }
            });
        });

        sysNav.content.querySelectorAll(".btn-perm-front").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const tr = e.target.closest("tr");
                const uid = tr.getAttribute("data-uid");
                if (!uid) return;
                const isActive = btn.classList.contains("active");

                const newStatus = isActive ? "停用" : "啟用";
                
                if (isActive && auth.currentUser && auth.currentUser.uid === uid) {
                    const ok = window.confirm("您正在停用自己的權限，這將導致您被登出。確定嗎？");
                    if (!ok) return;
                }

                try {
                    await setDoc(doc(db, "users", uid), { status: newStatus }, { merge: true });
                    showHint(newStatus === "啟用" ? "已啟用前台權限" : "已停用前台權限", "success");
                    if (newStatus === "停用" && auth.currentUser && auth.currentUser.uid === uid) {
                        await signOut(auth);
                        redirectAfterSignOut();
                    } else {
                        const user = admins.find(u => u.id === uid);
                        if(user) user.status = newStatus;
                        renderTable();
                    }
                } catch (err) {
                    console.error(err);
                    showHint("更新失敗", "error");
                }
            });
        });

        // Bind Reset Password Buttons
        sysNav.content.querySelectorAll(".btn-reset-pwd").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const tr = e.target.closest("tr");
                const emailCell = tr.children[5]; // Index 5 is Email now? Check columns.
                // Columns: Role(0), Perm(1), Company(2), Avatar(3), Name(4), Email(5)...
                // Correct.
                const email = emailCell ? emailCell.textContent.trim() : "";
                
                if (!email) {
                    showHint("找不到電子郵件", "error");
                    return;
                }

                const ok = window.confirm(`確定要重設 ${email} 的密碼嗎？\n(注意：系統將發送密碼重設信件至該信箱，因安全性限制無法直接設為123456)`);
                if (!ok) return;

                try {
                    await sendPasswordResetEmail(auth, email);
                    showHint("已發送密碼重設信", "success");
                } catch (err) {
                    console.error(err);
                    showHint("發送失敗: " + err.message, "error");
                }
            });
        });

        // Bind Status Toggles
        sysNav.content.querySelectorAll(".status-toggle").forEach(toggle => {
            toggle.addEventListener("change", async (e) => {
                const tr = e.target.closest("tr");
                const targetUid = tr && tr.getAttribute("data-uid");
                if (!targetUid) return;

                const newStatus = e.target.checked ? "停用" : "啟用";
                
                const currentUser = auth.currentUser;
                if (currentUser && currentUser.uid === targetUid && newStatus === "停用") {
                    const ok = window.confirm("您正在停用自己的帳號，這將導致您被登出。確定嗎？");
                    if (!ok) {
                        e.target.checked = false; 
                        return;
                    }
                }

                try {
                    await setDoc(doc(db, "users", targetUid), { status: newStatus }, { merge: true });
                    showHint(newStatus === "啟用" ? "帳號已啟用" : "帳號已停用", "success");
                    
                    if (currentUser && currentUser.uid === targetUid && newStatus === "停用") {
                        await signOut(auth);
                        redirectAfterSignOut();
                    }
                    const user = admins.find(u => u.id === targetUid);
                    if(user) user.status = newStatus;
                    renderTable(); 
                } catch (err) {
                    console.error(err);
                    showHint("更新狀態失敗", "error");
                    e.target.checked = !e.target.checked;
                }
            });
        });

        // Bind actions for each row
        sysNav.content.querySelectorAll(".btn-edit-admin").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!sysNav.content) return;
                const tr = btn.closest("tr");
                const targetUid = tr && tr.getAttribute("data-uid");
                const target = admins.find(a => a.id === targetUid);
                if (target) openEditModal(target, targetUid === uid, "system-admin");
            });
        });

        sysNav.content.querySelectorAll(".btn-delete-admin").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!sysNav.content) return;
                const tr = btn.closest("tr");
                const targetUid = tr && tr.getAttribute("data-uid");
                const target = admins.find(a => a.id === targetUid);
                if (!target) return;

                if (targetUid === uid) {
                    showHint("無法刪除自己的帳號", "error");
                    return;
                }

                const ok = window.confirm(`確定要刪除帳號 ${target.displayName || target.email} 嗎？`);
                if (!ok) return;

                try {
                    if (target && target.phone) await syncUserLookup(target.phone, null, null);
                    await deleteDoc(doc(db, "users", targetUid));
                    showHint("已刪除帳號", "success");
                    // Remove from local list and re-render
                    admins = admins.filter(a => a.id !== targetUid);
                    renderTable();
                } catch (e) {
                    console.error(e);
                    showHint("刪除失敗", "error");
                }
            });
        });
    };

    // Attach Filter Events
    document.getElementById("filter-community").addEventListener("change", renderTable);
    document.getElementById("filter-role").addEventListener("change", renderTable);
    document.getElementById("filter-name").addEventListener("input", renderTable);

    // Initial Render
    renderTable();

    // Bind Export Button
    const btnExport = document.getElementById("btn-export-admin");
    if (btnExport) {
        btnExport.addEventListener("click", () => {
            const commFilter = document.getElementById("filter-community").value;
            const roleFilter = document.getElementById("filter-role").value;
            const nameFilter = document.getElementById("filter-name").value.trim().toLowerCase();

            let filtered = admins.filter(a => {
                if (commFilter !== "全部") {
                     if (a.role === "系統管理員") return false; 
                     if (a.community !== commFilter) return false;
                }
                if (roleFilter !== "全部" && a.role !== roleFilter) return false;
                if (nameFilter) {
                    const n = (a.displayName || "").toLowerCase();
                    if (!n.includes(nameFilter)) return false;
                }
                return true;
            });

            filtered.sort((a, b) => {
                const getPriority = (role) => {
                    if (role === "系統管理員") return 1;
                    if (role === "住戶") return 3;
                    return 2;
                };
                const pA = getPriority(a.role);
                const pB = getPriority(b.role);
                if (pA !== pB) return pA - pB;
                
                if (a.role === "住戶") {
                    const hA = (a.houseNo || "").toString();
                    const hB = (b.houseNo || "").toString();
                    return hA.localeCompare(hB, undefined, { numeric: true, sensitivity: 'base' });
                }
                return 0;
            });

            const data = filtered.map(a => {
                let commName = "全部";
                if (a.role !== "系統管理員") {
                    const cObj = communities.find(c => c.id === a.community);
                    commName = cObj ? (cObj.name || a.community) : (a.community || "");
                }
                return {
                    "所屬社區": commName,
                    "戶號": a.houseNo || "",
                    "子戶號": a.subNo || "",
                    "姓名": a.displayName || "",
                    "帳號": a.email || "",
                    "角色": a.role || ""
                };
            });

            if (typeof XLSX === 'undefined') {
                showHint("匯出功能尚未載入完成，請稍後再試", "error");
                return;
            }

            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "帳號列表");
            
            const date = new Date().toISOString().slice(0,10);
            XLSX.writeFile(wb, `帳號列表_${date}.xlsx`);
        });
    }

    // Bind Create Button
    const btnCreate = document.getElementById("btn-create-admin");
    if (btnCreate) {
        btnCreate.addEventListener("click", () => {
            openCreateModal();
        });
    }
  }
  
  async function renderSettingsCommunity() {
    if (!sysNav.content) return;
    let list = [];
    let residentCounts = {};
    try {
      const [snapComm, snapUsers] = await Promise.all([
        getDocs(collection(db, "communities")),
        getDocs(collection(db, "users"))
      ]);
      list = snapComm.docs.map(d => ({ id: d.id, ...d.data() }));
      snapUsers.forEach(d => {
        const u = d.data();
        if (u.role === "住戶" && u.community) {
          residentCounts[u.community] = (residentCounts[u.community] || 0) + 1;
        }
      });
    } catch (e) {
       console.error(e);
       // Fallback: try fetching just communities
       try {
           const snap = await getDocs(collection(db, "communities"));
           list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
       } catch {}
    }
    list.forEach(c => {
      communityConfigs[c.id] = {
        apiKey: c.apiKey,
        authDomain: c.authDomain,
        projectId: c.projectId,
        storageBucket: c.storageBucket,
        messagingSenderId: c.messagingSenderId,
        appId: c.appId,
        measurementId: c.measurementId
      };
    });
    const rows = list.map(c => `
      <tr data-slug="${c.id}">
        <td>${c.id}</td>
        <td>${c.name || ""}</td>
        <td>${c.projectId || ""}</td>
        <td>${residentCounts[c.id] || 0}</td>
        <td>
          <label class="switch">
            <input type="checkbox" class="status-toggle-community-config" ${c.status === "停用" ? "checked" : ""}>
            <span class="slider round"></span>
          </label>
        </td>
        <td>
          <div class="actions">
            <button class="btn small action-btn btn-edit-community">編輯</button>
            <button class="btn small action-btn danger btn-delete-community">刪除</button>
            <button class="btn small action-btn btn-go-community" data-slug="${c.id}">進入後台</button>
            <button class="btn small action-btn btn-go-front" data-slug="${c.id}">進入前台</button>
          </div>
        </td>
      </tr>
    `).join("");
    // 社區後台帳號區塊已移除


    sysNav.content.innerHTML = `
      <div class="card data-card">
        <div class="card-head">
          <h1 class="card-title">社區設定</h1>
          <button id="btn-create-community" class="btn small action-btn">新增</button>
        </div>
        <div class="table-wrap">
          <table class="table">
            <colgroup><col><col><col><col><col><col></colgroup>
            <thead>
              <tr>
                <th>社區代碼</th>
                <th>名稱</th>
                <th>Firebase 專案ID</th>
                <th>住戶數</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
    
    const btnCreate = document.getElementById("btn-create-community");
    btnCreate && btnCreate.addEventListener("click", () => openCommunityModal());
    const btnEdits = sysNav.content.querySelectorAll(".btn-edit-community");
    btnEdits.forEach(b => b.addEventListener("click", () => {
      const tr = b.closest("tr");
      const slug = tr && tr.getAttribute("data-slug");
      const found = list.find(x => x.id === slug);
      openCommunityModal(found || { id: slug });
    }));
    const btnDeletes = sysNav.content.querySelectorAll(".btn-delete-community");
    btnDeletes.forEach(b => b.addEventListener("click", async () => {
      const ok = window.confirm("確定要刪除此社區設定嗎？此操作不可恢復。");
      if (!ok) return;
      const tr = b.closest("tr");
      const slug = tr && tr.getAttribute("data-slug");
      if (!slug) return;
      try {
        await deleteDoc(doc(db, "communities", slug));
        delete communityConfigs[slug];
        showHint("已刪除該社區設定", "success");
        await renderSettingsCommunity();
      } catch (e) {
        console.error(e);
        showHint("刪除社區失敗，請稍後再試", "error");
      }
    }));
    const btnGos = sysNav.content.querySelectorAll(".btn-go-community");
    btnGos.forEach(b => b.addEventListener("click", (e) => {
      e.preventDefault();
      const slug = b.getAttribute("data-slug");
      console.log("btn-go-community clicked: slug =", slug);
      if (!slug) {
        console.error("Missing slug for community button");
        showHint("系統錯誤：無法取得社區參數", "error");
        return;
      }
      const found = list.find(x => x.id === slug);
      const status = (found && found.status) || "啟用";
      if (status === "停用") {
        showHint("該社區已停用，無法進入", "error");
        return;
      }
      const url = `admin.html?c=${slug}`;
      const w = window.open(url, "_blank");
      if (w) w.opener = null;
    }));
    const btnGoFronts = sysNav.content.querySelectorAll(".btn-go-front");
    btnGoFronts.forEach(b => b.addEventListener("click", (e) => {
      e.preventDefault();
      const slug = b.getAttribute("data-slug");
      if (!slug) {
        console.error("Missing slug for front button");
        showHint("系統錯誤：無法取得社區參數", "error");
        return;
      }
      const found = list.find(x => x.id === slug);
      const status = (found && found.status) || "啟用";
      if (status === "停用") {
        showHint("該社區已停用，無法進入", "error");
        return;
      }
      const url = `front.html?c=${slug}`;
      const w = window.open(url, "_blank");
      if (w) w.opener = null;
    }));
    // 社區後台帳號綁定事件已移除
    
    // Bind Status Toggles for Community Configs (Top Table)
    const configToggles = sysNav.content.querySelectorAll(".status-toggle-community-config");
    configToggles.forEach(toggle => {
      toggle.addEventListener("change", async (e) => {
        const tr = e.target.closest("tr");
        const slug = tr && tr.getAttribute("data-slug");
        if (!slug) return;
        const newStatus = e.target.checked ? "停用" : "啟用";
        try {
          await setDoc(doc(db, "communities", slug), { status: newStatus }, { merge: true });
          showHint(newStatus === "啟用" ? "社區已啟用" : "社區已停用", "success");
        } catch (err) {
          console.error(err);
          showHint("更新狀態失敗", "error");
          e.target.checked = !e.target.checked;
        }
      });
    });
  }
  
  function openCommunityModal(comm) {
    const data = comm || {};
    const title = data.id ? "編輯社區" : "新增社區";
    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">${title}</div></div>
        <div class="modal-body">
          <div class="modal-row">
            <label>社區代碼</label>
            <input type="text" id="c-slug" value="${data.id || ""}" placeholder="如：north">
          </div>
          <div class="modal-row">
            <label>名稱</label>
            <input type="text" id="c-name" value="${data.name || ""}">
          </div>
          <div class="modal-row"><label>apiKey</label><input type="text" id="c-apiKey" value="${data.apiKey || ""}"></div>
          <div class="modal-row"><label>authDomain</label><input type="text" id="c-authDomain" value="${data.authDomain || ""}"></div>
          <div class="modal-row"><label>projectId</label><input type="text" id="c-projectId" value="${data.projectId || ""}"></div>
          <div class="modal-row"><label>storageBucket</label><input type="text" id="c-storageBucket" value="${data.storageBucket || ""}"></div>
          <div class="modal-row"><label>messagingSenderId</label><input type="text" id="c-msgId" value="${data.messagingSenderId || ""}"></div>
          <div class="modal-row"><label>appId</label><input type="text" id="c-appId" value="${data.appId || ""}"></div>
          <div class="modal-row"><label>measurementId</label><input type="text" id="c-measurementId" value="${data.measurementId || ""}"></div>
          <div class="modal-row"><label>狀態</label>
            <select id="c-status">
              <option value="啟用"${(data.status || "啟用")==="啟用" ? " selected" : ""}>啟用</option>
              <option value="停用"${(data.status || "啟用")==="停用" ? " selected" : ""}>停用</option>
            </select>
          </div>
        </div>
        <div class="modal-foot">
          <button id="c-cancel" class="btn action-btn danger">取消</button>
          <button id="c-save" class="btn action-btn">儲存</button>
        </div>
      </div>
    `;
    openModal(body);
    const btnCancel = document.getElementById("c-cancel");
    const btnSave = document.getElementById("c-save");
    btnCancel && btnCancel.addEventListener("click", () => closeModal());
    btnSave && btnSave.addEventListener("click", async () => {
      const slug = document.getElementById("c-slug").value.trim();
      const name = document.getElementById("c-name").value.trim();
      const apiKey = document.getElementById("c-apiKey").value.trim();
      const authDomain = document.getElementById("c-authDomain").value.trim();
      const projectId = document.getElementById("c-projectId").value.trim();
      const storageBucket = document.getElementById("c-storageBucket").value.trim();
      const messagingSenderId = document.getElementById("c-msgId").value.trim();
      const appId = document.getElementById("c-appId").value.trim();
      const measurementId = document.getElementById("c-measurementId").value.trim();
      const status = document.getElementById("c-status").value;
      if (!slug || !apiKey || !authDomain || !projectId || !appId) {
        showHint("請填入必要欄位（slug/apiKey/authDomain/projectId/appId）", "error");
        return;
      }
      try {
        const payload = { name, apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, measurementId, status, updatedAt: Date.now() };
        await setDoc(doc(db, "communities", slug), payload, { merge: true });
        communityConfigs[slug] = {
          apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, measurementId
        };
        closeModal();
        await renderSettingsCommunity();
        showHint("社區設定已儲存", "success");
      } catch (e) {
        showHint("儲存失敗", "error");
      }
    });
  }
  
  function openCreateCommunityAdminModal(slug) {
    const title = "新增社區後台帳號";
    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">${title}</div></div>
        <div class="modal-body">
          <div class="modal-row">
            <label>電子郵件</label>
            <input type="text" id="create-ca-email" placeholder="example@domain.com">
          </div>
          <div class="modal-row">
            <label>密碼</label>
            <input type="password" id="create-ca-password" placeholder="至少6字元">
          </div>
          <div class="modal-row">
            <label>姓名</label>
            <input type="text" id="create-ca-name">
          </div>
          <div class="modal-row">
            <label>手機號碼</label>
            <input type="tel" id="create-ca-phone">
          </div>
          <div class="modal-row">
            <label>大頭照</label>
            <input type="file" id="create-ca-photo-file" accept="image/png,image/jpeg">
          </div>
          <div class="modal-row">
            <label>預覽</label>
            <img id="create-ca-photo-preview" class="avatar-preview">
          </div>
          <div class="hint" id="create-ca-hint"></div>
        </div>
        <div class="modal-foot">
          <button id="create-ca-cancel" class="btn action-btn danger">取消</button>
          <button id="create-ca-save" class="btn action-btn">建立</button>
        </div>
      </div>
    `;
    openModal(body);
    const btnCancel = document.getElementById("create-ca-cancel");
    const btnSave = document.getElementById("create-ca-save");
    const createFile = document.getElementById("create-ca-photo-file");
    const createPreview = document.getElementById("create-ca-photo-preview");
    const hintEl = document.getElementById("create-ca-hint");

    const showModalHint = (msg, type="error") => {
        if(hintEl) {
            hintEl.textContent = msg;
            hintEl.style.color = type === "error" ? "#b71c1c" : "#0ea5e9";
        }
    };

    createFile && createFile.addEventListener("change", () => {
      const f = createFile.files[0];
      if (f) {
        createPreview.src = URL.createObjectURL(f);
      }
    });
    createPreview && createPreview.addEventListener("click", () => {
      if (createFile) createFile.click();
    });
    btnCancel && btnCancel.addEventListener("click", () => closeModal());
    btnSave && btnSave.addEventListener("click", async () => {
      try {
        showModalHint("");
        const email = document.getElementById("create-ca-email").value.trim();
        const password = document.getElementById("create-ca-password").value;
        const displayName = document.getElementById("create-ca-name").value.trim();
        const phone = document.getElementById("create-ca-phone").value.trim();
        const photoFile = document.getElementById("create-ca-photo-file").files[0];
        let photoURL = "";
        if (!email || !password || password.length < 6) {
          showModalHint("請填寫有效的信箱與至少6字元密碼", "error");
          return;
        }

        btnSave.disabled = true;
        btnSave.textContent = "建立中...";

        const cred = await createUserWithEmailAndPassword(createAuth, email, password);
        if (photoFile) {
          try {
            const ext = photoFile.type === "image/png" ? "png" : "jpg";
            const path = `avatars/${cred.user.uid}.${ext}`;
            const ref = storageRef(storage, path);
            await uploadBytes(ref, photoFile, { contentType: photoFile.type });
            photoURL = await getDownloadURL(ref);
          } catch (err) {
            try {
              const b64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(photoFile);
              });
              photoURL = b64;
              showModalHint("Storage 上傳失敗，已改用內嵌圖片儲存", "error");
            } catch {
              showModalHint("上傳大頭照失敗，帳號仍已建立", "error");
            }
          }
        }
        await setDoc(doc(db, "users", cred.user.uid), {
          email,
          role: "管理員",
          status: "啟用",
          displayName,
          phone,
          photoURL,
          community: slug,
          createdAt: Date.now()
        }, { merge: true });
        await syncUserLookup(null, phone, email);
        await updateProfile(cred.user, { displayName, photoURL });
        closeModal();
        await renderSettingsCommunity();
        showHint("已建立社區後台帳號", "success");
      } catch (e) {
        console.error(e);
        let msg = "建立失敗";
        if (e.code === 'auth/email-already-in-use') msg = "該 Email 已被使用";
        else if (e.code === 'auth/invalid-email') msg = "Email 格式不正確";
        else if (e.code === 'auth/weak-password') msg = "密碼強度不足";
        else if (e.message) msg += ": " + e.message;
        
        showModalHint(msg, "error");
      } finally {
        if(btnSave) {
            btnSave.disabled = false;
            btnSave.textContent = "建立";
        }
      }
    });
  }
  async function openEditModal(target, isSelf, context) {
    const title = "編輯帳號";
    let commList = [];
    try {
      const snap = await getDocs(collection(db, "communities"));
      commList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {}
    const currentComm = target.community || "";
    const commOptions = `<option value="">(無)</option>` + commList.map(c => `<option value="${c.id}"${c.id === currentComm ? " selected" : ""}>${c.name || c.id}</option>`).join("");
    
    const role = target.role || "系統管理員";

    const body = `
      <div class="modal-dialog">
        <div class="modal-head">
          <div class="modal-title">${title}</div>
          <button class="btn top" onclick="closeModal()">關閉</button>
        </div>
        <div class="modal-body">
          <div class="modal-row">
            <label>角色</label>
            <select id="edit-role" ${isSelf ? "disabled" : ""}>
              <option value="系統管理員" ${role === "系統管理員" ? "selected" : ""}>系統管理員</option>
              <option value="社區" ${role === "社區" ? "selected" : ""}>社區</option>
              <option value="住戶" ${role === "住戶" ? "selected" : ""}>住戶</option>
            </select>
          </div>
          <div class="modal-row" id="row-edit-community" style="display:none;">
            <label>所屬社區 <span style="color:red">*</span></label>
            <select id="edit-community" ${isSelf && role === "社區" ? "disabled" : ""}>${commOptions}</select>
          </div>
          <div class="modal-row">
            <label>權限</label>
            <div id="edit-permission-display" style="padding: 8px; background: #f3f4f6; border-radius: 8px; color: #6b7280;"></div>
          </div>
          <div class="modal-row">
            <label>大頭照</label>
            <input type="file" id="edit-photo-file" accept="image/png,image/jpeg">
          </div>
          <div class="modal-row">
            <label>預覽</label>
            <img id="edit-photo-preview" class="avatar-preview" src="${target.photoURL || ""}">
          </div>
          <div class="modal-row">
            <label>姓名</label>
            <input type="text" id="edit-name" value="${target.displayName || ""}">
          </div>
          <div class="modal-row">
            <label>稱謂</label>
            <select id="edit-title">
              <option value="區權人" ${target.title === "區權人" ? "selected" : ""}>區權人</option>
              <option value="親屬" ${target.title === "親屬" ? "selected" : ""}>親屬</option>
              <option value="承租人" ${target.title === "承租人" ? "selected" : ""}>承租人</option>
              <option value="管理員" ${target.title === "管理員" ? "selected" : ""}>管理員</option>
            </select>
          </div>
          <div class="modal-row">
            <label>電子郵件 (為登入帳號)</label>
            <input type="text" id="edit-email" value="${target.email || ""}">
          </div>
          <div class="modal-row">
            <label>手機號碼 (與電子郵件同為帳號，擇一登入)</label>
            <input type="tel" id="edit-phone" value="${target.phone || ""}">
          </div>
          <div class="modal-row">
            <label>QR code碼</label>
            <input type="text" id="edit-qr-code" value="${target.qrCodeText || ""}">
          </div>
          <div class="modal-row">
            <label>QR code預覽</label>
            <img id="edit-qr-preview" class="qr-preview">
          </div>
          <div class="modal-row">
            <label>戶號</label>
            <input type="text" id="edit-house-no" value="${target.houseNo || ""}">
          </div>
          <div class="modal-row">
            <label>子戶號</label>
            <input type="number" id="edit-sub-no" value="${target.subNo !== undefined ? target.subNo : ""}" placeholder="數字">
          </div>
          <div class="modal-row">
            <label>地址</label>
            <input type="text" id="edit-address" value="${target.address || ""}">
          </div>
          <div class="modal-row">
            <label>狀態</label>
            <select id="edit-status" ${isSelf ? "disabled" : ""}>
              <option value="啟用" ${target.status === "啟用" ? "selected" : ""}>啟用</option>
              <option value="停用" ${target.status === "停用" ? "selected" : ""}>停用</option>
            </select>
          </div>
          <div class="modal-row">
            <label>新密碼 (留空則不修改)</label>
            <input type="password" id="edit-password" placeholder="至少6字元">
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn action-btn danger" onclick="closeModal()">取消</button>
          <button class="btn primary" id="btn-save-edit">儲存</button>
        </div>
      </div>
    `;
    openModal(body);
    
    const roleSelect = document.getElementById("edit-role");
    const commRow = document.getElementById("row-edit-community");
    const permDisplay = document.getElementById("edit-permission-display");
    const photoFile = document.getElementById("edit-photo-file");
    const photoPreview = document.getElementById("edit-photo-preview");
    const qrInput = document.getElementById("edit-qr-code");
    const qrPreview = document.getElementById("edit-qr-preview");
    const btnSave = document.getElementById("btn-save-edit");

    const updateRoleUI = () => {
      const r = roleSelect.value;
      const tSelect = document.getElementById("edit-title");
      if (r === "系統管理員") {
        permDisplay.textContent = "系統、後台、前台";
        commRow.style.display = "none";
        if(tSelect) { tSelect.value = "管理員"; tSelect.disabled = true; }
      } else if (r === "社區") {
        permDisplay.textContent = "後台、前台";
        commRow.style.display = "grid";
        if(tSelect) { tSelect.value = "管理員"; tSelect.disabled = true; }
      } else if (r === "住戶") {
        permDisplay.textContent = "前台";
        commRow.style.display = "grid";
        if(tSelect) { 
            tSelect.disabled = false;
            if(tSelect.value === "管理員") tSelect.value = "區權人";
        }
      }
    };
    roleSelect && roleSelect.addEventListener("change", updateRoleUI);
    updateRoleUI();

    photoFile && photoFile.addEventListener("change", () => {
      const f = photoFile.files[0];
      if (f) photoPreview.src = URL.createObjectURL(f);
    });

    const updateQr = async () => {
        const val = qrInput.value.trim();
        if (!val) { qrPreview.src = ""; return; }
        try {
            const url = await getQrDataUrl(val, 150);
            qrPreview.src = url;
        } catch { qrPreview.src = ""; }
    };
    qrInput && qrInput.addEventListener("input", updateQr);
    if(target.qrCodeText) updateQr();

    btnSave && btnSave.addEventListener("click", async () => {
      try {
        const newRole = roleSelect.value;
        const newComm = document.getElementById("edit-community").value;
        const newName = document.getElementById("edit-name").value.trim();
        const newTitle = document.getElementById("edit-title").value;
        const newEmail = document.getElementById("edit-email").value.trim();
        const newPhone = document.getElementById("edit-phone").value.trim();
        const newQr = qrInput.value.trim();
        const newHouse = document.getElementById("edit-house-no").value.trim();
        const newSubNoRaw = document.getElementById("edit-sub-no").value.trim();
        const newAddr = document.getElementById("edit-address").value.trim();
        const newStatus = document.getElementById("edit-status").value;
        const newPass = document.getElementById("edit-password").value;
        const pFile = photoFile.files[0];

        if ((newRole === "社區" || newRole === "住戶") && !newComm) {
            showHint("請選擇所屬社區", "error");
            return;
        }

        btnSave.disabled = true;
        btnSave.textContent = "儲存中...";

        let newPhotoURL = target.photoURL || "";
        if (pFile) {
          try {
            const ext = pFile.type === "image/png" ? "png" : "jpg";
            const path = `avatars/${target.id}.${ext}`;
            const ref = storageRef(storage, path);
            await uploadBytes(ref, pFile, { contentType: pFile.type });
            newPhotoURL = await getDownloadURL(ref);
          } catch (err) {
             try {
               const b64 = await new Promise((resolve) => {
                 const reader = new FileReader();
                 reader.onload = () => resolve(reader.result);
                 reader.readAsDataURL(pFile);
               });
               newPhotoURL = b64;
             } catch {}
          }
        }

        const payload = {
          role: newRole,
          community: newComm || "",
          displayName: newName || target.displayName,
          title: newTitle,
          email: newEmail || target.email,
          phone: newPhone || target.phone,
          qrCodeText: newQr,
          houseNo: newHouse,
          subNo: newSubNoRaw !== "" ? parseInt(newSubNoRaw, 10) : deleteField(),
          address: newAddr,
          status: newStatus,
          photoURL: newPhotoURL
        };
        
        await setDoc(doc(db, "users", target.id), payload, { merge: true });
        await syncUserLookup(target.phone, payload.phone, payload.email);

        const curr = auth.currentUser;
        if (isSelf && curr) {
             const profilePatch = {};
             if (newName && newName !== curr.displayName) profilePatch.displayName = newName;
             if (newPhotoURL && newPhotoURL !== curr.photoURL) profilePatch.photoURL = newPhotoURL;
             if (Object.keys(profilePatch).length) {
               try { await updateProfile(curr, profilePatch); } catch {}
             }
             if (newPass && newPass.length >= 6) {
               try { await updatePassword(curr, newPass); showHint("密碼已更新", "success"); } 
               catch (e) { 
                 if(e.code === 'auth/requires-recent-login') {
                     const cp = window.prompt("請輸入目前密碼以更新新密碼");
                     if(cp) {
                         const cred = EmailAuthProvider.credential(curr.email, cp);
                         await reauthenticateWithCredential(curr, cred);
                         await updatePassword(curr, newPass);
                         showHint("密碼已更新", "success");
                     }
                 } else {
                     showHint("密碼更新失敗: " + e.message, "error");
                 }
               }
             }
             if (newStatus === "停用") {
               await signOut(auth);
               redirectAfterSignOut();
               return;
             }
        }

        closeModal();
        showHint("已更新帳號資料", "success");
        
        if (context === "system-admin") {
          if (typeof renderSettingsGeneral === "function") await renderSettingsGeneral();
        } else if (context === "community-admin") {
          if (typeof renderSettingsResidents === "function") await renderSettingsResidents();
        } else {
          if (typeof renderSettingsGeneral === "function") await renderSettingsGeneral();
          if (typeof renderSettingsCommunity === "function") await renderSettingsCommunity();
          if (typeof renderSettingsResidents === "function") await renderSettingsResidents();
        }

      } catch (e) {
        console.error(e);
        showHint("更新失敗: " + e.message, "error");
      } finally {
        if(btnSave) {
            btnSave.disabled = false;
            btnSave.textContent = "儲存";
        }
      }
    });
  }
  window.openEditModal = openEditModal;
  
  async function openCreateModal() {
    let commList = [];
    try {
      const snap = await getDocs(collection(db, "communities"));
      commList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {}
    const commOptions = `<option value="">(無)</option>` + commList.map(c => `<option value="${c.id}">${c.name || c.id}</option>`).join("");

    const body = `
      <div class="modal-dialog">
        <div class="modal-head">
          <div class="modal-title">新增帳號</div>
          <button class="btn top" onclick="closeModal()">關閉</button>
        </div>
        <div class="modal-body">
          <div class="modal-row">
            <label>角色</label>
            <select id="create-role">
              <option value="系統管理員">系統管理員</option>
              <option value="社區">社區</option>
              <option value="住戶">住戶</option>
            </select>
          </div>
          <div class="modal-row" id="row-create-community" style="display:none;">
            <label>所屬社區 <span style="color:red">*</span></label>
            <select id="create-community">${commOptions}</select>
          </div>
          <div class="modal-row">
            <label>權限</label>
            <div id="create-permission-display" style="padding: 8px; background: #f3f4f6; border-radius: 8px; color: #6b7280;">系統、後台、前台</div>
          </div>
          <div class="modal-row">
            <label>大頭照</label>
            <input type="file" id="create-photo-file" accept="image/png,image/jpeg">
          </div>
          <div class="modal-row">
            <label>預覽</label>
            <img id="create-photo-preview" class="avatar-preview">
          </div>
          <div class="modal-row">
            <label>姓名</label>
            <input type="text" id="create-name">
          </div>
          <div class="modal-row">
            <label>稱謂</label>
            <select id="create-title">
              <option value="區權人">區權人</option>
              <option value="親屬">親屬</option>
              <option value="承租人">承租人</option>
              <option value="管理員">管理員</option>
            </select>
          </div>
          <div class="modal-row">
            <label>電子郵件 (為登入帳號)</label>
            <input type="text" id="create-email" placeholder="example@domain.com">
          </div>
          <div class="modal-row">
            <label>手機號碼 (與電子郵件同為帳號，擇一登入)</label>
            <input type="tel" id="create-phone">
          </div>
          <div class="modal-row">
            <label>QR code碼</label>
            <input type="text" id="create-qr-code">
          </div>
          <div class="modal-row">
            <label>QR code預覽</label>
            <img id="create-qr-preview" class="qr-preview">
          </div>
          <div class="modal-row">
            <label>戶號</label>
            <input type="text" id="create-house-no">
          </div>
          <div class="modal-row">
            <label>子戶號</label>
            <input type="number" id="create-sub-no" placeholder="數字">
          </div>
          <div class="modal-row">
            <label>地址</label>
            <input type="text" id="create-address">
          </div>
          <div class="modal-row">
            <label>密碼 (預設)</label>
            <input type="password" id="create-password" placeholder="至少6字元" value="123456">
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn action-btn" onclick="closeModal()">取消</button>
          <button class="btn primary" id="btn-save-create">儲存</button>
        </div>
      </div>
    `;
    openModal(body);
    
    // Elements
    const roleSelect = document.getElementById("create-role");
    const commRow = document.getElementById("row-create-community");
    const commSelect = document.getElementById("create-community");
    const permDisplay = document.getElementById("create-permission-display");
    const photoFile = document.getElementById("create-photo-file");
    const photoPreview = document.getElementById("create-photo-preview");
    const qrInput = document.getElementById("create-qr-code");
    const qrPreview = document.getElementById("create-qr-preview");
    const btnSave = document.getElementById("btn-save-create");

    // Role Change Listener
    const updateRoleUI = () => {
      const r = roleSelect.value;
      const tSelect = document.getElementById("create-title");
      if (r === "系統管理員") {
        permDisplay.textContent = "系統、後台、前台";
        commRow.style.display = "none";
        if(tSelect) { tSelect.value = "管理員"; tSelect.disabled = true; }
      } else if (r === "社區") {
        permDisplay.textContent = "後台、前台";
        commRow.style.display = "grid";
        if(tSelect) { tSelect.value = "管理員"; tSelect.disabled = true; }
      } else if (r === "住戶") {
        permDisplay.textContent = "前台";
        commRow.style.display = "grid";
        if(tSelect) { 
            tSelect.disabled = false;
            if(tSelect.value === "管理員") tSelect.value = "區權人";
        }
      }
    };
    roleSelect && roleSelect.addEventListener("change", updateRoleUI);
    updateRoleUI();

    // Photo Preview Listener
    photoFile && photoFile.addEventListener("change", () => {
      const f = photoFile.files[0];
      if (f) photoPreview.src = URL.createObjectURL(f);
    });

    // QR Preview Listener
    qrInput && qrInput.addEventListener("input", async () => {
      const val = qrInput.value.trim();
      if (!val) {
        qrPreview.src = "";
        return;
      }
      try {
        const url = await getQrDataUrl(val, 150);
        qrPreview.src = url;
      } catch {
        qrPreview.src = "";
      }
    });

    // Save Listener
    btnSave && btnSave.addEventListener("click", async () => {
      try {
        const role = roleSelect.value;
        const community = commSelect.value;
        const name = document.getElementById("create-name").value.trim();
        const title = document.getElementById("create-title").value;
        const email = document.getElementById("create-email").value.trim();
        const phone = document.getElementById("create-phone").value.trim();
        const qrCodeText = qrInput.value.trim();
        const houseNo = document.getElementById("create-house-no").value.trim();
        const subNoRaw = document.getElementById("create-sub-no").value.trim();
        const address = document.getElementById("create-address").value.trim();
        const password = document.getElementById("create-password").value;
        const pFile = photoFile.files[0];

        if (!email || !password || password.length < 6) {
          showHint("請填寫有效的信箱與至少6字元密碼", "error");
          return;
        }

        if ((role === "社區" || role === "住戶") && !community) {
          showHint("請選擇所屬社區", "error");
          return;
        }

        btnSave.disabled = true;
        btnSave.textContent = "建立中...";

        // Create Auth User
        const cred = await createUserWithEmailAndPassword(createAuth, email, password);
        
        // Upload Photo
        let photoURL = "";
        if (pFile) {
          try {
            const ext = pFile.type === "image/png" ? "png" : "jpg";
            const path = `avatars/${cred.user.uid}.${ext}`;
            const ref = storageRef(storage, path);
            await uploadBytes(ref, pFile, { contentType: pFile.type });
            photoURL = await getDownloadURL(ref);
          } catch (err) {
             // Fallback to base64 if storage fails
             try {
               const b64 = await new Promise((resolve) => {
                 const reader = new FileReader();
                 reader.onload = () => resolve(reader.result);
                 reader.readAsDataURL(pFile);
               });
               photoURL = b64;
             } catch {}
          }
        }

        // Save User Doc
        const payload = {
          email,
          role,
          community: community || "",
          displayName: name,
          title, 
          phone,
          qrCodeText,
          houseNo,
          ...(subNoRaw !== "" ? { subNo: parseInt(subNoRaw, 10) } : {}),
          address,
          photoURL,
          status: "啟用",
          createdAt: Date.now()
        };
        
        await setDoc(doc(db, "users", cred.user.uid), payload, { merge: true });
        await syncUserLookup(null, phone, email);
        await updateProfile(cred.user, { displayName: name, photoURL });

        closeModal();
        showHint(`已建立 ${role} 帳號`, "success");
        
        // Refresh list if on admin page
        if (typeof renderSettingsGeneral === "function") await renderSettingsGeneral();

      } catch (e) {
        console.error(e);
        showHint("建立失敗: " + e.message, "error");
      } finally {
        if(btnSave) {
          btnSave.disabled = false;
          btnSave.textContent = "儲存";
        }
      }
    });
  }
  
  function openCreateResidentModal(slug) {
    const title = "新增住戶";
    const seqGuess = (() => {
      try {
        const tbody = document.getElementById("sys-content")?.querySelector("tbody");
        if (tbody) return String(tbody.querySelectorAll("tr").length + 1);
      } catch {}
      return "";
    })();
    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">${title}</div></div>
        <div class="modal-body">
          <div class="modal-row">
            <label>大頭照</label>
            <input type="file" id="create-r-photo-file" accept="image/png,image/jpeg">
          </div>
          <div class="modal-row">
            <label>預覽</label>
            <img id="create-r-photo-preview" class="avatar-preview">
          </div>
          <div class="modal-row">
            <label>序號</label>
            <input type="text" id="create-r-seq" value="${seqGuess}">
          </div>
          <div class="modal-row">
            <label>戶號</label>
            <input type="text" id="create-r-house-no" placeholder="例如 A-1201">
          </div>
          <div class="modal-row">
            <label>子戶號</label>
            <input type="number" id="create-r-sub-no" placeholder="數字">
          </div>
          <div class="modal-row">
            <label>QR 預覽</label>
            <img id="create-r-qr-preview" class="qr-preview">
          </div>
          <div class="modal-row">
            <label>QR code 代碼</label>
            <input type="text" id="create-r-qr-code" placeholder="輸入QR內容文字">
          </div>
          <div class="modal-row">
            <label>姓名</label>
            <input type="text" id="create-r-name">
          </div>
          <div class="modal-row">
            <label>地址</label>
            <input type="text" id="create-r-address" placeholder="住址">
          </div>
          <div class="modal-row">
            <label>坪數</label>
            <input type="number" id="create-r-area" placeholder="例如 35.5">
          </div>
          <div class="modal-row">
            <label>區分權比</label>
            <input type="number" id="create-r-ownership" placeholder="例如 1.5">
          </div>
          <div class="modal-row">
            <label>手機號碼</label>
            <input type="tel" id="create-r-phone">
          </div>
          <div class="modal-row">
            <label>電子郵件</label>
            <input type="text" id="create-r-email" placeholder="example@domain.com">
          </div>
          <div class="modal-row">
            <label>密碼</label>
            <input type="text" id="create-r-password" placeholder="至少6字元" value="123456">
          </div>
          <div class="modal-row">
            <label>狀態</label>
            <select id="create-r-status">
              <option value="啟用">啟用</option>
              <option value="停用" selected>停用</option>
            </select>
          </div>
          <div class="hint" id="create-r-hint"></div>
        </div>
        <div class="modal-foot">
          <button id="create-r-cancel" class="btn action-btn danger">取消</button>
          <button id="create-r-save" class="btn action-btn">建立</button>
        </div>
      </div>
    `;
    openModal(body);
    const btnCancel = document.getElementById("create-r-cancel");
    const btnSave = document.getElementById("create-r-save");
    const createFile = document.getElementById("create-r-photo-file");
    const createPreview = document.getElementById("create-r-photo-preview");
    const qrPreview = document.getElementById("create-r-qr-preview");
    const qrCodeInput = document.getElementById("create-r-qr-code");
    const hintEl = document.getElementById("create-r-hint");
    
    const showModalHint = (msg, type="error") => {
        if(hintEl) {
            hintEl.textContent = msg;
            hintEl.style.color = type === "error" ? "#b71c1c" : "#0ea5e9";
        }
    };

    createFile && createFile.addEventListener("change", () => {
      const f = createFile.files[0];
      if (f) {
        createPreview.src = URL.createObjectURL(f);
      }
    });
    qrCodeInput && qrCodeInput.addEventListener("input", async () => {
      const val = qrCodeInput.value.trim();
      if (!qrPreview) return;
      if (!val) {
        qrPreview.src = "";
      } else {
        const url = await getQrDataUrl(val, 64);
        qrPreview.src = url;
      }
    });
    (async () => {
      const val = qrCodeInput ? qrCodeInput.value.trim() : "";
      if (qrPreview && val) {
        const url = await getQrDataUrl(val, 64);
        qrPreview.src = url;
      }
    })();
    btnCancel && btnCancel.addEventListener("click", () => closeModal());
    btnSave && btnSave.addEventListener("click", async () => {
      try {
        showModalHint(""); 
        const email = document.getElementById("create-r-email").value.trim();
        const password = document.getElementById("create-r-password").value;
        const displayName = document.getElementById("create-r-name").value.trim();
        const phone = document.getElementById("create-r-phone").value.trim();
        const photoFile = document.getElementById("create-r-photo-file").files[0];
        const seq = document.getElementById("create-r-seq").value.trim();
        const houseNo = document.getElementById("create-r-house-no").value.trim();
        const subNoRaw = document.getElementById("create-r-sub-no").value.trim();
        const address = document.getElementById("create-r-address").value.trim();
        const area = document.getElementById("create-r-area").value.trim();
        const ownershipRatio = document.getElementById("create-r-ownership").value.trim();
        const qrCodeText = document.getElementById("create-r-qr-code").value.trim();
        const status = document.getElementById("create-r-status").value;
        let photoURL = "";
        if (!email || !password || password.length < 6) {
          showModalHint("請填寫有效的信箱與至少6字元密碼", "error");
          return;
        }
        
        btnSave.disabled = true;
        btnSave.textContent = "建立中...";
        
        const cred = await createUserWithEmailAndPassword(createAuth, email, password);
        if (photoFile) {
          try {
            const ext = photoFile.type === "image/png" ? "png" : "jpg";
            const path = `avatars/${cred.user.uid}.${ext}`;
            const ref = storageRef(storage, path);
            await uploadBytes(ref, photoFile, { contentType: photoFile.type });
            photoURL = await getDownloadURL(ref);
          } catch (err) {
            try {
              const b64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(photoFile);
              });
              photoURL = b64;
              showModalHint("Storage 上傳失敗，已改用內嵌圖片儲存", "error");
            } catch {
              showModalHint("上傳大頭照失敗，帳號仍已建立", "error");
            }
          }
        }
        await setDoc(doc(db, "users", cred.user.uid), {
          email,
          role: "住戶",
          status: status || "停用",
          displayName,
          phone,
          photoURL,
          seq,
          houseNo,
          address,
          area,
          ownershipRatio,
          qrCodeText,
          ...(subNoRaw !== "" ? { subNo: parseInt(subNoRaw, 10) } : {}),
          community: slug,
          createdAt: Date.now()
        }, { merge: true });
        await updateProfile(cred.user, { displayName, photoURL });
        closeModal();
        await renderSettingsResidents();
        showHint("已建立住戶帳號", "success");
      } catch (e) {
        console.error(e);
        let msg = "建立失敗";
        if (e.code === 'auth/email-already-in-use') msg = "該 Email 已被使用";
        else if (e.code === 'auth/invalid-email') msg = "Email 格式不正確";
        else if (e.code === 'auth/weak-password') msg = "密碼強度不足";
        else if (e.message) msg += ": " + e.message;
        
        showModalHint(msg, "error");
      } finally {
        if(btnSave) {
            btnSave.disabled = false;
            btnSave.textContent = "建立";
        }
      }
    });
  }
  window.openCreateResidentModal = openCreateResidentModal;
  
  async function renderSettingsResidents() {
    if (!sysNav.content) return;
    const u = auth.currentUser;
    const slug = u ? await getUserCommunity(u.uid) : "default";
    let selectedSlug = window.currentResidentsSlug || slug;
    let cname = selectedSlug;
    let communities = [];
    try {
      const snap = await getDocs(collection(db, "communities"));
      communities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {}
    if (selectedSlug === "default" && communities.length > 0) {
      selectedSlug = communities[0].id;
      cname = communities[0].name || selectedSlug;
    }
    if (!communities.length) {
      communities = [{ id: selectedSlug, name: selectedSlug }];
    }
    try {
      const csnap = await getDoc(doc(db, "communities", selectedSlug));
      if (csnap.exists()) {
        const c = csnap.data();
        cname = c.name || selectedSlug;
      }
    } catch {}
    let residents = [];
    try {
      const q = query(collection(db, "users"), where("community", "==", selectedSlug));
      const snapList = await getDocs(q);
      residents = snapList.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(a => (a.role || "住戶") === "住戶");
    } catch {}
    const rows = residents.map((a, idx) => {
      const nm = a.displayName || (a.email || "").split("@")[0] || "住戶";
      const av = a.photoURL
        ? `<img class="avatar" src="${a.photoURL}" alt="avatar">`
        : `<span class="avatar">${(nm || a.email || "住")[0]}</span>`;
      return `
        <tr data-uid="${a.id}">
          <td><input type="checkbox" class="check-resident" value="${a.id}"></td>
          <td>${av}</td>
          <td>${a.seq || ""}</td>
          <td>${a.houseNo || ""}</td>
          <td>${typeof a.subNo === "number" ? a.subNo : ""}</td>
          <td>${a.qrCodeText || "—"}</td>
          <td>${nm}</td>
          <td>${a.address || ""}</td>
          <td>${a.area || ""}</td>
          <td>${a.phone || ""}</td>
          <td>${a.email || ""}</td>
          <td>••••••</td>
          <td>
            <label class="switch">
              <input type="checkbox" class="status-toggle-resident" ${a.status === "停用" ? "checked" : ""}>
              <span class="slider round"></span>
            </label>
          </td>
          <td class="actions">
            <button class="btn small action-btn btn-edit-resident">編輯</button>
          </td>
        </tr>
      `;
    }).join("");
    const emptyText = rows ? "" : "目前沒有住戶資料";
    const options = communities.map(c => `<option value="${c.id}"${c.id === selectedSlug ? " selected" : ""}>${c.name || c.id}</option>`).join("");
    sysNav.content.innerHTML = `
      <div class="card data-card">
        <div class="card-filters">
          <label for="resident-community-select">社區</label>
          <select id="resident-community-select">${options}</select>
        </div>
        <div class="card-head">
          <h1 class="card-title">住戶帳號列表（${cname}）</h1>
          <div style="display:flex;gap:8px;">
            <button id="btn-delete-selected" class="btn small action-btn danger" style="display:none;">刪除選取項目</button>
            <button id="btn-import-resident" class="btn small action-btn">匯入 Excel</button>
            <button id="btn-export-resident" class="btn small action-btn">匯出 Excel</button>
            <button id="btn-create-resident" class="btn small action-btn">新增</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <colgroup>
              <col width="40"><col><col width="70"><col width="100"><col width="80"><col width="120"><col><col><col><col><col><col width="80"><col width="80"><col width="160">
            </colgroup>
            <thead>
              <tr>
                <th><input type="checkbox" id="check-all-residents"></th>
                <th>大頭照</th>
                <th>序號</th>
                <th>戶號</th>
                <th>子戶號</th>
                <th>QR code</th>
                <th>姓名</th>
                <th>地址</th>
                <th>坪數</th>
                <th>手機號碼</th>
                <th>電子郵件</th>
                <th>密碼</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${emptyText ? `<div class="empty-hint">${emptyText}</div>` : ""}
        </div>
      </div>
    `;
    const toggles = sysNav.content.querySelectorAll(".status-toggle-resident");
    toggles.forEach(toggle => {
      toggle.addEventListener("change", async (e) => {
        const tr = e.target.closest("tr");
        const targetUid = tr && tr.getAttribute("data-uid");
        if (!targetUid) return;
        const newStatus = e.target.checked ? "停用" : "啟用";
        try {
          await setDoc(doc(db, "users", targetUid), { status: newStatus }, { merge: true });
          showHint(newStatus === "啟用" ? "帳號已啟用" : "帳號已停用", "success");
        } catch (err) {
          console.error(err);
          showHint("更新狀態失敗", "error");
          e.target.checked = !e.target.checked;
        }
      });
    });
    const sel = document.getElementById("resident-community-select");
    sel && sel.addEventListener("change", async () => {
      window.currentResidentsSlug = sel.value;
      await renderSettingsResidents();
    });
    const btnExport = document.getElementById("btn-export-resident");
    btnExport && btnExport.addEventListener("click", async () => {
      btnExport.disabled = true;
      btnExport.textContent = "匯出中...";
      try {
        await ensureXlsxLib();
        if (!window.XLSX) throw new Error("Excel Library not found");
        const data = residents.map((r) => ({
          "大頭照": r.photoURL || "",
          "序號": r.seq || "",
          "戶號": r.houseNo || "",
          "子戶號": r.subNo !== undefined ? r.subNo : "",
          "QR code": r.qrCodeText || "",
          "姓名": r.displayName || "",
          "地址": r.address || "",
          "坪數": r.area || "",
          "區分權比": r.ownershipRatio || "",
          "手機號碼": r.phone || "",
          "電子郵件": r.email || "",
          "狀態": r.status || "啟用"
        }));
        const ws = window.XLSX.utils.json_to_sheet(data);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Residents");
        window.XLSX.writeFile(wb, `${cname}_residents_${new Date().toISOString().slice(0,10)}.xlsx`);
      } catch(e) {
        console.error(e);
        alert("匯出失敗");
      } finally {
        btnExport.disabled = false;
        btnExport.textContent = "匯出 Excel";
      }
    });
    const btnImport = document.getElementById("btn-import-resident");
    btnImport && btnImport.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".xlsx, .xls, .csv";
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        let overlay = document.getElementById("import-overlay");
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.id = "import-overlay";
          overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;justify-content:center;align-items:center;color:#fff;flex-direction:column;font-size:1.2rem;";
          document.body.appendChild(overlay);
        }
        overlay.style.display = "flex";
        overlay.innerHTML = `<div class="spinner"></div><div id="import-msg" style="margin-top:15px;">準備匯入中...</div>`;
        btnImport.disabled = true;
        btnImport.textContent = "匯入中...";
        try {
          await ensureXlsxLib();
          if (!window.XLSX) throw new Error("Excel Library not found");
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              const data = new Uint8Array(e.target.result);
              const workbook = window.XLSX.read(data, { type: 'array' });
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
              if (jsonData.length === 0) {
                alert("檔案內容為空");
                overlay.style.display = "none";
                return;
              }
              if (!confirm(`即將匯入 ${jsonData.length} 筆資料，確定嗎？`)) {
                overlay.style.display = "none";
                return;
              }
              let successCount = 0;
              let failCount = 0;
              const total = jsonData.length;
              const updateProgress = (processed) => {
                 const el = document.getElementById("import-msg");
                 if (el) el.textContent = `匯入中... ${processed} / ${total}`;
              };
              const CHUNK_SIZE = 20; 
              for (let i = 0; i < total; i += CHUNK_SIZE) {
                const chunk = jsonData.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);
                let hasWrites = false;
                const promises = chunk.map(async (row) => {
                    try {
                        const email = (row["電子郵件"] || "").trim();
                        const password = (row["密碼"] || "123456").trim();
                        const displayName = (row["姓名"] || "").trim();
                        const phone = (row["手機號碼"] || "").toString().trim();
                        const seq = (row["序號"] || "").toString().trim();
                        const houseNo = (row["戶號"] || "").toString().trim();
                        const subNoRaw = row["子戶號"];
                        const qrCodeText = (row["QR code"] || "").trim();
                        const address = (row["地址"] || "").trim();
                        const area = (row["坪數"] || "").toString().trim();
                        const ownershipRatio = (row["區分權比"] || "").toString().trim();
                        const status = (row["狀態"] || "停用").trim();
                        const photoURL = (row["大頭照"] || "").trim();
                        if (!email) { failCount++; return null; }
                        let uid = null;
                        try {
                            const cred = await createUserWithEmailAndPassword(createAuth, email, password);
                            uid = cred.user.uid;
                            await updateProfile(cred.user, { displayName, photoURL });
                            await signOut(createAuth);
                        } catch (authErr) {
                            if (authErr.code === 'auth/email-already-in-use') {
                                const qUser = query(collection(db, "users"), where("email", "==", email));
                                const snapUser = await getDocs(qUser);
                                if (!snapUser.empty) uid = snapUser.docs[0].id;
                            }
                            if (!uid) { failCount++; return null; }
                        }
                        if (uid) {
                            const docRef = doc(db, "users", uid);
                            const payload = {
                                email, role: "住戶", status, displayName, phone, photoURL,
                                community: selectedSlug, seq, houseNo,
                                ...(subNoRaw !== undefined && subNoRaw !== "" ? { subNo: parseInt(subNoRaw, 10) } : {}),
                                qrCodeText, address, area, ownershipRatio, createdAt: Date.now()
                            };
                            return { docRef, payload };
                        }
                    } catch (err) { failCount++; }
                    return null;
                });
                const results = await Promise.all(promises);
                results.forEach(res => {
                    if (res) {
                        batch.set(res.docRef, res.payload, { merge: true });
                        hasWrites = true;
                        successCount++;
                    }
                });
                if (hasWrites) await batch.commit();
                updateProgress(Math.min(i + CHUNK_SIZE, total));
              }
              overlay.innerHTML = `
                <div style="background:white;color:black;padding:20px;border-radius:8px;text-align:center;min-width:300px;">
                    <h2 style="margin-top:0;color:#333;">匯入完成</h2>
                    <p style="font-size:1.1rem;margin:10px 0;">成功：<span style="color:green;font-weight:bold;">${successCount}</span> 筆</p>
                    <p style="font-size:1.1rem;margin:10px 0;">失敗：<span style="color:red;font-weight:bold;">${failCount}</span> 筆</p>
                    <button id="close-overlay-btn" class="btn action-btn primary" style="margin-top:15px;width:100%;">確定</button>
                </div>
              `;
              const closeBtn = document.getElementById("close-overlay-btn");
              if (closeBtn) {
                  closeBtn.onclick = async () => {
                      overlay.style.display = "none";
                      await renderSettingsResidents();
                  };
              }
            } catch (e) {
              console.error(e);
              alert("讀取 Excel 失敗");
              overlay.style.display = "none";
            } finally {
              btnImport.disabled = false;
              btnImport.textContent = "匯入 Excel";
            }
          };
          reader.readAsArrayBuffer(file);
        } catch(e) {
          console.error(e);
          alert("匯入失敗");
          btnImport.disabled = false;
          btnImport.textContent = "匯入 Excel";
          if (overlay) overlay.style.display = "none";
        }
      };
      input.click();
    });
    sysNav.content.addEventListener("change", (e) => {
      if (e.target.id === "check-all-residents") {
        const checked = e.target.checked;
        const checkboxes = sysNav.content.querySelectorAll(".check-resident");
        checkboxes.forEach(cb => cb.checked = checked);
        updateDeleteSelectedBtn();
      } else if (e.target.classList.contains("check-resident")) {
        updateDeleteSelectedBtn();
      }
    });
    function updateDeleteSelectedBtn() {
       const btn = document.getElementById("btn-delete-selected");
       const checked = sysNav.content.querySelectorAll(".check-resident:checked");
       if (btn) {
         if (checked.length > 0) {
           btn.style.display = "inline-block";
           btn.textContent = `刪除選取項目 (${checked.length})`;
         } else {
           btn.style.display = "none";
         }
       }
    }
    const btnDeleteSelected = document.getElementById("btn-delete-selected");
    if (btnDeleteSelected) {
      btnDeleteSelected.addEventListener("click", async () => {
         const checked = sysNav.content.querySelectorAll(".check-resident:checked");
         if (checked.length === 0) return;
         if (!confirm(`確定要刪除選取的 ${checked.length} 位住戶嗎？此操作將永久刪除資料，且無法復原。`)) return;
         btnDeleteSelected.disabled = true;
        btnDeleteSelected.textContent = "刪除中...";
         let successCount = 0;
         let failCount = 0;
         const allIds = Array.from(checked).map(cb => cb.value);
         try {
            const limit = 10;
            const processItem = async (uid) => {
               try {
                 await deleteDoc(doc(db, "users", uid));
                 successCount++;
               } catch (e) {
                 console.error(e);
                 failCount++;
               }
            };
            for (let i=0; i<allIds.length; i+=limit) {
                const chunk = allIds.slice(i, i+limit);
                await Promise.all(chunk.map(processItem));
            }
            alert(`刪除完成\n成功：${successCount}\n失敗：${failCount}`);
            await renderSettingsResidents();
         } catch(e) {
            console.error(e);
            alert("刪除過程發生錯誤");
         } finally {
            btnDeleteSelected.disabled = false;
            btnDeleteSelected.textContent = "刪除選取項目";
            btnDeleteSelected.style.display = "none";
         }
      });
    }
    const btnCreate = document.getElementById("btn-create-resident");
    btnCreate && btnCreate.addEventListener("click", () => openCreateResidentModal(selectedSlug));
    const btnEdits = sysNav.content.querySelectorAll(".btn-edit-resident");
    const btnDeletes = sysNav.content.querySelectorAll(".btn-delete-resident");
    btnEdits.forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!sysNav.content) return;
        const tr = btn.closest("tr");
        const targetUid = tr && tr.getAttribute("data-uid");
        const currentUser = auth.currentUser;
        const isSelf = currentUser && currentUser.uid === targetUid;
        let target = { id: targetUid, displayName: "", email: "", phone: "", photoURL: "", role: "住戶", status: "啟用" };
        try {
          const snap = await getDoc(doc(db, "users", targetUid));
          if (snap.exists()) {
            const d = snap.data();
            target.displayName = d.displayName || target.displayName;
            target.email = d.email || target.email;
            target.phone = d.phone || target.phone;
            target.photoURL = d.photoURL || target.photoURL;
            target.status = d.status || target.status;
            target.seq = d.seq;
            target.houseNo = d.houseNo;
            target.subNo = d.subNo;
            target.qrCodeText = d.qrCodeText;
            target.address = d.address;
            target.area = d.area;
            target.ownershipRatio = d.ownershipRatio;
          }
        } catch {}
        openEditModal(target, isSelf, "community-admin");
      });
    });
    btnDeletes.forEach(btn => {
      btn.addEventListener("click", async () => {
        const ok = window.confirm("確定要刪除此住戶帳號嗎？此操作不可恢復。");
        if (!ok) return;
        try {
          const tr = btn.closest("tr");
          const targetUid = tr && tr.getAttribute("data-uid");
          const curr = auth.currentUser;
          if (curr && curr.uid === targetUid) {
            await curr.delete();
            showHint("已刪除目前帳號", "success");
            redirectAfterSignOut();
          } else {
            await setDoc(doc(db, "users", targetUid), { status: "停用" }, { merge: true });
            showHint("已標記該帳號為停用", "success");
            await renderSettingsResidents();
          }
        } catch (err) {
          console.error(err);
          showHint("刪除失敗，可能需要重新登入驗證", "error");
        }
      });
    });
  }
  
  async function renderSettingsSystem() {
    if (!sysNav.content) return;
    const items = [
      { key: "apiKey", value: firebaseConfig.apiKey },
      { key: "authDomain", value: firebaseConfig.authDomain },
      { key: "projectId", value: firebaseConfig.projectId },
      { key: "storageBucket", value: firebaseConfig.storageBucket },
      { key: "messagingSenderId", value: firebaseConfig.messagingSenderId },
      { key: "appId", value: firebaseConfig.appId },
      { key: "measurementId", value: firebaseConfig.measurementId }
    ];
    
    const rows = items.map(item => `
      <tr>
        <td style="font-weight:600; color:var(--text);">${item.key}</td>
        <td>
          <input type="text" id="fc-${item.key}" value="${item.value || ""}" style="width:100%; font-family:monospace; padding:6px; border:1px solid #ddd; border-radius:4px;">
        </td>
      </tr>
    `).join("");

    sysNav.content.innerHTML = `
      <div class="card data-card">
        <div class="card-head">
          <h1 class="card-title">系統配置 (Firebase Config)</h1>
          <div style="display:flex; gap:8px;">
             <button id="btn-reset-sys-config" class="btn small action-btn">重置預設</button>
             <button id="btn-save-sys-config" class="btn small action-btn primary" style="background-color: var(--primary); color: white;">儲存並重載</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th style="width: 200px;">鍵 (Key)</th>
                <th>值 (Value)</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
        <div style="padding: 16px; color: var(--muted); font-size: 0.9em; background:#f9fafb; border-top:1px solid var(--border);">
            <p><strong>注意：</strong>修改此配置將改變網站連接的 Firebase 專案。儲存後頁面將重新載入以套用新設定。</p>
            <p>若配置錯誤導致無法登入，請點擊「重置預設」恢復原始設定。</p>
        </div>
      </div>
    `;

    const btnSave = document.getElementById("btn-save-sys-config");
    btnSave && btnSave.addEventListener("click", () => {
        const newConfig = {};
        items.forEach(item => {
            const el = document.getElementById(`fc-${item.key}`);
            if (el) newConfig[item.key] = el.value.trim();
        });
        
        try {
            localStorage.setItem("nw_firebase_config", JSON.stringify(newConfig));
            if(confirm("配置已儲存。是否立即重新載入頁面以套用變更？")) {
                window.location.reload();
            }
        } catch(e) {
            console.error(e);
            alert("儲存失敗: " + e.message);
        }
    });

    const btnReset = document.getElementById("btn-reset-sys-config");
    btnReset && btnReset.addEventListener("click", () => {
        if(confirm("確定要重置為系統預設配置嗎？\n這將清除所有自訂的 Firebase 連線設定。")) {
            localStorage.removeItem("nw_firebase_config");
            window.location.reload();
        }
    });
  }

  function renderContentFor(mainKey, subLabel) {
    if (!sysNav.content) return;
    sysNav.content.innerHTML = '';
    const sub = (subLabel || '').replace(/\u200B/g, '').trim();
    if (mainKey === 'settings' && sub === '一般') {
      renderSettingsGeneral();
      return;
    }
    if (mainKey === 'settings' && sub === '社區') {
      renderSettingsCommunity();
      return;
    }
    if (mainKey === 'settings' && sub === '系統') {
      renderSettingsSystem();
      return;
    }
    if (mainKey === 'app') {
      renderAppSubContent(sub || '廣告');
      return;
    }
    sysNav.content.innerHTML = '';
  }
  
  async function renderAppSubContent(sub) {
    if (!sysNav.content) return;
    let options = [`<option value="all">全部</option>`];
    let communities = [];
    try {
      const snap = await getDocs(collection(db, "communities"));
      communities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {}
    const current = window.currentAppCommunitySlug || "all";
    const opts = communities.map(c => {
      const name = c.name || c.id;
      const sel = c.id === current ? " selected" : "";
      return `<option value="${c.id}"${sel}>${name}</option>`;
    }).join("");
    options = [`<option value="all"${current === "all" ? " selected" : ""}>全部</option>`, opts].filter(Boolean);
    
    // Content Logic based on 'sub'
    let contentHtml = `<div class="empty-hint">尚未建立內容</div>`;
    let adsConfig = { interval: 3, effect: 'slide', loop: 'infinite', nav: true };
    
    if (sub === '廣告') {
      // Fetch data
      let adsData = [];
      
      try {
        const targetSlug = current === 'all' ? 'default' : current;
        const snap = await getDoc(doc(db, `communities/${targetSlug}/app_modules/ads`));
        if (snap.exists()) {
          const d = snap.data();
          adsData = d.items || [];
          if (d.config) adsConfig = { ...adsConfig, ...d.config };
        }
      } catch (e) {
        console.log("Fetch ads failed", e);
      }
      
      // Ensure 10 rows
      const rows = [];
      for (let i = 1; i <= 10; i++) {
        const item = adsData.find(x => x.idx === i) || { idx: i, url: '', type: 'image', autoplay: false, description: '' };
        const isYoutube = item.type === 'youtube';
        rows.push(`
          <tr data-idx="${i}">
            <td>${i}</td>
            <td>
              <div class="ad-input-group" style="display: flex; gap: 8px; align-items: center;">
                <input type="text" class="ad-url-input" value="${item.url}" placeholder="圖片連結或 YouTube 網址" style="flex: 1;">
                <input type="file" class="ad-image-upload" accept="image/png,image/jpeg" style="width: 200px;">
              </div>
            </td>
            <td>
              <input type="text" class="ad-desc-input" value="${item.description || ''}" placeholder="輸入內容說明" style="width: 100%; padding: 6px; border: 1px solid var(--border); border-radius: 4px;">
            </td>
            <td>
              <span class="ad-type-badge ${item.type}">${item.type === 'youtube' ? 'YouTube' : '圖片'}</span>
            </td>
            <td>
              <label class="checkbox-label">
                <input type="checkbox" class="ad-autoplay" ${item.autoplay ? 'checked' : ''} ${!isYoutube ? 'disabled' : ''}>
                <span>自動播放</span>
              </label>
            </td>
          </tr>
        `);
      }

      // Preview HTML (Simulate A3)
      const validItems = adsData.filter(x => x.url).sort((a, b) => a.idx - b.idx);
      let previewContent = '';
      if (validItems.length === 0) {
        previewContent = `<div class="preview-placeholder">A3 輪播預覽區 (目前無內容)</div>`;
      } else {
        const slides = validItems.map((item, idx) => {
          let content = '';
          if (item.type === 'youtube') {
             let vidId = '';
             try {
               const u = new URL(item.url);
               if (u.hostname.includes('youtube.com')) {
                 vidId = u.searchParams.get('v');
                 if (!vidId && u.pathname.startsWith('/embed/')) {
                   vidId = u.pathname.split('/')[2];
                 } else if (!vidId && u.pathname.startsWith('/live/')) {
                    vidId = u.pathname.split('/')[2];
                 }
               }
               else if (u.hostname.includes('youtu.be')) vidId = u.pathname.slice(1);
             } catch {}
             const origin = window.location.origin;
             const embedUrl = vidId ? `https://www.youtube.com/embed/${vidId}?autoplay=${item.autoplay?1:0}&mute=1&enablejsapi=1&origin=${origin}` : item.url;
             content = `<iframe src="${embedUrl}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
          } else {
             content = `<img src="${item.url}" alt="Slide ${idx+1}">`;
          }
          return `<div class="preview-slide ${idx===0?'active':''}">${content}</div>`;
        }).join('');
        previewContent = `
            ${slides}
            <button class="preview-nav-btn preview-nav-prev" style="display: ${adsConfig.nav ? 'block' : 'none'}">❮</button>
            <button class="preview-nav-btn preview-nav-next" style="display: ${adsConfig.nav ? 'block' : 'none'}">❯</button>
          `;
      }

      contentHtml = `
        <div class="card data-card preview-card" style="margin-bottom: 24px;">
           <div class="card-head"><h2 class="card-title">A3 輪播預覽</h2></div>
           <div class="a3-preview-container effect-${adsConfig.effect}">
             ${previewContent}
           </div>
        </div>
        <div class="card data-card">
          <div class="card-head">
            <h2 class="card-title" style="white-space: nowrap;">輪播內容設定</h2>
            <button id="btn-save-ads" class="btn primary action-btn">儲存設定</button>
          </div>
          
          <div class="card-filters" style="margin-bottom: 24px; display: flex; flex-wrap: wrap; gap: 24px;">
            <div class="filter-group">
              <label for="ads-interval" style="display: block; margin-bottom: 4px; font-weight: 500;">輪播秒數</label>
              <input type="number" id="ads-interval" value="${adsConfig.interval}" min="1" max="60" style="padding: 6px; border: 1px solid var(--border); border-radius: 4px; width: 80px;">
            </div>
            <div class="filter-group">
              <label for="ads-effect" style="display: block; margin-bottom: 4px; font-weight: 500;">圖片轉場動畫方式</label>
              <select id="ads-effect" style="padding: 6px; border: 1px solid var(--border); border-radius: 4px;">
                <option value="slide" ${adsConfig.effect === 'slide' ? 'selected' : ''}>滑動 (Slide)</option>
                <option value="fade" ${adsConfig.effect === 'fade' ? 'selected' : ''}>淡入淡出 (Fade)</option>
                <option value="none" ${adsConfig.effect === 'none' ? 'selected' : ''}>無動畫 (None)</option>
              </select>
            </div>
            <div class="filter-group">
              <label for="ads-loop" style="display: block; margin-bottom: 4px; font-weight: 500;">循環方式</label>
              <select id="ads-loop" style="padding: 6px; border: 1px solid var(--border); border-radius: 4px;">
                <option value="infinite" ${adsConfig.loop === 'infinite' ? 'selected' : ''}>無限循環</option>
                <option value="rewind" ${adsConfig.loop === 'rewind' ? 'selected' : ''}>來回播放</option>
                <option value="once" ${adsConfig.loop === 'once' ? 'selected' : ''}>播放一次停止</option>
              </select>
            </div>
            <div class="filter-group">
              <label style="display: block; margin-bottom: 4px; font-weight: 500;">導航</label>
              <label class="checkbox-label">
                <input type="checkbox" id="ads-nav" ${adsConfig.nav ? 'checked' : ''}>
                <span>顯示左右導航箭頭</span>
              </label>
            </div>
          </div>

          <div class="table-wrap">
            <table class="table">
              <colgroup><col width="60"><col><col width="200"><col width="100"><col width="120"></colgroup>
              <thead>
                <tr>
                  <th>序號</th>
                  <th>圖片或影片位置</th>
                  <th>內容說明</th>
                  <th>類型</th>
                  <th>設定</th>
                </tr>
              </thead>
              <tbody>
                ${rows.join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }
    else if (sub === '按鈕') {
      let defaultData = { a6: [], a8: [] };
      let specificData = null;

      try {
        // Always fetch default (all) data
        const defaultSnap = await getDoc(doc(db, "communities/default/app_modules/buttons"));
        if (defaultSnap.exists()) {
          const d = defaultSnap.data();
          defaultData.a6 = Array.isArray(d.a6) ? d.a6 : [];
          defaultData.a8 = Array.isArray(d.a8) ? d.a8 : [];
        }
        
        // If specific community, fetch its data
        if (current !== 'all') {
             const specificSnap = await getDoc(doc(db, `communities/${current}/app_modules/buttons`));
             if (specificSnap.exists()) {
                 const d = specificSnap.data();
                 specificData = {
                     a6: Array.isArray(d.a6) ? d.a6 : [],
                     a8: Array.isArray(d.a8) ? d.a8 : []
                 };
             }
        }
      } catch (e) { console.error("Fetch buttons failed", e); }

      const getMergedItems = (defItems, specItems) => {
          const merged = [];
          for (let i = 1; i <= 8; i++) {
              const def = defItems.find(x => x.idx === i);
              const spec = specItems ? specItems.find(x => x.idx === i) : null;
              if (spec) {
                  merged.push(spec);
              } else if (def) {
                  merged.push(def);
              }
          }
          return merged;
      };

      const finalA6 = current === 'all' ? defaultData.a6 : getMergedItems(defaultData.a6, specificData ? specificData.a6 : null);
      const finalA8 = current === 'all' ? defaultData.a8 : getMergedItems(defaultData.a8, specificData ? specificData.a8 : null);

      const buildRows = (items, section) => {
        const rows = [];
        for (let i = 1; i <= 8; i++) {
          const it = items.find(x => x.idx === i) || { idx: i, text: '', link: '', iconUrl: '', newWindow: false };
          rows.push(`
            <tr data-idx="${i}">
              <td>${i}</td>
              <td><input type="text" class="btn-text" value="${it.text || ''}" placeholder="按鈕名稱"></td>
              <td><input type="url" class="btn-link" value="${it.link || ''}" placeholder="https://..."></td>
              <td>
                <label style="display:flex;align-items:center;gap:6px;">
                  <input type="checkbox" class="btn-new-window" ${it.newWindow ? 'checked' : ''}>
                  <span>另開視窗</span>
                </label>
              </td>
              <td>
                <div class="icon-cell">
                  <img class="icon-preview" src="${it.iconUrl || ''}">
                  <input type="file" class="icon-file ${section}-icon-file" accept="image/png,image/jpeg">
                </div>
              </td>
            </tr>
          `);
        }
        return rows.join("");
      };
      const a6Rows = buildRows(finalA6, "a6");
      const a8Rows = buildRows(finalA8, "a8");
      contentHtml = `
        <div class="card data-card">
          <div class="card-head">
            <h2 class="card-title">A6 列按鈕設定</h2>
            <button id="btn-save-buttons" class="btn primary action-btn">儲存設定</button>
          </div>
          <div class="table-wrap">
            <table class="table" id="a6-table">
              <colgroup><col width="60"><col><col><col width="100"><col width="180"></colgroup>
              <thead>
                <tr>
                  <th>序號</th>
                  <th>名稱</th>
                  <th>連結</th>
                  <th>另開視窗</th>
                  <th>圖形</th>
                </tr>
              </thead>
              <tbody>
                ${a6Rows}
              </tbody>
            </table>
          </div>
        </div>
        <div class="card data-card">
          <div class="card-head">
            <h2 class="card-title">A8 列按鈕設定</h2>
          </div>
          <div class="table-wrap">
            <table class="table" id="a8-table">
              <colgroup><col width="60"><col><col><col width="100"><col width="180"></colgroup>
              <thead>
                <tr>
                  <th>序號</th>
                  <th>名稱</th>
                  <th>連結</th>
                  <th>另開視窗</th>
                  <th>圖形</th>
                </tr>
              </thead>
              <tbody>
                ${a8Rows}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    sysNav.content.innerHTML = `
      <div class="card-wrapper">
        <div class="card data-card" style="margin-bottom: 16px;">
          <div class="card-filters">
            <label for="app-community-select">社區選擇</label>
            <select id="app-community-select">${options.join("")}</select>
          </div>
        </div>
        ${contentHtml}
      </div>
    `;

    // Start Preview Carousel
    if (sub === '廣告') {
        // Need to define startCarousel function or include it here.
        // For simplicity, I'll inline a simple starter or call a global one if I append it.
        // But since I'm appending 'loadFrontAds' and 'startFrontCarousel' later, I can reuse 'startFrontCarousel' logic?
        // No, 'startFrontCarousel' is for front.
        // Let's rely on 'renderAppSubContent' refreshing the DOM, but we need JS to run the carousel.
        // I will add the JS logic inside 'if (sub === "廣告")' block below.
    }

    const sel = document.getElementById("app-community-select");
    if (sel) {
      if (!window.currentAppCommunitySlug) {
        window.currentAppCommunitySlug = "all";
        sel.value = "all";
      }
      sel.addEventListener("change", () => {
        window.currentAppCommunitySlug = sel.value;
        renderAppSubContent(sub);
      });
    }
    
    if (sub === '廣告') {
      const btnSave = document.getElementById("btn-save-ads");
      if (btnSave) {
        btnSave.addEventListener("click", async () => {
           const trs = sysNav.content.querySelectorAll("tbody tr");
           const items = [];
           trs.forEach(tr => {
             const idx = parseInt(tr.getAttribute("data-idx"));
             const url = tr.querySelector(".ad-url-input").value.trim();
             const description = tr.querySelector(".ad-desc-input").value.trim();
             const typeEl = tr.querySelector(".ad-type-badge");
             const type = typeEl.textContent === 'YouTube' ? 'youtube' : 'image';
             const autoplay = tr.querySelector(".ad-autoplay").checked;
             if (url) {
               items.push({ idx, url, type, autoplay, description });
             }
           });
           
           // Get Config
           const config = {
             interval: parseInt(document.getElementById("ads-interval").value) || 3,
             effect: document.getElementById("ads-effect").value,
             loop: document.getElementById("ads-loop").value,
             nav: document.getElementById("ads-nav").checked
           };
           
           try {
             const targetSlug = current === 'all' ? 'default' : current;
             await setDoc(doc(db, `communities/${targetSlug}/app_modules/ads`), { items, config }, { merge: true });
             showHint("設定已儲存", "success");
             // Don't re-render to avoid race conditions and UI reset
             updatePreview();
           } catch(e) {
             console.error(e);
             showHint("儲存失敗", "error");
           }
        });
      }
      
      // Function to refresh preview based on current DOM inputs
      const updatePreview = () => {
         // Clear existing interval immediately to prevent race conditions
         if (window.adsPreviewInterval) {
             clearInterval(window.adsPreviewInterval);
             window.adsPreviewInterval = null;
         }

         // Gather current inputs
         const trs = sysNav.content.querySelectorAll("tbody tr");
         const items = [];
         trs.forEach(tr => {
           const idx = parseInt(tr.getAttribute("data-idx"));
           const url = tr.querySelector(".ad-url-input").value.trim();
           const description = tr.querySelector(".ad-desc-input").value.trim();
           const typeEl = tr.querySelector(".ad-type-badge");
           const type = typeEl.textContent === 'YouTube' ? 'youtube' : 'image';
           const autoplay = tr.querySelector(".ad-autoplay").checked;
           if (url) {
             items.push({ idx, url, type, autoplay, description });
           }
         });
         
         // Gather config
         const currentConfig = {
             interval: parseInt(document.getElementById("ads-interval")?.value) || 3,
             effect: document.getElementById("ads-effect")?.value || 'slide',
             loop: document.getElementById("ads-loop")?.value || 'infinite',
             nav: document.getElementById("ads-nav")?.checked || false
         };

         const previewContainer = sysNav.content.querySelector(".a3-preview-container");
         if (!previewContainer) return;

         // Capture current active index
         let currentIdx = 0;
         const currentSlides = previewContainer.querySelectorAll(".preview-slide");
         if (currentSlides.length > 0) {
             currentSlides.forEach((s, i) => {
                 if (s.classList.contains('active')) currentIdx = i;
             });
         }

         // Update Effect Class
         previewContainer.className = `a3-preview-container effect-${currentConfig.effect}`;

         // Generate Slides HTML
         const validItems = items.sort((a, b) => a.idx - b.idx);
         let previewContent = '';
         
         if (validItems.length === 0) {
            previewContent = `<div class="preview-placeholder">A3 輪播預覽區 (目前無內容)</div>`;
         } else {
            // Adjust currentIdx if out of bounds
            if (currentIdx >= validItems.length) currentIdx = 0;

            const slidesHtml = validItems.map((item, idx) => {
              let content = '';
              if (item.type === 'youtube') {
                 let vidId = '';
                 try {
                   const u = new URL(item.url);
                   if (u.hostname.includes('youtube.com')) {
                     vidId = u.searchParams.get('v');
                     if (!vidId && u.pathname.startsWith('/embed/')) {
                       vidId = u.pathname.split('/')[2];
                     } else if (!vidId && u.pathname.startsWith('/live/')) {
                        vidId = u.pathname.split('/')[2];
                     }
                   }
                   else if (u.hostname.includes('youtu.be')) vidId = u.pathname.slice(1);
                 } catch {}
                 const origin = window.location.origin;
                 const embedUrl = vidId ? `https://www.youtube.com/embed/${vidId}?autoplay=${item.autoplay?1:0}&mute=1&enablejsapi=1&origin=${origin}` : item.url;
                 content = `<iframe src="${embedUrl}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
              } else {
                 const safeDesc = (item.description || '').replace(/"/g, '&quot;');
                 content = `<img src="${item.url}" alt="Slide ${idx+1}" class="clickable-slide" style="cursor: pointer;" data-description="${safeDesc}" onclick="window.showAdModal(this.src, this.getAttribute('data-description'))">`;
              }
              const isActive = idx === currentIdx;
              return `<div class="preview-slide ${isActive?'active':''}">${content}</div>`;
            }).join('');
            
            previewContent = `
                ${slidesHtml}
                <button class="preview-nav-btn preview-nav-prev" style="display: ${currentConfig.nav ? 'block' : 'none'}">❮</button>
                <button class="preview-nav-btn preview-nav-next" style="display: ${currentConfig.nav ? 'block' : 'none'}">❯</button>
              `;
         }
         
         previewContainer.innerHTML = previewContent;
         
         // Restart Carousel Logic
         restartCarousel(currentConfig);
      };

      const restartCarousel = (config) => {
          if (window.adsPreviewInterval) {
            clearInterval(window.adsPreviewInterval);
            window.adsPreviewInterval = null;
          }
          
          const previewContainer = sysNav.content.querySelector(".a3-preview-container");
          if (!previewContainer) return;

          const slides = previewContainer.querySelectorAll(".preview-slide");
          const btnPrev = previewContainer.querySelector(".preview-nav-prev");
          const btnNext = previewContainer.querySelector(".preview-nav-next");
          
          if (slides.length <= 1) return;

          let idx = 0;
          // Try to maintain current active slide if possible, or start from 0
          for (let i = 0; i < slides.length; i++) {
             if (slides[i].classList.contains('active')) {
                 idx = i;
                 break;
             }
          }
          
          let direction = 1; 
          const rawInterval = parseInt(config.interval);
          const intervalTime = Math.max((!isNaN(rawInterval) ? rawInterval : 3) * 1000, 2000); // Enforce min 2s
          
          const showSlide = (i) => {
              slides.forEach(s => s.classList.remove('active'));
              if (slides[i]) slides[i].classList.add('active');
          };
          
          // Ensure initial state
          showSlide(idx);

          const next = () => {
              if (config.loop === 'rewind') {
                  if (idx >= slides.length - 1) direction = -1;
                  if (idx <= 0) direction = 1;
                  idx += direction;
              } else if (config.loop === 'once') {
                  if (idx < slides.length - 1) idx++;
                  else {
                      if (window.adsPreviewInterval) {
                          clearInterval(window.adsPreviewInterval);
                          window.adsPreviewInterval = null;
                      }
                      return;
                  }
              } else { 
                  // infinite
                  idx = (idx + 1) % slides.length;
              }
              showSlide(idx);
          };

          const prev = () => {
              if (config.loop === 'once') {
                  if (idx > 0) idx--;
              } else { 
                  idx = (idx - 1 + slides.length) % slides.length;
              }
              showSlide(idx);
          };

          const startTimer = () => {
              if (window.adsPreviewInterval) clearInterval(window.adsPreviewInterval);
              if (config.loop === 'once' && idx >= slides.length - 1) return;
              window.adsPreviewInterval = setInterval(next, intervalTime);
          };
          
          const resetTimer = () => {
              startTimer();
          };

          if (btnNext) {
             btnNext.onclick = (e) => {
                e.preventDefault();
                next();
                resetTimer();
             };
          }
          if (btnPrev) {
             btnPrev.onclick = (e) => {
                e.preventDefault();
                prev();
                resetTimer();
             };
          }

          // Swipe support for preview
          if (previewContainer) {
            let touchStartX = 0;
            let touchEndX = 0;
            previewContainer.addEventListener('touchstart', (e) => {
              if (e.changedTouches && e.changedTouches.length > 0) {
                touchStartX = e.changedTouches[0].screenX;
              }
              if (window.adsPreviewInterval) clearInterval(window.adsPreviewInterval);
            }, { passive: true });
            previewContainer.addEventListener('touchend', (e) => {
              if (e.changedTouches && e.changedTouches.length > 0) {
                touchEndX = e.changedTouches[0].screenX;
                if (touchEndX < touchStartX - 50) next();
                if (touchEndX > touchStartX + 50) prev();
              }
              resetTimer();
            }, { passive: true });
          }

          startTimer();
      };

      // Auto-detect inputs logic (same as before)
      const inputs = sysNav.content.querySelectorAll(".ad-url-input");
      inputs.forEach(input => {
        input.addEventListener("input", (e) => {
           const val = e.target.value.trim();
           const tr = e.target.closest("tr");
           const badge = tr.querySelector(".ad-type-badge");
           const autoCheck = tr.querySelector(".ad-autoplay");
           
           let isYt = false;
           if (val) {
             try {
               const u = new URL(val);
               if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) isYt = true;
             } catch {}
           }
           
           if (isYt) {
             badge.textContent = 'YouTube';
             badge.className = 'ad-type-badge youtube';
             autoCheck.disabled = false;
           } else {
             badge.textContent = '圖片';
             badge.className = 'ad-type-badge image';
             autoCheck.disabled = true;
             autoCheck.checked = false;
           }
           
           // Update Preview Realtime
           updatePreview();
        });
      });
      
      // Also update on checkbox change
      const checks = sysNav.content.querySelectorAll(".ad-autoplay");
      checks.forEach(c => c.addEventListener("change", updatePreview));

      // Also update on config change
      const configInputs = [
          document.getElementById("ads-interval"),
          document.getElementById("ads-effect"),
          document.getElementById("ads-loop"),
          document.getElementById("ads-nav")
      ];
      configInputs.forEach(el => {
          if(el) el.addEventListener("change", updatePreview);
          if(el && el.tagName === 'INPUT' && el.type === 'number') el.addEventListener("input", updatePreview);
      });
      
      // Ads image upload
      const adFileInputs = sysNav.content.querySelectorAll(".ad-image-upload");
      adFileInputs.forEach(input => {
        input.addEventListener("change", async (e) => {
           const f = e.target.files[0];
           if (!f) return;
           
           const current = window.currentAppCommunitySlug || "all";
           const targetSlug = current === 'all' ? 'default' : current;
           
           const uploadAdFile = async (idx, file) => {
              const ext = file.type === "image/png" ? "png" : "jpg";
              const path = `ads/${targetSlug}/${idx}.${ext}`;
              const ref = storageRef(storage, path);
              await uploadBytes(ref, file, { contentType: file.type });
              return await getDownloadURL(ref);
           };

           const tr = input.closest("tr");
           const idx = tr.getAttribute("data-idx");
           const textInput = tr.querySelector(".ad-url-input");
           
           input.disabled = true;
           textInput.disabled = true;
           const originalVal = textInput.value;
           textInput.value = "上傳中...";
           
           try {
              const url = await uploadAdFile(idx, f);
              textInput.value = url;
              textInput.dispatchEvent(new Event('input'));
           } catch (err) {
              console.error(err);
              alert("上傳失敗: " + err.message);
              textInput.value = originalVal;
           } finally {
              input.disabled = false;
              textInput.disabled = false;
              input.value = ""; 
           }
        });
      });

      // Start Carousel Logic for Admin Preview
      if (window.adsPreviewInterval) clearInterval(window.adsPreviewInterval);
      
      restartCarousel(adsConfig);
    }
    if (sub === '按鈕') {
      const bindPreview = (scope) => {
        const inputs = sysNav.content.querySelectorAll(`.${scope}-icon-file`);
        inputs.forEach(input => {
          input.addEventListener("change", () => {
            const tr = input.closest("tr");
            const img = tr.querySelector(".icon-preview");
            const f = input.files[0];
            if (img) img.src = f ? URL.createObjectURL(f) : "";
          });
        });
      };
      bindPreview("a6");
      bindPreview("a8");
      const btn = document.getElementById("btn-save-buttons");
      if (btn) {
        btn.addEventListener("click", async () => {
          const originalText = btn.textContent;
          btn.disabled = true;
          btn.textContent = "儲存中...";
          const selEl = document.getElementById("app-community-select");
          const targetSlug = (selEl && selEl.value === 'all') ? 'default' : (selEl ? selEl.value : 'default');
          const collect = (tableId) => {
            const trs = sysNav.content.querySelectorAll(`#${tableId} tbody tr`);
            const items = [];
            trs.forEach(tr => {
              const idx = parseInt(tr.getAttribute("data-idx"));
              const text = tr.querySelector(".btn-text").value.trim();
              const link = tr.querySelector(".btn-link").value.trim();
              const newWindow = !!(tr.querySelector(".btn-new-window")?.checked);
              const fileInput = tr.querySelector(".icon-file");
              items.push({ idx, text, link, newWindow, fileInput });
            });
            return items;
          };
          const a6Items = collect("a6-table");
          const a8Items = collect("a8-table");
          const uploadIcon = async (section, idx, file) => {
            const ext = file.type === "image/png" ? "png" : "jpg";
            const path = `avatars/buttons/${targetSlug}/${section}_${idx}.${ext}`;
            const ref = storageRef(storage, path);
            await uploadBytes(ref, file, { contentType: file.type });
            return await getDownloadURL(ref);
          };
          const resultA6 = [];
          const resultA8 = [];
          try {
            for (let it of a6Items) {
              let iconUrl = "";
              const f = it.fileInput.files[0];
              if (f) {
                try {
                  iconUrl = await uploadIcon("a6", it.idx, f);
                } catch {
                  try {
                    iconUrl = await new Promise((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(reader.result);
                      reader.onerror = reject;
                      reader.readAsDataURL(f);
                    });
                  } catch {
                    iconUrl = "";
                  }
                }
              } else {
                const prev = it.fileInput.closest("tr").querySelector(".icon-preview").getAttribute("src") || "";
                iconUrl = prev || "";
              }
              if (it.text || it.link || iconUrl) {
                resultA6.push({ idx: it.idx, text: it.text, link: it.link, newWindow: !!it.newWindow, iconUrl });
              }
            }
            for (let it of a8Items) {
              let iconUrl = "";
              const f = it.fileInput.files[0];
              if (f) {
                try {
                  iconUrl = await uploadIcon("a8", it.idx, f);
                } catch {
                  try {
                    iconUrl = await new Promise((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(reader.result);
                      reader.onerror = reject;
                      reader.readAsDataURL(f);
                    });
                  } catch {
                    iconUrl = "";
                  }
                }
              } else {
                const prev = it.fileInput.closest("tr").querySelector(".icon-preview").getAttribute("src") || "";
                iconUrl = prev || "";
              }
              if (it.text || it.link || iconUrl) {
                resultA8.push({ idx: it.idx, text: it.text, link: it.link, newWindow: !!it.newWindow, iconUrl });
              }
            }
            await setDoc(doc(db, `communities/${targetSlug}/app_modules/buttons`), { a6: resultA6, a8: resultA8 }, { merge: true });
            showHint("設定已儲存", "success");
            btn.textContent = "已儲存";
            const hint = document.createElement("span");
            hint.textContent = "已完成";
            hint.style.cssText = "margin-left:8px;color:#0ea5e9;font-size:13px;";
            btn.parentElement && btn.parentElement.appendChild(hint);
            setTimeout(() => {
              if (hint && hint.parentElement) hint.parentElement.removeChild(hint);
              btn.textContent = originalText;
              btn.disabled = false;
            }, 1500);
          } catch (e) {
            console.error(e);
            showHint("儲存失敗", "error");
            btn.textContent = "儲存失敗";
            setTimeout(() => {
              btn.textContent = originalText;
              btn.disabled = false;
            }, 1200);
          }
        });
      }
    }
  }
  
  function renderSubNav(key) {
    if (!sysNav.subContainer) return;
    const items = sysSubMenus[key] || [];
    sysNav.subContainer.innerHTML = items.map((item, index) => 
      `<button class="sub-nav-item ${index === 0 ? 'active' : ''}" data-label="${item}">${item}</button>`
    ).join('');
    
    const buttons = sysNav.subContainer.querySelectorAll('.sub-nav-item');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const label = (btn.getAttribute('data-label') || btn.textContent || '').replace(/\u200B/g, '').trim();
        renderContentFor(key, label);
      });
    });
    const firstBtn = sysNav.subContainer.querySelector('.sub-nav-item');
    const first = firstBtn && (firstBtn.getAttribute('data-label') || firstBtn.textContent || '').replace(/\u200B/g, '').trim();
    if (first) renderContentFor(key, first);
  
    if (items.length) renderContentFor(key, items[0]);
  }

  function setActiveNav(activeKey) {
    ['home', 'notify', 'settings', 'app'].forEach(key => {
      if (sysNav[key]) {
        if (key === activeKey) {
          sysNav[key].classList.add('active');
        } else {
          sysNav[key].classList.remove('active');
        }
      }
    });
    renderSubNav(activeKey);
  }

  // Event Listeners
  if (sysNav.home) sysNav.home.addEventListener('click', () => setActiveNav('home'));
  if (sysNav.notify) sysNav.notify.addEventListener('click', () => setActiveNav('notify'));
  if (sysNav.settings) sysNav.settings.addEventListener('click', () => setActiveNav('settings'));
  if (sysNav.app) sysNav.app.addEventListener('click', () => setActiveNav('app'));

  // Initialize with Home
  renderSubNav('home');
}

const adminNav = {
  shortcuts: document.getElementById("admin-tab-shortcuts"),
  mail: document.getElementById("admin-tab-mail"),
  facility: document.getElementById("admin-tab-facility"),
  announce: document.getElementById("admin-tab-announce"),
  residents: document.getElementById("admin-tab-residents"),
  communities: document.getElementById("admin-tab-communities"),
  others: document.getElementById("admin-tab-others"),
  subContainer: document.getElementById("admin-sub-nav"),
  content: adminStack ? adminStack.querySelector(".row.B3") : null
};

const adminSubMenus = {
  shortcuts: ["通知跑馬燈"],
  mail: ["收件", "取件", "寄放", "設定"],
  facility: ["設定"],
  announce: [{ key: "announce_list", label: "社區園地" }],
  residents: ["住戶", "點數", "通知", "警報", "設定"],
  communities: ["列表"],
  others: ["日誌", "班表", "通訊", "巡邏", "設定"]
};

async function renderAdminCommunities() {
  if (!adminNav.content) return;
  adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">社區列表</h1></div><div class="empty-hint">載入中...</div></div>`;

  try {
      const snap = await getDocs(collection(db, "communities"));
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      const tbody = items.map(item => `
        <tr>
            <td>${item.name || ""}</td>
            <td>${item.id}</td>
            <td>${item.manager || ""}</td>
            <td>${item.phone || ""}</td>
            <td>${item.active !== false ? "啟用" : "停用"}</td>
            <td class="actions">
                <button class="btn small action-btn btn-edit-community" data-id="${item.id}">編輯</button>
                <button class="btn small action-btn danger btn-delete-community" data-id="${item.id}">刪除</button>
            </td>
        </tr>
      `).join("");

      adminNav.content.innerHTML = `
        <div class="card data-card">
          <div class="card-head">
            <h1 class="card-title">社區列表</h1>
            <button id="btn-create-community" class="btn small action-btn">新增社區</button>
          </div>
          <div class="table-wrap">
            <table class="table">
               <thead>
                 <tr>
                   <th>社區名稱</th>
                   <th>代碼 (Slug)</th>
                   <th>管理者</th>
                   <th>電話</th>
                   <th>狀態</th>
                   <th>操作</th>
                 </tr>
               </thead>
               <tbody>${tbody}</tbody>
            </table>
            ${items.length === 0 ? '<div class="empty-hint">尚未建立內容</div>' : ''}
          </div>
        </div>
      `;

      // Event Listeners
      const btnCreate = document.getElementById("btn-create-community");
      if(btnCreate) btnCreate.addEventListener("click", () => openCommunityModal());
      
      document.querySelectorAll(".btn-edit-community").forEach(btn => {
          btn.addEventListener("click", () => {
              const id = btn.getAttribute("data-id");
              const item = items.find(i => i.id === id);
              openCommunityModal(item);
          });
      });

      document.querySelectorAll(".btn-delete-community").forEach(btn => {
          btn.addEventListener("click", async () => {
             if(!confirm("確定要刪除嗎？")) return;
             const id = btn.getAttribute("data-id");
             try {
                 await deleteDoc(doc(db, "communities", id));
                 renderAdminCommunities();
             } catch(e) {
                 alert("刪除失敗: " + e.message);
             }
          });
      });

  } catch (e) {
      console.error(e);
      adminNav.content.innerHTML = `<div class="error">載入失敗: ${e.message}</div>`;
  }
}

function openCommunityModal(community = null) {
  const isEdit = !!community;
  const modalId = "community-modal";
  let modal = document.getElementById(modalId);
  if (modal) modal.remove();

  const html = `
    <div id="${modalId}" class="modal active">
      <div class="modal-dialog">
        <div class="modal-head">
          <div class="modal-title">${isEdit ? "編輯社區" : "新增社區"}</div>
          <button class="close-btn" onclick="document.getElementById('${modalId}').remove()">×</button>
        </div>
        <div class="modal-body">
           <div class="form-group">
              <label>社區名稱</label>
              <input type="text" id="comm-name" class="form-control" value="${community?.name || ""}" required>
           </div>
           <div class="form-group">
              <label>社區代碼 (Slug/ID)</label>
              <input type="text" id="comm-slug" class="form-control" value="${community?.id || ""}" ${isEdit ? "disabled" : "required placeholder='例如: happy-community'"} >
              ${isEdit ? "" : "<small style='color:var(--muted);display:block;margin-top:4px;'>設定後不可修改，將作為網址與資料庫路徑</small>"}
           </div>
           <div class="form-group">
              <label>地址</label>
              <input type="text" id="comm-address" class="form-control" value="${community?.address || ""}">
           </div>
           <div class="form-group">
              <label>管理者</label>
              <input type="text" id="comm-manager" class="form-control" value="${community?.manager || ""}">
           </div>
           <div class="form-group">
              <label>聯絡電話</label>
              <input type="text" id="comm-phone" class="form-control" value="${community?.phone || ""}">
           </div>
           <div class="form-group">
              <label>聯絡 Email</label>
              <input type="email" id="comm-email" class="form-control" value="${community?.email || ""}">
           </div>
           <div class="form-group checkbox-group" style="margin-top:16px;">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="comm-active" ${community?.active !== false ? "checked" : ""}> 
                啟用狀態
              </label>
           </div>
        </div>
        <div class="modal-foot">
          <button class="btn" onclick="document.getElementById('${modalId}').remove()">取消</button>
          <button id="btn-save-community" class="btn primary">儲存</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", html);

  document.getElementById("btn-save-community").addEventListener("click", async () => {
      const name = document.getElementById("comm-name").value.trim();
      const slug = document.getElementById("comm-slug").value.trim();
      const address = document.getElementById("comm-address").value.trim();
      const manager = document.getElementById("comm-manager").value.trim();
      const phone = document.getElementById("comm-phone").value.trim();
      const email = document.getElementById("comm-email").value.trim();
      const active = document.getElementById("comm-active").checked;

      if (!name || !slug) {
          alert("名稱與代碼為必填");
          return;
      }

      const btn = document.getElementById("btn-save-community");
      btn.disabled = true;
      btn.textContent = "儲存中...";

      try {
          const data = {
              name,
              address,
              manager,
              phone,
              email,
              active,
              updatedAt: Date.now()
          };
          
          if (!isEdit) {
             data.createdAt = Date.now();
          }

          await setDoc(doc(db, "communities", slug), data, { merge: true });
          
          document.getElementById(modalId).remove();
          renderAdminCommunities();
      } catch (e) {
          console.error(e);
          alert("儲存失敗: " + e.message);
          btn.disabled = false;
          btn.textContent = "儲存";
      }
  });
}

async function renderAdminAnnounceList(displayTitle, dbCategoryOverride = null) {
  const category = dbCategoryOverride || displayTitle;
  if (!adminNav.content) return;
  
  // Initial loading state
  adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">${displayTitle}</h1></div><div class="empty-hint">載入中...</div></div>`;

  // Cleanup previous listener
  if (window.adminAnnounceUnsub) {
    window.adminAnnounceUnsub();
    window.adminAnnounceUnsub = null;
  }
  
  // Setup persistent listener to handle auth state changes (late init)
  window.adminAnnounceUnsub = onAuthStateChanged(auth, async (u) => {
    if (!u) {
       adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">${displayTitle}</h1></div><div class="empty-hint">請先登入</div></div>`;
       return;
    }
    
    let slug = window.currentAdminCommunitySlug || getSlugFromPath() || getQueryParam("c") || "default";
    if (slug === "default") {
        try {
          slug = await getUserCommunity(u.uid);
        } catch {}
    }

    let communityName = "";
    try {
        const commDoc = await getDoc(doc(db, "communities", slug));
        if (commDoc.exists()) {
            communityName = commDoc.data().name;
        }
    } catch (e) {
        console.error("Failed to fetch community name", e);
    }

    let items = [];
    try {
        const ref = collection(db, "communities", slug, "announcements");
        const q = query(ref, where("category", "==", category));
        const snap = await getDocs(q);
        items = snap.docs.map(d => ({id: d.id, ...d.data()}));
        // Sort in memory to avoid Firestore index requirement
        items.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch (e) {
        console.error("Failed to load announcements", e);
    }

    // Extract event dates
    const eventDates = new Set();
    items.forEach(item => {
        if(item.createdAt) {
            const d = new Date(item.createdAt);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            eventDates.add(`${y}-${m}-${day}`);
        }
    });

    let currentItems = [...items];
    let currentFilterDate = null;

    const renderTable = () => {
        const tbody = document.querySelector("#announce-table-body");
        const emptyHint = document.querySelector("#announce-empty-hint");
        if(!tbody) return;

        const rows = currentItems.map(item => {
            const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleString() : "";
            return `
                <tr data-id="${item.id}">
                    <td>${dateStr}</td>
                    <td>${item.title || ""}</td>
                    <td>${item.author || ""}</td>
                    <td>${item.status || "顯示"}</td>
                    <td class="actions">
                        <button class="btn small action-btn btn-edit-announce">編輯</button>
                        <button class="btn small action-btn danger btn-delete-announce">刪除</button>
                    </td>
                </tr>
            `;
        }).join("");
        
        tbody.innerHTML = rows;
        if(emptyHint) {
            emptyHint.style.display = currentItems.length === 0 ? "block" : "none";
            emptyHint.textContent = currentFilterDate ? "該日期無公告" : "尚未建立內容";
        }

        // Re-attach listeners for edit/delete
        tbody.querySelectorAll(".btn-edit-announce").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const tr = btn.closest("tr");
                const id = tr.getAttribute("data-id");
                const item = items.find(i => i.id === id);
                openAnnounceModal(item, displayTitle, slug, category);
            });
        });

        tbody.querySelectorAll(".btn-delete-announce").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                if(!confirm("確定要刪除嗎？")) return;
                const tr = btn.closest("tr");
                const id = tr.getAttribute("data-id");
                try {
                    await deleteDoc(doc(db, "communities", slug, "announcements", id));
                    renderAdminAnnounceList(displayTitle, category);
                } catch(err) {
                    console.error(err);
                    alert("刪除失敗");
                }
            });
        });
    };

    adminNav.content.innerHTML = `
      <div class="card data-card">
        <div class="card-head">
          <h1 class="card-title">${displayTitle}</h1>
          <div style="display:flex; gap:8px;">
             <button id="btn-filter-date" class="btn small action-btn" style="background:#fff; color: #1f2937; border: 1px solid #e5e7eb;">日期篩選</button>
             <button id="btn-preview-announce" class="btn small action-btn" style="background-color: #10b981; color: white;">預覽</button>
             <button id="btn-create-announce" class="btn small action-btn">新增${displayTitle}</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
             <thead>
               <tr>
                 <th>日期</th>
                 <th>標題</th>
                 <th>發起人</th>
                 <th>狀態</th>
                 <th>操作</th>
               </tr>
             </thead>
             <tbody id="announce-table-body"></tbody>
          </table>
          <div id="announce-empty-hint" class="empty-hint" style="display:none;">尚未建立內容</div>
        </div>
      </div>
      
      <div id="calendar-modal" class="calendar-modal hidden">
         <div class="calendar-container">
            <div class="calendar-header">
               <button class="btn small" id="cal-prev" style="min-width:40px;">&lt;</button>
               <div class="calendar-title" id="cal-title"></div>
               <button class="btn small" id="cal-next" style="min-width:40px;">&gt;</button>
            </div>
            <div class="calendar-grid" id="cal-grid"></div>
            <div class="calendar-actions">
               <button class="btn small" id="cal-clear">清除篩選</button>
               <button class="btn small primary" id="cal-close">關閉</button>
            </div>
         </div>
      </div>
    `;

    renderTable();

    const btnCreate = document.getElementById("btn-create-announce");
    if(btnCreate) {
        btnCreate.addEventListener("click", () => {
            openAnnounceModal(null, displayTitle, slug, category);
        });
    }

    const btnPreview = document.getElementById("btn-preview-announce");
    if(btnPreview) {
        btnPreview.addEventListener("click", () => {
            const cName = window.currentCommunityName || "";
            // Use 'preview' without extension to play nice with 'serve' clean URLs
            // Encode all parameters strictly
            const url = `preview?c=${encodeURIComponent(slug)}&tab=${encodeURIComponent(category)}&title=${encodeURIComponent(displayTitle)}&cn=${encodeURIComponent(cName)}`;
            const fullUrl = new URL(url, window.location.href).href;
            
            const html = `
              <div class="modal-dialog" style="max-width: 400px;">
                <div class="modal-head">
                  <div class="modal-title">預覽連結</div>
                </div>
                <div class="modal-body">
                  <div style="margin-bottom: 8px; font-size: 14px; color: #374151;">連結網址</div>
                  <input type="text" value="${fullUrl}" readonly style="width: 100%; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 14px; color: #4b5563; background: #f9fafb;" onclick="this.select()">
                </div>
                <div class="modal-foot">
                  <button id="preview-cancel" class="btn small" style="background: #fff; border: 1px solid #e5e7eb; color: #374151;">取消</button>
                  <button id="preview-go" class="btn small primary">前往</button>
                </div>
              </div>
            `;
            
            openModal(html);
            
            const btnCancel = document.getElementById("preview-cancel");
            if (btnCancel) btnCancel.addEventListener("click", closeModal);
            
            const btnGo = document.getElementById("preview-go");
            if (btnGo) {
                btnGo.addEventListener("click", () => {
                    window.open(fullUrl, "previewWindow", "width=375,height=812,scrollbars=yes,resizable=yes");
                    closeModal();
                });
            }
        });
    }

    // Date Filter Logic
    const btnFilter = document.getElementById("btn-filter-date");
    const modal = document.getElementById("calendar-modal");
    const calTitle = document.getElementById("cal-title");
    const calGrid = document.getElementById("cal-grid");
    const btnPrev = document.getElementById("cal-prev");
    const btnNext = document.getElementById("cal-next");
    const btnClear = document.getElementById("cal-clear");
    const btnClose = document.getElementById("cal-close");

    let viewDate = new Date();

    function renderCalendar() {
        const y = viewDate.getFullYear();
        const m = viewDate.getMonth();
        calTitle.textContent = `${y}年 ${m+1}月`;
        
        const firstDay = new Date(y, m, 1).getDay();
        const daysInMonth = new Date(y, m+1, 0).getDate();
        
        let html = '';
        const weekDays = ['日','一','二','三','四','五','六'];
        weekDays.forEach(d => html += `<div class="calendar-day-header">${d}</div>`);
        
        for(let i=0; i<firstDay; i++) {
            html += `<div class="calendar-day empty"></div>`;
        }
        
        for(let d=1; d<=daysInMonth; d++) {
            const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const hasEvent = eventDates.has(dateStr);
            const isSelected = currentFilterDate === dateStr;
            
            let classes = 'calendar-day';
            if(hasEvent) classes += ' has-event';
            else classes += ' no-event';
            if(isSelected) classes += ' selected';
            
            html += `<div class="${classes}" data-date="${dateStr}">${d}</div>`;
        }
        
        calGrid.innerHTML = html;
        
        calGrid.querySelectorAll('.calendar-day:not(.empty)').forEach(el => {
            el.addEventListener('click', () => {
                const dateStr = el.getAttribute('data-date');
                currentFilterDate = dateStr;
                currentItems = items.filter(i => {
                    if(!i.createdAt) return false;
                    const d = new Date(i.createdAt);
                    const iY = d.getFullYear();
                    const iM = String(d.getMonth() + 1).padStart(2, '0');
                    const iD = String(d.getDate()).padStart(2, '0');
                    return `${iY}-${iM}-${iD}` === dateStr;
                });
                renderTable();
                modal.classList.add('hidden');
                btnFilter.textContent = `篩選: ${dateStr}`;
                btnFilter.style.background = '#fff';
                btnFilter.style.border = '1px solid #ef4444';
                btnFilter.style.color = '#ef4444';
            });
        });
    }

    if(btnFilter) {
        btnFilter.addEventListener("click", () => {
            viewDate = new Date(); 
            renderCalendar();
            modal.classList.remove("hidden");
        });
    }
    
    if(btnPrev) {
        btnPrev.addEventListener("click", () => {
            viewDate.setMonth(viewDate.getMonth() - 1);
            renderCalendar();
        });
    }
    
    if(btnNext) {
        btnNext.addEventListener("click", () => {
            viewDate.setMonth(viewDate.getMonth() + 1);
            renderCalendar();
        });
    }
    
    if(btnClear) {
        btnClear.addEventListener("click", () => {
            currentFilterDate = null;
            currentItems = [...items];
            renderTable();
            modal.classList.add("hidden");
            btnFilter.textContent = "日期篩選";
            btnFilter.style.background = '#fff';
            btnFilter.style.border = '1px solid #e5e7eb';
            btnFilter.style.color = '#1f2937';
        });
    }
    
    if(btnClose) {
        btnClose.addEventListener("click", () => {
            modal.classList.add("hidden");
        });
    }

  });
}

function openAnnounceModal(item, displayTitle, slug, dbCategory) {
    const isEdit = !!item;
    const title = isEdit ? `編輯${displayTitle}` : `新增${displayTitle}`;
    
    const existingAuthor = item ? (item.author || "社區總幹事") : "社區總幹事";
    const isCustom = existingAuthor !== "社區總幹事" && existingAuthor !== "管委會";
    const selectVal = isCustom ? "其他" : existingAuthor;
    const customVal = isCustom ? existingAuthor : "";
    const showCustom = isCustom ? "block" : "none";

    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">${title}</div></div>
        <div class="modal-body">
           <label class="field">
             <div class="field-head">標題</div>
             <div class="input-wrap"><input type="text" id="ann-title" value="${item ? (item.title || "") : ""}"></div>
           </label>
           <label class="field">
             <div class="field-head">發起人</div>
             <div class="input-wrap">
               <select id="ann-author-select" style="margin-bottom: 5px;">
                 <option value="社區總幹事" ${selectVal === "社區總幹事" ? "selected" : ""}>社區總幹事</option>
                 <option value="管委會" ${selectVal === "管委會" ? "selected" : ""}>管委會</option>
                 <option value="其他" ${selectVal === "其他" ? "selected" : ""}>其他</option>
               </select>
               <input type="text" id="ann-author-custom" value="${customVal}" placeholder="請輸入發起人名稱" style="display: ${showCustom};">
             </div>
           </label>
           <label class="field">
             <div class="field-head">內容</div>
             <div class="input-wrap"><textarea id="ann-content" rows="5" style="width:100%;border:1px solid #ddd;padding:8px;border-radius:8px;">${item ? (item.content || "") : ""}</textarea></div>
           </label>
           <label class="field">
             <div class="field-head">圖片</div>
             <div class="input-wrap">
               <input type="file" id="ann-image" accept="image/*">
               <div id="ann-image-preview" style="margin-top:10px;">
                 ${item && item.imageUrl ? `<div style="position:relative;display:inline-block;"><img src="${item.imageUrl}" style="max-width:100%;max-height:200px;border-radius:4px;display:block;"><button type="button" class="btn-remove-img" style="position:absolute;top:-8px;right:-8px;background:#ef4444;color:white;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,0.2);">✕</button></div>` : ""}
               </div>
             </div>
           </label>
           <label class="field">
             <div class="field-head">狀態</div>
             <div class="input-wrap">
                <select id="ann-status">
                  <option value="顯示" ${item && item.status === "顯示" ? "selected" : ""}>顯示</option>
                  <option value="隱藏" ${item && item.status === "隱藏" ? "selected" : ""}>隱藏</option>
                </select>
             </div>
           </label>
        </div>
        <div class="modal-foot">
          <button class="btn action-btn" onclick="closeModal()">取消</button>
          <button class="btn action-btn primary" id="btn-save-announce">儲存</button>
        </div>
      </div>
    `;
    openModal(body);

    setTimeout(() => {
        const sel = document.getElementById("ann-author-select");
        const inp = document.getElementById("ann-author-custom");
        if (sel && inp) {
            sel.addEventListener("change", () => {
                if (sel.value === "其他") {
                    inp.style.display = "block";
                    inp.focus();
                } else {
                    inp.style.display = "none";
                    inp.value = "";
                }
            });
        }

        const imgInp = document.getElementById("ann-image");
        const imgPrev = document.getElementById("ann-image-preview");
        if(imgInp && imgPrev) {
            imgInp.addEventListener("change", (e) => {
                const f = e.target.files[0];
                if(f) {
                    const reader = new FileReader();
                    reader.onload = (re) => {
                        imgPrev.innerHTML = `<div style="position:relative;display:inline-block;"><img src="${re.target.result}" style="max-width:100%;max-height:200px;border-radius:4px;display:block;"><button type="button" class="btn-remove-img" style="position:absolute;top:-8px;right:-8px;background:#ef4444;color:white;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,0.2);">✕</button></div>`;
                    };
                    reader.readAsDataURL(f);
                }
            });

            imgPrev.addEventListener("click", (e) => {
                if(e.target.closest(".btn-remove-img")) {
                    e.stopPropagation(); // Prevent bubbling if needed
                    imgPrev.innerHTML = "";
                    imgInp.value = "";
                }
            });
        }

        const btnSave = document.getElementById("btn-save-announce");
        if(btnSave) {
            btnSave.addEventListener("click", async () => {
                const titleVal = document.getElementById("ann-title").value.trim();
                const contentVal = document.getElementById("ann-content").value.trim();
                const statusVal = document.getElementById("ann-status").value;
                
                let authorVal = document.getElementById("ann-author-select").value;
                if (authorVal === "其他") {
                    authorVal = document.getElementById("ann-author-custom").value.trim();
                    if (!authorVal) { alert("請輸入發起人名稱"); return; }
                }

                if(!titleVal) { alert("請輸入標題"); return; }

                btnSave.disabled = true;
                btnSave.textContent = "儲存中...";
                showLoading("正在儲存公告並上傳圖片...");

                let imageUrl = "";
                // If no new file is selected, check if we should keep the existing image
                if (!imgInp || !imgInp.files[0]) {
                    if (imgPrev && imgPrev.querySelector("img")) {
                        // Image is still in preview, so keep the existing URL
                        if (item && item.imageUrl) {
                            imageUrl = item.imageUrl;
                        }
                    }
                    // If preview is empty, imageUrl remains "" (deleted)
                }

                if (imgInp && imgInp.files[0]) {
                    const f = imgInp.files[0];
                    try {
                        const ext = f.name.split('.').pop();
                        const fname = `${Date.now()}_${Math.random().toString(36).substring(2)}.${ext}`;
                        const sRef = storageRef(storage, `communities/${slug}/announcements/${fname}`);
                        await uploadBytes(sRef, f);
                        imageUrl = await getDownloadURL(sRef);
                    } catch(err) {
                        console.error("Upload failed", err);
                        alert("圖片上傳失敗，但仍會儲存公告");
                    }
                }

                try {
                    // Check if category is valid (it should be passed from openAnnounceModal)
                    // The parameter name is 'dbCategory' in function signature, not 'category'
                    // So we must use 'dbCategory' here!
                    
                    const safeCategory = dbCategory || displayTitle || "公告";

                    const data = {
                        category: safeCategory,
                        title: titleVal,
                        content: contentVal,
                        status: statusVal,
                        author: authorVal,
                        imageUrl: imageUrl,
                        updatedAt: Date.now()
                    };

                    if (isEdit) {
                        await setDoc(doc(db, "communities", slug, "announcements", item.id), data, { merge: true });
                    } else {
                        data.createdAt = Date.now();
                        await addDoc(collection(db, "communities", slug, "announcements"), data);
                    }
                    hideLoading();
                    closeModal();
                    // Pass the correct title/category back to render
                    renderAdminAnnounceList(displayTitle, safeCategory);
                } catch(err) {
                    hideLoading();
                    console.error(err);
                    alert("儲存失敗: " + err.message);
                    btnSave.disabled = false;
                    btnSave.textContent = "儲存";
                }
            });
        }
    }, 100);
}


function openFacilitySettingsModal(facilityKey, currentTitle, slug) {
  // Use global openModal for consistency
  // Initial loading state
  const loadingHtml = `
    <div class="modal-dialog">
       <div class="modal-body" style="min-height:200px; display:flex; align-items:center; justify-content:center;">
          <div class="loader"></div>
       </div>
    </div>
  `;
  openModal(loadingHtml);

  // Defaults
  let config = {
      openTime: "06:00",
      closeTime: "22:00",
      timeUnit: 1,
      holidayOpen: true,
      status: "open"
  };
  
  let navItem = { label: currentTitle, buttonColor: "#ef4444" };

  (async () => {
      try {
          // Fetch Nav Settings
          const navSnap = await getDoc(doc(db, "communities", slug, "settings", "nav"));
          if(navSnap.exists()) {
              const data = navSnap.data();
              if(data.facility_tabs) {
                  const found = data.facility_tabs.find(t => (typeof t === 'string' ? t === facilityKey : t.key === facilityKey));
                  if(found) {
                      if(typeof found === 'object') {
                          navItem.label = found.label;
                          if(found.buttonColor) navItem.buttonColor = found.buttonColor;
                          if(found.imageUrl) navItem.imageUrl = found.imageUrl;
                      } else {
                          navItem.label = found;
                      }
                  }
              }
          }

          // Fetch Facility Config
          const configSnap = await getDoc(doc(db, "communities", slug, "facility_configs", facilityKey));
          if(configSnap.exists()) {
              config = { ...config, ...configSnap.data() };
          }

          // Render Form
          const formHtml = `
            <div class="modal-dialog">
              <div class="modal-head">
                 <div class="modal-title">設施預約設定 - ${navItem.label}</div>
              </div>
              <div class="modal-body">
                <div class="field">
                    <div class="field-head">設施圖片 (預覽用)</div>
                    <div class="input-wrap">
                         <input type="file" id="set-image-file" accept="image/*" style="display:none">
                         <div id="set-image-preview" style="width:100%; aspect-ratio:3/1; background:#f3f4f6; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; overflow:hidden; border:1px dashed #d1d5db; position:relative;">
                             ${navItem.imageUrl 
                               ? `<img src="${navItem.imageUrl}" style="width:100%; height:100%; object-fit:cover;">` 
                               : `<div style="color:#9ca3af; display:flex; flex-direction:column; align-items:center;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg><span style="margin-top:4px; font-size:12px;">點擊上傳圖片 (3:1)</span></div>`
                             }
                         </div>
                    </div>
                </div>
                <div class="field">
                    <div class="field-head">設施預約名稱</div>
                    <div class="input-wrap"><input type="text" id="set-name" value="${navItem.label}"></div>
                </div>

                <div class="field">
                    <div class="field-head">底線顏色</div>
                    <div class="input-wrap" style="display:flex; gap:10px;">
                        <input type="color" id="set-color-picker" value="${navItem.buttonColor}" style="height:44px; width:60px; padding:0; border:none; cursor:pointer;">
                        <input type="text" id="set-color-text" value="${navItem.buttonColor}" style="flex:1;">
                    </div>
                </div>

                <div class="field">
                    <div class="field-head">預約時段 (00:00 ~ 24:00)</div>
                    <div class="input-wrap" style="display:flex; gap:10px; align-items:center;">
                        <input type="time" id="set-open-time" value="${config.openTime}" style="flex:1;">
                        <span>至</span>
                        <input type="time" id="set-close-time" value="${config.closeTime}" style="flex:1;">
                    </div>
                </div>

                <div class="field">
                    <div class="field-head">時段單位 (小時)</div>
                    <div class="input-wrap">
                        <input type="number" id="set-time-unit" value="${config.timeUnit}" min="1" max="24">
                        <div style="font-size:12px; color:#666; margin-top:4px;">最少 1 小時，最多 24 小時</div>
                    </div>
                </div>

                <div class="field">
                    <div class="field-head">每時段扣除點數</div>
                    <div class="input-wrap">
                        <input type="number" id="set-cost" value="${config.cost || 0}" min="0">
                        <div style="font-size:12px; color:#666; margin-top:4px;">預約每個時段單位將扣除的點數</div>
                    </div>
                </div>

                <div class="field">
                    <div class="input-wrap" style="display:flex; align-items:center; gap:10px;">
                       <input type="checkbox" id="set-holiday" ${config.holidayOpen ? 'checked' : ''} style="width:20px; height:20px;">
                       <label for="set-holiday" style="font-weight:500;">假日開放</label>
                    </div>
                </div>

                <div class="field">
                    <div class="field-head">狀態</div>
                    <div class="input-wrap">
                        <select id="set-status">
                            <option value="open" ${config.status === 'open' ? 'selected' : ''}>開啟</option>
                            <option value="closed" ${config.status === 'closed' ? 'selected' : ''}>關閉</option>
                        </select>
                    </div>
                </div>
              </div>
              <div class="modal-foot" style="justify-content:space-between;">
                <button id="set-delete" class="btn action-btn" style="background-color:#fee2e2; color:#b91c1c; border-color:#fee2e2;">刪除此設施</button>
                <div style="display:flex; gap:10px;">
                    <button id="set-cancel" class="btn action-btn">取消</button>
                    <button id="set-save" class="btn action-btn primary">儲存設定</button>
                </div>
              </div>
            </div>
          `;
          
          // Update modal content
          const modalRoot = document.getElementById("sys-modal");
          if(modalRoot) {
              modalRoot.innerHTML = formHtml;
              
              // Bind Events
              const fileInput = document.getElementById("set-image-file");
              const previewDiv = document.getElementById("set-image-preview");
              
              if(fileInput && previewDiv) {
                  previewDiv.onclick = () => fileInput.click();
                  fileInput.onchange = (e) => {
                      const file = e.target.files[0];
                      if(!file) return;
                      const reader = new FileReader();
                      reader.onload = (evt) => {
                          previewDiv.innerHTML = `<img src="${evt.target.result}" style="width:100%; height:100%; object-fit:cover;">`;
                      };
                      reader.readAsDataURL(file);
                  };
              }

              const colorPicker = document.getElementById("set-color-picker");
              const colorText = document.getElementById("set-color-text");
              
              if(colorPicker && colorText) {
                  colorPicker.addEventListener("input", () => colorText.value = colorPicker.value);
                  colorText.addEventListener("input", () => colorPicker.value = colorText.value);
              }

              const btnDelete = document.getElementById("set-delete");
              if(btnDelete) {
                  btnDelete.onclick = async () => {
                      // Use openConfirmModal for custom confirmation UI
                      openConfirmModal(`確定要刪除 "${navItem.label}" 嗎？此操作無法復原。`, async () => {
                          btnDelete.disabled = true;
                          btnDelete.textContent = "刪除中...";
                          
                          try {
                              // 1. Remove from Nav
                              const navRef = doc(db, "communities", slug, "settings", "nav");
                              const navSnap = await getDoc(navRef);
                              if(navSnap.exists()) {
                                  let tabs = navSnap.data().facility_tabs || [];
                                  const newTabs = tabs.filter(t => {
                                      const tKey = (typeof t === 'object') ? t.key : t;
                                      return tKey !== facilityKey;
                                  });
                                  await updateDoc(navRef, { facility_tabs: newTabs });
                              }

                              // 2. Remove Config (Optional, but good for cleanup)
                              await deleteDoc(doc(db, "communities", slug, "facility_configs", facilityKey));

                              showHint("已刪除", "success");
                              closeModal();
                              
                              // Reload Page or Switch Tab
                              // Since we are in SPA, we should switch to another tab.
                              // But we don't have easy access to switch tab from here without knowing the list.
                              // Easiest is to reload admin facility view.
                              // renderAdminContent('facility'); // Handled by onSnapshot in renderAdminSubNav 

                          } catch(e) {
                              console.error("Delete facility error", e);
                              showHint("刪除失敗", "error");
                              btnDelete.disabled = false;
                              btnDelete.textContent = "刪除此設施";
                          }
                      });
                  };
              }

              const btnCancel = document.getElementById("set-cancel");
              if(btnCancel) btnCancel.onclick = closeModal;

              const btnSave = document.getElementById("set-save");
              if(btnSave) {
                  btnSave.onclick = async () => {
                      const newName = document.getElementById("set-name").value.trim();
                      const newColor = document.getElementById("set-color-text").value.trim();
                      const newOpen = document.getElementById("set-open-time").value;
                      const newClose = document.getElementById("set-close-time").value;
                      const newUnit = parseInt(document.getElementById("set-time-unit").value);
                      const newCost = parseInt(document.getElementById("set-cost").value) || 0;
                      const newHoliday = document.getElementById("set-holiday").checked;
                      const newStatus = document.getElementById("set-status").value;

                      if(!newName) { alert("請輸入預約名稱"); return; }
                      if(newName.length > 10) { alert("設施預約名稱不能超過 10 個字"); return; }
                      if(newUnit < 1 || newUnit > 24) { alert("時段單位需介於 1 至 24 小時"); return; }
                      if(newCost < 0) { alert("扣除點數不能為負數"); return; }
                      
                      btnSave.textContent = "儲存中...";
                      btnSave.disabled = true;

                      try {
                          // 0. Upload Image (if any)
                          let finalImageUrl = navItem.imageUrl || "";
                          const fileInput = document.getElementById("set-image-file");
                          if (fileInput && fileInput.files[0]) {
                              const file = fileInput.files[0];
                              // Use 'announcements' folder to reuse existing storage rules
                              const fileRef = storageRef(getStorage(), `communities/${slug}/announcements/fac_${facilityKey}_${Date.now()}`);
                              await uploadBytes(fileRef, file);
                              finalImageUrl = await getDownloadURL(fileRef);
                          }

                          // 1. Update Nav (Name & Color & Image)
                          const navRef = doc(db, "communities", slug, "settings", "nav");
                          const navSnap = await getDoc(navRef);
                          if(navSnap.exists()) {
                              let tabs = navSnap.data().facility_tabs || [];
                              
                              // Check for duplicates
                              const isDuplicate = tabs.some(t => {
                                  const tName = typeof t === 'string' ? t : t.label;
                                  const tKey = typeof t === 'string' ? t : t.key;
                                  return tKey !== facilityKey && tName === newName;
                              });

                              if(isDuplicate) {
                                  alert("預約名稱已存在，請使用其他名稱");
                                  btnSave.textContent = "儲存設定";
                                  btnSave.disabled = false;
                                  return;
                              }

                              const newTabs = tabs.map(t => {
                                  const k = (typeof t === 'object') ? t.key : t;
                                  if(k === facilityKey) {
                                      return { 
                                          key: facilityKey, 
                                          label: newName, 
                                          buttonColor: newColor,
                                          imageUrl: finalImageUrl
                                      };
                                  }
                                  return (typeof t === 'string') ? { key: t, label: t } : t;
                              });
                              await updateDoc(navRef, { facility_tabs: newTabs });
                          }

                          // 2. Update Config
                          const configRef = doc(db, "communities", slug, "facility_configs", facilityKey);
                          await setDoc(configRef, {
                              openTime: newOpen,
                              closeTime: newClose,
                              timeUnit: newUnit,
                              cost: newCost,
                              holidayOpen: newHoliday,
                              status: newStatus
                          }, { merge: true });

                          showHint("設定已儲存", "success");
                          closeModal();
                          
                          // Reload view to reflect changes (config & name)
                          if (typeof renderAdminFacilityList === 'function') {
                              renderAdminFacilityList(newName, facilityKey);
                          } else {
                              // Fallback if function not found/hoisted
                              const titleEl = document.querySelector(".card-title");
                              if(titleEl) titleEl.innerHTML = `${newName} - 預約管理`;
                              // We can't easily update schedule without reloading
                              // But reloading page is too drastic.
                              // Assuming renderAdminFacilityList is available.
                          }
                          
                      } catch(e) {
                          console.error("Save settings error", e);
                          showHint("儲存失敗", "error");
                          btnSave.textContent = "儲存設定";
                          btnSave.disabled = false;
                      }
                  };
              }
          }

      } catch(e) {
          console.error(e);
          const modalRoot = document.getElementById("sys-modal");
          if(modalRoot) modalRoot.innerHTML = `<div class="modal-dialog"><div class="modal-body">載入失敗: ${e.message}</div><div class="modal-foot"><button class="btn action-btn" onclick="closeModal()">關閉</button></div></div>`;
      }
  })();
}

async function renderAdminFacilityList(displayTitle, facilityKey) {
  if (!adminNav.content) return;
  
  const currentViewId = Date.now().toString();
  adminNav.content.dataset.viewId = currentViewId;

  // Cleanup previous listeners
  if (window.adminFacilityUnsub) {
    window.adminFacilityUnsub();
    window.adminFacilityUnsub = null;
  }
  
  // Cleanup reservation listener
  if (window.adminReservationsUnsub) {
    window.adminReservationsUnsub();
    window.adminReservationsUnsub = null;
  }
  
  adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">${displayTitle} - 預約管理</h1></div><div class="empty-hint">載入中...</div></div>`;
  
  window.adminFacilityUnsub = onAuthStateChanged(auth, async (u) => {
    if (!u) {
       adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">${displayTitle}</h1></div><div class="empty-hint">請先登入</div></div>`;
       return;
    }
    
    let slug = window.currentAdminCommunitySlug || localStorage.getItem("adminCurrentCommunity") || "default";
    if (slug === "default") {
        try {
          slug = await getUserCommunity(u.uid);
        } catch {}
    }

    let communityName = "";
    try {
        const commDoc = await getDoc(doc(db, "communities", slug));
        if (commDoc.exists()) {
            communityName = commDoc.data().name;
        }
    } catch (e) {
        console.error("Failed to fetch community name", e);
    }

    let config = {};
    try {
        const configSnap = await getDoc(doc(db, "communities", slug, "facility_configs", facilityKey));
        if (configSnap.exists()) {
            config = configSnap.data();
        }
    } catch (e) {
        console.error("Failed to load facility config", e);
    }

    let items = [];

    // State for Calendar
    let currentYear = new Date().getFullYear();
    let currentMonth = new Date().getMonth(); // 0-11
    let selectedDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD (Default today)

    // Helper: Get formatted date string YYYY-MM-DD
    const formatDate = (y, m, d) => {
        return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    };

    const renderUI = () => {
        const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
        
        adminNav.content.innerHTML = `
          <div class="card data-card" style="height: calc(70vh - 24px); margin: 12px auto; display: flex; flex-direction: column; padding: 20px; overflow: hidden;">
            <div class="card-head">
              <div style="display:flex; align-items:center; gap:8px;">
                 <h1 class="card-title" style="margin:0;">${displayTitle} - 設施預約管理</h1>
                 <button id="btn-fac-settings" class="btn small icon-btn" title="設定" style="padding:4px; height:auto; background:transparent; border:none; color:#666; cursor:pointer;">
                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                 </button>
              </div>
              <div style="display:flex; gap:8px;">
                 <button id="btn-preview-res" class="btn small action-btn" style="background:#fff; border:1px solid #ddd; color:#333;">預覽</button>
                 <button id="btn-create-res" class="btn small action-btn">設施預約</button>
              </div>
            </div>
            
            <div class="facility-layout">
               <!-- Left: Calendar (30%) -->
               <div class="facility-col-left">
                  <div class="cal-header">
                     <button id="cal-prev" class="btn small" style="padding:0 8px;">&lt;</button>
                     <span style="font-weight:700;">${currentYear}年 ${monthNames[currentMonth]}</span>
                     <button id="cal-next" class="btn small" style="padding:0 8px;">&gt;</button>
                  </div>
                  <div class="cal-grid">
                     <div class="cal-head-day">日</div>
                     <div class="cal-head-day">一</div>
                     <div class="cal-head-day">二</div>
                     <div class="cal-head-day">三</div>
                     <div class="cal-head-day">四</div>
                     <div class="cal-head-day">五</div>
                     <div class="cal-head-day">六</div>
                     ${generateCalendarHTML()}
                  </div>
               </div>

               <!-- Middle: Daily Schedule (20%) -->
               <div class="facility-col-mid">
                  <h3 style="font-size:16px; margin:0 0 12px 0; text-align:center; font-weight:700;">
                     ${selectedDate} 行程
                  </h3>
                  <div class="schedule-list">
                     ${generateScheduleHTML()}
                  </div>
               </div>

               <!-- Right: Management List (50%) -->
               <div class="facility-col-right">
                  <div class="table-wrap" style="height:100%; overflow-y:auto;">
                    <table class="table">
                       <thead style="position:sticky; top:0; z-index:10;">
                         <tr>
                           <th>日期</th>
                           <th>時間</th>
                           <th>預約人</th>
                           <th>狀態</th>
                           <th>操作</th>
                         </tr>
                       </thead>
                       <tbody id="facility-table-body">
                          ${generateTableHTML()}
                       </tbody>
                    </table>
                    ${items.length === 0 ? '<div class="empty-hint">目前無預約</div>' : ''}
                  </div>
               </div>
            </div>
          </div>
        `;

        // Attach Event Listeners
                
                // Settings
                const btnSettings = document.getElementById("btn-fac-settings");
                if(btnSettings) {
                    btnSettings.addEventListener("click", () => {
                        openFacilitySettingsModal(facilityKey, displayTitle, slug);
                    });
                }

                // Calendar Nav
        document.getElementById("cal-prev").addEventListener("click", () => {
            currentMonth--;
            if(currentMonth < 0) { currentMonth = 11; currentYear--; }
            renderUI();
        });
        document.getElementById("cal-next").addEventListener("click", () => {
            currentMonth++;
            if(currentMonth > 11) { currentMonth = 0; currentYear++; }
            renderUI();
        });

        // Calendar Day Click
        document.querySelectorAll(".cal-day:not(.other-month)").forEach(el => {
            el.addEventListener("click", () => {
                selectedDate = el.dataset.date;
                renderUI();
            });
        });

        // Slot Buttons
        document.querySelectorAll(".slot-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const resId = btn.dataset.resId;
                const clickable = btn.getAttribute("data-clickable") !== "false";
                if (resId) {
                    const item = items.find(i => i.id === resId);
                    
                    // Show Action Modal for Existing Reservation
                    const modalId = "res-action-modal";
                    let modal = document.getElementById(modalId);
                    if (!modal) {
                        modal = document.createElement("div");
                        modal.id = modalId;
                        modal.className = "modal hidden";
                        document.body.appendChild(modal);
                    }
                    if (modal.parentNode !== document.body) document.body.appendChild(modal);

                    const isPaused = item.bookerName === "暫停";
                    
                    // Button logic:
                    // If Paused: Only show "Cancel Suspension" (btn-res-cancel)
                    // If Booked: Only show "Cancel Reservation" (btn-res-cancel)
                    // No "Suspend" button in either case as per latest request.

                    const cancelBtnText = isPaused ? "取消暫停" : "取消預約";
                    
                    modal.innerHTML = `
                      <div class="modal-box" style="width:300px; padding:24px; text-align:center; background:white; border-radius:12px; box-shadow:0 10px 25px -5px rgba(0,0,0,0.1); position:relative; z-index:10;">
                        <h3 style="margin-top:0; margin-bottom:20px; font-size:18px; color:#111;">${isPaused ? '暫停詳情' : '預約詳情'}</h3>
                        <div style="margin-bottom:24px; text-align:left; font-size:15px; line-height:1.6; color:#374151; background:#f9fafb; padding:12px; border-radius:8px;">
                            <div><strong>日期：</strong>${item.date}</div>
                            <div><strong>時段：</strong>${item.startTime} ~ ${item.endTime}</div>
                            ${ !isPaused ? `<div><strong>預約人：</strong>${item.formattedBooker || item.bookerName}</div>` : '' }
                            ${ isPaused ? `<div><strong>狀態：</strong>暫停開放</div>` : '' }
                        </div>
                        <div style="display:flex; gap:12px; justify-content:center;">
                           <button id="btn-res-cancel" style="flex:1; padding:12px; background:#ef4444; border:none; border-radius:8px; cursor:pointer; font-weight:600; color:white; transition:all 0.2s;">${cancelBtnText}</button>
                        </div>
                        <div style="margin-top:16px;">
                            <button id="btn-res-close" style="background:none; border:none; color:#999; cursor:pointer; font-size:14px;">關閉</button>
                        </div>
                      </div>
                    `;
                    
                    modal.style.zIndex = "999999";
                    modal.classList.remove("hidden");
                    
                    const close = () => {
                        modal.classList.add("hidden");
                        modal.innerHTML = "";
                    };
                    
                    modal.querySelector("#btn-res-close").onclick = close;
                    modal.onclick = (e) => { if(e.target === modal) close(); };
                    
                    // Cancel Action (Handles both "Cancel Reservation" and "Cancel Suspension")
                    modal.querySelector("#btn-res-cancel").onclick = async () => {
                        close();
                        // If not paused (regular reservation), ask for confirmation.
                        // If paused (canceling suspension), do it directly without confirmation.
                        if (!isPaused) {
                            if(!confirm("確定要取消此預約嗎？")) return;
                        }
                        
                        try {
                            await deleteDoc(doc(db, "communities", slug, "reservations", resId));
                            renderAdminFacilityList(displayTitle, facilityKey);
                        } catch(e) {
                            console.error(e);
                            alert("操作失敗: " + e.message);
                        }
                    };
                } else {
                    if (!clickable) return;
                    const startTime = btn.dataset.start;
                    const endTime = btn.dataset.end;
                    
                    // Show Choice Modal (Suspend vs Reserve)
                    const modalId = "slot-action-modal";
                    let modal = document.getElementById(modalId);
                    if (!modal) {
                        modal = document.createElement("div");
                        modal.id = modalId;
                        modal.className = "modal hidden";
                        document.body.appendChild(modal);
                    }
                    if (modal.parentNode !== document.body) document.body.appendChild(modal);
                    
                    modal.innerHTML = `
                      <div class="modal-box" style="width:300px; padding:24px; text-align:center; background:white; border-radius:12px; box-shadow:0 10px 25px -5px rgba(0,0,0,0.1); position:relative; z-index:10;">
                        <h3 style="margin-top:0; margin-bottom:24px; font-size:18px; color:#111;">請選擇操作</h3>
                        <div style="display:flex; gap:12px; justify-content:center;">
                           <button id="btn-slot-suspend" style="flex:1; padding:12px; background:#f3f4f6; border:1px solid #e5e7eb; border-radius:8px; cursor:pointer; font-weight:600; color:#4b5563; transition:all 0.2s;">暫停</button>
                           <button id="btn-slot-reserve" style="flex:1; padding:12px; background:#3b82f6; border:none; border-radius:8px; cursor:pointer; font-weight:600; color:white; transition:all 0.2s;">預約</button>
                        </div>
                        <div style="margin-top:16px;">
                            <button id="btn-slot-cancel" style="background:none; border:none; color:#999; cursor:pointer; font-size:14px;">取消</button>
                        </div>
                      </div>
                    `;
                    
                    modal.style.zIndex = "999999";
                    modal.classList.remove("hidden");
                    
                    const close = () => {
                        modal.classList.add("hidden");
                        modal.innerHTML = "";
                    };
                    
                    modal.querySelector("#btn-slot-cancel").onclick = close;
                    modal.onclick = (e) => { if(e.target === modal) close(); };
                    
                    // Reserve Action
                    modal.querySelector("#btn-slot-reserve").onclick = () => {
                        close();
                        openFacilityReservationModal({
                            date: selectedDate,
                            startTime: startTime,
                            endTime: endTime
                        }, displayTitle, slug, facilityKey, true, config);
                    };
                    
                    // Suspend Action
                    modal.querySelector("#btn-slot-suspend").onclick = async () => {
                        close();
                        // if(!confirm("確定要暫停此時段嗎？")) return; // User flow suggests direct action or minimal friction
                        try {
                             const data = {
                                facility: facilityKey,
                                date: selectedDate,
                                startTime: startTime,
                                endTime: endTime,
                                bookerName: "暫停",
                                status: "已預約",
                                note: "管理員暫停開放",
                                createdAt: Date.now(),
                                updatedAt: Date.now()
                            };
                            await addDoc(collection(db, "communities", slug, "reservations"), data);
                            renderAdminFacilityList(displayTitle, facilityKey);
                        } catch(e) {
                            console.error(e);
                            alert("操作失敗: " + e.message);
                        }
                    };
                }
            });
        });

        // Preview Button
        const btnPreview = document.getElementById("btn-preview-res");
        if(btnPreview) {
            btnPreview.addEventListener("click", () => {
                // Use extensionless URL to avoid redirect stripping params
                // Also add hash params as backup in case redirect strips query params
                // Only pass communityName if it exists, otherwise let preview page fetch it. Avoid passing "健身房".
                const nameToPass = (communityName === "健身房") ? "" : communityName;
                const baseParams = `c=${slug}&cn=${encodeURIComponent(nameToPass)}`;
                const params = `${baseParams}&v=20260127-5`;
                // Fix: use .html for compatibility with local http-server
                const url = `${window.location.origin}/preview-facility.html?${params}#${baseParams}`;
                
                let modal = document.getElementById("sys-modal");
                if (!modal) {
                    modal = document.createElement("div");
                    modal.id = "sys-modal";
                    modal.className = "modal hidden";
                    document.body.appendChild(modal);
                }
                if (modal.parentNode !== document.body) {
                    document.body.appendChild(modal);
                }
                
                modal.innerHTML = `
                  <div class="modal-box" style="width:400px; max-width:90%; background:white; padding:20px; border-radius:8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); position:relative; z-index:10;">
                    <h3 style="margin-top:0; margin-bottom:16px; font-size:18px; font-weight:600;">設施預覽</h3>
                    <div style="margin-bottom:20px;">
                        <label style="display:block; font-size:12px; color:#666; margin-bottom:4px;">預覽網址</label>
                        <input type="text" value="${url}" readonly style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px; background:#f9fafb; font-size:14px;">
                    </div>
                    <div style="margin-bottom:20px; border:1px solid #ddd; border-radius:4px; height:300px; overflow:hidden;">
                        <iframe src="${url}" style="width:100%; height:100%; border:none;"></iframe>
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:12px;">
                      <button id="preview-cancel" style="padding:8px 16px; background:#f3f4f6; border:none; border-radius:6px; cursor:pointer; font-weight:500;">取消</button>
                      <button id="preview-go" style="padding:8px 16px; background:#ef4444; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:500;">前往</button>
                    </div>
                  </div>
                `;
                
                modal.style.zIndex = "999999";
                modal.classList.remove("hidden");
                
                const close = () => {
                     modal.classList.add("hidden");
                     modal.innerHTML = "";
                };

                modal.querySelector("#preview-cancel").onclick = close;
                modal.querySelector("#preview-go").onclick = () => {
                    window.open(url, '_blank');
                    close();
                };
                
                modal.onclick = (e) => {
                     if(e.target === modal) close();
                };
            });
        }

        // Create Button
        const btnCreate = document.getElementById("btn-create-res");
        if(btnCreate) {
            btnCreate.addEventListener("click", () => {
                // Pass selectedDate as default
                openFacilityReservationModal({date: selectedDate}, displayTitle, slug, facilityKey, true, config);
            });
        }

        // Table Actions
        document.querySelectorAll(".btn-checkin-res").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.closest("tr").getAttribute("data-id");
                
                try {
                    // 1. Get item and config
                    const item = items.find(i => i.id === id);
                    if (!item) throw new Error("找不到預約資料");
                    
                    const cost = parseInt(config.cost || 0);
                    let houseNo = "";
                    let subNo = "無";
                    let currentPoints = 0;
                    let balanceRef = null;
                    let pointsRef = null;
                    let isPointsFound = false;

                    // 2. Prepare user and points data
                    const booker = item.bookerName || "";
                    let userName = "未知";
                    
                    // Robust extraction logic
                    houseNo = booker;
                    let extractedSubNo = null;

                    // 1. Try A001-1 or A001-1-Name pattern (Case Insensitive)
                    let m = booker.match(/([A-Za-z0-9]+)-(\d+)/);
                    if (m) {
                        houseNo = m[1];
                        extractedSubNo = m[2];
                        subNo = extractedSubNo;
                    } else {
                        // 2. Try parens extraction: (A001-1) or (A001)
                        m = booker.match(/\(([^)]+)\)/);
                        if (m) {
                            const content = m[1];
                            const mInner = content.match(/([A-Z0-9]+)-(\d+)/);
                            if (mInner) {
                                houseNo = mInner[1];
                                extractedSubNo = mInner[2];
                                subNo = extractedSubNo;
                            } else {
                                houseNo = content;
                            }
                        }
                    }
                    houseNo = houseNo.trim();

                    // Resolve canonical HouseNo and SubNo from DB if possible
                    try {
                        // Try finding user by HouseNo first
                        let qUser = query(collection(db, "users"), where("houseNo", "==", houseNo));
                        let snapUser = await getDocs(qUser);
                        let targetUser = null;
                        
                        // If not found by HouseNo, try DisplayName
                        if (snapUser.empty) {
                            qUser = query(collection(db, "users"), where("displayName", "==", houseNo));
                            snapUser = await getDocs(qUser);
                        }
                        
                        if (!snapUser.empty) {
                            let candidates = snapUser.docs.map(d => d.data());
                            
                            // Filter by community if possible
                            if (slug && slug !== "default") {
                                candidates = candidates.filter(d => d.community === slug);
                            }
                            
                            // Filter by extracted subNo if available
                            if (extractedSubNo) {
                                const match = candidates.find(d => String(d.subNo) === String(extractedSubNo));
                                if (match) targetUser = { data: () => match };
                            }
                            
                            if (!targetUser && candidates.length > 0) {
                                targetUser = { data: () => candidates[0] };
                            }
                            
                            if (targetUser) {
                                const d = targetUser.data();
                                if (d.houseNo) {
                                    console.log(`[CheckIn] Resolved '${houseNo}' to canonical HouseNo '${d.houseNo}'`);
                                    houseNo = d.houseNo;
                                }
                                if (d.subNo !== undefined && d.subNo !== null && d.subNo !== "") {
                                    subNo = d.subNo;
                                }
                                userName = d.name || d.realName || d.displayName || "住戶";
                            }
                        }
                    } catch(e) {
                        console.warn("[CheckIn] User resolution failed", e);
                    }

                    if (houseNo) {
                         // Try path 1: communities/{slug}/points_balances/{houseNo} (Individual Doc)
                         try {
                             const ref = doc(db, "communities", slug, "points_balances", houseNo);
                             const bDoc = await getDoc(ref);
                             if (bDoc.exists()) {
                                 currentPoints = bDoc.data().balance || 0;
                                 balanceRef = ref;
                                 isPointsFound = true;
                             }
                         } catch(e) { console.warn("Check-in: Path 1 failed", e); }

                         if (!isPointsFound) {
                             // Try path 2: communities/{slug}/app_modules/points (Aggregated Doc)
                             try {
                                 const ref = doc(db, "communities", slug, "app_modules", "points");
                                 const pDoc = await getDoc(ref);
                                 if (pDoc.exists()) {
                                     const data = pDoc.data();
                                     const balances = data.balances || {};
                                     if (typeof balances[houseNo] !== 'undefined') {
                                         currentPoints = balances[houseNo];
                                         isPointsFound = true;
                                     }
                                     pointsRef = ref;
                                 }
                             } catch(e) { console.warn("Check-in: Path 2 failed", e); }
                         }
                    }

                    // 2.5 Handle Cancel Check-in
                    if (item.status === "已報到") {
                         const modal = document.getElementById("sys-modal");
                         if (!modal) return;

                         modal.innerHTML = `
                           <div class="modal-card" style="position: relative; z-index: 10; background: #fff; width: 90%; max-width: 360px; border-radius: 16px; padding: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                             <h3 class="modal-title" style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #111;">取消報到驗證</h3>
                             <div style="margin-bottom: 20px; font-size: 15px; color: #374151;">
                                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                                  <span style="color:#6b7280;">戶號</span>
                                  <span style="font-weight:600;">${houseNo || item.bookerName}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                                  <span style="color:#6b7280;">將退還點數</span>
                                  <span style="font-weight:600; color:#10b981;">+${cost}</span>
                                </div>
                                
                                <label style="display:block; margin-bottom:8px; font-weight:500;">請輸入取消密碼</label>
                                <input type="password" id="cancel-password" placeholder="預設為今日日期YYYYMMDD" style="width:100%; padding:10px; border:1px solid #d1d5db; border-radius:6px; font-size:16px;">
                                <div id="cancel-error" style="color:#ef4444; font-size:13px; margin-top:4px; display:none;">密碼錯誤</div>
                             </div>
                             <div class="modal-actions" style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
                                <button class="btn" id="btn-cancel-close" style="padding: 8px 16px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; cursor: pointer;">取消</button>
                                <button class="btn primary" id="btn-cancel-confirm" style="padding: 8px 16px; background: #ef4444; color: #fff; border: none; border-radius: 6px; cursor: pointer;">確定取消</button>
                             </div>
                           </div>
                         `;
                         
                         modal.style.zIndex = "999999";
                         modal.classList.remove("hidden");
                         
                         // Focus input
                         setTimeout(() => {
                             const input = modal.querySelector("#cancel-password");
                             if(input) input.focus();
                         }, 100);

                         const closeCancelModal = () => {
                             modal.classList.add("hidden");
                             modal.style.zIndex = "";
                             modal.innerHTML = "";
                         };

                         modal.querySelector("#btn-cancel-close").onclick = closeCancelModal;

                         modal.querySelector("#btn-cancel-confirm").onclick = async () => {
                             const passwordInput = modal.querySelector("#cancel-password");
                             const errorMsg = modal.querySelector("#cancel-error");
                             const password = passwordInput.value;
                             
                             const today = new Date();
                             const yyyy = today.getFullYear();
                             const mm = String(today.getMonth() + 1).padStart(2, '0');
                             const dd = String(today.getDate()).padStart(2, '0');
                             const defaultPwd = `${yyyy}${mm}${dd}`;

                             if (password !== defaultPwd) {
                                 errorMsg.style.display = "block";
                                 passwordInput.style.borderColor = "#ef4444";
                                 return;
                             }

                             const btnConfirm = modal.querySelector("#btn-cancel-confirm");
                             btnConfirm.disabled = true;
                             btnConfirm.textContent = "處理中...";

                             try {
                                 // 1. Refund points
                                 if (cost > 0 && isPointsFound) {
                                     if (balanceRef && !pointsRef) {
                                        await updateDoc(balanceRef, { balance: currentPoints + cost });
                                        await syncPointsToUsers(slug, houseNo, currentPoints + cost);
                                    } else if (pointsRef) {
                                        const pDoc = await getDoc(pointsRef);
                                        if (pDoc.exists()) {
                                            const data = pDoc.data();
                                            const balances = data.balances || {};
                                            balances[houseNo] = currentPoints + cost;
                                            await updateDoc(pointsRef, { balances: balances });
                                            await syncPointsToUsers(slug, houseNo, currentPoints + cost);
                                        }
                                    }
                                     
                                     // Add Log
                                     try {
                                         const auth = getAuth();
                                         const user = auth.currentUser;
                                         const operatorName = user ? (user.displayName || user.email || "管理員") : "管理員";
                                         const operator = user ? (user.email || user.uid) : "未知";

                                         // Log to collection
                                         try {
                                             await addDoc(collection(db, "communities", slug, "points_logs"), {
                                                 createdAt: Date.now(),
                                                 delta: cost,
                                                 reason: `取消報到退款: ${displayTitle}`,
                                                 houseNo: houseNo,
                                                 operator: operator,
                                                 operatorName: operatorName
                                             });
                                         } catch(e) { console.warn("Log collection add failed", e); }

                                         // Log to document
                                         const pointsDocRef = doc(db, "communities", slug, "app_modules", "points");
                                         let prev = {};
                                         try {
                                             const psnap = await getDoc(pointsDocRef);
                                             if (psnap.exists()) prev = psnap.data() || {};
                                         } catch {}
                                         
                                         const logs = Array.isArray(prev.logs) ? prev.logs.slice() : [];
                                         logs.push({
                                             houseNo,
                                             reason: `取消報到退款: ${displayTitle}`,
                                             delta: cost,
                                             operator,
                                             operatorName,
                                             createdAt: Date.now()
                                         });
                                         await setDoc(pointsDocRef, { logs: logs }, { merge: true });
                                     } catch(e) { console.warn("Failed to add log", e); }
                                 }

                                 // 2. Update Status
                                 await updateDoc(doc(db, "communities", slug, "reservations", id), {
                                     status: "已預約",
                                     updatedAt: Date.now()
                                 });

                                 // 3. Reload
                                 const ref = collection(db, "communities", slug, "reservations");
                                 const q = query(ref, where("facility", "==", facilityKey));
                                 const snap = await getDocs(q);
                                 items = snap.docs.map(d => ({id: d.id, ...d.data()}));
                                 items.sort((a,b) => {
                                     const dateA = a.date + (a.startTime || "");
                                     const dateB = b.date + (b.startTime || "");
                                     return dateA.localeCompare(dateB);
                                 });
                                 renderUI();
                                 
                                 showHint(`已取消報到${cost > 0 ? `並退還 ${cost} 點` : ""}`, "success");
                                 closeCancelModal();

                             } catch(e) {
                                 console.error(e);
                                 alert("取消報到失敗: " + e.message);
                                 btnConfirm.disabled = false;
                                 btnConfirm.textContent = "確定取消";
                             }
                         };
                         return;
                    }

                    // 3. Show detailed confirmation modal
                    const modal = document.getElementById("sys-modal");
                    if (!modal) {
                         if(!confirm(`確認報到？\n戶號: ${houseNo}\n扣點: ${cost}`)) return;
                         // Fallback if modal missing (should not happen)
                         executeCheckIn();
                         return;
                    }

                    const newBalance = isPointsFound ? (currentPoints - cost) : null;
                    const isInsufficient = (cost > 0 && isPointsFound && currentPoints < cost);

                    modal.innerHTML = `
                      <div class="modal-card" style="position: relative; z-index: 10; background: #fff; width: 90%; max-width: 360px; border-radius: 16px; padding: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                        <h3 class="modal-title" style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #111;">設施預約報到確認</h3>
                        <div style="margin-bottom: 20px; font-size: 15px; color: #374151;">
                           <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                             <span style="color:#6b7280;">戶號</span>
                             <span style="font-weight:600;">${houseNo || item.bookerName}</span>
                           </div>
                           <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                             <span style="color:#6b7280;">子戶號</span>
                             <span style="font-weight:600;">${subNo}</span>
                           </div>
                           <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                             <span style="color:#6b7280;">姓名</span>
                             <span style="font-weight:600;">${userName}</span>
                           </div>
                           <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                             <span style="color:#6b7280;">該戶點數</span>
                             <span style="font-weight:600; color:${isPointsFound ? '#2563eb' : '#9ca3af'}">${isPointsFound ? currentPoints : (houseNo ? "未找到 (0)" : "未知")}</span>
                           </div>
                           
                           <div style="border-top: 1px dashed #e5e7eb; margin: 8px 0;"></div>
                           
                           <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                             <span style="color:#6b7280;">預約設施</span>
                             <span>${displayTitle}</span>
                           </div>
                           <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                             <span style="color:#6b7280;">日期時段</span>
                             <span style="font-size:13px; text-align:right;">${item.date}<br>${item.startTime}~${item.endTime}</span>
                           </div>
                           
                           <div style="background:#f9fafb; padding:12px; border-radius:8px;">
                             <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                                <span>本次扣點</span>
                                <span style="font-weight:700; color:#ef4444;">-${cost}</span>
                             </div>
                             ${cost > 0 ? `
                             <div style="display:flex; justify-content:space-between; border-top:1px solid #e5e7eb; padding-top:4px; margin-top:4px;">
                                <span>扣除後點數</span>
                                <span style="font-weight:700; color:${isPointsFound && (currentPoints-cost)>=0 ? '#10b981' : '#ef4444'}">
                                  ${isPointsFound ? (currentPoints - cost) : "無法計算"}
                                </span>
                             </div>
                             ` : '<div style="text-align:right; font-size:12px; color:#10b981;">(本次免費)</div>'}
                           </div>
                           
                           ${isInsufficient ? `<div style="margin-top:8px; color:#ef4444; font-size:13px; font-weight:600;">⚠️ 點數不足，無法扣點 (仍可強制報到)</div>` : ''}
                           ${(cost > 0 && !isPointsFound) ? `<div style="margin-top:8px; color:#f59e0b; font-size:13px;">⚠️ 找不到點數資料，將不執行扣點</div>` : ''}
                        </div>
                        <div class="modal-actions" style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
                           <button class="btn" id="btn-modal-cancel" style="padding: 8px 16px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; cursor: pointer;">取消</button>
                           <button class="btn primary" id="btn-modal-confirm" style="padding: 8px 16px; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer;">確定報到</button>
                        </div>
                      </div>
                    `;
                    
                    modal.style.zIndex = "999999";
                    modal.classList.remove("hidden");
                    
                    const close = () => {
                        modal.classList.add("hidden");
                        modal.style.zIndex = "";
                        modal.innerHTML = "";
                    };
                    
                    modal.querySelector("#btn-modal-cancel").onclick = close;
                    
                    modal.querySelector("#btn-modal-confirm").onclick = async () => {
                        const btnConfirm = modal.querySelector("#btn-modal-confirm");
                        btnConfirm.disabled = true;
                        btnConfirm.textContent = "處理中...";
                        
                        try {
                            await executeCheckIn();
                            close();
                        } catch(e) {
                            console.error(e);
                            alert("報到失敗: " + e.message);
                            btnConfirm.disabled = false;
                            btnConfirm.textContent = "確定報到";
                        }
                    };

                    async function executeCheckIn() {
                        // 4. Deduct points if cost > 0 and points found
                        if (cost > 0 && isPointsFound) {
                            // Note: We allow negative balance or check-in without deduction if decided, 
                            // but currently we just deduct. 
                            // If insufficient, it goes negative? Or we block?
                            // User didn't specify blocking, but usually we allow with warning.
                            // The modal shows warning. We proceed.

                            if (balanceRef && !pointsRef) {
                                await updateDoc(balanceRef, { balance: currentPoints - cost });
                                await syncPointsToUsers(slug, houseNo, currentPoints - cost);
                            } else if (pointsRef) {
                                 // Re-fetch to ensure data consistency
                                 const pDoc = await getDoc(pointsRef);
                                 if (pDoc.exists()) {
                                     const data = pDoc.data();
                                     const balances = data.balances || {};
                                     balances[houseNo] = currentPoints - cost;
                                     await updateDoc(pointsRef, { balances: balances });
                                     await syncPointsToUsers(slug, houseNo, currentPoints - cost);
                                 }
                            }

                            // Add Log
                            try {
                                const auth = getAuth();
                                const user = auth.currentUser;
                                const operatorName = user ? (user.displayName || user.email || "管理員") : "管理員";
                                const operator = user ? (user.email || user.uid) : "未知";
                                
                                // 1. Try adding to collection
                                try {
                                    await addDoc(collection(db, "communities", slug, "points_logs"), {
                                        createdAt: Date.now(),
                                        delta: -cost,
                                        reason: `設施預約: ${displayTitle}`,
                                        houseNo: houseNo,
                                        operator: operator,
                                        operatorName: operatorName
                                    });
                                } catch(e) { console.warn("Log collection add failed", e); }
                                
                                // 2. Write to 'points' document logs array
                                const pointsDocRef = doc(db, "communities", slug, "app_modules", "points");
                                let prev = {};
                                try {
                                    const psnap = await getDoc(pointsDocRef);
                                    if (psnap.exists()) prev = psnap.data() || {};
                                } catch {}
                                
                                const logs = Array.isArray(prev.logs) ? prev.logs.slice() : [];
                                logs.push({
                                    houseNo,
                                    reason: `設施預約: ${displayTitle}`,
                                    delta: -cost,
                                    operator,
                                    operatorName,
                                    createdAt: Date.now()
                                });
                                
                                await setDoc(pointsDocRef, { logs: logs }, { merge: true });
                                
                            } catch(e) {
                                console.error("Failed to add points log", e);
                            }
                        }

                        // 5. Update status
                        await updateDoc(doc(db, "communities", slug, "reservations", id), {
                            status: "已報到",
                            updatedAt: Date.now()
                        });
                        
                        // Reload data
                        const ref = collection(db, "communities", slug, "reservations");
                        const q = query(ref, where("facility", "==", facilityKey));
                        const snap = await getDocs(q);
                        items = snap.docs.map(d => ({id: d.id, ...d.data()}));
                        items.sort((a,b) => {
                            const dateA = a.date + (a.startTime || "");
                            const dateB = b.date + (b.startTime || "");
                            return dateA.localeCompare(dateB);
                        });
                        renderUI();
                        
                        if (cost > 0 && isPointsFound) showHint(`報到成功，已扣除 ${cost} 點`, "success");
                        else if (cost > 0 && !isPointsFound) showHint("報到成功 (未扣點：無點數資料)", "warning");
                        else showHint("報到成功", "success");
                    }

                    
                } catch(err) {
                    console.error(err);
                    alert("報到失敗: " + err.message);
                }
            });
        });

        document.querySelectorAll(".btn-edit-res").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.closest("tr").getAttribute("data-id");
                const item = items.find(i => i.id === id);
                openFacilityReservationModal(item, displayTitle, slug, facilityKey, false, config);
            });
        });

        document.querySelectorAll(".btn-delete-res").forEach(btn => {
            btn.addEventListener("click", async () => {
                if(!confirm("確定要刪除此預約嗎？")) return;
                const id = btn.closest("tr").getAttribute("data-id");
                try {
                    await deleteDoc(doc(db, "communities", slug, "reservations", id));
                    // Reload data and render
                    const ref = collection(db, "communities", slug, "reservations");
                    const q = query(ref, where("facility", "==", facilityKey));
                    const snap = await getDocs(q);
                    items = snap.docs.map(d => ({id: d.id, ...d.data()}));
                    items.sort((a,b) => {
                        const dateA = a.date + (a.startTime || "");
                        const dateB = b.date + (b.startTime || "");
                        return dateA.localeCompare(dateB);
                    });
                    renderUI();
                } catch(err) {
                    console.error(err);
                    alert("刪除失敗");
                }
            });
        });
    };

    const generateCalendarHTML = () => {
        const firstDay = new Date(currentYear, currentMonth, 1).getDay();
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        let html = "";
        
        // Empty slots for previous month
        for(let i=0; i<firstDay; i++) {
            html += `<div class="cal-day other-month"></div>`;
        }
        
        // Days
        const todayStr = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
        
        for(let d=1; d<=daysInMonth; d++) {
            const dateStr = formatDate(currentYear, currentMonth, d);
            const isSelected = dateStr === selectedDate;
            const isToday = dateStr === todayStr;
            const isPast = dateStr < todayStr;
            const hasRes = items.some(i => i.date === dateStr);
            
            let classes = "cal-day";
            if(isSelected) classes += " active";
            if(isToday) classes += " today";
            if(hasRes) classes += " has-res";
            
            let style = "";
            if(isPast) {
                style = 'style="background-color: #f3f4f6; color: #9ca3af;"'; 
                // Using a lighter gray for background (#f3f4f6) and gray text (#9ca3af) to indicate past but not too dark
                // User said "dark gray background" (深灰色底). 
                // Let's use a darker gray if they asked for it. 
                // Previous slot was #555 (dark). 
                // Calendar background is usually white. 
                // If I make it #555 it might look like the slot button.
                // Let's try #e5e7eb (gray-200) or #d1d5db (gray-300).
                // Or #555 as requested? "身灰色" usually means deep gray.
                style = 'style="background-color: #555; color: #ccc; border-color: #444;"';
            }

            html += `<div class="${classes}" data-date="${dateStr}" ${style}>${d}</div>`;
        }
        return html;
    };

    const generateScheduleHTML = () => {
        const dayItems = items.filter(i => i.date === selectedDate);
        
        const openTime = config.openTime || "06:00";
        const closeTime = config.closeTime || "22:00";
        const unit = parseInt(config.timeUnit || "1");

        const slots = [];
        let [startH, startM] = openTime.split(':').map(Number);
        const [endH, endM] = closeTime.split(':').map(Number);
        
        let currentH = startH;
        let currentM = startM;

        while (true) {
            let nextH = currentH + unit;
            let nextM = currentM;
            
            // Check if exceeds closeTime
            if (nextH > endH || (nextH === endH && nextM > endM)) break;

            const formatTime = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
            const sTime = formatTime(currentH, currentM);
            const eTime = formatTime(nextH, nextM);
            
            // Find reservation - CHANGED to filter to support multiple reservations per slot
            // Exclude cancelled reservations so they appear as available slots
            const resList = dayItems.filter(i => i.startTime === sTime && (i.status !== 'cancelled' && i.status !== '已取消'));
            
            slots.push({
                sTime,
                eTime,
                resList
            });

            currentH = nextH;
            currentM = nextM;
        }

        if (slots.length === 0) return `<div style="text-align:center; color:#999; padding:20px;">無時段設定</div>`;

        // Current date/time for past/current slot computation
        const now = new Date();
        const ty = now.getFullYear();
        const tm = String(now.getMonth() + 1).padStart(2, '0');
        const td = String(now.getDate()).padStart(2, '0');
        const todayStr = `${ty}-${tm}-${td}`;
        const nowTimeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        const isPastDate = selectedDate < todayStr;
        const isToday = selectedDate === todayStr;

        return slots.map(slot => {
            const label = `${slot.sTime}~${slot.eTime}`;
            
            const renderButton = (res) => {
                const isReserved = !!res;
                
                let style = "width:100%; margin-bottom:2px; display:block; padding:5px; border-radius:4px; transition:all 0.2s; font-size:14px; text-align:left;";
                let clickable = true;
                if (isReserved) {
                    const s = res.status || "valid";
                    const isCheckedIn = (s === "checked_in" || s === "已報到");
                    const isCancelled = (s === "cancelled" || s === "已取消");
                    const isExpired = isPastDate || (isToday && slot.eTime <= nowTimeStr);

                    if (res.bookerName === "暫停") {
                        style += "background-color: #4b5563; color: white; border: 1px solid #374151; cursor:not-allowed;";
                        clickable = false;
                    } else if (isExpired && !isCheckedIn && !isCancelled) {
                        // No Show -> Light Orange, Not Clickable
                        style += "background-color: #ffedd5; color: #9a3412; border: 1px solid #fed7aa; cursor:not-allowed;";
                        clickable = false;
                    } else {
                        style += "background-color: #e3f2fd; color: #1565c0; border: 1px solid #bbdefb; cursor:pointer;";
                        // Reserved slots open details; keep clickable for admin actions
                        clickable = true;
                    }
                } else {
                    if (isPastDate || (isToday && (slot.eTime <= nowTimeStr))) {
                        // Past slot (date past) or time already passed today -> deep gray, not clickable
                        style += "background-color: #555; color: #ccc; border: 1px solid #444; cursor:not-allowed;";
                        clickable = false;
                    } else if (isToday && (slot.sTime <= nowTimeStr) && (nowTimeStr < slot.eTime)) {
                        // Current ongoing slot -> yellow and clickable
                        style += "background-color: #fef08a; color: #854d0e; border: 1px solid #eab308; cursor:pointer;";
                        clickable = true;
                    } else {
                        // Future slot -> default styling
                        style += "background-color: #f5f5f5; color: #333; border: 1px solid #ddd; cursor:pointer;";
                        clickable = true;
                    }
                }
                
                const info = isReserved ? ` <span style="font-size:12px; opacity:0.8;">${res.formattedBooker || formatBookerName(res.bookerName)}</span>` : "";

                return `<button class="slot-btn" style="${style}" data-start="${slot.sTime}" data-end="${slot.eTime}" data-res-id="${isReserved ? res.id : ''}" data-clickable="${clickable ? 'true' : 'false'}">
                    ${label}${info}
                </button>`;
            };

            if (slot.resList && slot.resList.length > 0) {
                return slot.resList.map(res => renderButton(res)).join("");
            } else {
                return renderButton(null);
            }
        }).join("");
    };

    const formatBookerName = (name) => {
        if (!name) return "";
        // Handle "本人(A001-1)" -> "A001-1" (Strip "本人")
        const m = name.match(/^本人\(([^)]+)\)$/);
        if (m) {
            return `${m[1]}`;
        }
        // Handle "(A001-1) Name" -> "A001-1-Name"
        const m2 = name.match(/^\(([^)]+)\)\s*(.+)$/);
        if (m2) {
            return `${m2[1]}-${m2[2]}`;
        }
        // Handle "Name(A001-1)" -> "A001-1-Name"
        const m3 = name.match(/^(.+)\(([^)]+)\)$/);
        if (m3) {
            return `${m3[2]}-${m3[1]}`;
        }
        // Handle "(A001-1)" -> "A001-1" (No Name)
        const m4 = name.match(/^\(([^)]+)\)$/);
        if (m4) {
            return m4[1];
        }
        return name;
    };

    const generateTableHTML = () => {
        // Current time for expiry check
        const now = new Date();
        const ty = now.getFullYear();
        const tm = String(now.getMonth() + 1).padStart(2, '0');
        const td = String(now.getDate()).padStart(2, '0');
        const todayStr = `${ty}-${tm}-${td}`;
        const nowTimeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

        // Show all items, but exclude "paused" items (bookerName === "暫停")
        return items
            .filter(item => item.bookerName !== "暫停")
            .map(item => {
                // Status Mapping and Coloring
                // Default: Valid/Reserved -> Light Blue
                let statusText = "已預約";
                let rowBg = "#e0f2fe"; // Light Blue
                
                const s = item.status || "valid";
                const isExpired = (item.date < todayStr) || (item.date === todayStr && item.endTime <= nowTimeStr);
                
                if (s === "checked_in" || s === "已報到") {
                    statusText = "已報到";
                    rowBg = "#dcfce7"; // Light Green
                } else if (s === "cancelled" || s === "已取消") {
                    statusText = "已取消";
                    rowBg = "#fee2e2"; // Light Red
                } else if (s === "no_show" || s === "未報到") {
                    statusText = "未報到";
                    rowBg = "#ffedd5"; // Light Orange
                } else if (isExpired && (s === "valid" || s === "已預約")) {
                    statusText = "未報到";
                    rowBg = "#ffedd5"; // Light Orange
                }

                const rowStyle = `background:${rowBg};`;
                
                return `
                    <tr data-id="${item.id}" style="${rowStyle}">
                        <td>${item.date}</td>
                        <td>${item.startTime} - ${item.endTime}</td>
                        <td>${item.formattedBooker || formatBookerName(item.bookerName)}</td>
                        <td>${statusText}</td>
                        <td class="actions">
                            ${(() => {
                                const isCheckedIn = (statusText === "已報到");
                                const isCancelled = (statusText === "已取消");
                                const isNoShow = (statusText === "未報到");
                                
                                if (isCancelled || isNoShow) {
                                    return `<span style="color:#6b7280; font-size:13px; margin-right:8px;">無操作</span>`;
                                }
                                
                                return `<button class="btn small action-btn btn-checkin-res" ${isCheckedIn ? 'style="background:#6b7280;color:white;"' : 'style="background:#10b981;color:white;"'}>${isCheckedIn ? '取消報到' : '報到'}</button>`;
                            })()}
                            <button class="btn small action-btn btn-edit-res">編輯</button>
                            <button class="btn small action-btn danger btn-delete-res">刪除</button>
                        </td>
                    </tr>
                `;
            }).join("");
    };

    // Real-time listener for reservations
    try {
        const ref = collection(db, "communities", slug, "reservations");
        const q = query(ref, where("facility", "==", facilityKey));
        
        window.adminReservationsUnsub = onSnapshot(q, async (snap) => {
            items = snap.docs.map(d => ({id: d.id, ...d.data()}));
            
            // Sort by date/time desc
            items.sort((a,b) => {
                const dateA = a.date + (a.startTime || "");
                const dateB = b.date + (b.startTime || "");
                return dateA.localeCompare(dateB);
            });

            // Pre-fetch user names
            const houseNos = new Set();
            items.forEach(item => {
                 if (!item.bookerName || item.bookerName === "暫停") return;
                 const m = item.bookerName.match(/([A-Za-z0-9]+)-(\d+)/);
                 if (m) houseNos.add(m[1]);
            });
            
            const userMap = {};
            const hList = Array.from(houseNos);
            if (hList.length > 0) {
                const chunks = [];
                for (let i=0; i<hList.length; i+=10) chunks.push(hList.slice(i, i+10));
                for (const chunk of chunks) {
                    try {
                        const q = query(collection(db, "users"), where("community", "==", slug), where("houseNo", "in", chunk));
                        const usnap = await getDocs(q);
                        usnap.forEach(d => {
                            const u = d.data();
                            userMap[`${u.houseNo}-${u.subNo}`] = u.name || u.realName || u.displayName || "住戶";
                        });
                    } catch(e) { console.error("Error fetching users", e); }
                }
            }

            items.forEach(item => {
                if (!item.bookerName) { item.formattedBooker = ""; return; }
                if (item.bookerName === "暫停") { item.formattedBooker = "暫停"; return; }
                
                const m = item.bookerName.match(/([A-Za-z0-9]+)-(\d+)/);
                if (m) {
                    const h = m[1];
                    const s = m[2];
                    const name = userMap[`${h}-${s}`];
                    if (name) {
                        item.formattedBooker = `${h}-${s}-${name}`;
                    } else {
                        item.formattedBooker = `${h}-${s}`; 
                    }
                } else {
                    item.formattedBooker = item.bookerName;
                }
            });

            renderUI();
        }, (error) => {
            console.error("Reservation listener error:", error);
        });
    } catch (e) {
        console.error("Failed to setup reservation listener", e);
        renderUI(); // Render empty if failed
    }
  });
}

// Helper to sync points to user profile for easier reading
async function syncPointsToUsers(slug, houseNo, newBalance) {
    if (!slug || !houseNo) return;
    try {
        const q = query(collection(db, "users"), where("community", "==", slug), where("houseNo", "==", houseNo));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const updates = snap.docs.map(d => updateDoc(doc(db, "users", d.id), { points: newBalance }));
            await Promise.all(updates);
            console.log(`[SyncPoints] Updated ${updates.length} users in ${houseNo} to ${newBalance}`);
        }
    } catch (e) {
        console.warn("[SyncPoints] Failed to sync points to users", e);
    }
}

function openFacilityReservationModal(item, displayTitle, slug, facilityKey, isNewWithDate = false, config = {}) {
    // Ensure slug is valid
    if (!slug) {
        slug = window.currentAdminCommunitySlug || localStorage.getItem("adminCurrentCommunity") || "default";
        console.warn("Slug missing in openFacilityReservationModal, using fallback:", slug);
    }

    // isNewWithDate: item contains {date: "YYYY-MM-DD"} but is not a DB item
    const isEdit = !!(item && item.id);
    const title = isEdit ? `編輯預約` : `新增預約`;
    
    // Default values
    let defaultDate = "";
    if (isEdit) defaultDate = item.date;
    else if (isNewWithDate) defaultDate = item.date;
    else {
        const d = new Date();
        defaultDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    const cost = config.cost || 0;

    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">${title}</div></div>
        <div class="modal-body">
           <label class="field">
             <div class="field-head">日期</div>
             <div class="input-wrap"><input type="date" id="res-date" value="${defaultDate}"></div>
           </label>
           <div style="display:flex; gap:10px;">
               <label class="field" style="flex:1;">
                 <div class="field-head">開始時間</div>
                 <div class="input-wrap"><input type="time" id="res-start" value="${item && item.startTime ? item.startTime : "09:00"}"></div>
               </label>
               <label class="field" style="flex:1;">
                 <div class="field-head">結束時間</div>
                 <div class="input-wrap"><input type="time" id="res-end" value="${item && item.endTime ? item.endTime : "10:00"}"></div>
               </label>
           </div>
           <label class="field">
             <div class="field-head">預約人</div>
             <div class="input-wrap" style="display: flex; gap: 8px; align-items: stretch;">
               <input type="text" id="res-booker" value="${item && (item.formattedBooker || (item.bookerName ? formatBookerName(item.bookerName) : ""))}" placeholder="請輸入 QR Code 代碼" style="flex: 1;">
               <button type="button" class="btn small action-btn" id="btn-scan-qr" style="padding: 0 10px; display: flex; align-items: center; justify-content: center; height: auto;" title="掃碼輸入">
                 <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                   <rect width="5" height="5" x="3" y="3" rx="1" />
                   <rect width="5" height="5" x="16" y="3" rx="1" />
                   <rect width="5" height="5" x="3" y="16" rx="1" />
                   <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
                   <path d="M21 21v.01" />
                   <path d="M12 7v3a2 2 0 0 1-2 2H7" />
                   <path d="M3 12h.01" />
                   <path d="M12 3h.01" />
                   <path d="M12 16v.01" />
                   <path d="M16 12h1" />
                   <path d="M21 12v.01" />
                   <path d="M12 21v-1" />
                 </svg>
               </button>
             </div>
           </label>
           <div style="display:flex; gap:10px;">
               <label class="field" style="flex:1;">
                 <div class="field-head">該住戶點數</div>
                 <div class="input-wrap"><input type="number" id="res-points" value="" readonly style="background:#f5f5f5; color:#666;"></div>
               </label>
               <label class="field" style="flex:1;">
                 <div class="field-head">此設備須扣點數</div>
                 <div class="input-wrap"><input type="number" id="res-cost" value="${cost}" readonly style="background:#f5f5f5; color:#666;"></div>
               </label>
           </div>
           <label class="field">
             <div class="field-head">備註</div>
             <div class="input-wrap"><textarea id="res-note" rows="3" style="width:100%;border:1px solid #ddd;padding:8px;border-radius:8px;">${item && item.note ? item.note : ""}</textarea></div>
           </label>
        </div>
        <div class="modal-foot">
          <button class="btn action-btn" onclick="closeModal()">取消</button>
          <button class="btn action-btn primary" id="btn-save-res">儲存</button>
        </div>
      </div>
    `;
    openModal(body);

    // Fetch points logic
    const fetchPoints = async (queryStr) => {
        if(!queryStr) return;
        const ptsInput = document.getElementById("res-points");
        const statusDiv = document.getElementById("res-search-status") || (() => {
            const d = document.createElement("div");
            d.id = "res-search-status";
            d.style.fontSize = "12px";
            d.style.marginTop = "4px";
            ptsInput.parentNode.appendChild(d);
            return d;
        })();
        
        ptsInput.placeholder = "查詢中...";
        ptsInput.value = ""; // Clear previous value
        statusDiv.textContent = "正在搜尋...";
        statusDiv.style.color = "#666";
        
        console.log(`[FetchPoints] Searching for: "${queryStr}" (slug: "${slug}")`);

        try {
            let userDoc = null;
            let errorMsg = "";
            
            // Strategy: Search Global -> Prioritize Current Community -> Fallback to any match
            // Sequence: QR Code (Text) -> QR Code (Legacy) -> HouseNo -> DisplayName

            // 1. Try QR Code (qrCodeText)
            if (!userDoc) {
                try {
                    let q = query(collection(db, "users"), where("qrCodeText", "==", queryStr));
                    let snap = await getDocs(q);
                    if (!snap.empty) {
                        userDoc = snap.docs[0];
                        console.log("[FetchPoints] Found by qrCodeText");
                    }
                } catch (e) { console.warn("qrCodeText query error", e); }
            }

            // 2. Try QR Code (qrCode - Legacy/Alt)
            if (!userDoc) {
                try {
                    let q = query(collection(db, "users"), where("qrCode", "==", queryStr));
                    let snap = await getDocs(q);
                    if (!snap.empty) {
                        userDoc = snap.docs[0];
                        console.log("[FetchPoints] Found by qrCode");
                    }
                } catch (e) { console.warn("qrCode query error", e); }
            }

            // 3. Try HouseNo
            if (!userDoc) {
                try {
                    const q = query(collection(db, "users"), where("houseNo", "==", queryStr));
                    const snap = await getDocs(q);
                    if (!snap.empty) {
                        const targetSlug = (slug && slug !== "default") ? slug : "";
                        let match = null;
                        if (targetSlug) match = snap.docs.find(d => d.data().community === targetSlug);
                        if (!match) match = snap.docs[0];
                        userDoc = match;
                        if (userDoc) console.log("[FetchPoints] Found by HouseNo");
                    }
                } catch (e) { console.warn("HouseNo query error", e); }
            }

            // 4. Try Display Name
            if (!userDoc) {
                try {
                    const q = query(collection(db, "users"), where("displayName", "==", queryStr));
                    const snap = await getDocs(q);
                    if (!snap.empty) {
                        const targetSlug = (slug && slug !== "default") ? slug : "";
                        let match = null;
                        if (targetSlug) match = snap.docs.find(d => d.data().community === targetSlug);
                        if (!match) match = snap.docs[0];
                        userDoc = match;
                        if (userDoc) console.log("[FetchPoints] Found by DisplayName");
                    }
                } catch (e) { console.warn("DisplayName query error", e); }
            }
            
            if (userDoc) {
                const uData = userDoc.data();
                let points = 0;
                const houseNo = uData.houseNo;
                let community = uData.community; 

                // If community is missing, try to infer or default to current admin slug
                if (!community || community === "default") {
                    if (uData.address && uData.address.includes("上碧潭")) {
                         // Try to find community ID for "上碧潭"
                         try {
                             const commQ = query(collection(db, "communities"), where("name", "==", "上碧潭"), limit(1));
                             const commSnap = await getDocs(commQ);
                             if (!commSnap.empty) community = commSnap.docs[0].id;
                         } catch(e) {}
                    }
                }
                
                // Final Fallback: Use current admin slug if user has no community
                // This assumes if admin scans a user, that user belongs to admin's community
                if ((!community || community === "default") && slug && slug !== "default") {
                    console.log("[FetchPoints] User has no community, defaulting to current admin slug:", slug);
                    community = slug;
                }
                
                if (!community || community === "default") {
                     statusDiv.textContent = "錯誤：該用戶無社區資料";
                     statusDiv.style.color = "red";
                     ptsInput.placeholder = "資料異常(無社區)";
                     return;
                }

                // Fetch Points
                if (houseNo) {
                    let found = false;

                    // 0. Try User Doc (Optimization)
                    if (typeof uData.points === 'number') {
                        points = uData.points;
                        found = true;
                        console.log("[FetchPoints] Found points in user doc:", points);
                    }

                    if (!found) {
                        try {
                            // Correct path: communities/{community}/points_balances/{houseNo}
                            const bdoc = await getDoc(doc(db, `communities/${community}/points_balances/${houseNo}`));
                            if (bdoc.exists()) {
                                points = bdoc.data().balance || 0;
                                found = true;
                            }
                        } catch(e) { console.warn("FetchPoints: Path 1 failed", e); }
                    }
                    
                    if (!found) {
                        try {
                            const pdoc = await getDoc(doc(db, `communities/${community}/app_modules/points`));
                            if (pdoc.exists()) {
                                const data = pdoc.data();
                                const bmap = data.balances || {};
                                points = typeof bmap[houseNo] === "number" ? bmap[houseNo] : 0;
                            }
                        } catch(e) {}
                    }
                }

                ptsInput.value = points;
                
                // Update Booker Name
                // Always prefer HouseNo (Standard)
                // Format: HouseNo-SubNo-Name
                const name = uData.displayName || uData.realName || "住戶";
                const sub = (uData.subNo !== undefined && uData.subNo !== null) ? uData.subNo : "0";
                const finalName = houseNo ? `${houseNo}-${sub}-${name}` : (houseNo || name || queryStr);
                
                document.getElementById("res-booker").value = finalName;
                
                ptsInput.placeholder = "";
                statusDiv.textContent = `已找到：${uData.displayName || finalName} (點數: ${points})`;
                statusDiv.style.color = "green";
                
                console.log("Found user:", uData, "Points:", points);
            } else {
                ptsInput.value = "";
                ptsInput.placeholder = `查無此人: ${queryStr}`;
                statusDiv.textContent = "查無此人";
                statusDiv.style.color = "red";
                console.warn("[FetchPoints] No matching user found for:", queryStr);
                
                // Debug suggestion
                if (queryStr && queryStr.length > 10) {
                     console.log("Tip: Check if QR Code contains hidden characters or is a URL.");
                }
            }
        } catch(e) {
            console.error("Fetch points fatal error", e);
            ptsInput.value = "";
            ptsInput.placeholder = "查詢失敗";
            if(statusDiv) statusDiv.textContent = "系統錯誤";
        }
    };

    setTimeout(() => {
        const btnSave = document.getElementById("btn-save-res");
        const inpBooker = document.getElementById("res-booker");
        const btnScan = document.getElementById("btn-scan-qr");
        
        if (inpBooker) {
            // Trigger fetch on Blur
            inpBooker.addEventListener("blur", () => {
                const val = inpBooker.value.trim();
                if(val) fetchPoints(val);
            });
            // Trigger fetch on Enter key
            inpBooker.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    const val = inpBooker.value.trim();
                    if(val) fetchPoints(val);
                }
            });
            
            // Also fetch immediately if editing and value exists
            if (inpBooker.value) {
                fetchPoints(inpBooker.value.trim());
            }
        }
        
        if (btnScan) {
            btnScan.addEventListener("click", () => {
                openQRScanner();
            });
        }
        
        if(btnSave) {
            btnSave.addEventListener("click", async () => {
                const dateVal = document.getElementById("res-date").value;
                const startVal = document.getElementById("res-start").value;
                const endVal = document.getElementById("res-end").value;
                const bookerVal = document.getElementById("res-booker").value;
                const statusEl = document.getElementById("res-status");
                const statusVal = statusEl ? statusEl.value : (item && item.status ? item.status : "已預約");
                const paymentEl = document.getElementById("res-payment");
                const paymentVal = paymentEl ? paymentEl.value : (item && item.paymentStatus ? item.paymentStatus : "未扣點");
                const noteVal = document.getElementById("res-note").value;

                if (!dateVal || !startVal || !endVal || !bookerVal) {
                    alert("請填寫所有必填欄位");
                    return;
                }

                btnSave.disabled = true;
                btnSave.textContent = "檢查中...";

                // Check for overlaps
                try {
                    // Optimized query to avoid composite index requirement
                    // We fetch all reservations for this facility/date and filter status client-side
                    const q = query(
                        collection(db, "communities", slug, "reservations"),
                        where("facility", "==", facilityKey),
                        where("date", "==", dateVal)
                    );
                    const querySnapshot = await getDocs(q);
                    let hasOverlap = false;
                    let overlapBooker = "";
                    querySnapshot.forEach((doc) => {
                         if (isEdit && doc.id === item.id) return; // Skip self
                         const d = doc.data();
                         
                         // Filter cancelled reservations client-side
                         if (d.status === "已取消") return;

                         // Overlap if (NewStart < ExistingEnd) and (NewEnd > ExistingStart)
                         if (startVal < d.endTime && endVal > d.startTime) {
                             hasOverlap = true;
                             overlapBooker = d.bookerName;
                         }
                    });

                    if (hasOverlap) {
                        alert(`此時段已被 "${overlapBooker}" 預約，不可重複預約！`);
                        btnSave.disabled = false;
                        btnSave.textContent = "儲存";
                        return;
                    }
                } catch (e) {
                    console.error("Check overlap failed", e);
                    alert("檢查預約衝突失敗: " + e.message);
                    btnSave.disabled = false;
                    btnSave.textContent = "儲存";
                    return;
                }

                btnSave.textContent = "儲存中...";

                try {
                    const data = {
                        facility: facilityKey,
                        date: dateVal,
                        startTime: startVal,
                        endTime: endVal,
                        bookerName: bookerVal,
                        status: statusVal,
                        paymentStatus: paymentVal,
                        note: noteVal,
                        updatedAt: Date.now()
                    };

                    if (isEdit) {
                        await setDoc(doc(db, "communities", slug, "reservations", item.id), data, { merge: true });
                    } else {
                        data.createdAt = Date.now();
                        await addDoc(collection(db, "communities", slug, "reservations"), data);
                    }
                    closeModal();
                    renderAdminFacilityList(displayTitle, facilityKey);
                } catch(err) {
                    console.error(err);
                    alert("儲存失敗");
                    btnSave.disabled = false;
                    btnSave.textContent = "儲存";
                }
            });
        }
    }, 100);
}

function renderAdminMailInbox() {
  if (window.adminMailUnsub) {
    window.adminMailUnsub();
    window.adminMailUnsub = null;
  }

  const container = adminNav.content;
  if (!container) return;

  container.innerHTML = `
    <div class="card data-card">
      <div class="card-head">
        <h1 class="card-title">郵件包裹收件登記</h1>
        <div style="display:flex;gap:8px;">
           <button id="btn-add-mail" class="btn small action-btn">新增收件</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>登記時間</th>
              <th>戶號</th>
              <th>收件人</th>
              <th>類型</th>
              <th>物流/備註</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="mail-list-body">
            <tr><td colspan="7" style="text-align:center;padding:20px;">載入中...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("btn-add-mail").addEventListener("click", () => openMailModal());

  const slug = window.currentAdminCommunitySlug || new URLSearchParams(window.location.search).get("c") || localStorage.getItem("adminCurrentCommunity") || "default";

  const q = query(
    collection(db, "communities", slug, "mails"),
    orderBy("arrivedAt", "desc"),
    limit(100)
  );

  window.adminMailUnsub = onSnapshot(q, (snap) => {
    const list = snap.docs.map(d => ({id: d.id, ...d.data()}));
    renderMailTable(list);
  }, (err) => {
    console.error(err);
    const tbody = document.getElementById("mail-list-body");
    if(tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:red;">載入失敗: ${err.message}</td></tr>`;
  });
}

function renderMailTable(list) {
  const tbody = document.getElementById("mail-list-body");
  if (!tbody) return;
  
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#888;">目前無資料</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(item => {
    let dateStr = "";
    if (item.arrivedAt) {
        const d = new Date(item.arrivedAt);
        const y = d.getFullYear();
        const m = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        const h = String(d.getHours()).padStart(2,'0');
        const min = String(d.getMinutes()).padStart(2,'0');
        dateStr = `${y}-${m}-${dd} ${h}:${min}`;
    }

    const isPicked = item.status === 'picked_up';
    const statusClass = isPicked ? 'status-green' : 'status-orange';
    const statusText = isPicked ? '已領取' : '未領取';
    
    return `
      <tr>
        <td>${dateStr}</td>
        <td>${item.houseNo || ""}</td>
        <td>${item.recipient || ""}</td>
        <td>${item.type || ""}</td>
        <td>${item.carrier || ""}${item.note ? `<br><small style="color:#666">${item.note}</small>` : ""}</td>
        <td><span class="status-badge ${statusClass}" style="background-color:${isPicked?'#d1fae5':'#ffedd5'};color:${isPicked?'#065f46':'#9a3412'};padding:2px 8px;border-radius:999px;font-size:12px;">${statusText}</span></td>
        <td>
          ${!isPicked ? `<button class="btn small action-btn" onclick="pickupMail('${item.id}')">領取</button>` : ""}
          <button class="btn small action-btn danger" onclick="deleteMail('${item.id}')">刪除</button>
        </td>
      </tr>
    `;
  }).join("");
}

window.pickupMail = async (id) => {
    if(!confirm("確定已領取？")) return;
    try {
        const slug = window.currentAdminCommunitySlug || new URLSearchParams(window.location.search).get("c") || localStorage.getItem("adminCurrentCommunity") || "default";
        await updateDoc(doc(db, "communities", slug, "mails", id), {
            status: 'picked_up',
            pickedUpAt: Date.now(),
            pickedUpBy: auth.currentUser.uid
        });
    } catch(e) { 
        console.error(e);
        alert("操作失敗"); 
    }
};

window.deleteMail = async (id) => {
    if(!confirm("確定刪除此記錄？")) return;
    try {
        const slug = window.currentAdminCommunitySlug || new URLSearchParams(window.location.search).get("c") || localStorage.getItem("adminCurrentCommunity") || "default";
        await deleteDoc(doc(db, "communities", slug, "mails", id));
    } catch(e) { 
        console.error(e);
        alert("刪除失敗"); 
    }
};

window.openMailModal = (item = null) => {
    const modalId = "mail-modal";
    let modal = document.getElementById(modalId);
    if(modal) modal.remove();
    
    modal = document.createElement("div");
    modal.id = modalId;
    modal.className = "modal active";
    modal.style.zIndex = "11000"; // Ensure it's on top of everything
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-head">
          <h3 class="modal-title">${item ? "編輯收件" : "新增收件"}</h3>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">戶號 *</label>
            <input type="text" id="mail-house" class="form-input" placeholder="例如: A-10-2" value="${item?.houseNo || ''}" list="mail-house-list" autocomplete="off">
            <datalist id="mail-house-list"></datalist>
          </div>
          <div class="form-group">
            <label class="form-label">收件人 *</label>
            <input type="text" id="mail-recipient" class="form-input" placeholder="姓名" value="${item?.recipient || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">類型 *</label>
            <select id="mail-type" class="form-input">
                <option value="包裹" ${item?.type === '包裹' ? 'selected' : ''}>包裹</option>
                <option value="掛號" ${item?.type === '掛號' ? 'selected' : ''}>掛號</option>
                <option value="信件" ${item?.type === '信件' ? 'selected' : ''}>信件</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">狀態</label>
            <select id="mail-status-detail" class="form-input">
                <!-- Populated by JS -->
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">物流業者</label>
            <select id="mail-carrier" class="form-input">
                <option value="">載入中...</option>
            </select>
          </div>
          <div class="form-group">
             <label class="form-label">物流單號</label>
             <div class="input-wrap" style="display: flex; gap: 8px; align-items: stretch;">
               <input type="text" id="mail-tracking-no" class="form-input" placeholder="掃碼或手動輸入" value="${item?.trackingNo || ''}" style="flex: 1;">
               <button type="button" class="btn small action-btn" id="btn-scan-mail-qr" style="padding: 0 10px; display: flex; align-items: center; justify-content: center; height: auto;" title="掃碼輸入">
                 <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                   <rect width="5" height="5" x="3" y="3" rx="1"></rect>
                   <rect width="5" height="5" x="16" y="3" rx="1"></rect>
                   <rect width="5" height="5" x="3" y="16" rx="1"></rect>
                   <path d="M21 16h-3a2 2 0 0 0-2 2v3"></path>
                   <path d="M21 21v.01"></path>
                   <path d="M12 7v3a2 2 0 0 1-2 2H7"></path>
                   <path d="M3 12h.01"></path>
                   <path d="M12 3h.01"></path>
                   <path d="M12 16v.01"></path>
                   <path d="M16 12h1"></path>
                   <path d="M21 12v.01"></path>
                   <path d="M12 21v-1"></path>
                 </svg>
               </button>
             </div>
          </div>
          <div class="form-group">
            <label class="form-label">備註</label>
            <input type="text" id="mail-note" class="form-input" value="${item?.note || ''}">
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn action-btn" onclick="document.getElementById('${modalId}').remove()">取消</button>
          <button class="btn primary" id="btn-save-mail">儲存</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Auto-load residents and setup fields
    (async () => {
        try {
            const slug = window.currentAdminCommunitySlug || new URLSearchParams(window.location.search).get("c") || localStorage.getItem("adminCurrentCommunity") || "default";
            
            // 1. Load Residents
            const q = query(collection(db, "users"), where("community", "==", slug), where("role", "==", "住戶"));
            const snap = await getDocs(q);
            const residents = [];
            snap.forEach(d => {
                const data = d.data();
                if (data.houseNo) residents.push({ h: data.houseNo, n: data.displayName || data.realName || "" });
            });
            residents.sort((a, b) => a.h.localeCompare(b.h, undefined, { numeric: true }));
            
            const dl = document.getElementById("mail-house-list");
            if (dl) dl.innerHTML = residents.map(r => `<option value="${r.h}">${r.n}</option>`).join("");
            
            const hInput = document.getElementById("mail-house");
            const rInput = document.getElementById("mail-recipient");
            if (hInput && rInput) {
                const autoFill = () => {
                    const val = hInput.value.trim();
                    const match = residents.find(r => r.h === val);
                    if (match && match.n) rInput.value = match.n;
                };
                hInput.addEventListener("input", autoFill);
                hInput.addEventListener("change", autoFill);
            }

            // 2. Setup Type & Status Logic
            const typeSelect = document.getElementById("mail-type");
            const statusSelect = document.getElementById("mail-status-detail");
            
            const updateStatusOptions = () => {
                const type = typeSelect.value;
                let options = [];
                if (type === "包裹") {
                    options = ["常溫", "冷藏", "冷凍"];
                } else if (type === "掛號") {
                    options = ["一般", "限時", "雙掛號", "政府公文"];
                } else if (type === "信件") {
                    options = ["一般", "限時", "其他"];
                }
                
                statusSelect.innerHTML = options.map(opt => `<option value="${opt}" ${item?.statusDetail === opt ? 'selected' : ''}>${opt}</option>`).join("");
            };
            
            typeSelect.addEventListener("change", updateStatusOptions);
            updateStatusOptions(); // Init

            // 3. Load Carriers
            let carriers = window.currentCarriers;
            if(!carriers) {
                const settingsRef = doc(db, "communities", slug, "settings", "mail");
                const sSnap = await getDoc(settingsRef);
                if(sSnap.exists() && sSnap.data().carriers) {
                    carriers = sSnap.data().carriers;
                } else {
                     // Default fallback if not loaded
                     carriers = ["郵局", "中華郵政", "黑貓宅急便", "新竹物流", "嘉里大榮", "宅配通", "順豐速運", "DHL", "FedEx", "UPS"];
                }
            }
            
            const carrierSelect = document.getElementById("mail-carrier");
            if(carrierSelect) {
                carrierSelect.innerHTML = carriers.map(c => `<option value="${c}" ${item?.carrier === c ? 'selected' : ''}>${c}</option>`).join("");
                // Add "Other" option just in case? Or strictly from list. User said "dropdown brings in". Strict is safer.
            }

            // 4. Setup Scanner
            const scanBtn = document.getElementById("btn-scan-mail-qr");
            if(scanBtn) {
                scanBtn.addEventListener("click", () => {
                     // Reuse existing scanner logic but target tracking no input
                     if (window.startQrScanner) {
                         window.startQrScanner((text) => {
                             const trackInput = document.getElementById("mail-tracking-no");
                             if(trackInput) trackInput.value = text;
                             // Close scanner handled by scanner logic or manual close
                         });
                     } else {
                         alert("掃碼功能未初始化");
                     }
                });
            }

        } catch (e) { console.error("Load mail modal data error", e); }
    })();
    
    document.getElementById("btn-save-mail").addEventListener("click", async () => {
        const house = document.getElementById("mail-house").value.trim();
        const recipient = document.getElementById("mail-recipient").value.trim();
        const type = document.getElementById("mail-type").value;
        const statusDetail = document.getElementById("mail-status-detail").value;
        const carrier = document.getElementById("mail-carrier").value;
        const trackingNo = document.getElementById("mail-tracking-no").value.trim();
        const note = document.getElementById("mail-note").value.trim();
        
        if(!house || !recipient) {
            alert("請填寫戶號和收件人");
            return;
        }
        
        const btn = document.getElementById("btn-save-mail");
        btn.disabled = true;
        btn.textContent = "儲存中...";
        
        try {
            const data = {
                houseNo: house,
                recipient: recipient,
                type: type,
                statusDetail: statusDetail,
                carrier: carrier,
                trackingNo: trackingNo,
                note: note,
                status: 'pending',
                arrivedAt: Date.now()
            };
            
            const slug = window.currentAdminCommunitySlug || new URLSearchParams(window.location.search).get("c") || localStorage.getItem("adminCurrentCommunity") || "default";
            await addDoc(collection(db, "communities", slug, "mails"), data);
            
            document.getElementById(modalId).remove();
        } catch(e) {
            console.error(e);
            alert("儲存失敗: " + e.message);
            btn.disabled = false;
            btn.textContent = "儲存";
        }
    });
};

window.renderAdminMailSettings = async () => {
  const container = adminNav.content;
  if(!container) return;
  
  const slug = window.currentAdminCommunitySlug || new URLSearchParams(window.location.search).get("c") || localStorage.getItem("adminCurrentCommunity") || "default";
  
  // Default carriers
  const defaultCarriers = [
      // Taiwan Local
      "郵局", "中華郵政", "黑貓宅急便", "新竹物流", "嘉里大榮", "宅配通", "順豐速運",
      // International
      "DHL", "FedEx", "UPS", "TNT", "EMS",
      // China / Cross-border
      "淘寶集運", "京東物流", "圓通速遞", "中通快遞", "申通快遞", "韻達快遞"
  ];
  
  container.innerHTML = `
    <div class="card data-card">
      <div class="card-head">
        <h1 class="card-title">物流業者設定</h1>
        <div class="card-actions">
           <button class="btn small action-btn" onclick="openCarrierModal()">新增業者</button>
        </div>
      </div>
      <div class="card-body">
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>業者名稱</th>
                        <th style="width: 100px; text-align: center;">操作</th>
                    </tr>
                </thead>
                <tbody id="carrier-list-body">
                    <tr><td colspan="2" style="text-align:center;">載入中...</td></tr>
                </tbody>
            </table>
        </div>
      </div>
    </div>
  `;
  
  // Fetch existing settings
  try {
      const settingsRef = doc(db, "communities", slug, "settings", "mail");
      let settingsSnap = await getDoc(settingsRef);
      
      let carriers = [];
      
      if (!settingsSnap.exists()) {
          // Initialize with defaults if not exists
          carriers = [...defaultCarriers];
          await setDoc(settingsRef, { carriers: carriers }, { merge: true });
      } else {
          const data = settingsSnap.data();
          if (!data.carriers || !Array.isArray(data.carriers)) {
              // Merge defaults if field missing
               carriers = [...defaultCarriers];
               await setDoc(settingsRef, { carriers: carriers }, { merge: true });
          } else {
              carriers = data.carriers;
          }
      }
      
      // Ensure '郵局' is present if not already (for existing data migration)
      if (!carriers.includes("郵局")) {
          carriers.unshift("郵局");
          await setDoc(settingsRef, { carriers: carriers }, { merge: true });
      }

      renderCarrierTable(carriers);
      
      // Store locally for edits
      window.currentCarriers = carriers;
      
  } catch(e) {
      console.error(e);
      document.getElementById("carrier-list-body").innerHTML = `<tr><td colspan="2" style="color:red;">載入失敗: ${e.message}</td></tr>`;
  }
};

window.renderCarrierTable = (list) => {
    const tbody = document.getElementById("carrier-list-body");
    if(!tbody) return;
    
    if(list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#999;">無資料</td></tr>`;
        return;
    }
    
    tbody.innerHTML = list.map((name, index) => `
        <tr>
            <td>${name}</td>
            <td style="text-align: center;">
                <div style="display: flex; gap: 6px; justify-content: center; align-items: center;">
                    <button class="btn small icon-btn" onclick="moveCarrier(${index}, -1)" title="上移" 
                        style="background: #f5f5f5; border: 1px solid #ddd; visibility: ${index === 0 ? 'hidden' : 'visible'};">
                       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
                    </button>
                    <button class="btn small icon-btn" onclick="moveCarrier(${index}, 1)" title="下移" 
                        style="background: #f5f5f5; border: 1px solid #ddd; visibility: ${index === list.length - 1 ? 'hidden' : 'visible'};">
                       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>
                    <button class="btn small action-btn danger" onclick="deleteCarrier(${index})" title="刪除">刪除</button>
                </div>
            </td>
        </tr>
    `).join("");
};

window.moveCarrier = async (index, direction) => {
    try {
        const slug = window.currentAdminCommunitySlug || new URLSearchParams(window.location.search).get("c") || localStorage.getItem("adminCurrentCommunity") || "default";
        const newList = [...window.currentCarriers];
        
        // Swap elements
        const targetIndex = index + direction;
        if(targetIndex < 0 || targetIndex >= newList.length) return;
        
        [newList[index], newList[targetIndex]] = [newList[targetIndex], newList[index]];
        
        await setDoc(doc(db, "communities", slug, "settings", "mail"), { carriers: newList }, { merge: true });
        
        window.currentCarriers = newList;
        renderCarrierTable(newList);
    } catch(e) {
        console.error(e);
        alert("移動失敗: " + e.message);
    }
};

window.openCarrierModal = () => {
    const modalId = "carrier-modal";
    let modal = document.getElementById(modalId);
    if(modal) modal.remove();
    
    modal = document.createElement("div");
    modal.id = modalId;
    modal.className = "modal active";
    modal.style.zIndex = "11000";
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-head">
          <h3 class="modal-title">新增物流業者</h3>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">業者名稱</label>
            <input type="text" id="carrier-name" class="form-input" placeholder="例如: 郵局">
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn action-btn" onclick="document.getElementById('${modalId}').remove()">取消</button>
          <button class="btn primary" id="btn-save-carrier">新增</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById("btn-save-carrier").addEventListener("click", async () => {
        const name = document.getElementById("carrier-name").value.trim();
        if(!name) {
            alert("請輸入名稱");
            return;
        }
        
        if(window.currentCarriers.includes(name)) {
            alert("此業者已存在");
            return;
        }
        
        const btn = document.getElementById("btn-save-carrier");
        btn.disabled = true;
        btn.textContent = "處理中...";
        
        try {
            const slug = window.currentAdminCommunitySlug || new URLSearchParams(window.location.search).get("c") || localStorage.getItem("adminCurrentCommunity") || "default";
            const newList = [...window.currentCarriers, name];
            
            await setDoc(doc(db, "communities", slug, "settings", "mail"), { carriers: newList }, { merge: true });
            
            window.currentCarriers = newList;
            renderCarrierTable(newList);
            document.getElementById(modalId).remove();
        } catch(e) {
            console.error(e);
            alert("新增失敗: " + e.message);
            btn.disabled = false;
            btn.textContent = "新增";
        }
    });
};

window.deleteCarrier = async (index) => {
    if(!confirm("確定要刪除此業者嗎?")) return;
    
    try {
        const slug = window.currentAdminCommunitySlug || new URLSearchParams(window.location.search).get("c") || localStorage.getItem("adminCurrentCommunity") || "default";
        const newList = [...window.currentCarriers];
        newList.splice(index, 1);
        
        await setDoc(doc(db, "communities", slug, "settings", "mail"), { carriers: newList }, { merge: true });
        
        window.currentCarriers = newList;
        renderCarrierTable(newList);
    } catch(e) {
        console.error(e);
        alert("刪除失敗: " + e.message);
    }
};

function renderAdminContent(mainKey, subKeyOrLabel, subLabelOverride) {
  // Cleanup previous SOS list listener if exists
  if (window.sosListUnsub) {
    window.sosListUnsub();
    window.sosListUnsub = null;
  }
  if (window.adminAnnounceUnsub) {
    window.adminAnnounceUnsub();
    window.adminAnnounceUnsub = null;
  }
  if (!adminNav.content) return;
  
  // Backwards compatibility: if 2nd arg is label (old style), use it as key/label
  // If called from new renderAdminSubNav, subKeyOrLabel is KEY, subLabelOverride is LABEL.
  const sub = (subKeyOrLabel || "").replace(/\u200B/g, "").trim();
  const displayLabel = subLabelOverride || sub;

  if (mainKey === "shortcuts" && sub === "通知跑馬燈") {
    adminNav.content.innerHTML = `
      <div class="card data-card marquee-card">
        <div class="marquee">
          <div class="marquee-track">
            <span>系統通知：請於本週完成電力設備巡檢。</span>
            <span>住戶公告：元旦活動報名開放中。</span>
            <span>包裹提醒：B棟管理室今日18:00前可領取。</span>
          </div>
        </div>
      </div>
    `;
    const track = adminNav.content.querySelector(".marquee-track");
    if (track) {
      const clone = track.cloneNode(true);
      track.parentNode.appendChild(clone);
    }
    return;
  }
  if (mainKey === "mail") {
    if (sub === "收件") {
      renderAdminMailInbox();
      return;
    }
    if (sub === "取件") {
      adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">取件</h1></div><div class="empty-hint">尚未建立表單</div></div>`;
      return;
    }
    if (sub === "寄放") {
      adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">寄放</h1></div><div class="empty-hint">尚未建立表單</div></div>`;
      return;
    }
    if (sub === "設定") {
      renderAdminMailSettings();
      return;
    }
  }
  if (mainKey === "facility") {
    // sub is the facility key (e.g., 'gym'), displayLabel is the facility name (e.g., '健身房')
    renderAdminFacilityList(displayLabel, sub);
    return;
  }
  if (mainKey === "announce") {
    // If it's a known key or legacy label, handle it.
    // Dynamic keys are also handled here: if subKeyOrLabel is 'ann_xxx', we use it as key.
    if (sub === "announce_list" || sub === "社區園地" || sub === "公告") {
      renderAdminAnnounceList(displayLabel, "社區公告");
      return;
    }
    // For any other key (dynamic categories), use the key itself (or the label if preferred, but key is safer)
    // Here we use 'sub' (the key) as the DB category ID.
    renderAdminAnnounceList(displayLabel, sub);
    return;
  }
  if (mainKey === "communities") {
      if (sub === "列表") {
          renderAdminCommunities();
          return;
      }
  }

  if (mainKey === "residents") {
    if (sub === "住戶") {
      (async () => {
        if (!auth.currentUser) {
          await new Promise(resolve => {
            const unsub = onAuthStateChanged(auth, u => {
              unsub();
              resolve(u);
            });
          });
        }
        const cu = auth.currentUser;
        if (!cu) {
          adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">住戶帳號列表</h1></div><div class="empty-hint">請先登入後台</div></div>`;
          return;
        }
        let roleNow = "住戶";
        try {
          roleNow = await getOrCreateUserRole(cu.uid, cu.email);
        } catch {}
        if (roleNow === "停用" || !checkPagePermission(roleNow, window.location.pathname)) {
          adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">住戶帳號列表</h1></div><div class="empty-hint">權限不足</div></div>`;
          return;
        }
        let slug = window.currentAdminCommunitySlug || localStorage.getItem("adminCurrentCommunity") || getSlugFromPath() || getQueryParam("c") || "default";
        if (slug === "default") {
          try {
            const snap = await getDocs(collection(db, "communities"));
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            if (list.length > 0) {
              slug = list[0].id;
              window.currentAdminCommunitySlug = slug;
            } else if (auth.currentUser) {
              slug = await getUserCommunity(auth.currentUser.uid);
              window.currentAdminCommunitySlug = slug;
            }
          } catch {
            if (auth.currentUser) {
              slug = await getUserCommunity(auth.currentUser.uid);
              window.currentAdminCommunitySlug = slug;
            }
          }
        }
        try {
          const u = auth.currentUser;
          if (u) {
            const usnap = await getDoc(doc(db, "users", u.uid));
            if (usnap.exists()) {
              const r = (usnap.data().role || "住戶");
              if (r !== "系統管理員") {
                const mySlug = await getUserCommunity(u.uid);
                slug = mySlug;
                window.currentAdminCommunitySlug = mySlug;
              }
            }
          }
        } catch {}
        let cname = slug;
        try {
          const csnap = await getDoc(doc(db, "communities", slug));
          if (csnap.exists()) {
            const c = csnap.data();
            cname = c.name || slug;
          }
        } catch {}
        let residents = [];
        let fetchError = null;
        try {
          const communitiesFilter = [slug];
          if (cname && cname !== slug) communitiesFilter.push(cname);
          let snapList;
          if (communitiesFilter.length > 1) {
            const qIn = query(collection(db, "users"), where("community", "in", communitiesFilter), where("role", "==", "住戶"));
            snapList = await getDocs(qIn);
          } else {
            const qEq = query(collection(db, "users"), where("community", "==", slug), where("role", "==", "住戶"));
            snapList = await getDocs(qEq);
          }
          residents = snapList.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (err) {
          console.error("Fetch residents error:", err);
          try {
            const qFallback = query(collection(db, "users"), where("community", "==", slug), where("role", "==", "住戶"));
            const snapList = await getDocs(qFallback);
            residents = snapList.docs.map(d => ({ id: d.id, ...d.data() }));
          } catch (retryErr) {
             console.error("Retry fetch error:", retryErr);
             if (retryErr.code === 'permission-denied') {
               fetchError = "權限不足：您沒有權限讀取此社區的住戶資料 (Permission Denied)。";
             } else {
               fetchError = "無法載入住戶資料，請檢查網路連線或稍後再試。";
             }
          }
        }
        const rows = residents.map((a, idx) => {
          const nm = a.displayName || (a.email || "").split("@")[0] || "住戶";
          const av = a.photoURL ? `<img class="avatar" src="${a.photoURL}" alt="avatar">` : `<span class="avatar">${(nm || a.email || "住")[0]}</span>`;
          const qrText = a.qrCodeText || "—";
          return `
            <tr data-uid="${a.id}">
              <td><input type="checkbox" class="check-resident" value="${a.id}"></td>
              <td>${av}</td>
              <td>${a.seq || ""}</td>
              <td>${a.houseNo || ""}</td>
              <td>${typeof a.subNo === "number" ? a.subNo : ""}</td>
              <td>${qrText}</td>
              <td>${nm}</td>
              <td>${a.address || ""}</td>
              <td>${a.area || ""}</td>
              <td>${a.ownershipRatio || ""}</td>
              <td>${a.phone || ""}</td>
              <td>${a.email || ""}</td>
              <td>••••••</td>
              <td>
                <label class="switch">
                  <input type="checkbox" class="status-toggle-resident" ${a.status === "停用" ? "checked" : ""}>
                  <span class="slider round"></span>
                </label>
              </td>
              <td class="actions">
                <button class="btn small action-btn btn-edit-resident">編輯</button>
              </td>
            </tr>
          `;
        }).join("");
        const emptyText = fetchError ? `<span style="color:red">${fetchError}</span>` : "目前沒有住戶資料";
        adminNav.content.innerHTML = `
          <div class="card data-card">
            <div class="card-head">
              <h1 class="card-title">住戶帳號列表（${cname}） · 總數：${residents.length}</h1>
              <div style="display:flex;gap:8px;">
                <button id="btn-delete-selected" class="btn small action-btn danger" style="display:none;">刪除選取項目</button>
                <button id="btn-import-resident" class="btn small action-btn">匯入 Excel</button>
                <button id="btn-export-resident" class="btn small action-btn">匯出 Excel</button>
                <button id="btn-create-resident" class="btn small action-btn">新增</button>
              </div>
            </div>
            <div class="table-wrap">
              <table class="table">
                <colgroup>
                  <col width="40"><col><col width="70"><col width="100"><col width="80"><col width="120"><col><col><col><col><col><col><col width="80"><col width="80"><col width="160">
                </colgroup>
                <thead>
                  <tr>
                    <th><input type="checkbox" id="check-all-residents"></th>
                    <th>大頭照</th>
                    <th>序號</th>
                    <th>戶號</th>
                    <th>子戶號</th>
                    <th>QR code</th>
                    <th>姓名</th>
                    <th>地址</th>
                    <th>坪數</th>
                    <th>區分權比</th>
                    <th>手機號碼</th>
                    <th>電子郵件</th>
                    <th>密碼</th>
                    <th>狀態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
              ${emptyText ? `<div class="empty-hint">${emptyText}</div>` : ""}
            </div>
          </div>
        `;

        const toggles = adminNav.content.querySelectorAll(".status-toggle-resident");
        toggles.forEach(toggle => {
          toggle.addEventListener("change", async (e) => {
            const tr = e.target.closest("tr");
            const targetUid = tr && tr.getAttribute("data-uid");
            if (!targetUid) return;
            const newStatus = e.target.checked ? "停用" : "啟用";
            try {
              await setDoc(doc(db, "users", targetUid), { status: newStatus }, { merge: true });
              showHint(newStatus === "啟用" ? "帳號已啟用" : "帳號已停用", "success");
            } catch (err) {
              console.error(err);
              showHint("更新狀態失敗", "error");
              e.target.checked = !e.target.checked;
            }
          });
        });

        const btnCreate = document.getElementById("btn-create-resident");
        btnCreate && btnCreate.addEventListener("click", () => window.openCreateResidentModal && window.openCreateResidentModal(slug));
        
        const btnExport = document.getElementById("btn-export-resident");
        btnExport && btnExport.addEventListener("click", async () => {
          btnExport.disabled = true;
          btnExport.textContent = "匯出中...";
          try {
            await ensureXlsxLib();
            if (!window.XLSX) throw new Error("Excel Library not found");
            
            const data = residents.map((r, idx) => ({
              "大頭照": r.photoURL || "",
              "序號": r.seq || "",
              "戶號": r.houseNo || "",
              "子戶號": r.subNo !== undefined ? r.subNo : "",
              "QR code": r.qrCodeText || "",
              "姓名": r.displayName || "",
              "地址": r.address || "",
              "坪數": r.area || "",
              "區分權比": r.ownershipRatio || "",
              "手機號碼": r.phone || "",
              "電子郵件": r.email || "",
              "狀態": r.status || "啟用"
            }));
            
            const ws = window.XLSX.utils.json_to_sheet(data);
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, ws, "Residents");
            window.XLSX.writeFile(wb, `${cname}_residents_${new Date().toISOString().slice(0,10)}.xlsx`);
          } catch(e) {
            console.error(e);
            alert("匯出失敗");
          } finally {
            btnExport.disabled = false;
            btnExport.textContent = "匯出 Excel";
          }
        });

        const btnImport = document.getElementById("btn-import-resident");
        btnImport && btnImport.addEventListener("click", () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".xlsx, .xls, .csv";
          input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            // Show blocking overlay
            let overlay = document.getElementById("import-overlay");
            if (!overlay) {
              overlay = document.createElement("div");
              overlay.id = "import-overlay";
              overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;justify-content:center;align-items:center;color:#fff;flex-direction:column;font-size:1.2rem;";
              overlay.innerHTML = `<div class="spinner"></div><div id="import-msg" style="margin-top:15px;">準備匯入中...</div>`;
              document.body.appendChild(overlay);
            } else {
              overlay.style.display = "flex";
              overlay.innerHTML = `<div class="spinner"></div><div id="import-msg" style="margin-top:15px;">準備匯入中...</div>`;
            }
            
            btnImport.disabled = true;
            btnImport.textContent = "匯入中...";
            try {
              await ensureXlsxLib();
              if (!window.XLSX) throw new Error("Excel Library not found");
              
              const reader = new FileReader();
              reader.onload = async (e) => {
                try {
                  const data = new Uint8Array(e.target.result);
                  const workbook = window.XLSX.read(data, { type: 'array' });
                  const firstSheetName = workbook.SheetNames[0];
                  const worksheet = workbook.Sheets[firstSheetName];
                  const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
                  
                  if (jsonData.length === 0) {
                    alert("檔案內容為空");
                    overlay.style.display = "none";
                    return;
                  }
                  
                  if (!confirm(`即將匯入 ${jsonData.length} 筆資料，確定嗎？`)) {
                    overlay.style.display = "none";
                    return;
                  }

                  let successCount = 0;
                  let failCount = 0;
                  const total = jsonData.length;
                  const updateProgress = (processed) => {
                     const el = document.getElementById("import-msg");
                     if (el) el.textContent = `匯入中... ${processed} / ${total}`;
                  };

                  // Optimized Batch Processing with Concurrency Control
                  // Auth creation can be rate-limited, so we keep concurrency low (e.g., 10)
                  const CHUNK_SIZE = 20; 
                  for (let i = 0; i < total; i += CHUNK_SIZE) {
                    const chunk = jsonData.slice(i, i + CHUNK_SIZE);
                    const batch = writeBatch(db);
                    let hasWrites = false;

                    const promises = chunk.map(async (row) => {
                        try {
                            const email = (row["電子郵件"] || "").trim();
                            const password = (row["密碼"] || "123456").trim();
                            const displayName = (row["姓名"] || "").trim();
                            const phone = (row["手機號碼"] || "").toString().trim();
                            const seq = (row["序號"] || "").toString().trim();
                            const houseNo = (row["戶號"] || "").toString().trim();
                            const subNoRaw = row["子戶號"];
                            // Support multiple column names for QR Code
                            const qrCodeText = (row["QR code"] || row["QR code碼"] || row["QRcode"] || "").trim();
                            const address = (row["地址"] || "").trim();
                            const area = (row["坪數"] || "").toString().trim();
                            const ownershipRatio = (row["區分權比"] || "").toString().trim();
                            const status = (row["狀態"] || "停用").trim();
                            const photoURL = (row["大頭照"] || "").trim();

                            if (!email) {
                                console.warn("Skipping row without email", row);
                                failCount++;
                                return null;
                            }

                            // Create Auth
                            let uid = null;
                            try {
                                const cred = await createUserWithEmailAndPassword(createAuth, email, password);
                                uid = cred.user.uid;
                                await updateProfile(cred.user, { displayName, photoURL });
                                await signOut(createAuth);
                            } catch (authErr) {
                                if (authErr.code === 'auth/email-already-in-use') {
                                    const qUser = query(collection(db, "users"), where("email", "==", email));
                                    const snapUser = await getDocs(qUser);
                                    if (!snapUser.empty) {
                                        uid = snapUser.docs[0].id;
                                    }
                                }
                                if (!uid) {
                                    console.error("Auth create failed", authErr);
                                    failCount++;
                                    return null;
                                }
                            }
                            
                            if (uid) {
                                const docRef = doc(db, "users", uid);
                                const payload = {
                                    email,
                                    role: "住戶",
                                    status,
                                    displayName,
                                    phone,
                                    photoURL,
                                    community: slug,
                                    seq,
                                    houseNo,
                                    ...(subNoRaw !== undefined && subNoRaw !== "" ? { subNo: parseInt(subNoRaw, 10) } : {}),
                                    qrCodeText,
                                    address,
                                    area,
                                    ownershipRatio,
                                    createdAt: Date.now()
                                };
                                return { docRef, payload };
                            }
                        } catch (err) {
                            console.error("Import row failed", err);
                            failCount++;
                        }
                        return null;
                    });

                    const results = await Promise.all(promises);
                    results.forEach(res => {
                        if (res) {
                            batch.set(res.docRef, res.payload, { merge: true });
                            hasWrites = true;
                            successCount++;
                        }
                    });

                    if (hasWrites) {
                        await batch.commit();
                    }
                    updateProgress(Math.min(i + CHUNK_SIZE, total));
                  }
                  
                  // Completion UI
                  overlay.innerHTML = `
                    <div style="background:white;color:black;padding:20px;border-radius:8px;text-align:center;min-width:300px;">
                        <h2 style="margin-top:0;color:#333;">匯入完成</h2>
                        <p style="font-size:1.1rem;margin:10px 0;">成功：<span style="color:green;font-weight:bold;">${successCount}</span> 筆</p>
                        <p style="font-size:1.1rem;margin:10px 0;">失敗：<span style="color:red;font-weight:bold;">${failCount}</span> 筆</p>
                        <button id="close-overlay-btn" class="btn action-btn primary" style="margin-top:15px;width:100%;">確定</button>
                    </div>
                  `;
                  const closeBtn = document.getElementById("close-overlay-btn");
                  if (closeBtn) {
                      closeBtn.onclick = () => {
                          overlay.style.display = "none";
                          // Refresh list
                          const btnResidents = document.getElementById("admin-tab-residents");
                          if (btnResidents) btnResidents.click(); 
                      };
                  }
                  
                } catch (e) {
                  console.error(e);
                  alert("讀取 Excel 失敗");
                  overlay.style.display = "none";
                } finally {
                  btnImport.disabled = false;
                  btnImport.textContent = "匯入 Excel";
                }
              };
              reader.readAsArrayBuffer(file);
              
            } catch(e) {
              console.error(e);
              alert("匯入失敗");
              btnImport.disabled = false;
              btnImport.textContent = "匯入 Excel";
              if (overlay) overlay.style.display = "none";
            }
          };
          input.click();
        });

        adminNav.content.addEventListener("change", (e) => {
          if (e.target.id === "check-all-residents") {
            const checked = e.target.checked;
            const checkboxes = adminNav.content.querySelectorAll(".check-resident");
            checkboxes.forEach(cb => cb.checked = checked);
            updateDeleteSelectedBtn();
          } else if (e.target.classList.contains("check-resident")) {
            updateDeleteSelectedBtn();
          }
        });

        function updateDeleteSelectedBtn() {
           const btn = document.getElementById("btn-delete-selected");
           const checked = adminNav.content.querySelectorAll(".check-resident:checked");
           if (btn) {
             if (checked.length > 0) {
               btn.style.display = "inline-block";
               btn.textContent = `刪除選取項目 (${checked.length})`;
             } else {
               btn.style.display = "none";
             }
           }
        }

        const btnDeleteSelected = document.getElementById("btn-delete-selected");
        if (btnDeleteSelected) {
          btnDeleteSelected.addEventListener("click", async () => {
             const checked = adminNav.content.querySelectorAll(".check-resident:checked");
             if (checked.length === 0) return;
             if (!confirm(`確定要刪除選取的 ${checked.length} 位住戶嗎？此操作將永久刪除資料，且無法復原。`)) return;
             
             btnDeleteSelected.disabled = true;
             btnDeleteSelected.textContent = "刪除中...";
             
             let successCount = 0;
             let failCount = 0;
             
             // Use writeBatch for atomic updates (max 500 operations per batch)
             const chunks = [];
             const allIds = Array.from(checked).map(cb => cb.value);
             for (let i = 0; i < allIds.length; i += 500) {
               chunks.push(allIds.slice(i, i + 500));
             }
             
             try {
                const limit = 10;
                
                const processItem = async (uid) => {
                   try {
                     await deleteDoc(doc(db, "users", uid));
                     successCount++;
                   } catch (e) {
                     console.error(e);
                     failCount++;
                   }
                };
                
                // Simple batch processing
                for (let i = 0; i < allIds.length; i += limit) {
                   const batchIds = allIds.slice(i, i + limit);
                   await Promise.all(batchIds.map(uid => processItem(uid)));
                }

                showHint(`已刪除 ${successCount} 筆，失敗 ${failCount} 筆`, "success");
                setActiveAdminNav("residents"); // Reload
             } catch (err) {
               console.error(err);
               showHint("批次刪除發生錯誤", "error");
             } finally {
               if (btnDeleteSelected) {
                 btnDeleteSelected.disabled = false;
                 btnDeleteSelected.textContent = "刪除選取項目";
               }
             }
          });
        }

        adminNav.content.addEventListener("click", async (e) => {
          const btn = e.target.closest("button");
          if (!btn) return;
          if (btn.id === "btn-create-resident") {
            window.openCreateResidentModal && window.openCreateResidentModal(slug);
            return;
          }
          if (btn.classList.contains("btn-edit-resident")) {
            const tr = btn.closest("tr");
            const targetUid = tr && tr.getAttribute("data-uid");
            const currentUser = auth.currentUser;
            const isSelf = currentUser && currentUser.uid === targetUid;
            let target = { id: targetUid, displayName: "", email: "", phone: "", photoURL: "", role: "住戶", status: "停用" };
            try {
              const snap = await getDoc(doc(db, "users", targetUid));
              if (snap.exists()) {
                const d = snap.data();
                target.displayName = d.displayName || target.displayName;
                target.email = d.email || target.email;
                target.phone = d.phone || target.phone;
                target.photoURL = d.photoURL || target.photoURL;
                target.status = d.status || target.status;
                target.seq = d.seq;
                target.houseNo = d.houseNo || target.houseNo;
                target.subNo = d.subNo;
                target.qrCodeText = d.qrCodeText || target.qrCodeText;
                target.address = d.address || target.address;
                target.area = d.area || target.area;
                target.ownershipRatio = d.ownershipRatio || target.ownershipRatio;
              }
            } catch {}
            window.openEditModal && window.openEditModal(target, isSelf, "community-admin");
            return;
          }
        });
      })();
      return;
    }
    if (sub === "點數") {
      adminNav.content.innerHTML = `
        <div class="card data-card">
          <div class="card-head">
            <h1 class="card-title" style="white-space:nowrap;">點數紀錄</h1>
            <div style="display:flex;gap:8px;margin-left:auto;">
              <button id="btn-add-points" class="btn action-btn small">新增點數</button>
              <button id="btn-auto-points" class="btn action-btn small">自動新增</button>
              <button id="btn-sync-points" class="btn action-btn small" style="background-color:#059669;color:white;">同步舊資料</button>
            </div>
          </div>
          <div class="card-filters">
            <select id="points-resident-select" style="min-width:120px;height:32px;border:1px solid #e5e7eb;border-radius:6px;padding:0 8px;margin-left:auto;">
              <option value="">選擇住戶戶號</option>
            </select>
          </div>
          <div id="points-summary" style="padding:12px 16px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:14px;color:#6b7280;">請選擇戶號以顯示摘要</div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>變動日期</th>
                  <th>原因</th>
                  <th>變動點數</th>
                  <th>點數餘額</th>
                  <th>紀錄（操作人員）</th>
                </tr>
              </thead>
              <tbody id="points-tbody">
                <tr><td colspan="5" style="text-align:center">尚未建立內容</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      `;
      (async () => {
        try {
          let slug = window.currentAdminCommunitySlug || getSlugFromPath() || getQueryParam("c") || "default";
          if (slug === "default") {
            try {
              const snap = await getDocs(collection(db, "communities"));
              const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
              if (list.length > 0) {
                slug = list[0].id;
                window.currentAdminCommunitySlug = slug;
              } else if (auth.currentUser) {
                slug = await getUserCommunity(auth.currentUser.uid);
                window.currentAdminCommunitySlug = slug;
              }
            } catch {
              if (auth.currentUser) {
                slug = await getUserCommunity(auth.currentUser.uid);
                window.currentAdminCommunitySlug = slug;
              }
            }
          }
          let residents = [];
          try {
            const qEq = query(collection(db, "users"), where("community", "==", slug), where("role", "==", "住戶"));
            const snapList = await getDocs(qEq);
            residents = snapList.docs.map(d => ({ id: d.id, ...d.data() }));
          } catch {}
          const sel = adminNav.content.querySelector("#points-resident-select");
          if (sel) {
            const houseNos = Array.from(new Set(residents.map(r => r.houseNo).filter(Boolean)));
            const opts = houseNos
              .map(hn => `<option value="${hn}">${hn}</option>`)
              .join("");
            sel.innerHTML = `<option value="">選擇住戶戶號</option>${opts}`;
            const summary = adminNav.content.querySelector("#points-summary");
            sel.addEventListener("change", async () => {
              const houseNo = sel.value;
              if (!houseNo) {
                if (summary) summary.innerHTML = `<div style="font-size:14px;color:#6b7280;">請選擇戶號以顯示摘要</div>`;
                return;
              }
              try {
                const qH = query(collection(db, "users"), where("community", "==", slug), where("role", "==", "住戶"), where("houseNo", "==", houseNo));
                const snapH = await getDocs(qH);
                const members = snapH.docs.map(d => ({ id: d.id, ...d.data() }));
                const names = members.map(m => m.displayName || (m.email || "").split("@")[0]).filter(Boolean);
                const subCount = members.filter(m => typeof m.subNo === "number").length || members.length;
                const address = (members[0] && members[0].address) || "";
                const mainMember = members.find(m => !m.subNo || m.subNo === 0) || members[0];
                const qrText = (mainMember && mainMember.qrCodeText) || "";
                let qrImg = "";
                if (qrText) qrImg = await getQrDataUrl(qrText, 120);

                let balance = 0;
                let foundUserPoints = false;

                // Optimization: Try to find user by houseNo and use their points
                try {
                    const qUser = query(collection(db, "users"), where("community", "==", slug), where("houseNo", "==", houseNo));
                    const snapUser = await getDocs(qUser);
                    if (!snapUser.empty) {
                        const uData = snapUser.docs[0].data();
                        if (typeof uData.points === 'number') {
                            balance = uData.points;
                            foundUserPoints = true;
                        }
                    }
                } catch(e) { console.warn("Fetch user points failed", e); }

                if (!foundUserPoints) {
                  try {
                    const bdoc = await getDoc(doc(db, `communities/${slug}/app_modules/points_balances/${houseNo}`));
                    if (bdoc.exists()) balance = bdoc.data().balance || 0;
                  } catch {
                    try {
                      const pdoc = await getDoc(doc(db, `communities/${slug}/app_modules/points`));
                      if (pdoc.exists()) {
                        const data = pdoc.data();
                        const bmap = data.balances || {};
                        balance = typeof bmap[houseNo] === "number" ? bmap[houseNo] : 0;
                      }
                    } catch {}
                  }
                }
                if (summary) {
                  summary.innerHTML = `
                    <div style="display:flex;align-items:center;gap:16px;">
                      ${qrImg ? `
                        <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
                           <img src="${qrImg}" style="width:120px;height:120px;border:1px solid #eee;border-radius:8px;">
                           <div style="font-size:14px;font-weight:500;color:#333;">${qrText}</div>
                        </div>
                      ` : `
                        <div style="width:120px;height:120px;background:#f3f4f6;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:12px;">
                           無QR Code
                        </div>
                      `}
                      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;align-items:center;flex:1;">
                        <div><strong>戶號</strong>：${houseNo}</div>
                        <div><strong>子戶號數量</strong>：${subCount}</div>
                        <div><strong>子戶號姓名</strong>：${names.join("、") || "—"}</div>
                        <div><strong>地址</strong>：${address || "—"}</div>
                        <div style="grid-column:1 / -1;"><strong>點數</strong>：<span style="color:#f59e0b;font-weight:800;font-size:20px;">${balance}</span></div>
                      </div>
                    </div>
                  `;
                }
                const tbody = document.getElementById("points-tbody");
                if (tbody) {
                  try {
                    let logs = [];
                    try {
                      const qLogs = query(collection(db, "communities", slug, "points_logs"), where("houseNo", "==", houseNo));
                      const snapLogs = await getDocs(qLogs);
                      logs = snapLogs.docs.map(d => ({ id: d.id, ...d.data() }));
                    } catch (permErr) {
                      try {
                        const pdoc = await getDoc(doc(db, `communities/${slug}/app_modules/points`));
                        if (pdoc.exists()) {
                          const data = pdoc.data();
                          const arr = Array.isArray(data.logs) ? data.logs : [];
                          logs = arr.filter(x => x.houseNo === houseNo);
                        }
                      } catch {}
                    }
                    logs.sort((a,b) => a.createdAt - b.createdAt);
                    let run = 0;
                    const rowsAsc = logs.map(l => {
                      run += (typeof l.delta === "number" ? l.delta : 0);
                      return { ...l, run };
                    });
                    rowsAsc.sort((a,b) => b.createdAt - a.createdAt);
                    const rowsHtml = rowsAsc.map(l => `
                      <tr>
                        <td>${new Date(l.createdAt).toLocaleString()}</td>
                        <td>${l.reason || "—"}</td>
                        <td>${(typeof l.delta === "number" ? l.delta : 0)}</td>
                        <td>${l.run}</td>
                        <td>${l.operatorName || l.operator || "—"}</td>
                      </tr>
                    `).join("");
                    tbody.innerHTML = rowsHtml || '<tr><td colspan="5" style="text-align:center">尚未建立內容</td></tr>';
                  } catch (err) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#b71c1c;">載入失敗</td></tr>';
                  }
                }
              } catch {
                if (summary) summary.innerHTML = `<div style="color:#b71c1c;">載入失敗</div>`;
              }
            });
            
            const btnAdd = adminNav.content.querySelector("#btn-add-points");
            btnAdd && btnAdd.addEventListener("click", async () => {
              const currentHouse = sel.value || "";
              const optionsHtml = houseNos.map(hn => `<option value="${hn}" ${hn===currentHouse?"selected":""}>${hn}</option>`).join("");
              const body = `
                <div class="modal-dialog">
                  <div class="modal-head"><div class="modal-title">新增點數</div></div>
                  <div class="modal-body">
                    <div class="modal-row">
                      <label>戶號</label>
                      <select id="add-points-house">${optionsHtml}</select>
                    </div>
                    <div class="modal-row">
                      <label>原因</label>
                      <input type="text" id="add-points-reason" placeholder="例如：活動獎勵">
                    </div>
                    <div class="modal-row">
                      <label>點數</label>
                      <input type="number" id="add-points-amount" placeholder="例如：10">
                    </div>
                    <div class="hint" id="add-points-hint"></div>
                  </div>
                  <div class="modal-foot">
                    <button id="add-points-cancel" class="btn action-btn danger">取消</button>
                    <button id="add-points-save" class="btn action-btn">儲存</button>
                  </div>
                </div>
              `;
              openModal(body);
              const cancel = document.getElementById("add-points-cancel");
              const save = document.getElementById("add-points-save");
              const houseEl = document.getElementById("add-points-house");
              const reasonEl = document.getElementById("add-points-reason");
              const amountEl = document.getElementById("add-points-amount");
              const hintEl = document.getElementById("add-points-hint");
              const showHintLocal = (msg, type="error") => {
                if (hintEl) {
                  hintEl.textContent = msg;
                  hintEl.style.color = type === "error" ? "#b71c1c" : "#0ea5e9";
                }
              };
              cancel && cancel.addEventListener("click", () => closeModal());
              save && save.addEventListener("click", async () => {
                try {
                  const houseNo = (houseEl && houseEl.value.trim()) || "";
                  const reason = (reasonEl && reasonEl.value.trim()) || "";
                  const amount = amountEl ? parseInt(amountEl.value, 10) : NaN;
                  if (!houseNo || isNaN(amount)) {
                    showHintLocal("請選擇戶號並填入有效的點數", "error");
                    return;
                  }
                  if (!auth.currentUser) {
                    await new Promise(resolve => {
                      const unsub = onAuthStateChanged(auth, u => { unsub(); resolve(u); });
                    });
                  }
                  const operatorId = auth.currentUser ? auth.currentUser.uid : "";
                  let operatorName = (auth.currentUser && auth.currentUser.displayName) ? auth.currentUser.displayName : "";
                  const operator = auth.currentUser ? (auth.currentUser.email || auth.currentUser.uid) : "未知";
                  if (!operatorName && operatorId) {
                    try {
                      const osnap = await getDoc(doc(db, "users", operatorId));
                      if (osnap.exists()) {
                        operatorName = osnap.data().displayName || operatorName;
                      }
                    } catch {}
                  }
                  let balance = 0;
                  try {
                    const bdoc = await getDoc(doc(db, `communities/${slug}/points_balances/${houseNo}`));
                    if (bdoc.exists()) balance = bdoc.data().balance || 0;
                  } catch {}
                  const newBalance = balance + amount;
                  try {
                    await addDoc(collection(db, `communities/${slug}/app_modules/points_logs`), {
                      houseNo,
                      reason,
                      delta: amount,
                      operator,
                      operatorId,
                      operatorName,
                      createdAt: Date.now()
                    });
                    await setDoc(doc(db, `communities/${slug}/app_modules/points_balances/${houseNo}`), {
                      balance: newBalance,
                      updatedAt: Date.now()
                    }, { merge: true });
                    await syncPointsToUsers(slug, houseNo, newBalance);
                  } catch (werr) {
                    const pointsDocRef = doc(db, `communities/${slug}/app_modules/points`);
                    let prev = {};
                    try {
                      const psnap = await getDoc(pointsDocRef);
                      if (psnap.exists()) prev = psnap.data() || {};
                    } catch {}
                    const logs = Array.isArray(prev.logs) ? prev.logs.slice() : [];
                    logs.push({ houseNo, reason, delta: amount, operator, operatorId, operatorName, createdAt: Date.now() });
                    const balances = typeof prev.balances === "object" && prev.balances ? { ...prev.balances } : {};
                    balances[houseNo] = newBalance;
                    await setDoc(pointsDocRef, { logs, balances, updatedAt: Date.now() }, { merge: true });
                    await syncPointsToUsers(slug, houseNo, newBalance);
                  }
                  closeModal();
                  showHint("已新增點數", "success");
                  // trigger summary refresh if current selected
                  const evt = new Event("change");
                  sel.dispatchEvent(evt);
                } catch (e) {
                  console.error(e);
                  showHintLocal("新增失敗", "error");
                }
              });
            });
            
            const btnAuto = adminNav.content.querySelector("#btn-auto-points");

            
            // Sync Button Handler
            const btnSync = adminNav.content.querySelector("#btn-sync-points");
            btnSync && btnSync.addEventListener("click", async () => {
                if(!confirm("確定要將目前社區的所有點數資料同步寫入到使用者的個人資料欄位嗎？\n(這可能需要一點時間)")) return;
                
                btnSync.disabled = true;
                btnSync.textContent = "同步中...";
                
                try {
                    let totalSynced = 0;
                    // 1. Get all balances from collection
                    let balancesMap = {};
                    try {
                        const snapB = await getDocs(collection(db, `communities/${slug}/points_balances`));
                        snapB.docs.forEach(d => {
                            balancesMap[d.id] = d.data().balance || 0;
                        });
                    } catch {}

                    // 2. Get balances from single doc (fallback/merge)
                    try {
                        const pDoc = await getDoc(doc(db, `communities/${slug}/app_modules/points`));
                        if (pDoc.exists()) {
                            const data = pDoc.data();
                            const bmap = data.balances || {};
                            Object.keys(bmap).forEach(h => {
                                // If not present in collection or preferred source, take this
                                // Assuming collection is source of truth if exists, but let's just merge
                                if (balancesMap[h] === undefined) {
                                    balancesMap[h] = bmap[h];
                                }
                            });
                        }
                    } catch {}
                    
                    const houseNos = Object.keys(balancesMap);
                    console.log(`[Sync] Found ${houseNos.length} houses with points.`);

                    // 3. Batch update users
                    // We need to find users by houseNo. 
                    // Since we can't do a massive "IN" query easily for all, we iterate or chunk.
                    // Given scale, iterating query by houseNo is acceptable or query all community users first.
                    
                    // Fetch all community users first to avoid N reads
                    const qUsers = query(collection(db, "users"), where("community", "==", slug));
                    const snapUsers = await getDocs(qUsers);
                    const usersByHouse = {};
                    snapUsers.docs.forEach(d => {
                        const u = d.data();
                        const h = u.houseNo;
                        if(h) {
                            if(!usersByHouse[h]) usersByHouse[h] = [];
                            usersByHouse[h].push(d.id);
                        }
                    });
                    
                    // 4. Update
                    let updates = [];
                    for(const h of houseNos) {
                        const balance = balancesMap[h];
                        const uids = usersByHouse[h];
                        if(uids && uids.length > 0) {
                            uids.forEach(uid => {
                                updates.push(updateDoc(doc(db, "users", uid), { points: balance }));
                                totalSynced++;
                            });
                        }
                    }
                    
                    // Chunk promises to avoid overwhelming
                    const chunkSize = 50;
                    for (let i = 0; i < updates.length; i += chunkSize) {
                        await Promise.all(updates.slice(i, i + chunkSize));
                    }
                    
                    showHint(`同步完成！共更新了 ${totalSynced} 位住戶的點數資料`, "success");
                } catch(e) {
                    console.error(e);
                    showHint("同步失敗: " + e.message, "error");
                } finally {
                    btnSync.disabled = false;
                    btnSync.textContent = "同步舊資料";
                }
            });
            btnAuto && btnAuto.addEventListener("click", async () => {
              const dayOptions = Array.from({length:31}, (_,i) => `<option value="${i+1}">${i+1}</option>`).join("");
              const hourOptions = Array.from({length:24}, (_,i) => `<option value="${i}">${i}</option>`).join("");
              const minuteOptions = Array.from({length:60}, (_,i) => `<option value="${i}">${i}</option>`).join("");
              const body = `
                <div class="modal-dialog">
                  <div class="modal-head"><div class="modal-title">自動新增點數</div></div>
                  <div class="modal-body">
                    <div class="modal-row">
                      <label>套用該社區全部戶號（唯一設定）</label>
                    </div>
                    <div class="modal-row">
                      <label>原因</label>
                      <input type="text" id="auto-reason" value="每月新增">
                    </div>
                    <div class="modal-row">
                      <label>點數</label>
                      <input type="number" id="auto-amount" placeholder="例如：10">
                    </div>
                    <div class="modal-row">
                      <label>自動新增日期時間</label>
                      <div style="display:flex;gap:8px;align-items:center;">
                        <select id="auto-day" style="width:90px;"><option value="">日</option>${dayOptions}</select>
                        <select id="auto-hour" style="width:90px;"><option value="">時</option>${hourOptions}</select>
                        <select id="auto-minute" style="width:90px;"><option value="">分</option>${minuteOptions}</select>
                      </div>
                    </div>
                    <div class="modal-row">
                      <label>原點數是否在新增時歸0</label>
                      <input type="checkbox" id="auto-reset" style="width:14px;height:14px;">
                    </div>
                    <div class="hint" id="auto-hint"></div>
                  </div>
                  <div class="modal-foot">
                    <button id="auto-cancel" class="btn action-btn danger">取消</button>
                    <button id="auto-save" class="btn action-btn">儲存</button>
                  </div>
                </div>
              `;
              openModal(body);
              try {
                let preset = null;
                try {
                  const jsnap = await getDoc(doc(db, `communities/${slug}/app_modules/points_auto_job`));
                  if (jsnap.exists()) preset = jsnap.data();
                } catch {}
                if (!preset) {
                  try {
                    const psnap = await getDoc(doc(db, `communities/${slug}/app_modules/points`));
                    if (psnap.exists()) {
                      const data = psnap.data();
                      preset = data.autoJob || null;
                    }
                  } catch {}
                }
                if (preset) {
                  const r = document.getElementById("auto-reason");
                  const a = document.getElementById("auto-amount");
                  const d = document.getElementById("auto-day");
                  const h = document.getElementById("auto-hour");
                  const m = document.getElementById("auto-minute");
                  const x = document.getElementById("auto-reset");
                  if (r) r.value = preset.reason || r.value;
                  if (a) a.value = typeof preset.amount === "number" ? String(preset.amount) : a.value;
                  if (d) d.value = typeof preset.dayOfMonth === "number" ? String(preset.dayOfMonth) : "";
                  if (h) h.value = typeof preset.hour === "number" ? String(preset.hour) : "";
                  if (m) m.value = typeof preset.minute === "number" ? String(preset.minute) : "";
                  if (x) x.checked = !!preset.resetBeforeAdd;
                }
              } catch {}
              const cancel = document.getElementById("auto-cancel");
              const save = document.getElementById("auto-save");
              const hintEl = document.getElementById("auto-hint");
              const showHintLocal = (msg, type="error") => {
                if (hintEl) {
                  hintEl.textContent = msg;
                  hintEl.style.color = type === "error" ? "#b71c1c" : "#0ea5e9";
                }
              };
              cancel && cancel.addEventListener("click", () => closeModal());
              save && save.addEventListener("click", async () => {
                try {
                  const selected = houseNos.slice();
                  const reason = (document.getElementById("auto-reason").value || "").trim();
                  const amount = parseInt(document.getElementById("auto-amount").value || "NaN", 10);
                  const day = parseInt(document.getElementById("auto-day").value || "NaN", 10);
                  const hour = parseInt(document.getElementById("auto-hour").value || "NaN", 10);
                  const minute = parseInt(document.getElementById("auto-minute").value || "NaN", 10);
                  const reset = !!document.getElementById("auto-reset").checked;
                  if (!selected.length || isNaN(amount) || isNaN(day) || isNaN(hour) || isNaN(minute)) {
                    showHintLocal("請選擇住戶並填寫有效的點數與時間", "error");
                    return;
                  }
                  if (!auth.currentUser) {
                    await new Promise(resolve => {
                      const unsub = onAuthStateChanged(auth, u => { unsub(); resolve(u); });
                    });
                  }
                  const operatorId = auth.currentUser ? auth.currentUser.uid : "";
                  let operatorName = (auth.currentUser && auth.currentUser.displayName) ? auth.currentUser.displayName : "";
                  const operator = auth.currentUser ? (auth.currentUser.email || auth.currentUser.uid) : "未知";
                  if (!operatorName && operatorId) {
                    try {
                      const osnap = await getDoc(doc(db, "users", operatorId));
                      if (osnap.exists()) operatorName = osnap.data().displayName || operatorName;
                    } catch {}
                  }
                  const payload = {
                    houseNos: selected,
                    reason: reason || "每月新增",
                    amount,
                    dayOfMonth: day,
                    hour,
                    minute,
                    resetBeforeAdd: reset,
                    createdBy: operator,
                    createdById: operatorId,
                    createdByName: operatorName,
                    createdAt: Date.now(),
                    status: "active"
                  };
                  try {
                    await setDoc(doc(db, `communities/${slug}/app_modules/points_auto_job`), payload, { merge: true });
                  } catch (werr) {
                    const pointsDocRef = doc(db, `communities/${slug}/app_modules/points`);
                    await setDoc(pointsDocRef, { autoJob: payload, updatedAt: Date.now() }, { merge: true });
                  }
                  closeModal();
                  showHint("已儲存自動新增設定", "success");
                } catch (e) {
                  console.error(e);
                  showHintLocal("儲存失敗", "error");
                }
              });
            });
          }
        } catch {}
      })();
      return;
    }
    if (sub === "通知") {
      adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">住戶通知</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "警報") {
      (async () => {
        // 1. Initial Skeleton Render
        adminNav.content.innerHTML = `
          <div class="card data-card" style="height: 96%; display: flex; flex-direction: column;">
            <div class="card-head" style="flex-wrap: wrap; gap: 10px;">
              <h1 class="card-title">住戶警報紀錄</h1>
              <div class="card-filters" style="display: flex; gap: 8px; margin-left: auto; align-items: center;">
                <input type="date" id="sos-filter-date" style="padding: 6px; border: 1px solid #ddd; border-radius: 4px;">
                <input type="text" id="sos-filter-house" placeholder="搜尋戶號" style="padding: 6px; border: 1px solid #ddd; border-radius: 4px; width: 100px;">
                <button class="btn small" id="btn-export-sos" style="background-color: #10b981; color: white;">匯出</button>
              </div>
            </div>
            <div class="table-wrap" style="flex: 1; overflow: auto;">
              <table class="table">
                <thead>
                  <tr>
                    <th style="position: sticky; top: 0; z-index: 10;">時間</th>
                    <th style="position: sticky; top: 0; z-index: 10;">戶號</th>
                    <th style="position: sticky; top: 0; z-index: 10;">子戶號</th>
                    <th style="position: sticky; top: 0; z-index: 10;">姓名</th>
                    <th style="position: sticky; top: 0; z-index: 10;">地址</th>
                    <th style="position: sticky; top: 0; z-index: 10;">狀態</th>
                    <th style="position: sticky; top: 0; z-index: 10;">操作</th>
                    <th style="position: sticky; top: 0; z-index: 10;">解除時間</th>
                    <th style="position: sticky; top: 0; z-index: 10;">完成時間</th>
                  </tr>
                </thead>
                <tbody id="sos-list-tbody">
                  <tr><td colspan="9" style="text-align:center">載入中...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        `;

        try {
          // Wait for Auth to initialize if needed
          if (!auth.currentUser) {
            await new Promise(resolve => {
               const unsub = onAuthStateChanged(auth, (u) => {
                 unsub();
                 resolve(u);
               });
            });
          }

          let slug = window.currentAdminCommunitySlug || getSlugFromPath() || getQueryParam("c") || "default";
          if (slug === "default" && auth.currentUser) {
             try {
                slug = await getUserCommunity(auth.currentUser.uid);
             } catch(e) { console.error("Error getting user community:", e); }
          }
          
          let communityName = "社區";
          try {
             const cDoc = await getDoc(doc(db, "communities", slug));
             if (cDoc.exists()) communityName = cDoc.data().name || slug;
          } catch(e) {}

          let allAlerts = [];
          
          // 2. Setup Real-time Listener
          const q = query(collection(db, "sos_alerts"), where("community", "==", slug));
          
          // Define Custom Modals for SOS
          function showCompleteSOSModal(docId, currentData, onSuccess) {
             const modal = document.createElement("div");
             modal.className = "modal";
             modal.style.display = "flex";
             modal.style.zIndex = "100002"; // Higher than normal
             
             let handlers = [];
             try {
                 handlers = JSON.parse(localStorage.getItem("sos_handlers_history") || "[]");
             } catch {}
             const handlerOptions = handlers.map(h => `<option value="${h}">`).join("");
             
             // Current time in local ISO format for input
             const now = new Date();
             now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
             const nowStr = now.toISOString().slice(0, 16);

             modal.innerHTML = `
               <div class="modal-dialog">
                 <div class="modal-head">
                   <div class="modal-title">完成處理回報</div>
                 </div>
                 <div class="modal-body">
                     <label class="field">
                         <div class="field-head">處理時間</div>
                         <input type="datetime-local" id="sos-complete-time" value="${nowStr}" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px;">
                     </label>
                     <label class="field">
                         <div class="field-head">處理人</div>
                         <input type="text" id="sos-complete-handler" list="sos-handler-list" placeholder="請輸入處理人員姓名" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px;">
                         <datalist id="sos-handler-list">${handlerOptions}</datalist>
                     </label>
                     <label class="field">
                         <div class="field-head">處理紀錄</div>
                         <textarea id="sos-complete-record" rows="4" placeholder="請輸入詳細處理過程..." style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px;"></textarea>
                     </label>
                     <label class="field">
                         <div class="field-head">上傳照片</div>
                         <input type="file" id="sos-complete-photo" accept="image/*" style="width:100%;">
                     </label>
                 </div>
                 <div class="modal-foot">
                   <button class="btn" id="btn-cancel-complete">取消</button>
                   <button class="btn primary" id="btn-confirm-complete">確認完成</button>
                 </div>
               </div>
             `;
             
             document.body.appendChild(modal);
             
             const close = () => { modal.remove(); };
             
             modal.querySelector("#btn-cancel-complete").addEventListener("click", close);
             
             modal.querySelector("#btn-confirm-complete").addEventListener("click", async () => {
                 const btn = modal.querySelector("#btn-confirm-complete");
                 const timeVal = modal.querySelector("#sos-complete-time").value;
                 const handlerVal = modal.querySelector("#sos-complete-handler").value.trim();
                 const recordVal = modal.querySelector("#sos-complete-record").value.trim();
                 const fileInput = modal.querySelector("#sos-complete-photo");
                 
                 if (!timeVal || !handlerVal || !recordVal) {
                     alert("請填寫所有必填欄位 (時間、處理人、紀錄)");
                     return;
                 }
                 
                 btn.disabled = true;
                 btn.textContent = "處理中...";
                 
                 try {
                     if (handlerVal && !handlers.includes(handlerVal)) {
                         handlers.push(handlerVal);
                         localStorage.setItem("sos_handlers_history", JSON.stringify(handlers));
                     }
                     
                     let photoUrl = "";
                     if (fileInput.files[0]) {
                         const file = fileInput.files[0];
                         const storage = getStorage();
                         const fileRef = storageRef(storage, `sos_evidence/${currentData.community}/${docId}/${Date.now()}_${file.name}`);
                         await uploadBytes(fileRef, file);
                         photoUrl = await getDownloadURL(fileRef);
                     }
                     
                     const updateData = {
                         status: "completed",
                         completedAt: new Date(timeVal).toISOString(),
                         handler: handlerVal,
                         processRecord: recordVal,
                         processPhotoUrl: photoUrl
                     };
                     
                     await onSuccess(updateData);
                     close();
                 } catch (e) {
                     console.error(e);
                     alert("儲存失敗: " + e.message);
                     btn.disabled = false;
                     btn.textContent = "確認完成";
                 }
             });
          }

          function showProcessViewModal(data) {
             if (!data) return;
             const modal = document.createElement("div");
             modal.className = "modal"; // Outer modal container for backdrop and centering
             modal.style.display = "flex"; // Ensure visible
             modal.style.zIndex = "100005";
             
             const timeStr = data.createdAt ? new Date(data.createdAt).toLocaleString() : "未知時間";
             const completeTimeStr = data.completedAt ? new Date(data.completedAt).toLocaleString() : "未記錄";
             
             modal.innerHTML = `
               <div class="link-view-dialog">
                 <div class="link-view-head">
                     <div class="link-view-title">警報處理詳情</div>
                     <button class="link-view-close" style="font-size:24px;">&times;</button>
                 </div>
                 <div class="link-view-body" style="padding: 20px; overflow-y: auto;">
                     <div style="max-width: 800px; margin: 0 auto;">
                         <h3 style="border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 20px;">基本資訊</h3>
                         <div class="field" style="margin-bottom: 10px;"><label style="font-weight:bold; width:80px; display:inline-block;">時間：</label> <span>${timeStr}</span></div>
                         <div class="field" style="margin-bottom: 10px;"><label style="font-weight:bold; width:80px; display:inline-block;">戶號：</label> <span>${data.houseNo || "-"}</span></div>
                         <div class="field" style="margin-bottom: 10px;"><label style="font-weight:bold; width:80px; display:inline-block;">住戶：</label> <span>${data.name || "-"}</span></div>
                         <div class="field" style="margin-bottom: 10px;"><label style="font-weight:bold; width:80px; display:inline-block;">地址：</label> <span>${data.address || "-"}</span></div>
                        <div class="field" style="margin-bottom: 10px;"><label style="font-weight:bold; width:80px; display:inline-block;">訊息：</label> <span style="color: #ef4444; font-weight: bold;">${data.message || "無訊息"}</span></div>
                        
                        <h3 style="border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 20px; margin-top: 40px;">處理紀錄</h3>
                         <div class="field" style="margin-bottom: 10px;"><label style="font-weight:bold; width:80px; display:inline-block;">完成時間：</label> <span>${completeTimeStr}</span></div>
                         <div class="field" style="margin-bottom: 10px;"><label style="font-weight:bold; width:80px; display:inline-block;">處理人：</label> <span>${data.handler || "-"}</span></div>
                         <div class="field" style="margin-bottom: 10px;">
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">處理過程：</label> 
                            <p style="white-space: pre-wrap; background: #f9f9f9; padding: 15px; border-radius: 8px; border:1px solid #eee; margin:0;">${data.processRecord || "無紀錄"}</p>
                         </div>
                         
                         ${data.processPhotoUrl ? `
                         <div class="field" style="margin-top: 20px;">
                             <label style="font-weight:bold; display:block; margin-bottom:5px;">現場照片：</label>
                             <div style="margin-top: 10px;">
                                 <img src="${data.processPhotoUrl}" style="max-width: 100%; max-height: 500px; border-radius: 8px; border: 1px solid #ddd; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                             </div>
                         </div>` : ""}
                     </div>
                 </div>
               </div>
             `;
             
             document.body.appendChild(modal);
             
             modal.querySelector(".link-view-close").addEventListener("click", () => modal.remove());
          }

          function renderSOSList() {
             const dateFilter = document.getElementById("sos-filter-date").value;
             const houseFilter = (document.getElementById("sos-filter-house").value || "").trim().toLowerCase();
             
             let filtered = allAlerts;
             
             if (dateFilter) {
                 filtered = filtered.filter(a => {
                     const d = new Date(a.createdAt);
                     // Create date string YYYY-MM-DD in local time
                     const y = d.getFullYear();
                     const m = String(d.getMonth() + 1).padStart(2, "0");
                     const day = String(d.getDate()).padStart(2, "0");
                     return `${y}-${m}-${day}` === dateFilter;
                 });
             }
             
             if (houseFilter) {
                 filtered = filtered.filter(a => (a.houseNo || "").toLowerCase().includes(houseFilter));
             }
             
             const rows = filtered.map(a => {
               const time = new Date(a.createdAt).toLocaleString();
               let statusClass = "danger";
               let statusText = "警報中";
               let actionBtns = "";

               if (a.status === "resolved") {
                   statusClass = "warning";
                   statusText = "已解除";
               } else if (a.status === "completed") {
                   statusClass = "success";
                   statusText = "後續處理完成";
               }

               // Status Column Display Logic
               let badgeStyle = "color: #ef4444;"; // Red for active
               if (a.status === "resolved") badgeStyle = "color: #f59e0b;"; // Amber for resolved
               if (a.status === "completed") badgeStyle = "color: #10b981;"; // Green for completed

               // Operation Column Buttons
               if (a.status === "active" || !a.status) {
                   actionBtns += `<button class="btn small action-btn btn-resolve-sos" style="margin-right: 5px;">解除</button>`;
               } else if (a.status === "resolved") {
                   actionBtns += `<button class="btn small action-btn btn-complete-sos" style="margin-right: 5px;">完成</button>`;
               } else if (a.status === "completed") {
                   actionBtns += `<button class="btn small action-btn btn-view-process" style="margin-right: 5px; background-color: #8b5cf6; color: white;">處理</button>`;
               }
               
               // Delete button is always available
               actionBtns += `<button class="btn small action-btn danger btn-delete-sos">刪除</button>`;

               const resolvedTime = a.resolvedAt ? new Date(a.resolvedAt).toLocaleString() : "-";
               const completedTime = a.completedAt ? new Date(a.completedAt).toLocaleString() : "-";

               return `
                 <tr data-id="${a.id}">
                   <td>${time}</td>
                   <td>${a.houseNo || ""}</td>
                   <td>${a.subNo || ""}</td>
                   <td>${a.name || ""}</td>
                   <td>${a.address || ""}</td>
                   <td><span class="status ${statusClass}" style="${badgeStyle}">${statusText}</span></td>
                   <td>
                     ${actionBtns}
                   </td>
                   <td>${resolvedTime}</td>
                   <td>${completedTime}</td>
                 </tr>
               `;
             }).join("");
             
             const tbody = document.getElementById("sos-list-tbody");
             if(tbody) {
                tbody.innerHTML = rows || '<tr><td colspan="9" style="text-align:center">無符合條件的警報紀錄</td></tr>';
                
                // Bind Resolve Buttons
                tbody.querySelectorAll(".btn-resolve-sos").forEach(btn => {
                  btn.addEventListener("click", () => {
                    const tr = btn.closest("tr");
                    const id = tr.getAttribute("data-id");
                    showConfirmModal(
                      "解除警報確認",
                      "確定要解除此警報嗎？<br>解除後狀態將變更為「已解除」。",
                      "確認解除",
                      "primary",
                      async () => {
                        await setDoc(doc(db, "sos_alerts", id), { 
                            status: "resolved",
                            resolvedAt: new Date().toISOString()
                        }, { merge: true });
                      }
                    );
                  });
                });

                // Bind Complete Buttons
                tbody.querySelectorAll(".btn-complete-sos").forEach(btn => {
                  btn.addEventListener("click", () => {
                    const tr = btn.closest("tr");
                    const id = tr.getAttribute("data-id");
                    const currentData = allAlerts.find(a => a.id === id);
                    
                    showCompleteSOSModal(id, currentData, async (updateData) => {
                         await setDoc(doc(db, "sos_alerts", id), updateData, { merge: true });
                    });
                  });
                });

                // Bind View Process Buttons
                tbody.querySelectorAll(".btn-view-process").forEach(btn => {
                  btn.addEventListener("click", () => {
                    const tr = btn.closest("tr");
                    const id = tr.getAttribute("data-id");
                    const data = allAlerts.find(a => a.id === id);
                    showProcessViewModal(data);
                  });
                });

                // Bind Delete Buttons
                tbody.querySelectorAll(".btn-delete-sos").forEach(btn => {
                  btn.addEventListener("click", () => {
                    const tr = btn.closest("tr");
                    const id = tr.getAttribute("data-id");
                    showConfirmModal(
                      "刪除紀錄確認",
                      "⚠️ 警告：確定要永久刪除此紀錄嗎？<br>此動作無法復原。",
                      "確認刪除",
                      "danger",
                      async () => {
                        await deleteDoc(doc(db, "sos_alerts", id));
                      }
                    );
                  });
                });
             }
             return filtered; // Return for export
          }
          
          // Bind Filter Events
          document.getElementById("sos-filter-date").addEventListener("change", renderSOSList);
          document.getElementById("sos-filter-house").addEventListener("input", renderSOSList);
          
          // Bind Export Event
          document.getElementById("btn-export-sos").addEventListener("click", () => {
              const filtered = renderSOSList();
              if (!filtered || !filtered.length) {
                  alert("目前無資料可匯出");
                  return;
              }
              
              const exportData = filtered.map(a => ({
                  "時間": new Date(a.createdAt).toLocaleString(),
                  "戶號": a.houseNo || "",
                  "子戶號": a.subNo || "",
                  "姓名": a.name || "",
                  "地址": a.address || "",
                  "狀態": a.status === "resolved" ? "已解除" : (a.status === "completed" ? "後續處理完成" : "警報中"),
                  "解除時間": a.resolvedAt ? new Date(a.resolvedAt).toLocaleString() : "",
                  "完成時間": a.completedAt ? new Date(a.completedAt).toLocaleString() : "",
                  "處理人": a.handler || "",
                  "處理紀錄": a.processRecord || ""
              }));
              
              const wb = XLSX.utils.book_new();
              const ws = XLSX.utils.json_to_sheet(exportData);
              XLSX.utils.book_append_sheet(wb, ws, "警報紀錄");
              
              const now = new Date();
              const y = now.getFullYear();
              const m = String(now.getMonth() + 1).padStart(2, "0");
              const d = String(now.getDate()).padStart(2, "0");
              const filename = `${communityName}住戶警報紀錄_${y}${m}${d}.xlsx`;
              
              XLSX.writeFile(wb, filename);
          });

          window.sosListUnsub = onSnapshot(q, (snap) => {
             allAlerts = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => b.createdAt - a.createdAt);
             renderSOSList();
          }, (error) => {
             console.error("SOS Listener Error:", error);
             const tbody = document.getElementById("sos-list-tbody");
             if(tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:red">載入失敗: ${error.message}</td></tr>`;
          });

        } catch (e) {
          console.error(e);
          const tbody = document.getElementById("sos-list-tbody");
          if(tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:red">載入失敗</td></tr>';
        }
      })();
      return;
    }
    if (sub === "設定") {
      adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">住戶設定</h1></div><div class="empty-hint">尚未建立設定</div></div>`;
      return;
    }
  }
  if (mainKey === "others") {
    if (sub === "日誌") {
      adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">日誌</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "班表") {
      adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">班表</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "通訊") {
      adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">通訊</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "巡邏") {
      adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">巡邏</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "設定") {
      adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">其他設定</h1></div><div class="empty-hint">尚未建立設定</div></div>`;
      return;
    }
  }
  adminNav.content.innerHTML = "";
}

function openCommunitySwitchModal() {
  (async () => {
    let items = [];
    try {
      const snap = await getDocs(collection(db, "communities"));
      items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {}
    const current = window.currentAdminCommunitySlug || "";
    const list = items.map(c => `
      <button class="btn action-btn ${c.id === current ? "primary" : ""}" data-slug="${c.id}">${c.name || c.id}</button>
    `).join("");
    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">切換社區</div></div>
        <div class="modal-body">
          <div class="modal-row">${list || "<div class='empty-hint'>尚未建立社區</div>"}</div>
        </div>
        <div class="modal-foot">
          <button id="switch-cancel" class="btn action-btn danger">關閉</button>
        </div>
      </div>
    `;
    openModal(body);
    const btns = Array.from(document.querySelectorAll(".modal-body .btn.action-btn"));
    btns.forEach(b => {
      b.addEventListener("click", async () => {
        const slug = b.getAttribute("data-slug");
        if (slug) {
          window.currentAdminCommunitySlug = slug;
          try {
            localStorage.setItem("adminCurrentCommunity", slug);
            const url = new URL(window.location);
            url.searchParams.set("c", slug);
            window.history.pushState({}, "", url);
          } catch {}
          
          closeModal();
          
          // Show loading to indicate change
          if (adminNav.content) adminNav.content.innerHTML = '<div style="padding:40px;text-align:center;color:#666;">載入中...</div>';
          
          await updateAdminBrandTitle();
          
          const savedMain = localStorage.getItem("adminActiveMain") || "shortcuts";
          setActiveAdminNav(savedMain);
          
          // Re-trigger content render if setActiveAdminNav didn't do it (though it should)
          // or if we need to ensure the correct sub-tab is loaded
          if (adminNav.subContainer) {
             // setActiveAdminNav calls renderAdminSubNav which renders the initial/saved sub-tab.
             // So we don't need to do much else.
          } else if (sysNav.subContainer) {
             const activeSub = sysNav.subContainer.querySelector('.sub-nav-item.active');
             if (activeSub) {
               const label = (activeSub.getAttribute('data-label') || activeSub.textContent || '').replace(/\u200B/g, '').trim();
               renderContentFor(savedMain, label);
             } else {
               renderSubNav(savedMain);
             }
          }
        }
      });
    });
    const btnCancel = document.getElementById("switch-cancel");
    btnCancel && btnCancel.addEventListener("click", () => closeModal());
  })();
}

async function updateAdminBrandTitle() {
  const el = document.querySelector("#admin-stack .sys-title");
  if (!el) return;
  let slug = window.currentAdminCommunitySlug || localStorage.getItem("adminCurrentCommunity") || getSlugFromPath() || getQueryParam("c") || "default";
  if (slug === "default") {
    try {
      const snap = await getDocs(collection(db, "communities"));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (list.length > 0) slug = list[0].id;
    } catch {}
    if (slug === "default" && auth.currentUser) {
      slug = await getUserCommunity(auth.currentUser.uid);
    }
  }
  let cname = slug;
  try {
    const csnap = await getDoc(doc(db, "communities", slug));
    if (csnap.exists()) {
      const c = csnap.data();
      cname = c.name || slug;
    }
  } catch {}
  window.currentCommunityName = cname;
  el.textContent = `西北e生活 社區後台（${cname}）`;
}
if (!window.openCreateResidentModal) {
  function openCreateResidentModal(slug) {
    const title = "新增住戶";
    const seqGuess = (() => {
      try {
        const tbody = document.querySelector("#admin-stack .row.B3")?.querySelector("tbody");
        if (tbody) return String(tbody.querySelectorAll("tr").length + 1);
      } catch {}
      return "";
    })();
    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">${title}</div></div>
        <div class="modal-body">
          <div class="modal-row">
            <label>大頭照</label>
            <input type="file" id="create-r-photo-file" accept="image/png,image/jpeg">
          </div>
          <div class="modal-row">
            <label>預覽</label>
            <img id="create-r-photo-preview" class="avatar-preview">
          </div>
          <div class="modal-row">
            <label>序號</label>
            <input type="text" id="create-r-seq" value="${seqGuess}">
          </div>
          <div class="modal-row">
            <label>戶號</label>
            <input type="text" id="create-r-house-no" placeholder="例如 A-1201">
          </div>
          <div class="modal-row">
            <label>子戶號</label>
            <input type="number" id="create-r-sub-no" placeholder="數字">
          </div>
          <div class="modal-row">
            <label>QR 預覽</label>
            <img id="create-r-qr-preview" class="qr-preview">
          </div>
          <div class="modal-row">
            <label>QR code 代碼</label>
            <input type="text" id="create-r-qr-code" placeholder="輸入QR內容文字">
          </div>
          <div class="modal-row">
            <label>姓名</label>
            <input type="text" id="create-r-name">
          </div>
          <div class="modal-row">
            <label>地址</label>
            <input type="text" id="create-r-address" placeholder="住址">
          </div>
          <div class="modal-row">
            <label>坪數</label>
            <input type="number" id="create-r-area" placeholder="例如 35.5">
          </div>
          <div class="modal-row">
            <label>區分權比</label>
            <input type="number" id="create-r-ownership" placeholder="例如 1.5">
          </div>
          <div class="modal-row">
            <label>手機號碼</label>
            <input type="tel" id="create-r-phone">
          </div>
          <div class="modal-row">
            <label>電子郵件</label>
            <input type="text" id="create-r-email" placeholder="example@domain.com">
          </div>
          <div class="modal-row">
            <label>密碼</label>
            <input type="text" id="create-r-password" placeholder="至少6字元" value="123456">
          </div>
          <div class="modal-row">
            <label>狀態</label>
            <select id="create-r-status">
              <option value="啟用">啟用</option>
              <option value="停用" selected>停用</option>
            </select>
          </div>
          <div class="hint" id="create-r-hint"></div>
        </div>
        <div class="modal-foot">
          <button id="create-r-cancel" class="btn action-btn danger">取消</button>
          <button id="create-r-save" class="btn action-btn">建立</button>
        </div>
      </div>
    `;
    openModal(body);
    const btnCancel = document.getElementById("create-r-cancel");
    const btnSave = document.getElementById("create-r-save");
    const createFile = document.getElementById("create-r-photo-file");
    const createPreview = document.getElementById("create-r-photo-preview");
    const qrPreview = document.getElementById("create-r-qr-preview");
    const qrCodeInput = document.getElementById("create-r-qr-code");
    const hintEl = document.getElementById("create-r-hint");
    
    const showModalHint = (msg, type="error") => {
      if(hintEl) {
        hintEl.textContent = msg;
        hintEl.style.color = type === "error" ? "#b71c1c" : "#0ea5e9";
      }
    };
    createFile && createFile.addEventListener("change", () => {
      const f = createFile.files[0];
      if (f) createPreview.src = URL.createObjectURL(f);
    });
    qrCodeInput && qrCodeInput.addEventListener("input", async () => {
      const val = qrCodeInput.value.trim();
      if (!qrPreview) return;
      if (!val) {
        qrPreview.src = "";
      } else {
        const url = await getQrDataUrl(val, 64);
        qrPreview.src = url;
      }
    });
    (async () => {
      const val = qrCodeInput ? qrCodeInput.value.trim() : "";
      if (qrPreview && val) {
        const url = await getQrDataUrl(val, 64);
        qrPreview.src = url;
      }
    })();
    btnCancel && btnCancel.addEventListener("click", () => closeModal());
    btnSave && btnSave.addEventListener("click", async () => {
      try {
        showModalHint(""); 
        const email = document.getElementById("create-r-email").value.trim();
        const password = document.getElementById("create-r-password").value;
        const displayName = document.getElementById("create-r-name").value.trim();
        const phone = document.getElementById("create-r-phone").value.trim();
        const photoFile = document.getElementById("create-r-photo-file").files[0];
        const houseNo = document.getElementById("create-r-house-no").value.trim();
        const subNoRaw = document.getElementById("create-r-sub-no").value.trim();
        const address = document.getElementById("create-r-address").value.trim();
        const area = document.getElementById("create-r-area").value.trim();
        const ownershipRatio = document.getElementById("create-r-ownership").value.trim();
        const qrCodeText = document.getElementById("create-r-qr-code").value.trim();
        const status = document.getElementById("create-r-status").value;
        let photoURL = "";
        if (!email || !password || password.length < 6) {
          showModalHint("請填寫有效的信箱與至少6字元密碼", "error");
          return;
        }
        btnSave.disabled = true;
        btnSave.textContent = "建立中...";
        const cred = await createUserWithEmailAndPassword(createAuth, email, password);
        if (photoFile) {
          try {
            const ext = photoFile.type === "image/png" ? "png" : "jpg";
            const path = `avatars/${cred.user.uid}.${ext}`;
            const ref = storageRef(storage, path);
            await uploadBytes(ref, photoFile, { contentType: photoFile.type });
            photoURL = await getDownloadURL(ref);
          } catch (err) {
            try {
              const b64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(photoFile);
              });
              photoURL = b64;
              showModalHint("Storage 上傳失敗，已改用內嵌圖片儲存", "error");
            } catch {
              showModalHint("上傳大頭照失敗，帳號仍已建立", "error");
            }
          }
        }
        await setDoc(doc(db, "users", cred.user.uid), {
          email,
          role: "住戶",
          status: status || "停用",
          displayName,
          phone,
          photoURL,
          houseNo,
          address,
          area,
          ownershipRatio,
          qrCodeText,
          ...(subNoRaw !== "" ? { subNo: parseInt(subNoRaw, 10) } : {}),
          community: slug,
          createdAt: Date.now()
        }, { merge: true });
        await updateProfile(cred.user, { displayName, photoURL });
        closeModal();
        showHint("已建立住戶帳號", "success");
        const savedMain = localStorage.getItem("adminActiveMain") || "residents";
        setActiveAdminNav(savedMain);
      } catch (e) {
        console.error(e);
        let msg = "建立失敗";
        if (e.code === 'auth/email-already-in-use') msg = "該 Email 已被使用";
        else if (e.code === 'auth/invalid-email') msg = "Email 格式不正確";
        else if (e.code === 'auth/weak-password') msg = "密碼強度不足";
        else if (e.message) msg += ": " + e.message;
        showModalHint(msg, "error");
      } finally {
        if(btnSave) {
          btnSave.disabled = false;
          btnSave.textContent = "建立";
        }
      }
    });
  }
  window.openCreateResidentModal = openCreateResidentModal;
}
if (!window.openEditModal) {
  async function openEditModal(target, isSelf) {
    const isResident = (target.role || "住戶") === "住戶";
    if (isResident) {
      const titleR = "編輯住戶";
      const seqR = target.seq || "";
      const bodyR = `
        <div class="modal-dialog">
          <div class="modal-head"><div class="modal-title">${titleR}</div></div>
          <div class="modal-body">
            <div class="modal-row">
              <label>大頭照</label>
              <input type="file" id="modal-photo-file" accept="image/png,image/jpeg">
            </div>
            <div class="modal-row">
              <label>預覽</label>
              <img id="modal-photo-preview" class="avatar-preview" src="${target.photoURL || ""}">
            </div>
            <div class="modal-row">
              <label>序號</label>
              <input type="text" id="modal-serial" value="${seqR}">
            </div>
            <div class="modal-row">
              <label>戶號</label>
              <input type="text" id="modal-house-no" value="${target.houseNo || ""}">
            </div>
            <div class="modal-row">
              <label>子戶號</label>
              <input type="number" id="modal-sub-no" value="${typeof target.subNo === "number" ? target.subNo : ""}">
            </div>
            <div class="modal-row">
              <label>QR 預覽</label>
              <img id="modal-qr-preview" class="qr-preview" src="">
            </div>
            <div class="modal-row">
              <label>QR code 代碼</label>
              <input type="text" id="modal-qr-code" value="${(target.qrCodeText || "")}">
            </div>
            <div class="modal-row">
              <label>姓名</label>
              <input type="text" id="modal-name" value="${target.displayName || ""}">
            </div>
            <div class="modal-row">
              <label>地址</label>
              <input type="text" id="modal-address" value="${target.address || ""}">
            </div>
            <div class="modal-row">
              <label>坪數</label>
              <input type="number" id="modal-area" value="${target.area || ""}">
            </div>
            <div class="modal-row">
              <label>區分權比</label>
              <input type="number" id="modal-ownership" value="${target.ownershipRatio || ""}">
            </div>
            <div class="modal-row">
              <label>手機號碼</label>
              <input type="tel" id="modal-phone" value="${target.phone || ""}">
            </div>
            <div class="modal-row">
              <label>電子郵件</label>
              <input type="email" id="modal-email" value="${target.email || ""}">
            </div>
            <div class="modal-row">
              <label>新密碼</label>
              <input type="text" id="modal-password" placeholder="至少6字元">
            </div>
            <div class="modal-row">
              <label>狀態</label>
              <select id="modal-status">
                <option value="啟用">啟用</option>
                <option value="停用">停用</option>
              </select>
            </div>
          </div>
          <div class="modal-foot">
            <button id="modal-cancel" class="btn action-btn danger">取消</button>
            <button id="modal-save" class="btn action-btn">儲存</button>
          </div>
        </div>
      `;
      openModal(bodyR);
      const btnCancel = document.getElementById("modal-cancel");
      const btnSave = document.getElementById("modal-save");
      const editFile = document.getElementById("modal-photo-file");
      const editPreview = document.getElementById("modal-photo-preview");
      const statusSelect = document.getElementById("modal-status");
      const editQrPreview = document.getElementById("modal-qr-preview");
      const editQrCodeInput = document.getElementById("modal-qr-code");
      if (editPreview) editPreview.src = target.photoURL || "";
      if (statusSelect) statusSelect.value = target.status || "停用";
      editFile && editFile.addEventListener("change", () => {
        const f = editFile.files[0];
        if (f) editPreview.src = URL.createObjectURL(f);
      });
      editQrCodeInput && editQrCodeInput.addEventListener("input", async () => {
        const val = editQrCodeInput.value.trim();
        if (!editQrPreview) return;
        if (!val) {
          editQrPreview.src = "";
        } else {
          const url = await getQrDataUrl(val, 64);
          editQrPreview.src = url;
        }
      });
      (async () => {
        const val = editQrCodeInput ? editQrCodeInput.value.trim() : "";
        if (editQrPreview && val) {
          const url = await getQrDataUrl(val, 64);
          editQrPreview.src = url;
        }
      })();
      btnCancel && btnCancel.addEventListener("click", () => closeModal());
      btnSave && btnSave.addEventListener("click", async () => {
        try {
          const newName = document.getElementById("modal-name").value.trim();
          const newSeq = document.getElementById("modal-serial").value.trim();
          const newPhone = document.getElementById("modal-phone").value.trim();
          const photoFile = document.getElementById("modal-photo-file").files[0];
          const newPassword = document.getElementById("modal-password").value;
          const newStatus = document.getElementById("modal-status").value;
          const newHouseNo = document.getElementById("modal-house-no").value.trim();
          const newSubNoRaw = document.getElementById("modal-sub-no").value.trim();
          const newSubNo = newSubNoRaw !== "" ? parseInt(newSubNoRaw, 10) : undefined;
          const newAddress = document.getElementById("modal-address").value.trim();
          const newArea = document.getElementById("modal-area").value.trim();
          const newOwnership = document.getElementById("modal-ownership").value.trim();
          const newQrCodeText = document.getElementById("modal-qr-code").value.trim();
          const newEmail = document.getElementById("modal-email").value.trim();
          let newPhotoURL = target.photoURL || "";
          if (photoFile) {
            try {
              const ext = photoFile.type === "image/png" ? "png" : "jpg";
              const path = `avatars/${target.id}.${ext}`;
              const ref = storageRef(storage, path);
              await uploadBytes(ref, photoFile, { contentType: photoFile.type });
              newPhotoURL = await getDownloadURL(ref);
            } catch (err) {
              try {
                const b64 = await new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result);
                  reader.onerror = reject;
                  reader.readAsDataURL(photoFile);
                });
                newPhotoURL = b64;
                showHint("Storage 上傳失敗，已改用內嵌圖片儲存", "error");
              } catch {
                showHint("上傳大頭照失敗，先以原圖進行更新", "error");
              }
            }
          }
          const payload = {
            displayName: newName || target.displayName,
            seq: newSeq,
            phone: newPhone || target.phone,
            photoURL: newPhotoURL,
            status: newStatus || target.status,
            houseNo: newHouseNo || target.houseNo || "",
            address: newAddress || target.address || "",
            qrCodeText: newQrCodeText || target.qrCodeText || "",
            area: newArea || target.area || "",
            ownershipRatio: newOwnership || target.ownershipRatio || "",
            email: newEmail || target.email || ""
          };
          if (newSubNoRaw !== "") payload.subNo = isNaN(newSubNo) ? target.subNo : newSubNo;
          await setDoc(doc(db, "users", target.id), payload, { merge: true });
          const curr = auth.currentUser;
          if (isSelf && curr) {
            const profilePatch = {};
            if (newName && newName !== curr.displayName) profilePatch.displayName = newName;
            if (newPhotoURL && newPhotoURL !== curr.photoURL) profilePatch.photoURL = newPhotoURL;
            if (Object.keys(profilePatch).length) {
              try {
                await updateProfile(curr, profilePatch);
              } catch (err) {
                if (err && err.code === "auth/requires-recent-login") {
                  const cp = window.prompt("請輸入目前密碼以完成更新");
                  if (cp) {
                    try {
                      const cred = EmailAuthProvider.credential(curr.email, cp);
                      await reauthenticateWithCredential(curr, cred);
                      await updateProfile(curr, profilePatch);
                    } catch {}
                  }
                }
              }
            }
            if (newPassword && newPassword.length >= 6) {
              try {
                await updatePassword(curr, newPassword);
              } catch (err) {
                if (err && err.code === "auth/requires-recent-login") {
                  const cp = window.prompt("請輸入目前密碼以完成設定新密碼");
                  if (cp) {
                    try {
                      const cred = EmailAuthProvider.credential(curr.email, cp);
                      await reauthenticateWithCredential(curr, cred);
                      await updatePassword(curr, newPassword);
                    } catch {}
                  }
                }
              }
            }
          }
          closeModal();
          const savedMain = localStorage.getItem("adminActiveMain") || "residents";
          setActiveAdminNav(savedMain);
          showHint("已更新住戶資料", "success");
        } catch (e) {
          showHint("更新失敗", "error");
        }
      });
      return;
    }
  }
  window.openEditModal = openEditModal;
}

function openRenameModal(currentLabel, onConfirm, title = "編輯名稱", onDelete = null) {
  let modal = document.getElementById("sys-modal");
  
  // Ensure modal exists
  if (!modal) {
      modal = document.createElement("div");
      modal.id = "sys-modal";
      modal.className = "modal hidden";
      document.body.appendChild(modal);
  }
  
  // Move to body to avoid transform/scroll issues in layout
  if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
  }

  const deleteBtnHtml = onDelete ? `<button id="rename-delete" style="margin-right:auto; padding:8px 16px; background:#fee2e2; color:#b91c1c; border:none; border-radius:6px; cursor:pointer; font-weight:500;">刪除</button>` : '';

  modal.innerHTML = `
    <div class="modal-box" style="width:300px; background:white; padding:20px; border-radius:8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); position:relative; z-index:10;">
      <h3 style="margin-top:0; margin-bottom:16px; font-size:18px; font-weight:600;">${title}</h3>
      <input type="text" id="rename-input" value="${currentLabel}" style="width:100%; padding:8px 12px; margin-bottom:20px; border:1px solid #ddd; border-radius:6px; font-size:14px;">
      <div style="display:flex; justify-content:flex-end; gap:12px;">
        ${deleteBtnHtml}
        <button id="rename-cancel" style="padding:8px 16px; background:#f3f4f6; border:none; border-radius:6px; cursor:pointer; font-weight:500;">取消</button>
        <button id="rename-confirm" style="padding:8px 16px; background:#ef4444; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:500;">確定</button>
      </div>
    </div>
  `;
  
  // Ensure z-index is high enough
  modal.style.zIndex = "999999";
  modal.classList.remove("hidden");
  
  const input = modal.querySelector("#rename-input");
  // Small delay to ensure visibility before focus
  setTimeout(() => {
      input.focus();
      input.select();
  }, 50);

  const close = () => {
    modal.classList.add("hidden");
    modal.innerHTML = "";
  };

  if(onDelete) {
      modal.querySelector("#rename-delete").onclick = () => {
          close();
          onDelete();
      };
  }

  modal.querySelector("#rename-cancel").onclick = close;
  modal.querySelector("#rename-confirm").onclick = () => {
    const val = input.value;
    onConfirm(val);
    close();
  };
  
  input.addEventListener("keyup", (e) => {
    if(e.key === "Enter") {
       const val = input.value;
       onConfirm(val);
       close();
    }
  });
  
  // Click outside to close
  modal.onclick = (e) => {
      if(e.target === modal) close();
  };
}

function openConfirmModal(message, onConfirm) {
  let modal = document.getElementById("sys-modal");
  if (!modal) {
      modal = document.createElement("div");
      modal.id = "sys-modal";
      modal.className = "modal hidden";
      document.body.appendChild(modal);
  }
  if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-box" style="width:300px; background:white; padding:20px; border-radius:8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); position:relative; z-index:10;">
      <h3 style="margin-top:0; margin-bottom:16px; font-size:18px; font-weight:600; color:#b91c1c;">確認刪除</h3>
      <p style="margin-bottom:20px; font-size:14px; color:#374151;">${message}</p>
      <div style="display:flex; justify-content:flex-end; gap:12px;">
        <button id="confirm-cancel" style="padding:8px 16px; background:#f3f4f6; border:none; border-radius:6px; cursor:pointer; font-weight:500;">取消</button>
        <button id="confirm-ok" style="padding:8px 16px; background:#ef4444; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:500;">確認刪除</button>
      </div>
    </div>
  `;
  
  modal.style.zIndex = "999999";
  modal.classList.remove("hidden");

  const close = () => {
    modal.classList.add("hidden");
    modal.innerHTML = "";
  };

  modal.querySelector("#confirm-cancel").onclick = close;
  modal.querySelector("#confirm-ok").onclick = () => {
    onConfirm();
    close();
  };
  
  modal.onclick = (e) => {
      if(e.target === modal) close();
  };
}


let navUnsubscribe = null;
let mainBadgeUnsub = null;
let mainBadgeSlug = null;

async function checkAndSetupMainBadge() {
    let slug = window.currentAdminCommunitySlug || localStorage.getItem("adminCurrentCommunity") || "default";
    
    if (slug === "default" && auth.currentUser) {
         try {
             const fetchedSlug = await getUserCommunity(auth.currentUser.uid);
             if (fetchedSlug !== "default") {
                 slug = fetchedSlug;
                 window.currentAdminCommunitySlug = slug;
                 localStorage.setItem("adminCurrentCommunity", slug);
             }
         } catch (e) { }
    }

    if (slug === "default") return;
    if (mainBadgeSlug === slug && mainBadgeUnsub) return;

    if (mainBadgeUnsub) { mainBadgeUnsub(); mainBadgeUnsub = null; }
    
    mainBadgeSlug = slug;
    
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    const q = query(
        collection(db, "communities", slug, "reservations"),
        where("date", "==", dateStr)
    );

    mainBadgeUnsub = onSnapshot(q, (rsnap) => {
        let total = 0;
        rsnap.forEach(doc => {
            const rd = doc.data();
            if (rd.status !== 'cancelled' && rd.status !== '已取消') {
                total++;
            }
        });
        
        const btn = document.getElementById("admin-tab-facility");
        if (btn) {
            let badge = btn.querySelector(".nav-badge-main");
            if (total > 0) {
                if (!badge) {
                    badge = document.createElement("div");
                    badge.className = "nav-badge-main";
                    btn.appendChild(badge);
                }
                badge.textContent = total;
            } else {
                if (badge) badge.remove();
            }
        }
    }, (err) => {
        console.error("Main badge fetch error", err);
    });
}
function renderAdminSubNav(key) {
  checkAndSetupMainBadge();
  if (navUnsubscribe) { navUnsubscribe(); navUnsubscribe = null; }
  if (!adminNav.subContainer) return;
  const items = adminSubMenus[key] || [];
  
  // Render buttons
  const renderButtons = (list) => {
      let html = list.map((item, index) => {
        const isObj = typeof item === 'object';
        const label = isObj ? item.label : item;
        const itemKey = isObj ? item.key : item;
        const buttonColor = (isObj && item.buttonColor) ? item.buttonColor : "";
        const titleAttr = ' title="雙擊可編輯名稱"';
        // Check if this tab is active
        const isActive = (localStorage.getItem("adminActiveSub") === itemKey) || (index === 0 && !localStorage.getItem("adminActiveSub"));
        
        let style = "";
        if (buttonColor && isActive) {
            style = `style="background-color: ${buttonColor} !important; color: #fff !important; border-color: ${buttonColor} !important;"`;
        }

        return `<button class="sub-nav-item ${isActive ? "active" : ""}" data-key="${itemKey}" data-label="${label}" ${style} ${titleAttr}>${label}</button>`;
      }).join("");

      if (key === 'announce' || key === 'facility') {
          html += `<button class="sub-nav-item add-btn" title="新增分類" style="min-width: 30px; padding: 0 10px; font-weight:bold;">+</button>`;
      }
      return html;
  };

  adminNav.subContainer.innerHTML = renderButtons(items);
  
  // Logic to load custom tabs for announce
  if (key === 'announce') {
      let localUnsub = null;
      // Wrapper to allow cancellation before async setup completes
      const wrapper = () => {
          if (localUnsub) localUnsub();
      };
      navUnsubscribe = wrapper;

      (async () => {
          let slug = window.currentAdminCommunitySlug || localStorage.getItem("adminCurrentCommunity") || "default";
          
          if (slug === "default" && auth.currentUser) {
              try {
                  const fetchedSlug = await getUserCommunity(auth.currentUser.uid);
                  if (fetchedSlug !== "default") {
                      slug = fetchedSlug;
                      // Sync to globals to ensure save operations use the correct slug
                      window.currentAdminCommunitySlug = slug;
                      localStorage.setItem("adminCurrentCommunity", slug);
                  }
              } catch (e) { console.error(e); }
          }

          // If navUnsubscribe was replaced (component unmounted/re-rendered), stop here
          if (navUnsubscribe !== wrapper) return;

          if (slug === "default" || !auth.currentUser) return;

          localUnsub = onSnapshot(doc(db, "communities", slug, "settings", "nav"), (snap) => {
              let currentList = [...items]; // Default list
              
              if(snap.exists()) {
                  const data = snap.data();
                  // Check if full list exists
                  if(data.announce_tabs && Array.isArray(data.announce_tabs)) {
                      currentList = data.announce_tabs;
                  } else {
                      // Fallback: update labels of default list
                      currentList = currentList.map(i => {
                          if(data[i.key]) return { ...i, label: data[i.key] };
                          return i;
                      });
                  }
              }
              
              // Re-render with fetched list
              adminNav.subContainer.innerHTML = renderButtons(currentList);
              attachListeners(currentList);
              
              // Update title if active tab matches
              const activeBtn = adminNav.subContainer.querySelector(".sub-nav-item.active");
              if(activeBtn) {
                   const titleEl = document.querySelector(".row.B3 .card-title");
                   if(titleEl) titleEl.textContent = activeBtn.getAttribute("data-label");
              } else if (currentList.length > 0) {
                   // If active was deleted or invalid, switch to first
                   const firstBtn = adminNav.subContainer.querySelector(".sub-nav-item");
                   if(firstBtn) firstBtn.click();
              }
          }, (e) => {
              console.error(e);
              attachListeners(items);
          });
      })();
  } else if (key === 'facility') {
      let localUnsub = null;
      let badgeUnsub = null;
      const wrapper = () => { 
          if (localUnsub) localUnsub(); 
          if (badgeUnsub) badgeUnsub();
      };
      navUnsubscribe = wrapper;

      (async () => {
          let slug = window.currentAdminCommunitySlug || localStorage.getItem("adminCurrentCommunity") || "default";
          
          if (slug === "default" && auth.currentUser) {
              try {
                  const fetchedSlug = await getUserCommunity(auth.currentUser.uid);
                  if (fetchedSlug !== "default") {
                      slug = fetchedSlug;
                      window.currentAdminCommunitySlug = slug;
                      localStorage.setItem("adminCurrentCommunity", slug);
                  }
              } catch (e) { console.error(e); }
          }

          if (navUnsubscribe !== wrapper) return;
          if (slug === "default" || !auth.currentUser) return;

          localUnsub = onSnapshot(doc(db, "communities", slug, "settings", "nav"), (snap) => {
              // Default list for facility
              let currentList = [{ key: 'gym', label: '健身房' }];
              
              if(snap.exists()) {
                  const data = snap.data();
                  if(data.facility_tabs && Array.isArray(data.facility_tabs)) {
                      currentList = data.facility_tabs;
                  }
              }
              
              adminNav.subContainer.innerHTML = renderButtons(currentList);
              attachListeners(currentList);

              // Setup Badge Listener (Reservations Today)
              if (badgeUnsub) badgeUnsub();
              const today = new Date();
              const y = today.getFullYear();
              const m = String(today.getMonth() + 1).padStart(2, '0');
              const d = String(today.getDate()).padStart(2, '0');
              const dateStr = `${y}-${m}-${d}`;

              // Query by date only to avoid index issues, filter status client-side
              const q = query(
                  collection(db, "communities", slug, "reservations"),
                  where("date", "==", dateStr)
              );

              badgeUnsub = onSnapshot(q, (rsnap) => {
                  console.log(`[Badge] Fetching for ${dateStr}, found ${rsnap.size} docs`);
                  const counts = {};
                  rsnap.forEach(doc => {
                      const rd = doc.data();
                      // Filter cancelled
                      if (rd.status === 'cancelled' || rd.status === '已取消') return;
                      
                      if (rd.facility) {
                          counts[rd.facility] = (counts[rd.facility] || 0) + 1;
                      }
                  });
                  console.log("[Badge] Counts:", counts);
                  
                  const buttons = adminNav.subContainer.querySelectorAll(".sub-nav-item");
                  if (buttons.length === 0) console.warn("[Badge] No sub-nav items found to attach badges");

                  buttons.forEach(btn => {
                      const k = btn.getAttribute("data-key");
                      const count = counts[k] || 0;
                      
                      // Remove existing
                      const old = btn.querySelector(".nav-badge");
                      if(old) old.remove();
                      
                      if(count > 0) {
                          const badge = document.createElement("div");
                          badge.className = "nav-badge";
                          badge.textContent = count;
                          btn.appendChild(badge);
                      }
                  });
              }, (err) => console.error("Badge fetch error", err));
              
              const activeBtn = adminNav.subContainer.querySelector(".sub-nav-item.active");
              if(activeBtn) {
                   const titleEl = document.querySelector(".row.B3 .card-title");
                   if(titleEl) titleEl.textContent = activeBtn.getAttribute("data-label");
              } else if (currentList.length > 0) {
                   // If active was deleted or invalid, switch to first
                   const firstBtn = adminNav.subContainer.querySelector(".sub-nav-item");
                   if(firstBtn) firstBtn.click();
              }
          }, (e) => {
              console.error(e);
              attachListeners([{ key: 'gym', label: '健身房' }]);
          });
      })();
  } else {
      attachListeners(items);
  }

  function attachListeners(currentList) {
      const buttons = adminNav.subContainer.querySelectorAll(".sub-nav-item:not(.add-btn)");
      const addBtn = adminNav.subContainer.querySelector(".add-btn");

      // Helper: Reorder Logic
      const handleReorder = async (index, direction) => {
          if (index + direction < 0 || index + direction >= currentList.length) return;
          
          // Swap
          const newList = [...currentList];
          const temp = newList[index];
          newList[index] = newList[index + direction];
          newList[index + direction] = temp;
          
          try {
              const slug = window.currentAdminCommunitySlug || localStorage.getItem("adminCurrentCommunity") || "default";
              const updateData = {};
              
              // Normalize
              const normalizedList = newList.map(i => {
                   if (typeof i === 'string') return { key: i, label: i }; 
                   return i;
              });

              if (key === 'announce') updateData.announce_tabs = normalizedList;
              if (key === 'facility') updateData.facility_tabs = normalizedList;

              await setDoc(doc(db, "communities", slug, "settings", "nav"), updateData, { merge: true });
          } catch(e) {
              console.error("Reorder failed", e);
              alert("排序失敗: " + e.message);
          }
      };

      // Helper: Show Reorder Modal
      const openReorderModal = (index) => {
          const item = currentList[index];
          const label = typeof item === 'object' ? item.label : item;
          
          const modalHtml = `
            <div class="modal-dialog">
              <div class="modal-head">
                <div class="modal-title">調整順序 - ${label}</div>
              </div>
              <div class="modal-body" style="text-align: center; padding: 20px;">
                <p style="margin-bottom: 20px; color: #666;">請選擇移動方向</p>
                <div style="display: flex; gap: 16px; justify-content: center;">
                    <button id="btn-move-left" class="btn" style="min-width: 100px; ${index === 0 ? 'opacity:0.5; cursor:not-allowed;' : ''}" ${index === 0 ? 'disabled' : ''}>
                       &larr; 向左移
                    </button>
                    <button id="btn-move-right" class="btn" style="min-width: 100px; ${index === currentList.length - 1 ? 'opacity:0.5; cursor:not-allowed;' : ''}" ${index === currentList.length - 1 ? 'disabled' : ''}>
                       向右移 &rarr;
                    </button>
                </div>
              </div>
              <div class="modal-foot">
                <button class="btn action-btn" onclick="closeModal()">關閉</button>
              </div>
            </div>
          `;
          
          openModal(modalHtml);
          
          setTimeout(() => {
              const btnLeft = document.getElementById("btn-move-left");
              const btnRight = document.getElementById("btn-move-right");
              
              if(btnLeft && !btnLeft.disabled) {
                  btnLeft.onclick = () => { handleReorder(index, -1); closeModal(); };
              }
              if(btnRight && !btnRight.disabled) {
                  btnRight.onclick = () => { handleReorder(index, 1); closeModal(); };
              }
          }, 50);
      };

      buttons.forEach((btn, index) => {
        // Long Press Detection
        let pressTimer;
        let isLongPress = false;

        const startPress = (e) => {
            if (key !== 'announce' && key !== 'facility') return;
            // Only primary button
            if (e.type === 'mousedown' && e.button !== 0) return;
            
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                if (navigator.vibrate) navigator.vibrate(50);
                openReorderModal(index);
            }, 600);
        };

        const cancelPress = () => {
            clearTimeout(pressTimer);
        };

        btn.addEventListener("mousedown", startPress);
        btn.addEventListener("touchstart", startPress, {passive: true});
        btn.addEventListener("mouseup", cancelPress);
        btn.addEventListener("touchend", cancelPress);
        btn.addEventListener("mouseleave", cancelPress);

        // Click to switch
        btn.addEventListener("click", (e) => {
          if (isLongPress) {
              e.preventDefault();
              e.stopPropagation();
              isLongPress = false;
              return;
          }

          buttons.forEach(b => b.classList.remove("active"));
          // Remove inline styles from others if they were active-colored
          // Re-rendering is safer but for now let's just update classes and styles manually or re-render?
          // Re-rendering happens on click inside renderAdminSubNav? No, only on snapshot.
          // To properly update colors, we might need to re-apply logic. 
          // But wait, the click just changes 'active' class. The color logic is inside renderButtons.
          // So if we just toggle class, the inline style for active color won't apply automatically if it was conditional.
          // Actually, in renderButtons, we baked the style into the HTML string based on 'isActive'.
          // So if we click, we need to re-render the buttons to update the styles correctly.
          // But here we are just toggling classes.
          
          // Fix: Update localStorage and trigger re-render of subnav via state or just reload content?
          // The onSnapshot listener will re-render if data changes, but click doesn't change data.
          // We should just update localStorage and call renderAdminSubNav again? 
          // Or just update the clicked button's style if it has a color.
          
          const k = btn.getAttribute("data-key");
          const l = btn.getAttribute("data-label");
          localStorage.setItem("adminActiveSub", k); 
          
          // Re-render subnav to apply correct active styles
          // We can call renderButtons again but we don't have the list here easily unless we scope it.
          // Better: just reload the whole subnav for this key.
          renderAdminSubNav(key);
          
          renderAdminContent(key, k, l); 
        });

        // Double click to edit
        btn.addEventListener("dblclick", async () => {
            const k = btn.getAttribute("data-key");
            
            // Allow all items to be editable
            // const isCustomizable = items.some(i => typeof i === 'object' && i.key === k);
            // if(!isCustomizable) return;

            const currentLabel = btn.getAttribute("data-label");
            
            const onDelete = (index > 0) ? () => {
                 openConfirmModal(`確定要刪除 "${currentLabel}" 嗎？此操作無法復原。`, async () => {
                     // Filter out the deleted item
                     // Note: We need to filter based on key, but currentList might have mixed types
                     // For safety, let's normalize check
                     const newList = currentList.filter(item => {
                          if (typeof item === 'object') return item.key !== k;
                          return item !== k;
                     });
                     
                     // Save to DB
                     try {
                         const slug = window.currentAdminCommunitySlug || localStorage.getItem("adminCurrentCommunity") || "default";
                         if (key === 'announce' || key === 'facility') {
                             const normalizedList = newList.map(i => {
                                  if (typeof i === 'string') return { key: i, label: i }; 
                                  return i;
                             });
                             
                             const updateData = {};
                             if (key === 'announce') updateData.announce_tabs = normalizedList;
                             if (key === 'facility') updateData.facility_tabs = normalizedList;

                             await setDoc(doc(db, "communities", slug, "settings", "nav"), updateData, { merge: true });
                             
                             // If active was deleted, switch to first
                             if(btn.classList.contains("active")) {
                                 const firstBtn = adminNav.subContainer.querySelector(".sub-nav-item");
                                 if(firstBtn) firstBtn.click();
                             }

                         } else {
                             // For non-array structure
                             await setDoc(doc(db, "communities", slug, "settings", "nav"), {
                                 [k]: deleteField()
                             }, { merge: true });
                         }
                     } catch(e) {
                         console.error("Delete nav item error", e);
                         showHint("刪除失敗: " + e.message, "error");
                     }
                 });
            } : null;

            // Use custom modal instead of prompt
            openRenameModal(currentLabel, async (newLabel) => {
                if(!newLabel || newLabel.trim() === "") return;
                const finalLabel = newLabel.trim();
                
                // Check for duplicates
                const isDuplicate = currentList.some(item => {
                    const iName = typeof item === 'object' ? item.label : item;
                    const iKey = typeof item === 'object' ? item.key : item;
                    if (iKey === k) return false;
                    return iName === finalLabel;
                });
                if (isDuplicate) {
                    alert("預約名稱已存在，請使用其他名稱");
                    return;
                }

                // Update local list
                const newList = currentList.map(item => {
                    if (typeof item === 'object' && item.key === k) {
                        return { ...item, label: finalLabel };
                    }
                    // For default items which might be strings or objects without label
                    if (typeof item === 'string' && item === k) {
                        // Convert string item to object to support label change
                        return { key: k, label: finalLabel };
                    }
                    if (typeof item === 'object' && item.key === k) {
                         return { ...item, label: finalLabel };
                    }
                    return item;
                });

                // Optimistic update
                btn.textContent = finalLabel;
                btn.setAttribute("data-label", finalLabel);
                
                if(btn.classList.contains("active")) {
                     const titleEl = document.querySelector(".row.B3 .card-title");
                     if(titleEl) {
                         titleEl.textContent = finalLabel;
                     }
                }

                // Save to DB
                try {
                    const slug = window.currentAdminCommunitySlug || localStorage.getItem("adminCurrentCommunity") || "default";
                    if (key === 'announce' || key === 'facility') {
                        // For announce/facility, we always save the full list to announce_tabs/facility_tabs
                        // But first ensure all items in list are normalized to objects if needed
                        const normalizedList = newList.map(i => {
                             if (typeof i === 'string') return { key: i, label: i }; 
                             return i;
                        });
                        
                        const updateData = {};
                        if (key === 'announce') updateData.announce_tabs = normalizedList;
                        if (key === 'facility') updateData.facility_tabs = normalizedList;

                        await setDoc(doc(db, "communities", slug, "settings", "nav"), updateData, { merge: true });
                    } else {
                        await setDoc(doc(db, "communities", slug, "settings", "nav"), {
                            [k]: finalLabel
                        }, { merge: true });
                    }
                } catch(e) {
                    console.error("Save nav label error", e);
                    showHint("儲存名稱失敗: " + e.message, "error");
                }
            }, "編輯名稱", onDelete);
        });
      });

      if (addBtn) {
          addBtn.addEventListener("click", async () => {
              openRenameModal("", async (name) => {
                  if (name && name.trim()) {
                      const finalName = name.trim();

                      // Check for duplicates
                      const isDuplicate = currentList.some(item => {
                          const iName = typeof item === 'object' ? item.label : item;
                          return iName === finalName;
                      });
                      if (isDuplicate) {
                          alert("預約名稱已存在，請使用其他名稱");
                          return;
                      }

                      const newKey = (key === 'facility' ? "fac_" : "ann_") + Date.now();
                      const newItem = { key: newKey, label: finalName };
                      const newList = [...currentList, newItem];
                      
                      // Save
                      try {
                        const slug = window.currentAdminCommunitySlug || localStorage.getItem("adminCurrentCommunity") || "default";
                        const updateData = {};
                        if (key === 'announce') updateData.announce_tabs = newList;
                        if (key === 'facility') updateData.facility_tabs = newList;
                        
                        await setDoc(doc(db, "communities", slug, "settings", "nav"), updateData, { merge: true });
                        
                        // Re-render
                        adminNav.subContainer.innerHTML = renderButtons(newList);
                        attachListeners(newList);
                        
                        // Auto-select new tab
                        const newBtns = adminNav.subContainer.querySelectorAll(".sub-nav-item:not(.add-btn)");
                        const target = Array.from(newBtns).find(b => b.getAttribute("data-key") === newKey);
                        if(target) target.click();

                      } catch(e) {
                          console.error(e);
                          if(typeof showHint === 'function') showHint("新增失敗: " + e.message, "error");
                          else alert("新增失敗: " + e.message);
                      }
                  }
              }, "新增分類");
          });
      }
      
      // Handle Initial Selection (if not handled by click)
      const savedSub = localStorage.getItem("adminActiveSub");
      let initialBtn = null;
      if(savedSub) {
          initialBtn = Array.from(buttons).find(b => b.getAttribute("data-key") === savedSub || b.getAttribute("data-label") === savedSub);
      }
      if (!initialBtn && buttons.length > 0) initialBtn = buttons[0];

      // Only force render if content is empty or mismatched (avoid double render loop)
      // But we need to ensure the correct tab is visually active
      if (initialBtn) {
           // Ensure active class is correct
           buttons.forEach(b => b.classList.remove("active"));
           initialBtn.classList.add("active");
           
           // If we are in the async load phase, we might need to trigger render content if it wasn't done
           // logic: check if content title matches
           const titleEl = document.querySelector(".card-title");
           const k = initialBtn.getAttribute("data-key");
           const l = initialBtn.getAttribute("data-label");
           if (!titleEl || titleEl.textContent !== l) {
               renderAdminContent(key, k, l);
           }
      }
  }
}

async function setActiveAdminNav(activeKey) {
  ["shortcuts", "mail", "facility", "announce", "residents", "others"].forEach(key => {
    const el = adminNav[key];
    if (el) {
      if (key === activeKey) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    }
  });
  localStorage.setItem("adminActiveMain", activeKey);

  // Pre-fetch for announce/facility to ensure instant correct render
  if (activeKey === 'announce' || activeKey === 'facility') {
      try {
          const slug = window.currentAdminCommunitySlug || localStorage.getItem("adminCurrentCommunity") || "default";
          if (slug !== "default" && auth.currentUser) {
              const snap = await getDoc(doc(db, "communities", slug, "settings", "nav"));
              // Check if we are still on the same tab
              if (localStorage.getItem("adminActiveMain") !== activeKey) return;

              if (snap.exists()) {
                  const data = snap.data();
                  if (activeKey === 'announce' && data.announce_tabs && Array.isArray(data.announce_tabs)) {
                      adminSubMenus[activeKey] = data.announce_tabs;
                  }
                  if (activeKey === 'facility' && data.facility_tabs && Array.isArray(data.facility_tabs)) {
                      adminSubMenus[activeKey] = data.facility_tabs;
                  }
              }
          }
      } catch (e) {
          console.error("Pre-fetch nav failed", e);
      }
  }

  renderAdminSubNav(activeKey);
  updateAdminBrandTitle();
}

if (adminNav.subContainer) {
  if (adminNav.shortcuts) adminNav.shortcuts.addEventListener("click", () => setActiveAdminNav("shortcuts"));
  if (adminNav.mail) adminNav.mail.addEventListener("click", () => setActiveAdminNav("mail"));
  if (adminNav.facility) adminNav.facility.addEventListener("click", () => setActiveAdminNav("facility"));
  if (adminNav.announce) adminNav.announce.addEventListener("click", () => setActiveAdminNav("announce"));
  if (adminNav.residents) adminNav.residents.addEventListener("click", () => setActiveAdminNav("residents"));
  if (adminNav.others) adminNav.others.addEventListener("click", () => setActiveAdminNav("others"));
  const savedMain = localStorage.getItem("adminActiveMain");
  const initialMain = savedMain && adminSubMenus[savedMain] ? savedMain : "shortcuts";
  setActiveAdminNav(initialMain);
}

// Front-end Ads Logic
async function loadFrontAds(slug, providedSnap = null) {
  const container = document.querySelector(".row.A3");
  if (!container) return;
  
  // Ensure we clear any existing interval before reloading
  if (window.frontAdsInterval) clearInterval(window.frontAdsInterval);

  try {
    let data = null;
    let snap = providedSnap;
    if (!snap) {
      snap = await getDoc(doc(db, `communities/${slug}/app_modules/ads`));
    }
    if (!snap.exists()) {
       const def = await getDoc(doc(db, `communities/default/app_modules/ads`));
       if (!def.exists()) {
         container.innerHTML = `<div class="section-text">尚無廣告內容</div>`;
         return;
       }
       data = def.data();
    } else {
       data = snap.data();
    }
    const items = data.items || [];
    
    // Inject YouTube API if needed
    if (items.some(x => x.type === 'youtube') && !window.YT) {
        if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
            const tag = document.createElement('script');
            tag.src = "https://www.youtube.com/iframe_api";
            document.head.appendChild(tag);
        }
    }

    // Merge defaults to ensure all properties exist even if DB has partial config
    const defaults = { interval: 3, effect: 'slide', loop: 'infinite', nav: true };
    const savedConfig = data.config || {};
    const config = { ...defaults, ...savedConfig };
    
    const validItems = items.filter(x => x.url).sort((a, b) => a.idx - b.idx);
    
    if (validItems.length === 0) {
      container.innerHTML = `<div class="section-text">尚無廣告內容</div>`;
      return;
    }
    
    const slides = validItems.map((item, idx) => {
      let content = '';
      if (item.type === 'youtube') {
         let vidId = '';
         try {
           const u = new URL(item.url);
           if (u.hostname.includes('youtube.com')) {
             vidId = u.searchParams.get('v');
             if (!vidId && u.pathname.startsWith('/embed/')) {
               vidId = u.pathname.split('/')[2];
             } else if (!vidId && u.pathname.startsWith('/live/')) {
                vidId = u.pathname.split('/')[2];
             }
           }
           else if (u.hostname.includes('youtu.be')) vidId = u.pathname.slice(1);
         } catch {}
         const origin = window.location.origin;
         const embedUrl = vidId ? `https://www.youtube.com/embed/${vidId}?autoplay=${item.autoplay?1:0}&mute=1&enablejsapi=1&origin=${origin}` : item.url;
         content = `<iframe src="${embedUrl}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
      } else {
         const safeDesc = (item.description || '').replace(/"/g, '&quot;');
         content = `<img src="${item.url}" alt="Slide ${idx+1}" class="clickable-slide" style="cursor: pointer;" data-description="${safeDesc}" onclick="window.showAdModal(this.src, this.getAttribute('data-description'))">`;
      }
      return `<div class="preview-slide ${idx===0?'active':''}">${content}</div>`;
    }).join('');
    
    const showNav = config.nav === true;
    container.innerHTML = `
      <div class="a3-preview-container effect-${config.effect}">
        ${slides}
        <button class="preview-nav-btn preview-nav-prev" style="display: ${showNav ? 'block' : 'none'}">❮</button>
        <button class="preview-nav-btn preview-nav-next" style="display: ${showNav ? 'block' : 'none'}">❯</button>
      </div>
    `;
    
    startFrontCarousel(config);
    
  } catch (e) {
    console.error("Load front ads failed", e);
  }
}

function startFrontCarousel(config) {
    if (window.frontAdsInterval) clearInterval(window.frontAdsInterval);
    if (window.frontAdsTimer) clearTimeout(window.frontAdsTimer);
    
    const frontContainer = document.querySelector(".row.A3 .a3-preview-container");
    if (!frontContainer) return;

    const slides = frontContainer.querySelectorAll(".preview-slide");
    const btnPrev = frontContainer.querySelector(".preview-nav-prev");
    const btnNext = frontContainer.querySelector(".preview-nav-next");
    
    if (slides.length <= 1) return;

    let idx = 0;
    slides.forEach((s, i) => { if (s.classList.contains('active')) idx = i; });
    
    let direction = 1; 
    const intervalTime = Math.max((parseInt(config.interval) || 3) * 1000, 1000);
    const players = {}; // Map to store YT players
    let ytRetryCount = 0;
    let isTransitioning = false;
    
    const showSlide = (i, enterFrom) => {
        ytRetryCount = 0;
        // Pause all videos when switching
        Object.values(players).forEach(p => {
            if (p && typeof p.pauseVideo === 'function') p.pauseVideo();
        });

        let currentActive = null;
        slides.forEach(s => {
          if (s.classList.contains('active')) currentActive = s;
          s.classList.remove('active');
          s.classList.remove('enter-left');
          s.classList.remove('enter-right');
          s.classList.remove('exit-left');
          s.classList.remove('exit-right');
        });

        const target = slides[i];
        if (target) {
          target.classList.add('active');
          
          if (enterFrom === 'right') {
            target.classList.add('enter-right');
            if (currentActive && currentActive !== target) {
                currentActive.classList.add('exit-left');
            }
            setTimeout(() => {
                target.classList.remove('enter-right');
                if (currentActive) currentActive.classList.remove('exit-left');
            }, 500);
          } else if (enterFrom === 'left') {
            target.classList.add('enter-left');
            if (currentActive && currentActive !== target) {
                currentActive.classList.add('exit-right');
            }
            setTimeout(() => {
                target.classList.remove('enter-left');
                if (currentActive) currentActive.classList.remove('exit-right');
            }, 500);
          }
        }
    };
    
    const next = () => {
        if (isTransitioning) return;
        isTransitioning = true;
        setTimeout(() => isTransitioning = false, 1000); // Lock for 1s to prevent double skip

        if (config.loop === 'rewind') {
            if (slides.length <= 1) return;
            if (idx >= slides.length - 1) direction = -1;
            if (idx <= 0) direction = 1;
            idx += direction;
        } else if (config.loop === 'once') {
            if (idx < slides.length - 1) idx++;
            else {
                if (window.frontAdsTimer) clearTimeout(window.frontAdsTimer);
                return;
            }
        } else { 
            idx = (idx + 1) % slides.length;
        }
        showSlide(idx, 'right');
        runLoop();
    };

    const prev = () => {
        if (isTransitioning) return;
        isTransitioning = true;
        setTimeout(() => isTransitioning = false, 1000);

        if (config.loop === 'once') {
            if (idx > 0) idx--;
        } else { 
            idx = (idx - 1 + slides.length) % slides.length;
        }
        showSlide(idx, 'left');
        runLoop();
    };

    if (btnNext) {
       btnNext.onclick = (e) => { e.preventDefault(); next(); };
    }
    if (btnPrev) {
       btnPrev.onclick = (e) => { e.preventDefault(); prev(); };
    }

    // Drag support
    if (frontContainer) {
      let isDragging = false;
      let startX = 0;
      let currentX = 0;
      let startY = 0; // For detecting vertical scroll
      let currentY = 0;
      let containerWidth = 0;
      let prevIdx = -1;
      let nextIdx = -1;
      let hasMoved = false;

      // Helper to calculate indices
      const getIndices = () => {
          let pIdx, nIdx;
          const len = slides.length;
          
          if (config.loop === 'rewind') {
              pIdx = idx > 0 ? idx - 1 : (direction === -1 ? len - 1 : 0); // Simplified logic for rewind
              nIdx = idx < len - 1 ? idx + 1 : (direction === 1 ? 0 : len - 1);
          } else if (config.loop === 'once') {
              pIdx = idx > 0 ? idx - 1 : -1;
              nIdx = idx < len - 1 ? idx + 1 : -1;
          } else {
              pIdx = (idx - 1 + len) % len;
              nIdx = (idx + 1) % len;
          }
          return { pIdx, nIdx };
      };

      const startDrag = (x, y) => {
        isDragging = true;
        startX = x;
        startY = y;
        currentX = x;
        currentY = y;
        hasMoved = false;
        containerWidth = frontContainer.offsetWidth;
        
        // Pause auto-loop
        if (window.frontAdsTimer) clearTimeout(window.frontAdsTimer);
        
        // Prepare indices
        const indices = getIndices();
        prevIdx = indices.pIdx;
        nextIdx = indices.nIdx;

        // Reset transitions and ensure visibility
        [idx, prevIdx, nextIdx].forEach(i => {
           if (i === -1) return;
           const s = slides[i];
           s.style.transition = 'none';
           s.style.display = 'flex';
           s.style.zIndex = (i === idx) ? 2 : 1;
           
           // Pre-position neighbors
           if (i === prevIdx) s.style.transform = `translateX(${-containerWidth}px)`;
           if (i === nextIdx) s.style.transform = `translateX(${containerWidth}px)`;
           if (i === idx) s.style.transform = `translateX(0px)`;
        });
      };

      const moveDrag = (x, y, e) => {
        if (!isDragging) return;
        
        const deltaX = x - startX;
        const deltaY = y - startY;

        // If this is the first move, determine if vertical or horizontal
        if (!hasMoved) {
            if (Math.abs(deltaY) > Math.abs(deltaX)) {
                // Vertical scroll, ignore drag
                isDragging = false;
                // Clean up inline styles
                 [idx, prevIdx, nextIdx].forEach(i => {
                    if (i === -1) return;
                    slides[i].style.transition = '';
                    slides[i].style.transform = '';
                    slides[i].style.display = '';
                    slides[i].style.zIndex = '';
                 });
                return;
            }
            hasMoved = true;
        }

        if (e.cancelable) e.preventDefault(); // Stop page scroll
        
        currentX = x;
        
        // Move current
        slides[idx].style.transform = `translateX(${deltaX}px)`;
        
        // Move neighbors
        if (prevIdx !== -1) {
            slides[prevIdx].style.transform = `translateX(${-containerWidth + deltaX}px)`;
        }
        if (nextIdx !== -1) {
            slides[nextIdx].style.transform = `translateX(${containerWidth + deltaX}px)`;
        }
      };

      const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        
        const deltaX = currentX - startX;
        const threshold = containerWidth * 0.2; // 20% width to trigger
        
        const transitionDuration = '0.3s';
        
        const animateTo = (index, xPos) => {
            if (index === -1) return;
            const s = slides[index];
            s.style.transition = `transform ${transitionDuration} ease`;
            s.style.transform = `translateX(${xPos}px)`;
        };

        if (Math.abs(deltaX) > 10) {
            // It was a drag, prevent click
            // (Handled by capture listener)
        }

        if (deltaX < -threshold && nextIdx !== -1) {
            // Next
            animateTo(idx, -containerWidth);
            animateTo(nextIdx, 0);
            
            setTimeout(() => {
                // Cleanup and update
                [idx, prevIdx, nextIdx].forEach(i => {
                    if (i === -1) return;
                    slides[i].style.transition = '';
                    slides[i].style.transform = '';
                    slides[i].style.display = '';
                    slides[i].style.zIndex = '';
                });
                next(); // Use existing logic to update state/classes
            }, 300);
            
        } else if (deltaX > threshold && prevIdx !== -1) {
            // Prev
            animateTo(idx, containerWidth);
            animateTo(prevIdx, 0);
            
            setTimeout(() => {
                [idx, prevIdx, nextIdx].forEach(i => {
                    if (i === -1) return;
                    slides[i].style.transition = '';
                    slides[i].style.transform = '';
                    slides[i].style.display = '';
                    slides[i].style.zIndex = '';
                });
                prev();
            }, 300);
            
        } else {
            // Revert
            animateTo(idx, 0);
            if (prevIdx !== -1) animateTo(prevIdx, -containerWidth);
            if (nextIdx !== -1) animateTo(nextIdx, containerWidth);
            
            setTimeout(() => {
                [idx, prevIdx, nextIdx].forEach(i => {
                    if (i === -1) return;
                    slides[i].style.transition = '';
                    slides[i].style.transform = '';
                    slides[i].style.display = '';
                    slides[i].style.zIndex = '';
                });
                runLoop();
            }, 300);
        }
      };

      // Touch events
      frontContainer.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
           startDrag(e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: false }); // passive: false to allow preventDefault

      frontContainer.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
           moveDrag(e.touches[0].clientX, e.touches[0].clientY, e);
        }
      }, { passive: false });

      frontContainer.addEventListener('touchend', (e) => {
        endDrag();
      });

      // Mouse events (for desktop testing)
      frontContainer.addEventListener('mousedown', (e) => {
         e.preventDefault(); // Prevent image drag
         startDrag(e.clientX, e.clientY);
         frontContainer.style.cursor = 'grabbing';
      });
      
      frontContainer.addEventListener('mousemove', (e) => {
         if (isDragging) moveDrag(e.clientX, e.clientY, e);
      });
      
      window.addEventListener('mouseup', () => {
         if (isDragging) {
             frontContainer.style.cursor = '';
             endDrag();
         }
      });

      // Prevent click if dragged
      frontContainer.addEventListener('click', (e) => {
         if (hasMoved && Math.abs(currentX - startX) > 10) {
             e.preventDefault();
             e.stopPropagation();
         }
      }, { capture: true });
    }

    const runLoop = () => {
        if (window.frontAdsTimer) clearTimeout(window.frontAdsTimer);
        if (config.loop === 'once' && idx >= slides.length - 1) return;

        const currentSlide = slides[idx];
        const iframe = currentSlide.querySelector('iframe');
        
        if (iframe) {
            // Check if YouTube API is ready
            if (window.YT && window.YT.Player) {
                 let player = players[idx];
                 if (!player) {
                     player = new YT.Player(iframe, {
                         events: {
                             'onStateChange': (event) => {
                                 if (event.data === YT.PlayerState.ENDED) {
                                     next();
                                 }
                             },
                             'onReady': (event) => {
                                 event.target.playVideo();
                             },
                             'onError': (event) => {
                                 console.warn('YT Player Error:', event.data);
                                 next();
                             }
                         }
                     });
                     players[idx] = player;
                 } else {
                     // Ensure it plays
                     if (typeof player.getPlayerState === 'function') {
                        const state = player.getPlayerState();
                        // If paused, buffering, or ENDED (replay), play video
                        if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING) {
                            if (state === YT.PlayerState.ENDED) {
                                player.seekTo(0);
                            }
                            player.playVideo();
                        }
                     }
                 }
                 // Do not set timeout; wait for ENDED event
                 return; 
            } else {
                // API not ready, retry in 300ms
                ytRetryCount++;
                if (ytRetryCount > 20) {
                    console.warn('YT API timeout, skipping slide');
                    next();
                    return;
                }
                window.frontAdsTimer = setTimeout(() => {
                    runLoop();
                }, 300);
                return;
            }
        }

        // Image slide
        window.frontAdsTimer = setTimeout(() => {
          next();
        }, intervalTime);
    };
    
    showSlide(idx, null);
    runLoop();
}

async function loadFrontButtons(slug) {
  const a6Btns = document.querySelectorAll(".row.A6 .feature-btn");
  const a8Btns = document.querySelectorAll(".row.A8 .feature-btn");
  if (!a6Btns.length && !a8Btns.length) return;
  try {
    let snap = await getDoc(doc(db, `communities/${slug}/app_modules/buttons`));
    if (!snap.exists()) {
      const def = await getDoc(doc(db, `communities/default/app_modules/buttons`));
      if (!def.exists()) return;
      snap = def;
    }
    const data = snap.data() || {};
    const a6 = Array.isArray(data.a6) ? data.a6 : [];
    const a8 = Array.isArray(data.a8) ? data.a8 : [];
    const applyToButtons = (items, nodeList) => {
      const byIdx = {};
      items.forEach(it => { if (typeof it.idx === "number") byIdx[it.idx] = it; });
      nodeList.forEach((btn, i) => {
        const cfg = byIdx[i + 1] || null;
        const textEl = btn.querySelector(".nav-text");
        const iconEl = btn.querySelector(".nav-icon");
        if (cfg && textEl) textEl.textContent = cfg.text || textEl.textContent;
        if (cfg && cfg.iconUrl) {
          if (iconEl && iconEl.tagName === "IMG") {
            iconEl.src = cfg.iconUrl;
          } else {
            const img = document.createElement("img");
            img.className = "nav-icon";
            img.src = cfg.iconUrl;
            if (iconEl) iconEl.replaceWith(img);
            else btn.prepend(img);
          }
        }
        btn.onclick = null;
        if (cfg && cfg.link) {
          btn.addEventListener("click", () => {
            const url = cfg.link;
            const title = (cfg.text || (textEl && textEl.textContent) || "連結");
            if (!url) return;
            if (cfg.newWindow) {
              try { window.open(url, "_blank", "noopener"); } catch {}
            } else {
              openLinkView(title, url);
            }
          });
        }
      });
    };
    applyToButtons(a6, a6Btns);
    applyToButtons(a8, a8Btns);
  } catch (e) {
    console.error("Load front buttons failed", e);
  }
}

function openLinkView(title, url) {
  // Fix mixed content issue: upgrade http to https for github.io
  if (url && typeof url === 'string' && url.startsWith('http://') && url.includes('github.io')) {
    url = url.replace('http://', 'https://');
  }

  // Fix: Rewrite production URLs to local if running locally
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    if (url.includes("nw-app.github.io/nw-app")) {
      url = url.replace("https://nw-app.github.io/nw-app", window.location.origin)
               .replace("http://nw-app.github.io/nw-app", window.location.origin);
    }
  }

  // Fix: Ensure .html extension for internal pages (required for local http-server)
  if (url.includes("/preview-facility") && !url.includes("preview-facility.html")) {
    url = url.replace("/preview-facility", "/preview-facility.html");
  }

  let root = document.getElementById("sys-modal");
  if (!root) {
    root = document.createElement("div");
    root.id = "sys-modal";
    root.className = "modal hidden";
    document.body.appendChild(root);
  }
  const safeTitle = (title || "").replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));
  const html = `
    <div class="modal-dialog link-view-dialog">
      <div class="modal-head link-view-head">
        <div class="modal-title link-view-title">${safeTitle}</div>
        <div style="display:flex;align-items:center;gap:16px;">
          <a href="${url}" target="_blank" rel="noopener" class="link-view-external" title="在新視窗開啟" style="display:flex;color:#666;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
          <button type="button" id="link-view-close" class="btn link-view-close">
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
              <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
            </svg>
          </button>
        </div>
      </div>
      <div class="modal-body link-view-body">
        <iframe class="link-view-iframe" src="${url}" frameborder="0" allow="autoplay; encrypted-media; clipboard-read; clipboard-write; geolocation"></iframe>
      </div>
    </div>
  `;
  openModal(html);
  const closeBtn = document.getElementById("link-view-close");
  if (closeBtn) closeBtn.addEventListener("click", () => closeModal());
  const escHandler = (e) => {
    if (e.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", escHandler, true);
    }
  };
  document.addEventListener("keydown", escHandler, true);
}

let unsubscribeFrontButtons = null;
function subscribeFrontButtons(slug) {
  if (unsubscribeFrontButtons) {
    try { unsubscribeFrontButtons(); } catch {}
    unsubscribeFrontButtons = null;
  }
  const ref = doc(db, `communities/${slug}/app_modules/buttons`);
  unsubscribeFrontButtons = onSnapshot(ref, () => {
    loadFrontButtons(slug);
  }, (err) => {
    void 0;
  });
}

let unsubscribeFrontAds = null;
function subscribeFrontAds(slug) {
  if (unsubscribeFrontAds) {
    try { unsubscribeFrontAds(); } catch {}
    unsubscribeFrontAds = null;
  }
  const ref = doc(db, `communities/${slug}/app_modules/ads`);
  unsubscribeFrontAds = onSnapshot(ref, (snap) => {
    loadFrontAds(slug, snap);
  }, (err) => {
    void 0;
  });
}

function startFrontPolling(slug) {
  try {
    if (window.frontDataPolling) clearInterval(window.frontDataPolling);
  } catch {}
  // Polling disabled in favor of real-time subscriptions (subscribeFrontAds/Buttons)
}

window.addEventListener("beforeunload", () => {
  if (unsubscribeFrontAds) {
    try { unsubscribeFrontAds(); } catch {}
    unsubscribeFrontAds = null;
  }
  if (unsubscribeFrontButtons) {
    try { unsubscribeFrontButtons(); } catch {}
    unsubscribeFrontButtons = null;
  }
  if (window.frontDataPolling) {
    try { clearInterval(window.frontDataPolling); } catch {}
    window.frontDataPolling = null;
  }

});

function matchInPath(e, selector) {
  const p = (typeof e.composedPath === "function") ? e.composedPath() : [];
  if (Array.isArray(p) && p.length) {
    for (let i = 0; i < p.length; i++) {
      const n = p[i];
      if (n && n.matches && n.matches(selector)) return n;
      if (n && n.closest && n.closest(selector)) return n.closest(selector);
    }
    return null;
  }
  const t = e.target;
  return t && t.closest ? t.closest(selector) : null;
}
async function handleCreateResidentTrigger(e) {
  const btn = matchInPath(e, "#btn-create-resident-admin") || matchInPath(e, "#btn-create-resident");
  if (!btn) return;
  const root = document.getElementById("sys-modal");
  if (root && !root.classList.contains("hidden")) return;
  let slug = getSlugFromPath() || getQueryParam("c") || "default";
  if (slug === "default" && auth.currentUser) {
    slug = await getUserCommunity(auth.currentUser.uid);
  }
  if (window.openCreateResidentModal) {
    window.openCreateResidentModal(slug);
  }
}
document.addEventListener("click", handleCreateResidentTrigger, true);
document.addEventListener("touchend", handleCreateResidentTrigger, { passive: true, capture: true });

// ==========================================
// QR Code Scanner Implementation
// ==========================================
window.openQRScanner = async function(callback) {
  const modalId = 'qr-scanner-modal';
  
  // 1. Safely stop existing scanner BEFORE touching the DOM
  // This prevents "Device in use" errors caused by destroying the video element while scanner is running
  if (window.currentQrScanner) {
      try {
          await window.currentQrScanner.stop();
          window.currentQrScanner.clear();
      } catch(e) {
          console.warn("Failed to stop existing scanner", e);
      }
      window.currentQrScanner = null;
  }

  let modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    // Use fixed positioning and high z-index to overlay everything
    modal.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:99999; align-items:center; justify-content:center;';
    document.body.appendChild(modal);
  }
  
  // 2. Reset DOM content
  modal.innerHTML = `
      <div class="modal-dialog" style="background:#fff; width:90%; max-width:400px; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; max-height:90vh; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
        <div class="modal-head" style="padding:16px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
          <div class="modal-title" style="font-size:18px; font-weight:600; color:#333;">掃描 QR Code</div>
          <button type="button" onclick="closeQRScanner()" style="background:none; border:none; cursor:pointer; padding:4px; display:flex; align-items:center;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="#666" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="modal-body" style="padding:0; background:#000; flex:1; display:flex; align-items:center; justify-content:center; position:relative; min-height: 300px;">
          <div id="qr-reader" style="width:100%;"></div>
        </div>
        <div class="modal-foot" style="padding:16px; border-top:1px solid #eee; text-align:right;">
          <button class="btn action-btn" onclick="closeQRScanner()" style="padding: 8px 16px; border-radius: 6px; border: 1px solid #ddd; background: #fff; cursor: pointer;">關閉</button>
        </div>
      </div>
    `;
  
  modal.style.display = 'flex';
  
  // 3. Start Scanner
  setTimeout(() => {
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };
      startScannerInstance(config, callback);
  }, 100);
};

// Alias for generic usage
window.startQrScanner = window.openQRScanner;

function startScannerInstance(config, callback) {
    if (typeof Html5Qrcode === 'undefined') {
        alert("掃描模組尚未載入，請稍後再試或重新整理頁面。");
        closeQRScanner();
        return;
    }

    // Ensure element exists
    if (!document.getElementById("qr-reader")) {
        console.error("QR Reader element not found");
        return;
    }

    const html5QrCode = new Html5Qrcode("qr-reader");
    window.currentQrScanner = html5QrCode;
    
    const successHandler = (decodedText, decodedResult) => {
        if (callback) {
            callback(decodedText, decodedResult);
            closeQRScanner();
        } else {
            onScanSuccess(decodedText, decodedResult);
        }
    };
    
    html5QrCode.start({ facingMode: "environment" }, config, successHandler, onScanFailure)
    .catch(err => {
        console.error("Error starting scanner", err);
        const reader = document.getElementById("qr-reader");
        if (reader) {
            // Show error but keep retry possibility
            reader.innerHTML = `<div style="color:white; padding:20px; text-align:center;">無法啟動相機<br><br>${err}<br><br><button class="btn small" onclick="closeQRScanner(); setTimeout(() => openQRScanner(${callback}), 500)">重試</button></div>`;
        }
    });
}

window.closeQRScanner = function() {
  const modal = document.getElementById('qr-scanner-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  
  if (window.currentQrScanner) {
    const scanner = window.currentQrScanner;
    // Note: We do NOT set window.currentQrScanner = null immediately.
    // We wait until it stops. This ensures openQRScanner knows it's still active/stopping
    // and can await it properly to avoid "Device in use" errors.
    
    scanner.stop().then(() => {
      try { scanner.clear(); } catch(e) {}
      if (window.currentQrScanner === scanner) {
          window.currentQrScanner = null;
      }
    }).catch(err => {
      console.warn("Failed to stop scanner", err);
      // Even if error, we should clear the reference eventually
      if (window.currentQrScanner === scanner) {
          window.currentQrScanner = null;
      }
    });
  }
};

function onScanSuccess(decodedText, decodedResult) {
  const bookerInput = document.getElementById('res-booker');
  if (bookerInput) {
    bookerInput.value = decodedText;
    // Trigger blur to fetch points
    bookerInput.dispatchEvent(new Event('blur'));
  }
  
  if (navigator.vibrate) navigator.vibrate(200);
  
  closeQRScanner();
}

function onScanFailure(error) {
  // console.warn(`Code scan error = ${error}`);
}

window.showAdModal = (src, description) => {
  if (!src) return;
  const desc = description || "無內容說明";
  const body = `
    <div class="modal-dialog" style="width: 90%; max-width: 90vw; height: auto; max-height: 90vh; display: flex; flex-direction: column;">
      <div class="modal-head">
        <div class="modal-title">內容說明</div>
        <button class="btn" style="background: transparent; border: none; padding: 4px; display: flex; align-items: center; justify-content: center; color: #666; cursor: pointer;" onclick="closeModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 24px; height: 24px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="modal-body" style="padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px;">
        <div style="width: 100%; display: flex; justify-content: center; background: #000;">
            <img src="${src}" style="max-width: 100%; max-height: 50vh; object-fit: contain;">
        </div>
        <div style="font-size: 16px; line-height: 1.6; color: #333; white-space: pre-wrap; padding: 10px; background: #f9f9f9; border-radius: 8px;">${desc}</div>
      </div>
    </div>
  `;
  openModal(body);
};

window.openCancelReservationModal = function(slug, resId, facilityName, date, startTime, endTime) {
  const body = `
    <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">取消預約</div></div>
        <div class="modal-body">
            <p>您確定要取消 <strong>${facilityName}</strong> 的預約嗎？</p>
            <p style="color:#666; font-size:14px; margin-top:8px;">時間: ${date} ${startTime}~${endTime}</p>
        </div>
        <div class="modal-foot">
            <button class="btn action-btn" onclick="closeModal()">保留</button>
            <button class="btn action-btn primary" onclick="confirmCancelReservation('${slug}', '${resId}')" style="background-color: #ef4444; color: white;">確定取消</button>
        </div>
    </div>
  `;
  openModal(body);
};

window.confirmCancelReservation = async function(slug, resId) {
    try {
        const btns = document.querySelectorAll("#sys-modal .action-btn");
        const confirmBtn = btns[btns.length - 1];
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerText = "處理中...";
        }

        await updateDoc(doc(db, "communities", slug, "reservations", resId), {
            status: "cancelled"
        });
        
        closeModal();
        
        if (typeof showHint === 'function') {
             showHint("已取消預約", "success");
        } else {
             alert("已取消預約");
        }
        
        if (typeof loadPersonalData === 'function') {
            loadPersonalData(slug);
        }

    } catch(e) {
        console.error("Cancel failed", e);
        alert(`取消失敗: ${e.code || e.message} (ID: ${resId})`);
        closeModal();
    }
};
