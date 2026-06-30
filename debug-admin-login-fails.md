[OPEN] admin-login-fails

## 症狀
- 系統管理員無法登入（手機端畫面停留頂部列/空白或登入流程失敗）。
- 期望：登入成功後可正常載入主畫面內容。

## 初始假設（可被證偽）
- H1：Firebase Auth 登入本身失敗（錯誤碼如 auth/invalid-credential、auth/unauthorized-domain、auth/network-request-failed）。
- H2：登入成功，但後續讀取使用者資料（users/roles/permissions）被 Firestore rules 擋住或查不到文件，導致 UI 看起來像沒登入或空白。
- H3：Service Worker 快取造成手機載入舊版 index.html / firebase-config / sw，導致登入流程與規則/資料結構不一致。
- H4：手機端發生未捕捉的 JS 例外/Promise rejection，渲染中斷。
- H5：行動網路 DNS/攔截或瀏覽器限制導致 Firebase 相關請求被擋（CSP/混合內容/封鎖第三方）。

## 取證計畫
- 先在 index.html 加入「只回報、不改邏輯」的 instrumentation：global error、unhandledrejection、auth step、firestore step。
- 用 remote Debug Server 收集手機端 log（包含錯誤碼與關鍵狀態）。

## 成功標準
- 取得可重現的一組 runtime log，能明確判定上述假設中哪一個成立。
- 基於 evidence 做最小修復並驗證：手機端可登入並顯示主內容。

