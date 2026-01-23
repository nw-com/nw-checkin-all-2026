import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js";
import { initializeFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, where, setLogLevel, onSnapshot, writeBatch, addDoc, orderBy, deleteField } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

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
try {
  const _origError = console.error.bind(console);
  console.error = (...args) => {
    const s = args.map(a => {
      if (typeof a === "string") return a;
      if (a && typeof a === "object" && a.message) return String(a.message);
      return "";
    }).join(" ");
    if (
      s.includes("google.firestore.v1.Firestore/Listen/channel") ||
      s.includes("net::ERR_ABORTED")
    ) {
      return;
    }
    _origError(...args);
  };
} catch {}
try {
  const suppress = (msg) => {
    const s = String(msg || "");
    return s.includes("google.firestore.v1.Firestore/Listen/channel") || s.includes("net::ERR_ABORTED");
  };
  window.addEventListener("error", (e) => {
    const m = e && (e.message || (e.error && e.error.message));
    if (suppress(m)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("unhandledrejection", (e) => {
    const r = e && e.reason;
    const m = (r && r.message) ? r.message : String(r || "");
    if (suppress(m)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
} catch {}
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
  if (window._qrLibLoading) return window._qrLibLoading;
  window._qrLibLoading = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
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
  } catch {}
  const safe = (text || "").replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size||64}' height='${size||64}'><rect width='100%' height='100%' fill='#ffffff'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='10' fill='#111'>${safe}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
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
  const title = "個人資訊";
  const email = (u && u.email) || "";
  let name = (u && u.displayName) || "";
  let photo = (u && u.photoURL) || "";
  let phone = "";
  let status = "啟用";
  let role = "住戶";
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
      }
    } catch {}
  }
  const body = `
    <div class="modal-dialog">
      <div class="modal-head"><div class="modal-title">${title}</div></div>
      <div class="modal-body">
        <div class="modal-row">
          <label>大頭照</label>
          <img class="avatar-preview" src="${photo || ""}">
        </div>
        <div class="modal-row">
          <label>姓名</label>
          <input type="text" value="${name || ""}" disabled>
        </div>
        <div class="modal-row">
          <label>電子郵件</label>
          <input type="text" value="${email}" disabled>
        </div>
        <div class="modal-row">
          <label>手機號碼</label>
          <input type="text" value="${phone}" disabled>
        </div>
        <div class="modal-row">
          <label>角色</label>
          <input type="text" value="${role}" disabled>
        </div>
        <div class="modal-row">
          <label>狀態</label>
          <input type="text" value="${status}" disabled>
        </div>
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
    const email = el.email.value.trim();
    const password = el.password.value;
    if (!email || !password) return showHint("請輸入帳號密碼", "error");

    el.btnLogin.disabled = true;
    el.btnLogin.textContent = "登入中...";
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
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
        openEditModal(target, isSelf);
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
        startFrontPolling(slug);

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
                if (target) openEditModal(target, targetUid === uid);
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
  async function openEditModal(target, isSelf) {
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
        if (typeof renderSettingsGeneral === "function") await renderSettingsGeneral();
        if (typeof renderSettingsCommunity === "function") await renderSettingsCommunity();
        if (typeof renderSettingsResidents === "function") await renderSettingsResidents();

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
        openEditModal(target, isSelf);
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
        const item = adsData.find(x => x.idx === i) || { idx: i, url: '', type: 'image', autoplay: false };
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
              <colgroup><col width="60"><col><col width="100"><col width="120"></colgroup>
              <thead>
                <tr>
                  <th>序號</th>
                  <th>圖片或影片位置</th>
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
      let data = { a6: [], a8: [] };
      try {
        const targetSlug = current === 'all' ? 'default' : current;
        const snap = await getDoc(doc(db, `communities/${targetSlug}/app_modules/buttons`));
        if (snap.exists()) {
          const d = snap.data();
          data.a6 = Array.isArray(d.a6) ? d.a6 : [];
          data.a8 = Array.isArray(d.a8) ? d.a8 : [];
        }
      } catch {}
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
      const a6Rows = buildRows(data.a6, "a6");
      const a8Rows = buildRows(data.a8, "a8");
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
             const typeEl = tr.querySelector(".ad-type-badge");
             const type = typeEl.textContent === 'YouTube' ? 'youtube' : 'image';
             const autoplay = tr.querySelector(".ad-autoplay").checked;
             if (url) {
               items.push({ idx, url, type, autoplay });
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
           const typeEl = tr.querySelector(".ad-type-badge");
           const type = typeEl.textContent === 'YouTube' ? 'youtube' : 'image';
           const autoplay = tr.querySelector(".ad-autoplay").checked;
           if (url) {
             items.push({ idx, url, type, autoplay });
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
                 content = `<img src="${item.url}" alt="Slide ${idx+1}">`;
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
  others: ["日誌", "班表", "通訊", "巡邏", "設定"]
};

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
      openTime: "00:00",
      closeTime: "24:00",
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
                 <div class="modal-title">預約設定 - ${navItem.label}</div>
              </div>
              <div class="modal-body">
                <div class="field">
                    <div class="field-head">預約名稱</div>
                    <div class="input-wrap"><input type="text" id="set-name" value="${navItem.label}"></div>
                </div>

                <div class="field">
                    <div class="field-head">按鈕顏色</div>
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
              <div class="modal-foot">
                <button id="set-cancel" class="btn action-btn">取消</button>
                <button id="set-save" class="btn action-btn primary">儲存設定</button>
              </div>
            </div>
          `;
          
          // Update modal content
          const modalRoot = document.getElementById("sys-modal");
          if(modalRoot) {
              modalRoot.innerHTML = formHtml;
              
              // Bind Events
              const colorPicker = document.getElementById("set-color-picker");
              const colorText = document.getElementById("set-color-text");
              
              if(colorPicker && colorText) {
                  colorPicker.addEventListener("input", () => colorText.value = colorPicker.value);
                  colorText.addEventListener("input", () => colorPicker.value = colorText.value);
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
                      const newHoliday = document.getElementById("set-holiday").checked;
                      const newStatus = document.getElementById("set-status").value;

                      if(!newName) { alert("請輸入預約名稱"); return; }
                      if(newUnit < 1 || newUnit > 24) { alert("時段單位需介於 1 至 24 小時"); return; }
                      
                      btnSave.textContent = "儲存中...";
                      btnSave.disabled = true;

                      try {
                          // 1. Update Nav (Name & Color)
                          const navRef = doc(db, "communities", slug, "settings", "nav");
                          const navSnap = await getDoc(navRef);
                          if(navSnap.exists()) {
                              let tabs = navSnap.data().facility_tabs || [];
                              const newTabs = tabs.map(t => {
                                  const k = (typeof t === 'object') ? t.key : t;
                                  if(k === facilityKey) {
                                      return { key: facilityKey, label: newName, buttonColor: newColor };
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
                              holidayOpen: newHoliday,
                              status: newStatus
                          }, { merge: true });

                          showHint("設定已儲存", "success");
                          closeModal();
                          
                          // Update UI
                          const titleEl = document.querySelector(".card-title");
                          if(titleEl) titleEl.innerHTML = `${newName} - 預約管理`;
                          
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
  
  // Cleanup previous listeners
  if (window.adminFacilityUnsub) {
    window.adminFacilityUnsub();
    window.adminFacilityUnsub = null;
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

    let items = [];
    try {
        const ref = collection(db, "communities", slug, "reservations");
        const q = query(ref, where("facility", "==", facilityKey));
        // Use onSnapshot for realtime updates? The previous code used getDocs inside onAuthStateChanged.
        // But let's stick to single fetch for now to match the pattern, or upgrade to onSnapshot if I want realtime.
        // Actually, the previous code was inside onAuthStateChanged which runs once on login.
        // It didn't have a real-time listener for the collection itself.
        // Let's use getDocs for now as per previous implementation to avoid complexity with multiple listeners.
        const snap = await getDocs(q);
        items = snap.docs.map(d => ({id: d.id, ...d.data()}));
        // Sort by date/time desc
        items.sort((a,b) => {
            const dateA = a.date + (a.startTime || "");
            const dateB = b.date + (b.startTime || "");
            return dateB.localeCompare(dateA);
        });
    } catch (e) {
        console.error("Failed to load reservations", e);
    }

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
                 <h1 class="card-title" style="margin:0;">${displayTitle} - 預約管理</h1>
                 <button id="btn-fac-settings" class="btn small icon-btn" title="設定" style="padding:4px; height:auto; background:transparent; border:none; color:#666; cursor:pointer;">
                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                 </button>
              </div>
              <div style="display:flex; gap:8px;">
                 <button id="btn-create-res" class="btn small action-btn">新增預約</button>
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

        // Create Button
        const btnCreate = document.getElementById("btn-create-res");
        if(btnCreate) {
            btnCreate.addEventListener("click", () => {
                // Pass selectedDate as default
                openFacilityReservationModal({date: selectedDate}, displayTitle, slug, facilityKey, true);
            });
        }

        // Table Actions
        document.querySelectorAll(".btn-edit-res").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.closest("tr").getAttribute("data-id");
                const item = items.find(i => i.id === id);
                openFacilityReservationModal(item, displayTitle, slug, facilityKey);
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
                        return dateB.localeCompare(dateA);
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
            const hasRes = items.some(i => i.date === dateStr);
            
            let classes = "cal-day";
            if(isSelected) classes += " active";
            if(isToday) classes += " today";
            if(hasRes) classes += " has-res";
            
            html += `<div class="${classes}" data-date="${dateStr}">${d}</div>`;
        }
        return html;
    };

    const generateScheduleHTML = () => {
        const dayItems = items.filter(i => i.date === selectedDate);
        // Sort by start time asc
        dayItems.sort((a,b) => (a.startTime || "").localeCompare(b.startTime || ""));
        
        if(dayItems.length === 0) return `<div style="text-align:center; color:#999; padding:20px;">無預約</div>`;
        
        return dayItems.map(item => `
            <div class="schedule-item">
               <span class="schedule-status">${item.status || "已預約"}</span>
               <span class="schedule-time">${item.startTime} - ${item.endTime}</span>
               <div class="schedule-info">${item.bookerName || ""}</div>
               ${item.note ? `<div style="color:#666; font-size:12px; margin-top:4px;">${item.note}</div>` : ""}
            </div>
        `).join("");
    };

    const generateTableHTML = () => {
        // Show all items
        return items.map(item => {
            return `
                <tr data-id="${item.id}" style="${item.date === selectedDate ? 'background:#f0f9ff;' : ''}">
                    <td>${item.date}</td>
                    <td>${item.startTime} - ${item.endTime}</td>
                    <td>${item.bookerName || ""}</td>
                    <td>${item.status || "已預約"}</td>
                    <td class="actions">
                        <button class="btn small action-btn btn-edit-res">編輯</button>
                        <button class="btn small action-btn danger btn-delete-res">刪除</button>
                    </td>
                </tr>
            `;
        }).join("");
    };

    renderUI();
  });
}

function openFacilityReservationModal(item, displayTitle, slug, facilityKey, isNewWithDate = false) {
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
             <div class="input-wrap"><input type="text" id="res-booker" value="${item && item.bookerName ? item.bookerName : ""}" placeholder="請輸入住戶姓名或房號"></div>
           </label>
           <label class="field">
             <div class="field-head">狀態</div>
             <div class="input-wrap">
                <select id="res-status">
                  <option value="已預約" ${item && item.status === "已預約" ? "selected" : ""}>已預約</option>
                  <option value="已取消" ${item && item.status === "已取消" ? "selected" : ""}>已取消</option>
                  <option value="已完成" ${item && item.status === "已完成" ? "selected" : ""}>已完成</option>
                </select>
             </div>
           </label>
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

    setTimeout(() => {
        const btnSave = document.getElementById("btn-save-res");
        if(btnSave) {
            btnSave.addEventListener("click", async () => {
                const dateVal = document.getElementById("res-date").value;
                const startVal = document.getElementById("res-start").value;
                const endVal = document.getElementById("res-end").value;
                const bookerVal = document.getElementById("res-booker").value;
                const statusVal = document.getElementById("res-status").value;
                const noteVal = document.getElementById("res-note").value;

                if (!dateVal || !startVal || !endVal || !bookerVal) {
                    alert("請填寫所有必填欄位");
                    return;
                }

                btnSave.disabled = true;
                btnSave.textContent = "儲存中...";

                try {
                    const data = {
                        facility: facilityKey,
                        date: dateVal,
                        startTime: startVal,
                        endTime: endVal,
                        bookerName: bookerVal,
                        status: statusVal,
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
      adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">收件</h1></div><div class="empty-hint">尚未建立表單</div></div>`;
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
      adminNav.content.innerHTML = `<div class="card data-card"><div class="card-head"><h1 class="card-title">郵件包裹設定</h1></div><div class="empty-hint">尚未建立設定</div></div>`;
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
                            const qrCodeText = (row["QR code"] || "").trim();
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
            window.openEditModal && window.openEditModal(target, isSelf);
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
                let balance = 0;
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
                if (summary) {
                  summary.innerHTML = `
                    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;align-items:center;">
                      <div><strong>戶號</strong>：${houseNo}</div>
                      <div><strong>子戶號數量</strong>：${subCount}</div>
                      <div><strong>子戶號姓名</strong>：${names.join("、") || "—"}</div>
                      <div><strong>地址</strong>：${address || "—"}</div>
                      <div style="grid-column:1 / -1;"><strong>點數</strong>：<span style="color:#f59e0b;font-weight:800;font-size:20px;">${balance}</span></div>
                    </div>
                  `;
                }
                const tbody = document.getElementById("points-tbody");
                if (tbody) {
                  try {
                    let logs = [];
                    try {
                      const qLogs = query(collection(db, `communities/${slug}/app_modules/points_logs`), where("houseNo", "==", houseNo));
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
function renderAdminSubNav(key) {
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
              }
          }, (e) => {
              console.error(e);
              attachListeners(items);
          });
      })();
  } else if (key === 'facility') {
      let localUnsub = null;
      const wrapper = () => { if (localUnsub) localUnsub(); };
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
              
              const activeBtn = adminNav.subContainer.querySelector(".sub-nav-item.active");
              if(activeBtn) {
                   const titleEl = document.querySelector(".row.B3 .card-title");
                   if(titleEl) titleEl.textContent = activeBtn.getAttribute("data-label");
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

      buttons.forEach((btn, index) => {
        // Click to switch
        btn.addEventListener("click", () => {
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
                      const newKey = (key === 'facility' ? "fac_" : "ann_") + Date.now();
                      const newItem = { key: newKey, label: name.trim() };
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
         content = `<img src="${item.url}" alt="Slide ${idx+1}">`;
      }
      return `<div class="preview-slide ${idx===0?'active':''}">${content}</div>`;
    }).join('');
    
    const showNav = (config.nav === true) || (validItems.length > 1);
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
    
    const showSlide = (i, enterFrom) => {
        slides.forEach(s => {
          s.classList.remove('active');
          s.classList.remove('enter-left');
          s.classList.remove('enter-right');
        });
        const target = slides[i];
        if (target) {
          target.classList.add('active');
          if (enterFrom === 'right') {
            target.classList.add('enter-right');
            setTimeout(() => target.classList.remove('enter-right'), 500);
          } else if (enterFrom === 'left') {
            target.classList.add('enter-left');
            setTimeout(() => target.classList.remove('enter-left'), 500);
          }
        }
    };
    
    const next = () => {
        if (config.loop === 'rewind') {
            if (slides.length <= 1) return;
            if (idx >= slides.length - 1) direction = -1;
            if (idx <= 0) direction = 1;
            idx += direction;
        } else if (config.loop === 'once') {
            if (idx < slides.length - 1) idx++;
            else {
                if (window.frontAdsInterval) clearInterval(window.frontAdsInterval);
                return;
            }
        } else { 
            idx = (idx + 1) % slides.length;
        }
        showSlide(idx, 'right');
    };

    const prev = () => {
        if (config.loop === 'once') {
            if (idx > 0) idx--;
        } else { 
            idx = (idx - 1 + slides.length) % slides.length;
        }
        showSlide(idx, 'left');
    };

    if (btnNext) {
       btnNext.onclick = (e) => { e.preventDefault(); next(); resetTimer(); };
    }
    if (btnPrev) {
       btnPrev.onclick = (e) => { e.preventDefault(); prev(); resetTimer(); };
    }

    // Swipe support
    if (frontContainer) {
      let touchStartX = 0;
      let touchEndX = 0;
      frontContainer.addEventListener('touchstart', (e) => {
        if (e.changedTouches && e.changedTouches.length > 0) {
          touchStartX = e.changedTouches[0].screenX;
        }
        if (window.frontAdsInterval) clearInterval(window.frontAdsInterval);
      }, { passive: true });
      frontContainer.addEventListener('touchend', (e) => {
        if (e.changedTouches && e.changedTouches.length > 0) {
          touchEndX = e.changedTouches[0].screenX;
          if (touchEndX < touchStartX - 50) next();
          if (touchEndX > touchStartX + 50) prev();
        }
        resetTimer();
      }, { passive: true });
    }

    const startTimer = () => {
        if (config.loop === 'once' && idx >= slides.length - 1) return;
        window.frontAdsInterval = setInterval(() => {
          next();
        }, intervalTime);
    };
    
    const resetTimer = () => {
        if (window.frontAdsInterval) clearInterval(window.frontAdsInterval);
        startTimer();
    };

    showSlide(idx, null);
    startTimer();
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
  unsubscribeFrontAds = onSnapshot(ref, () => {
    loadFrontAds(slug);
  }, (err) => {
    void 0;
  });
}

function startFrontPolling(slug) {
  try {
    if (window.frontDataPolling) clearInterval(window.frontDataPolling);
  } catch {}
  const poll = async () => {
    try { await loadFrontAds(slug); } catch {}
    try { await loadFrontButtons(slug); } catch {}
  };
  window.frontDataPolling = setInterval(poll, 15000);
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
