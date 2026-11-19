// ============================================================
// 資料層：同一套介面，兩種後端
//  - firebase：Firebase Auth + Realtime Database（正式連線，多人即時同步）
//  - demo    ：localStorage（本機示範，只在同一瀏覽器內同步，非安全驗證）
// ============================================================
import { FIREBASE_CONFIG, DEMO_ADMIN_PASSWORD } from "./config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
let storePromise = null;

export const isFirebaseConfigured = () => !!(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.databaseURL && FIREBASE_CONFIG.projectId);

export function getStore() {
  if (!storePromise) storePromise = isFirebaseConfigured() ? createFirebaseStore() : Promise.resolve(createDemoStore());
  return storePromise;
}

const mapUser = (u) => (u ? {
  uid: u.uid, email: u.email || "", isAnonymous: !!u.isAnonymous,
  provider: u.isAnonymous ? "anonymous" : (u.providerData?.[0]?.providerId || "password")
} : null);

async function createFirebaseStore() {
  const [{ initializeApp }, A, D] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-database.js`)
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = A.getAuth(app);
  const db = D.getDatabase(app);
  const r = (p) => D.ref(db, p);

  return {
    mode: "firebase",
    onAuth: (cb) => A.onAuthStateChanged(auth, (u) => cb(mapUser(u))),
    signIn: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
    signOut: () => A.signOut(auth),
    sendReset: (email) => A.sendPasswordResetEmail(auth, email),
    currentUser: () => mapUser(auth.currentUser),
    signInAnon: () => A.signInAnonymously(auth),
    async signInGoogle() {
      const provider = new A.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try { return await A.signInWithPopup(auth, provider); }
      catch (e) {
        // 部分手機瀏覽器封鎖彈出視窗時改用整頁導向
        if (/popup-blocked|operation-not-supported/.test(e.code || "")) return A.signInWithRedirect(auth, provider);
        throw e;
      }
    },
    /** 伺服器時間（毫秒），用於每日一次的日期判斷 */
    serverNow: () => new Promise((res) => {
      const off = D.onValue(r(".info/serverTimeOffset"), (s) => { off(); res(Date.now() + (s.val() || 0)); }, () => res(Date.now()));
    }),
    /** 投票完成後中斷連線，節省免費方案的同時連線數（上限 100） */
    goOffline: () => D.goOffline(db),
    lastAdminError: null,
    async isAdmin(uid) {
      try { this.lastAdminError = null; return (await D.get(r(`admins/${uid}`))).exists(); }
      catch (e) { this.lastAdminError = e?.code || e?.message || "unknown"; console.warn("isAdmin", e); return false; }
    },
    async get(path) {
      const s = await D.get(r(path));
      return s.exists() ? s.val() : null;
    },
    set: (path, val) => D.set(r(path), val),
    update: (updates) => D.update(r("/"), updates), // 多路徑原子更新
    remove: (path) => D.remove(r(path)),
    newKey: (path) => D.push(r(path)).key,
    on(path, cb, onError) {
      return D.onValue(r(path), (s) => cb(s.exists() ? s.val() : null), (e) => onError && onError(e));
    },
    now: () => D.serverTimestamp()
  };
}

// ---------------- 本機示範模式 ----------------
const DEMO_KEY = "starlight-awards-demo-v1";
const DEMO_USER_KEY = "starlight-awards-demo-user";
const TS = ".sv";

function createDemoStore() {
  const listeners = new Set();
  const authCbs = new Set();
  const load = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || {}; } catch { return {}; } };
  let root = load();

  const emit = () => listeners.forEach((l) => l.fire());
  const persist = () => { localStorage.setItem(DEMO_KEY, JSON.stringify(root)); emit(); };
  window.addEventListener("storage", (e) => { if (e.key === DEMO_KEY) { root = load(); emit(); } });

  const parts = (p) => String(p).split("/").filter(Boolean);
  const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
  const resolve = (v) => {
    if (v && typeof v === "object") {
      if (v[TS] === "timestamp") return Date.now();
      const out = Array.isArray(v) ? [] : {};
      for (const [k, x] of Object.entries(v)) { const y = resolve(x); if (y !== null && y !== undefined) out[k] = y; }
      return out;
    }
    return v;
  };
  const getAt = (p) => {
    let n = root;
    for (const k of parts(p)) { if (n == null || typeof n !== "object") return null; n = n[k]; }
    return n === undefined ? null : clone(n);
  };
  const setAt = (p, v) => {
    const ks = parts(p);
    v = resolve(v);
    if (!ks.length) { root = v || {}; return; }
    let n = root;
    for (const k of ks.slice(0, -1)) { if (typeof n[k] !== "object" || n[k] === null) n[k] = {}; n = n[k]; }
    const last = ks[ks.length - 1];
    if (v === null || v === undefined) delete n[last]; else n[last] = v;
  };
  const curUser = () => { try { return JSON.parse(sessionStorage.getItem(DEMO_USER_KEY)); } catch { return null; } };
  const fireAuth = () => authCbs.forEach((cb) => cb(curUser()));

  return {
    mode: "demo",
    onAuth(cb) { authCbs.add(cb); queueMicrotask(() => cb(curUser())); return () => authCbs.delete(cb); },
    async signIn(email, pw) {
      if (pw !== DEMO_ADMIN_PASSWORD) { const e = new Error("wrong password"); e.code = "auth/invalid-credential"; throw e; }
      sessionStorage.setItem(DEMO_USER_KEY, JSON.stringify({ uid: "demo-admin", email, isAnonymous: false, provider: "password" }));
      fireAuth();
    },
    async signOut() { sessionStorage.removeItem(DEMO_USER_KEY); fireAuth(); },
    async sendReset() { throw Object.assign(new Error("demo"), { code: "demo/unsupported" }); },
    currentUser: () => curUser(),
    async signInAnon() {
      let id = localStorage.getItem("starlight-demo-voter");
      if (!id) { id = "anon-" + Math.random().toString(36).slice(2, 10); localStorage.setItem("starlight-demo-voter", id); }
      if (!curUser()) { sessionStorage.setItem(DEMO_USER_KEY, JSON.stringify({ uid: id, email: "", isAnonymous: true, provider: "anonymous" })); fireAuth(); }
    },
    async signInGoogle() {
      const email = (prompt("示範模式：請輸入模擬的 Google 帳號 Email") || "").trim().toLowerCase();
      if (!email) throw Object.assign(new Error("cancel"), { code: "auth/popup-closed-by-user" });
      sessionStorage.setItem(DEMO_USER_KEY, JSON.stringify({ uid: "g-" + email.replace(/[^a-z0-9]/g, "_"), email, isAnonymous: false, provider: "google.com" }));
      fireAuth();
    },
    serverNow: async () => Date.now(),
    goOffline: () => {},
    async isAdmin(uid) { return uid === "demo-admin"; },
    async get(path) { return getAt(path); },
    async set(path, val) { setAt(path, val); persist(); },
    async update(updates) { for (const [p, v] of Object.entries(updates)) setAt(p, v); persist(); },
    async remove(path) { setAt(path, null); persist(); },
    newKey: () => "-D" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    on(path, cb) {
      let last;
      const l = { fire() { const v = getAt(path); const s = JSON.stringify(v); if (s !== last) { last = s; cb(v); } } };
      listeners.add(l);
      queueMicrotask(() => l.fire());
      return () => listeners.delete(l);
    },
    now: () => ({ [TS]: "timestamp" })
  };
}
