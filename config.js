// ============================================================
// 星光榮耀｜系統設定
// 填入 Firebase 專案設定後，系統自動切換為「正式連線模式」。
// 留空時為「本機示範模式」：資料只存在目前瀏覽器，供操作測試用。
// Firebase Web 設定（apiKey 等）屬公開識別資訊，可放在前端；
// 但「服務帳戶私密金鑰」絕對不可放進此檔或任何前端檔案。
// ============================================================

export const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",        // 例：https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

export const APP_CONFIG = {
  timezone: "Asia/Taipei",
  minCandidates: 2,
  maxCandidates: 100,
  maxImagesPerCandidate: 5,
  // 正式網址（GitHub Pages），用於產生投票連結與 QR Code。
  // 例："https://yourname.github.io/starlight-awards/"
  // 留空時自動使用目前網頁所在位置。
  publicBaseUrl: ""
};

// 僅供「本機示範模式」使用的測試密碼（非安全驗證，正式模式不使用）
export const DEMO_ADMIN_PASSWORD = "starlight2026";
