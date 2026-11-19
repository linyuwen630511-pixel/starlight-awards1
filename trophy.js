// ============================================================
// 金、銀、銅立體獎盃（SVG，原創繪製）
// ============================================================
const PALETTE = {
  gold:   { hi: "#fff7d6", mid: "#f0cf7a", base: "#d4a743", deep: "#8f6418", rim: "#ffe9a8", label: "CHAMPION", rank: "1" },
  silver: { hi: "#ffffff", mid: "#e3e8ef", base: "#b6bfcc", deep: "#69717f", rim: "#f6f8fb", label: "2ND PLACE", rank: "2" },
  bronze: { hi: "#ffe6cf", mid: "#e5a678", base: "#c07a43", deep: "#6e3c17", rim: "#ffd2ae", label: "3RD PLACE", rank: "3" }
};

let seq = 0;
export function trophySVG(tier, { width = 220, className = "trophy-xl" } = {}) {
  const p = PALETTE[tier];
  const id = `t${tier}${++seq}`;
  return `<svg class="${className} trophy-${tier}" width="${width}" viewBox="0 0 200 260" role="img" aria-label="${tier === "gold" ? "金獎盃" : tier === "silver" ? "銀獎盃" : "銅獎盃"}">
  <defs>
    <linearGradient id="${id}b" x1="0" x2="1">
      <stop offset="0" stop-color="${p.deep}"/><stop offset=".22" stop-color="${p.base}"/>
      <stop offset=".42" stop-color="${p.hi}"/><stop offset=".58" stop-color="${p.mid}"/>
      <stop offset=".82" stop-color="${p.base}"/><stop offset="1" stop-color="${p.deep}"/>
    </linearGradient>
    <linearGradient id="${id}v" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.rim}"/><stop offset=".5" stop-color="${p.base}"/><stop offset="1" stop-color="${p.deep}"/>
    </linearGradient>
    <radialGradient id="${id}g" cx=".5" cy=".4" r=".55"><stop offset="0" stop-color="${p.rim}" stop-opacity=".55"/><stop offset="1" stop-color="${p.rim}" stop-opacity="0"/></radialGradient>
  </defs>
  <ellipse class="trophy-glow" cx="100" cy="100" rx="98" ry="98" fill="url(#${id}g)"/>
  <!-- 把手 -->
  <path d="M52 44 C 16 44, 14 98, 58 108" fill="none" stroke="url(#${id}v)" stroke-width="10" stroke-linecap="round"/>
  <path d="M148 44 C 184 44, 186 98, 142 108" fill="none" stroke="url(#${id}v)" stroke-width="10" stroke-linecap="round"/>
  <!-- 杯身 -->
  <path d="M44 30 H156 V58 C156 104 132 128 100 134 C68 128 44 104 44 58 Z" fill="url(#${id}b)"/>
  <ellipse cx="100" cy="30" rx="56" ry="9" fill="${p.rim}"/>
  <ellipse cx="100" cy="30" rx="49" ry="6" fill="${p.deep}" opacity=".55"/>
  <path d="M62 40 C 60 78, 70 106, 88 122" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="5" stroke-linecap="round"/>
  <!-- 星章 -->
  <circle cx="100" cy="74" r="22" fill="${p.deep}" opacity=".25"/>
  <path d="M100 55 l5.6 11.4 12.6 1.8 -9.1 8.9 2.2 12.5 -11.3-5.9 -11.3 5.9 2.2-12.5 -9.1-8.9 12.6-1.8z" fill="${p.hi}" stroke="${p.deep}" stroke-opacity=".35"/>
  <!-- 杯頸與杯腳 -->
  <path d="M88 132 H112 L108 160 H92 Z" fill="url(#${id}b)"/>
  <ellipse cx="100" cy="162" rx="26" ry="7" fill="url(#${id}b)"/>
  <path d="M78 166 H122 L130 196 H70 Z" fill="url(#${id}b)"/>
  <!-- 底座與名牌 -->
  <rect x="52" y="196" width="96" height="16" rx="3" fill="${p.deep}"/>
  <rect x="44" y="210" width="112" height="40" rx="6" fill="#2b2420"/>
  <rect x="44" y="210" width="112" height="6" rx="3" fill="#3d332c"/>
  <rect x="60" y="222" width="80" height="20" rx="3" fill="url(#${id}b)"/>
  <text x="100" y="236.5" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-weight="700" font-size="11" letter-spacing="1.5" fill="${p.deep}">${p.label}</text>
  <!-- 光點 -->
  <path class="trophy-twinkle" d="M150 18 c1 6 4 9 10 10 -6 1 -9 4 -10 10 -1-6 -4-9 -10-10 6-1 9-4 10-10z" fill="#fff"/>
</svg>`;
}

export const TROPHY_PALETTE = PALETTE;
