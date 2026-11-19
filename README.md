# 星光榮耀｜QR Code 互動投票與頒獎平台
*Starlight Awards — Interactive Voting & Awards Platform*

> 每一份努力，都值得被看見。

**完全免費架構**：GitHub Pages（網站）＋ Firebase **Spark 免費方案**（登入＋即時資料庫）。
不需要信用卡、不需要 Cloud Functions、不需要 Cloud Storage。

## 目前進度

| 階段 | 內容 | 狀態 |
|---|---|---|
| 第一階段 | 首頁、管理者登入、活動建立／編輯／複製／刪除、自訂投票規則、投票須知自動產生、候選人管理、CSV 匯入 | ✅ |
| 第二階段 | QR Code（全螢幕、PNG、複製網址）、開始／暫停／繼續／結束、匿名／一人一碼／Google 帳號三種驗證、手機投票（多選卡片、票數分配器）、作品放大、防超額與重複投票、投票進度 | ✅ |
| 第三階段 | 統計結果（排名表、得票長條圖、得票比例圖、每日統計）、同票處理（並列／評審分數／加賽投票）、確認最終結果、CSV（UTF-8 BOM、防公式注入）與 PDF 匯出、作品圖片免費上傳 | ✅ |
| 第四階段 | 星光頒獎舞台（16:9）、金銀銅三座 3D 頒獎台與三座獎盃、聚光燈、彩帶、原創典禮音樂與軍樂進行曲、逐一揭曉、多螢幕同步、完整獎台 PNG 下載 | ✅ |
| 第五階段 | GitHub Actions 自動測試＋部署、系統檢查頁（環境檢查、安全規則與多人同時投票實測）、驗收清單 ACCEPTANCE.md | ✅ |

## 免費方案如何做到「後端驗證」

沒有 Cloud Functions，所有投票限制改由 **Firebase 安全規則**在 Google 伺服器端強制執行（學生無法繞過）：

| 要求 | 做法 |
|---|---|
| 票數不超過上限 | 選票以「票位」s0、s1…儲存，規則只接受活動設定中存在的票位 |
| 必須投滿 | 規則檢查最後一個票位必須存在，且票位須連續 |
| 不可重複投同一人 | 選票同時記錄「票位→候選人」與「候選人→票位」雙向對應，規則檢查一致，因此候選人不可能重複 |
| 整場一次 | `voterState` 只能建立一次，之後不可修改 |
| 每日一次 | 規則以伺服器時間 `now` 驗證台灣日期，並要求日期遞增 |
| 未開始／已暫停／已結束不可投 | 規則檢查活動狀態必須是「投票中」 |
| 重複點擊、網路重試 | 選票只能新增、不能覆寫；前端重試時以同一張選票編號判斷 |
| 學生看不到票數與排名 | `ballots`、`voterState` 只有管理者可讀 |
| 開始後不可改規則與名單 | 規則鎖定核心欄位與候選人 |
| 統計 | 由管理者瀏覽器讀取選票即時計算（免費） |

### 免費方案限制（請留意）

- **同時連線上限 100**：同一時間打開投票頁的人數上限約 100 人（含管理者與投影頁）。投票送出後頁面會自動斷線釋放名額。一般班級／課堂活動足夠；全校同時投票請分批開放。
- 資料庫容量 1 GB、每月下載 10 GB：文字資料與一般活動遠低於此。
- 作品圖片：上傳後在瀏覽器自動壓縮（大圖約 300KB、縮圖約 50KB）存入資料庫，不需 Cloud Storage。投票頁只先載入縮圖，放大時才載入大圖。也可改用一般圖片網址。

## 頒獎典禮操作

1. 結束投票 →「統計結果」→ 確認最終結果（同票需先處理）。
2. 按「進入頒獎典禮」，點一下畫面啟用音樂與音效，再按 F 或「全螢幕」。
3. 依序按：開始頒獎典禮 → 揭曉銅獎 → 揭曉銀獎 → 揭曉金獎 → 顯示完整獎台（也可用 → 或空白鍵）。
4. 按 H 隱藏控制列。另一台電腦以管理者登入開啟同一頁，可當投影端，畫面會同步。
5. 「重新播放」只重設動畫，不會改變投票結果；「下載 PNG」輸出 1920×1080 完整獎台圖。

同票規則：「同票並列名次」採標準競賽排名（例如兩位並列第二，下一位為第四名，銅獎從缺）。

## 檔案結構

```
starlight-awards/
├─ index.html / admin.html / vote.html
├─ css/theme.css         主題（象牙香檳＝星光遊戲所風格；夜幕星光）
├─ css/app.css           版面與元件
├─ js/config.js          ★ Firebase 設定與正式網址
├─ js/store.js           資料層（Firebase／本機示範模式）
├─ js/rules.js           規則、須知、選票、計票邏輯
├─ js/admin.js           管理者控制台
├─ js/vote.js            投票者頁面
├─ ceremony.html          頒獎典禮舞台
├─ css/ceremony.css       舞台樣式
├─ js/results.js          排名、同票、金銀銅計算
├─ js/ceremony.js         頒獎流程、彩帶、PNG 輸出
├─ js/trophy.js           金銀銅獎盃（SVG）
├─ js/audio.js            原創音樂與音效（Web Audio 即時合成）
├─ js/images.js           圖片壓縮與載入（免費方案）
├─ check.html / js/check.js   系統檢查與驗收實測
├─ .github/workflows/pages.yml  自動測試＋部署
├─ ACCEPTANCE.md          30 項驗收清單與跨裝置紀錄表
├─ js/vendor/qrcode.js   QR Code 產生器（MIT，Kazuhiko Arase）
├─ js/vendor/jspdf.umd.min.js、html2canvas.min.js   PDF 匯出（MIT）
├─ database.rules.json   安全規則（由 tools/build_rules.py 產生）
└─ tests/                單元測試（npm test）
```

## 本機試用（不需任何設定）

`js/config.js` 未填 Firebase 時為「本機示範模式」，資料只存在這台電腦的瀏覽器，示範密碼 `starlight2026`。
可開兩個分頁：一個當管理者、一個當投票者，完整試跑投票流程。

```bash
python3 -m http.server 8000     # 然後開啟 http://localhost:8000
```

## Firebase 設定（免費 Spark 方案，約 10 分鐘）

1. 到 <https://console.firebase.google.com/> 建立專案（不要升級方案，維持 Spark）。
2. **Authentication → 登入方式**，啟用：
   - 電子郵件／密碼（管理者用）
   - 匿名（匿名投票、一人一碼用）
   - Google（帳號登入投票用，選用）
3. **Authentication → 使用者 → 新增使用者**：建立管理者帳號，複製 **UID**。
4. **Realtime Database → 建立資料庫**（區域建議 `asia-southeast1` 新加坡）→ 鎖定模式。
5. **Realtime Database → 規則**：貼上 `database.rules.json` 全部內容 → 發布。
6. **Realtime Database → 資料**：新增 `admins` → `<管理者UID>` → `role` = `"owner"`。
7. **專案設定 → 一般 → 新增網頁應用程式**，把 `firebaseConfig` 填入 `js/config.js`。
8. **Authentication → 設定 → 已授權網域**：加入 `你的帳號.github.io`。

## 部署到 GitHub Pages（免費）

**方式 A：自動部署（建議）**
1. 在 GitHub 建立 repository（例：`starlight-awards`），上傳整個資料夾（含 `.github`、`.nojekyll`）。
2. Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。
3. 之後每次推送到 `main`，會先跑單元測試，通過才自動部署（Actions 分頁可看進度）。

**方式 B：手動**
Settings → Pages → Deploy from a branch → `main` / `(root)`。

部署完成後：
1. 取得網址（例：`https://yourname.github.io/starlight-awards/`），填入 `js/config.js` 的 `publicBaseUrl` 再推送一次。
2. 到 Firebase → Authentication → 設定 → 已授權網域，加入 `yourname.github.io`。
3. 管理者登入 → 控制台「系統檢查」→ 執行「環境檢查」與「安全規則與多人投票實測」，全部 ✅ 即可正式使用。

## 正式使用前的建議測試（完整清單見 ACCEPTANCE.md）

1. 管理者建立測試活動 → 標記準備完成 → 開始投票。
2. 用兩支手機掃 QR Code 投票；同一支手機重新整理應顯示「您已完成投票」。
3. 暫停投票，確認手機無法送出；結束投票，確認顯示「本次投票已結束」。
4. 控制台「清除全部選票」後再正式開始。

## 測試

```bash
npm test     # 23 項：含排名、同票（並列／評審／加賽）、0 票不得獎；：預設規則、須知、票數驗證、開始前檢查、台北日期、選票建立、投票次數、計票、CSV
```
