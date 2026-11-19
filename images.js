// ============================================================
// 作品圖片（免費方案）
// 不使用 Cloud Storage：在瀏覽器端壓縮成 WebP（不支援時用 JPEG），
// 存入 Realtime Database：images/{eventId}/{candidateId}/{imageId} = { full, thumb, w, h }
// 候選人的 imageUrls 以 "db:{imageId}" 參照；仍可混用一般 https 圖片網址。
// ============================================================

export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
export const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const FULL_EDGE = 1600, THUMB_EDGE = 520;
const FULL_LIMIT = 420000, THUMB_LIMIT = 90000; // data URL 字元上限（與安全規則一致）

export const isDbRef = (u) => typeof u === "string" && u.startsWith("db:");
export const dbId = (u) => u.slice(3);

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("無法讀取圖片")); };
    img.src = url;
  });
}

function encode(img, maxEdge, limit) {
  const scale0 = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const webp = document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp");
  const type = webp ? "image/webp" : "image/jpeg";
  let scale = scale0, q = 0.82, out = "";
  for (let i = 0; i < 8; i++) {
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    out = c.toDataURL(type, q);
    if (out.length <= limit) break;
    if (q > 0.6) q -= 0.1; else scale *= 0.85;
  }
  return { data: out, w: c.width, h: c.height };
}

/** 壓縮一張圖片，回傳 { full, thumb, w, h } */
export async function compressImage(file) {
  if (!ACCEPT.includes(file.type)) throw new Error(`不支援的格式：${file.name}（僅限 JPG、PNG、WebP）`);
  if (file.size > MAX_SOURCE_BYTES) throw new Error(`檔案過大：${file.name}（上限 15MB）`);
  const img = await loadImage(file);
  const full = encode(img, FULL_EDGE, FULL_LIMIT);
  const thumb = encode(img, THUMB_EDGE, THUMB_LIMIT);
  if (full.data.length > FULL_LIMIT || thumb.data.length > THUMB_LIMIT) throw new Error(`圖片壓縮後仍過大：${file.name}`);
  return { full: full.data, thumb: thumb.data, w: full.w, h: full.h };
}

/** 依參照取得可顯示的圖片網址（有快取）。size: "thumb" | "full" */
const cache = new Map();
export async function resolveImage(store, eventId, cid, ref, size = "thumb") {
  if (!isDbRef(ref)) return ref;
  const key = `${eventId}/${cid}/${dbId(ref)}/${size}`;
  if (!cache.has(key)) cache.set(key, store.get(`images/${key}`).catch(() => null));
  return cache.get(key);
}

/** 將頁面中 <img data-ref> 補上實際圖片（延遲載入） */
export function hydrateImages(root, store, eventId) {
  const imgs = root.querySelectorAll("img[data-ref]:not([data-loaded])");
  const load = async (img) => {
    img.dataset.loaded = "1";
    const src = await resolveImage(store, eventId, img.dataset.cid, img.dataset.ref, img.dataset.size || "thumb");
    if (src) img.src = src; else img.alt = "圖片無法載入";
  };
  if (!("IntersectionObserver" in window)) return imgs.forEach(load);
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }), { rootMargin: "300px" });
  imgs.forEach((i) => io.observe(i));
}

/** 產生 <img> 標籤：db 參照延遲載入；https 直接顯示 */
export function imgTag(ref, cid, { alt = "", size = "thumb", attrs = "" } = {}) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  if (isDbRef(ref)) return `<img data-ref="${esc(ref)}" data-cid="${esc(cid)}" data-size="${size}" alt="${esc(alt)}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" ${attrs}>`;
  if (/^https?:\/\//i.test(ref || "")) return `<img src="${esc(ref)}" alt="${esc(alt)}" loading="lazy" ${attrs}>`;
  return "";
}
