// Local illustrated cover renderer. Produces a distinct square SVG per slot from its motif,
// palette and a seed — used when no art provider is configured or the provider fails.
// The art brief is abstract: no names, portraits or private text ever reach the image.

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Draw = (p: string[], r: () => number) => string;
const n = (x: number) => x.toFixed(1);

const sun = (cx: number, cy: number, rad: number, c: string) => `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${c}"/>`;
const stars = (r: () => number, c: string, k = 30) =>
  Array.from({ length: k }, () => `<circle cx="${n(r() * 512)}" cy="${n(r() * 300)}" r="${n(0.6 + r() * 1.8)}" fill="${c}" opacity="${n(0.3 + r() * 0.6)}"/>`).join("");

const MOTIFS: Record<string, Draw> = {
  lion_sunrise: (p, r) =>
    `${sun(256, 330, 150, p[1])}<g transform="translate(256 300)">${Array.from({ length: 18 }, (_, i) =>
      `<ellipse rx="26" ry="62" transform="rotate(${i * 20}) translate(0 -70)" fill="${p[0]}" opacity="0.95"/>`).join("")}
     <circle r="62" fill="#f8c27a"/><circle cx="-22" cy="-10" r="7" fill="${p[3]}"/><circle cx="22" cy="-10" r="7" fill="${p[3]}"/>
     <ellipse cy="22" rx="18" ry="12" fill="${p[2]}"/></g>${Array.from({ length: 4 }, (_, i) =>
      `<path d="M330 ${250 - i * 18} q ${40 + i * 20} -${20 + r() * 20} ${80 + i * 25} 0" stroke="${p[1]}" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.7"/>`).join("")}
     <rect y="420" width="512" height="92" fill="${p[2]}" opacity="0.6"/>`,
  paws_park: (p, r) =>
    `${sun(400, 110, 60, p[1])}<path d="M0 380 Q256 300 512 380 V512 H0Z" fill="${p[2]}"/>` +
    Array.from({ length: 7 }, (_, i) => {
      const x = 60 + i * 62, y = 460 - i * 22 + r() * 10, rot = -20 + r() * 40;
      return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)})" fill="${p[0]}"><ellipse rx="16" ry="13"/>${[-14, -5, 5, 14].map((dx) => `<circle cx="${dx}" cy="-18" r="5.5"/>`).join("")}</g>`;
    }).join(""),
  cat_window: (p, r) =>
    `${stars(r, p[0])}<rect x="96" y="80" width="320" height="300" rx="12" fill="${p[1]}" opacity="0.45"/>
     ${sun(330, 170, 50, p[2])}<line x1="256" y1="80" x2="256" y2="380" stroke="${p[3]}" stroke-width="10"/>
     <line x1="96" y1="230" x2="416" y2="230" stroke="${p[3]}" stroke-width="10"/><rect x="70" y="380" width="372" height="26" fill="${p[0]}"/>
     <path d="M170 380 q-10 -70 50 -78 l8 -22 l14 18 q22 -2 34 6 l14 -18 l4 26 q40 30 6 68 z" fill="${p[3]}"/>
     <path d="M300 380 q60 -10 50 -60" stroke="${p[3]}" stroke-width="12" fill="none" stroke-linecap="round"/>`,
  bird_sky: (p, r) =>
    Array.from({ length: 5 }, (_, i) => `<ellipse cx="${n(r() * 512)}" cy="${n(120 + i * 70)}" rx="${n(120 + r() * 80)}" ry="28" fill="${p[1]}" opacity="${n(0.25 + i * 0.1)}"/>`).join("") +
    `<path d="M200 240 q60 -60 110 0 q-40 -10 -55 20 q-15 -30 -55 -20z" fill="${p[0]}"/><circle cx="300" cy="236" r="5" fill="${p[3]}"/>`,
  fish_bubbles: (p, r) =>
    Array.from({ length: 22 }, () => `<circle cx="${n(r() * 512)}" cy="${n(r() * 512)}" r="${n(4 + r() * 16)}" fill="none" stroke="${p[0]}" stroke-width="2" opacity="0.6"/>`).join("") +
    `<g transform="translate(250 270)"><ellipse rx="90" ry="55" fill="${p[1]}"/><path d="M80 0 l60 -45 v90z" fill="${p[1]}"/><circle cx="-45" cy="-12" r="9" fill="${p[3]}"/></g>`,
  highway_trails: (p, r) =>
    `<path d="M0 300 H512 V512 H0Z" fill="${p[3]}"/>${Array.from({ length: 9 }, (_, i) =>
      `<path d="M256 300 L${n(-200 + i * 115 + r() * 20)} 512" stroke="${i % 2 ? p[0] : p[1]}" stroke-width="${n(3 + r() * 6)}" opacity="${n(0.5 + r() * 0.5)}"/>`).join("")}
     ${Array.from({ length: 14 }, (_, i) => `<rect x="${n(i * 38 + r() * 8)}" y="${n(150 + r() * 100)}" width="${n(20 + r() * 16)}" height="${n(150)}" fill="${p[2]}" opacity="0.5"/>`).join("")}
     ${sun(256, 300, 26, p[1])}`,
  pulse_sun: (p, r) =>
    `${sun(256, 250, 110, p[1])}${Array.from({ length: 5 }, (_, i) => {
      const y = 300 + i * 34;
      let d = `M0 ${y}`;
      for (let x = 0; x <= 512; x += 32) d += ` L${x} ${n(y + (x % 64 ? -1 : 1) * r() * 30)}`;
      return `<path d="${d}" stroke="${i % 2 ? p[0] : p[2]}" stroke-width="5" fill="none" stroke-linejoin="round"/>`;
    }).join("")}`,
  circles_light: (p, r) =>
    `<circle cx="${n(200 + r() * 20)}" cy="256" r="130" fill="${p[0]}" opacity="0.75"/><circle cx="${n(312 - r() * 20)}" cy="256" r="130" fill="${p[1]}" opacity="0.65"/>${stars(r, p[1], 18)}`,
  window_glow: (p, r) =>
    Array.from({ length: 4 }, (_, i) => `<rect x="${40 + i * 120}" y="${n(120 + r() * 60)}" width="100" height="400" fill="${p[2]}"/>`).join("") +
    `<rect x="190" y="220" width="56" height="70" fill="${p[0]}"/><rect x="190" y="220" width="56" height="70" fill="${p[1]}" opacity="0.5"/>${stars(r, p[1], 20)}`,
  lamp_grid: (p, r) =>
    Array.from({ length: 9 }, (_, i) => `<line x1="${i * 64}" y1="0" x2="${i * 64}" y2="512" stroke="${p[2]}" stroke-width="1.5" opacity="0.5"/><line x1="0" y1="${i * 64}" x2="512" y2="${i * 64}" stroke="${p[2]}" stroke-width="1.5" opacity="0.5"/>`).join("") +
    `<path d="M256 240 L190 330 H322Z" fill="${p[1]}" opacity="0.35"/><path d="M226 200 h60 l18 40 h-96z" fill="${p[1]}"/><line x1="256" y1="240" x2="256" y2="400" stroke="${p[0]}" stroke-width="8"/><rect x="200" y="400" width="112" height="14" rx="7" fill="${p[0]}"/>` +
    `<rect x="${n(80 + r() * 40)}" y="${n(80 + r() * 40)}" width="64" height="64" fill="${p[0]}" opacity="0.35"/>`,
  paper_plane: (p, r) =>
    `<rect y="340" width="512" height="172" fill="${p[2]}" opacity="0.6"/>${sun(380, 340, 70, p[1])}<path d="M120 220 L330 150 L200 260 Z" fill="${p[0]}"/><path d="M200 260 L330 150 L230 290Z" fill="${p[1]}"/><path d="M110 260 q-60 30 -100 10" stroke="${p[0]}" stroke-width="3" stroke-dasharray="8 10" fill="none"/>${stars(r, p[0], 10)}`,
  lanterns: (p, r) =>
    Array.from({ length: 9 }, () => {
      const x = r() * 470 + 20, y = r() * 380 + 40, s = 0.5 + r() * 0.9;
      return `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s)})"><rect x="-22" y="-30" width="44" height="60" rx="16" fill="${p[0]}"/><rect x="-14" y="-24" width="28" height="48" rx="10" fill="${p[1]}" opacity="0.7"/></g>`;
    }).join(""),
  confetti_dawn: (p, r) =>
    `${sun(256, 512, 200, p[0])}` +
    Array.from({ length: 70 }, () => `<rect x="${n(r() * 512)}" y="${n(r() * 420)}" width="${n(6 + r() * 8)}" height="${n(3 + r() * 5)}" fill="${p[Math.floor(r() * 3)]}" transform="rotate(${n(r() * 180)} 256 256)"/>`).join(""),
  moon_water: (p, r) =>
    `${stars(r, p[0], 40)}<circle cx="300" cy="170" r="70" fill="${p[0]}"/><circle cx="330" cy="150" r="64" fill="${p[3]}"/><rect y="330" width="512" height="182" fill="${p[2]}"/>` +
    Array.from({ length: 6 }, (_, i) => `<rect x="${n(220 + r() * 40 - i * 6)}" y="${350 + i * 22}" width="${n(100 - i * 10)}" height="4" rx="2" fill="${p[0]}" opacity="${n(0.7 - i * 0.1)}"/>`).join(""),
  steam_bowl: (p, r) =>
    `<path d="M120 300 h272 a136 120 0 0 1 -272 0z" fill="${p[2]}"/>` +
    Array.from({ length: 3 }, (_, i) => `<path d="M${200 + i * 56} 270 c-30 -40 30 -60 0 -110 c-20 -35 ${n(10 + r() * 20)} -50 0 -80" stroke="${p[1]}" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.8"/>`).join(""),
  paper_stars: (p, r) =>
    `<path d="M140 380 L256 340 L372 380 L372 420 L256 380 L140 420Z" fill="${p[0]}"/>${Array.from({ length: 12 }, () => {
      const x = 140 + r() * 232, y = 80 + r() * 230, s = 6 + r() * 10;
      return `<path d="M${n(x)} ${n(y - s)} L${n(x + s * 0.3)} ${n(y - s * 0.3)} L${n(x + s)} ${n(y)} L${n(x + s * 0.3)} ${n(y + s * 0.3)} L${n(x)} ${n(y + s)} L${n(x - s * 0.3)} ${n(y + s * 0.3)} L${n(x - s)} ${n(y)} L${n(x - s * 0.3)} ${n(y - s * 0.3)}Z" fill="${p[1]}"/>`;
    }).join("")}`,
  pixel_grid: (p, r) =>
    Array.from({ length: 64 }, (_, i) => {
      const x = (i % 8) * 64, h = Math.floor(r() * 6) * 32;
      return i < 8 ? `<rect x="${x}" y="${512 - h - 64}" width="60" height="${h + 64}" fill="${p[i % 3]}" opacity="0.8"/>` : "";
    }).join("") + `${sun(256, 160, 60, p[1])}`,
  paint_swirl: (p, r) =>
    Array.from({ length: 4 }, (_, i) => `<path d="M${n(r() * 100)} ${100 + i * 90} C 180 ${n(r() * 512)}, 330 ${n(r() * 512)}, 512 ${120 + i * 80}" stroke="${p[i % 3]}" stroke-width="${n(26 + r() * 20)}" fill="none" stroke-linecap="round" opacity="0.85"/>`).join(""),
  leaves: (p, r) =>
    `${sun(140, 120, 70, p[1])}` + Array.from({ length: 12 }, () => {
      const x = r() * 512, y = 200 + r() * 300, a = r() * 360;
      return `<path d="M0 0 C 30 -40, 80 -40, 110 0 C 80 40, 30 40, 0 0Z" fill="${p[r() > 0.5 ? 0 : 2]}" transform="translate(${n(x)} ${n(y)}) rotate(${n(a)})"/>`;
    }).join(""),
  notes_wave: (p, r) =>
    `<path d="M0 360 C 120 300, 220 420, 320 350 S 470 310, 512 340 V512 H0Z" fill="${p[2]}" opacity="0.8"/>` +
    Array.from({ length: 5 }, (_, i) => {
      const x = 80 + i * 85, y = 160 + r() * 120;
      return `<g fill="${p[i % 2]}"><ellipse cx="${n(x)}" cy="${n(y)}" rx="16" ry="12" transform="rotate(-20 ${n(x)} ${n(y)})"/><rect x="${n(x + 12)}" y="${n(y - 70)}" width="5" height="70"/></g>`;
    }).join(""),
  mountain_sun: (p, r) =>
    `${sun(300, 210, 100, p[1])}<path d="M0 420 L${n(120 + r() * 40)} 260 L250 380 L${n(360 + r() * 30)} 230 L512 400 V512 H0Z" fill="${p[2]}"/>`,
};

export function renderCoverSvg(opts: { motif: string; palette: string[]; seed: string; alt: string }): string {
  const r = rng(`${opts.seed}:${opts.motif}`);
  const p = opts.palette.length >= 4 ? opts.palette : ["#f6a96b", "#ffd59a", "#7a3f6e", "#1a1530"];
  const draw = MOTIFS[opts.motif] ?? MOTIFS.notes_wave;
  const angle = Math.floor(r() * 360);
  const esc = opts.alt.replace(/[<>&"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${esc}">` +
    `<defs><linearGradient id="bg" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${p[3]}"/><stop offset="1" stop-color="${p[2]}"/></linearGradient>` +
    `<radialGradient id="glow" cx="${n(0.3 + r() * 0.4)}" cy="${n(0.3 + r() * 0.3)}" r=".7"><stop offset="0" stop-color="${p[1]}" stop-opacity=".35"/><stop offset="1" stop-color="${p[3]}" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="512" height="512" fill="url(#bg)"/><rect width="512" height="512" fill="url(#glow)"/>${draw(p, r)}</svg>`;
}

export const KNOWN_MOTIFS = Object.keys(MOTIFS);
