import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBa3EfodIJk4hZgH0zEHTlEGqSxncpkIbs",
  authDomain: "nw-checkin-all-2026.firebaseapp.com",
  projectId: "nw-checkin-all-2026",
  storageBucket: "nw-checkin-all-2026.firebasestorage.app",
  messagingSenderId: "840454751760",
  appId: "1:840454751760:web:58bbfa83cb146f4fc7ac95",
  measurementId: "G-NQ0W45T9CK"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const togglePasswordBtn = document.getElementById("togglePassword");
const rememberCheckbox = document.getElementById("remember");
const loginForm = document.getElementById("login-form");
const messageBox = document.getElementById("message");

const openRegisterLink = document.getElementById("openRegister");
const modal = document.getElementById("modal");
const closeModalBtn = document.getElementById("closeModal");
const registerForm = document.getElementById("register-form");
const regEmailInput = document.getElementById("reg-email");
const regPasswordInput = document.getElementById("reg-password");
const toggleRegPasswordBtn = document.getElementById("toggleRegPassword");
const regRoleSelect = document.getElementById("reg-role");
const regMessageBox = document.getElementById("reg-message");

function setMessage(el, text){
  el.textContent = text || "";
}

function isValidPassword(v){
  if(!v || v.length < 6) return false;
  const hasLetter = /[A-Za-z]/.test(v);
  const hasDigit = /\d/.test(v);
  const onlyAlnum = /^[A-Za-z0-9]+$/.test(v);
  return hasLetter && hasDigit && onlyAlnum;
}

function togglePassword(input, btn){
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  btn.setAttribute("aria-label", isHidden ? "隱藏密碼" : "顯示密碼");
}

togglePasswordBtn.addEventListener("click", ()=> togglePassword(passwordInput, togglePasswordBtn));
toggleRegPasswordBtn.addEventListener("click", ()=> togglePassword(regPasswordInput, toggleRegPasswordBtn));

try{
  const savedEmail = localStorage.getItem("remember_email");
  if(savedEmail){
    emailInput.value = savedEmail;
    rememberCheckbox.checked = true;
  }
}catch(e){}

loginForm.addEventListener("submit", async (e)=>{
  e.preventDefault();
  setMessage(messageBox, "");
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  if(!isValidPassword(password)){
    setMessage(messageBox, "密碼需至少6位且為英數組合");
    return;
  }
  const remember = !!rememberCheckbox.checked;
  try{
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    try{
      if(remember) localStorage.setItem("remember_email", email);
      else localStorage.removeItem("remember_email");
    }catch(e){}
    setMessage(messageBox, "登入成功");
  }catch(err){
    setMessage(messageBox, "登入失敗：" + (err?.message || "未知錯誤"));
  }
});

openRegisterLink.addEventListener("click", (e)=>{
  e.preventDefault();
  modal.hidden = false;
});

closeModalBtn.addEventListener("click", ()=>{
  modal.hidden = true;
  setMessage(regMessageBox, "");
});

modal.addEventListener("click", (e)=>{
  if(e.target.classList.contains("modal-backdrop")){
    modal.hidden = true;
    setMessage(regMessageBox, "");
  }
});

registerForm.addEventListener("submit", async (e)=>{
  e.preventDefault();
  setMessage(regMessageBox, "");
  const email = regEmailInput.value.trim();
  const password = regPasswordInput.value.trim();
  const role = regRoleSelect.value.trim();
  if(!isValidPassword(password)){
    setMessage(regMessageBox, "密碼需至少6位且為英數組合");
    return;
  }
  if(!role){
    setMessage(regMessageBox, "請選擇角色");
    return;
  }
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;
    await setDoc(doc(db, "users", uid), { email, role, createdAt: Date.now() });
    setMessage(regMessageBox, "註冊成功，請返回登入");
  }catch(err){
    setMessage(regMessageBox, "註冊失敗：" + (err?.message || "未知錯誤"));
  }
});
