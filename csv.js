// ============================================================
// CSV 工具：解析（支援引號、換行）、輸出（UTF-8 BOM、防公式注入）
// ============================================================

export function parseCSV(text) {
  text = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

/** 防止 CSV 公式注入：以 = + - @ Tab CR 開頭的字串前加上單引號 */
export function safeCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCSV(rows) {
  return "﻿" + rows.map((r) => r.map(safeCell).join(",")).join("\r\n");
}

export function downloadText(filename, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const HEADER_MAP = {
  code: ["編號", "候選人編號", "code", "no"],
  name: ["名稱", "姓名", "組別", "姓名或組別名稱", "name"],
  members: ["成員", "成員姓名", "members"],
  workTitle: ["作品名稱", "作品", "worktitle", "title"],
  description: ["作品介紹", "介紹", "說明", "description"],
  imageUrls: ["圖片網址", "作品圖片", "images", "imageurls"],
  active: ["是否參與", "參與投票", "是否參與投票", "active"]
};

export const CANDIDATE_TEMPLATE_HEADER = ["編號", "名稱", "成員", "作品名稱", "作品介紹", "圖片網址", "是否參與"];

/** 將 CSV 轉為候選人資料陣列，回傳 { items, errors } */
export function csvToCandidates(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { items: [], errors: ["CSV 至少需要標題列與一筆資料。"] };
  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const idx = {};
  for (const [key, names] of Object.entries(HEADER_MAP)) {
    idx[key] = header.findIndex((h) => names.map((n) => n.toLowerCase()).includes(h));
  }
  if (idx.name < 0) return { items: [], errors: ["找不到「名稱」欄位，請使用範本的標題列。"] };
  const items = [], errors = [];
  rows.slice(1).forEach((r, i) => {
    const get = (k) => (idx[k] >= 0 ? String(r[idx[k]] ?? "").trim() : "");
    const name = get("name");
    if (!name) { errors.push(`第 ${i + 2} 列缺少名稱，已略過。`); return; }
    const activeRaw = get("active").toLowerCase();
    const active = !["否", "n", "no", "0", "false", "不參與"].includes(activeRaw);
    const imageUrls = get("imageUrls").split(/[|\n]/).map((s) => s.trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 5);
    items.push({
      code: get("code"),
      name: name.slice(0, 80),
      members: get("members").slice(0, 200),
      workTitle: get("workTitle").slice(0, 120),
      description: get("description").slice(0, 2000),
      imageUrls,
      active
    });
  });
  return { items, errors };
}
