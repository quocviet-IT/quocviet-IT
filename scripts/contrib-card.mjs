// Draws an isometric contribution calendar with Contributions and Streaks panels,
// one SVG for GitHub's light theme and one for its dark theme.
//
//   GITHUB_TOKEN=... USERNAME=quocviet-IT OUT_DIR=dist-3d node scripts/contrib-card.mjs
//
// No dependencies: Node 20+ (global fetch).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const token = process.env.GITHUB_TOKEN;
const login = process.env.USERNAME;
const outDir = process.env.OUT_DIR || "dist-3d";
if (!token || !login) throw new Error("GITHUB_TOKEN and USERNAME are required");

// ---------------------------------------------------------------- data

const QUERY = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: QUERY, variables: { login } }),
});
if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
const body = await res.json();
if (body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors)}`);
const calendar = body.data.user.contributionsCollection.contributionCalendar;

const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const weeks = calendar.weeks.map((wk) =>
  wk.contributionDays.map((d) => ({
    date: d.date,
    count: d.contributionCount,
    level: LEVEL[d.contributionLevel] ?? 0,
  })),
);
const days = weeks.flat();

// ---------------------------------------------------------------- stats

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
const withYear = (iso) => `${short(iso)}, ${iso.slice(0, 4)}`;
const num = (n) => n.toLocaleString("en-US");

const first = days[0];
const last = days[days.length - 1];
const total = calendar.totalContributions;
const thisWeek = weeks[weeks.length - 1];
const weekTotal = thisWeek.reduce((s, d) => s + d.count, 0);
const best = days.reduce((b, d) => (d.count > b.count ? d : b), days[0]);
const average = total / days.length;

let longest = { length: 0, start: null, end: null };
let run = { length: 0, start: null };
for (const d of days) {
  if (d.count > 0) {
    run = run.length ? { length: run.length + 1, start: run.start } : { length: 1, start: d.date };
    if (run.length > longest.length) longest = { length: run.length, start: run.start, end: d.date };
  } else {
    run = { length: 0, start: null };
  }
}

// today still counts as "in progress": a streak that ended yesterday is still current
let i = days.length - 1;
if (days[i].count === 0) i -= 1;
const currentEnd = i >= 0 ? days[i].date : null;
let current = 0;
while (i >= 0 && days[i].count > 0) {
  current += 1;
  i -= 1;
}
const currentStart = current ? days[i + 1].date : null;

const stats = {
  total, weekTotal, best, average, longest, current, currentStart, currentEnd,
  totalRange: `${short(first.date)} '${first.date.slice(2, 4)} → ${short(last.date)}`,
  weekRange: `${short(thisWeek[0].date)} → ${short(thisWeek[thisWeek.length - 1].date)}`,
  updated: withYear(last.date),
};

// ---------------------------------------------------------------- themes

// faces per level: [top, left, right]
const THEMES = {
  light: {
    file: "contrib-3d-light.svg",
    panel: "#ffffff", border: "#d1d9e0", fg: "#1f2328", muted: "#59636e", accent: "#bc4c00",
    levels: [
      ["#ebedf0", "#d9dce1", "#cbd0d6"],
      ["#ffee4a", "#e8d63c", "#d1bf30"],
      ["#ffc501", "#e5ae00", "#c99800"],
      ["#fe9600", "#e07f00", "#c26b00"],
      ["#2a2440", "#1b1630", "#100c20"],
    ],
    legend: ["#ebedf0", "#ffee4a", "#ffc501", "#fe9600", "#03001c"],
  },
  dark: {
    file: "contrib-3d-dark.svg",
    panel: "#0d1117", border: "#3d444d", fg: "#f0f6fc", muted: "#9198a1", accent: "#fa7a18",
    levels: [
      ["#1f252e", "#181d24", "#13171d"],
      ["#7a2405", "#631c03", "#4d1502"],
      ["#bd561d", "#a04818", "#833b13"],
      ["#fa7a18", "#d96813", "#b8570f"],
      ["#fddf68", "#e2c556", "#c4aa45"],
    ],
    legend: ["#161b22", "#631c03", "#bd561d", "#fa7a18", "#fddf68"],
  },
};

// ---------------------------------------------------------------- drawing

const W = 880;
const A = 13; // half width of one tile; a tile is 2A wide and A tall
const MAX_H = 104; // tallest bar
const X0 = W / 2 - 23 * A; // centres the 53 x 7 grid horizontally
const Y0 = 150;
const GRID_BOTTOM = Y0 + (52 + 6) * (A / 2) + A / 2;
const H = GRID_BOTTOM + 46;

const maxCount = Math.max(1, ...days.map((d) => d.count));
const barHeight = (count) => (count === 0 ? 2 : 5 + (MAX_H - 5) * Math.pow(count / maxCount, 0.8));
const r = (n) => Math.round(n * 10) / 10;
const pts = (...p) => p.map(([x, y]) => `${r(x)},${r(y)}`).join(" ");

function bars(theme) {
  const cells = [];
  weeks.forEach((wk, w) => wk.forEach((d) => cells.push({ ...d, w, dow: new Date(d.date + "T00:00:00Z").getUTCDay() })));
  // back to front, so nearer bars cover the ones behind them
  cells.sort((p, q) => p.w + p.dow - (q.w + q.dow) || p.w - q.w);

  return cells
    .map((c) => {
      const cx = X0 + (c.w - c.dow) * A;
      const cy = Y0 + (c.w + c.dow) * (A / 2);
      const h = barHeight(c.count);
      const [top, left, right] = theme.levels[c.level];
      const k = 0.94; // tiny gap between tiles keeps the edges crisp
      const a = A * k;
      const b = (A / 2) * k;
      const faces =
        `<polygon fill="${left}" points="${pts([cx - a, cy - h], [cx, cy - h + b], [cx, cy + b], [cx - a, cy])}"/>` +
        `<polygon fill="${right}" points="${pts([cx, cy - h + b], [cx + a, cy - h], [cx + a, cy], [cx, cy + b])}"/>` +
        `<polygon fill="${top}" points="${pts([cx, cy - h - b], [cx + a, cy - h], [cx, cy - h + b], [cx - a, cy - h])}"/>`;
      if (c.count === 0) return faces;
      const tip = `${c.count} contribution${c.count === 1 ? "" : "s"} on ${withYear(c.date)}`;
      return `<g class="bar" style="animation-delay:${c.w * 14}ms"><title>${tip}</title>${faces}</g>`;
    })
    .join("\n");
}

function stat(x, y, value, unit, label, sub, theme) {
  const unitText = unit ? `<tspan class="unit" dx="5">${unit}</tspan>` : "";
  return (
    `<text x="${x}" y="${y}" class="num">${value}${unitText}</text>` +
    `<text x="${x}" y="${y + 22}" class="lbl">${label}</text>` +
    `<text x="${x}" y="${y + 40}" class="sub">${sub}</text>`
  );
}

function panel(x, y, w, h, title, theme) {
  return (
    `<text x="${x}" y="${y - 12}" class="ttl">${title}</text>` +
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="7" fill="${theme.panel}" stroke="${theme.border}"/>`
  );
}

function svg(theme) {
  const s = stats;
  // Contributions panel, top right
  const cx = W - 16 - 404;
  const cy = 34;
  const contributions =
    panel(cx, cy, 404, 92, "Contributions", theme) +
    stat(cx + 20, cy + 36, num(s.total), "", "Total", s.totalRange, theme) +
    stat(cx + 152, cy + 36, num(s.weekTotal), "", "This week", s.weekRange, theme) +
    stat(cx + 282, cy + 36, num(s.best.count), "", "Best day", short(s.best.date), theme) +
    `<text x="${cx + 404}" y="${cy + 92 + 20}" text-anchor="end" class="sub">Average: <tspan class="avg">${s.average.toFixed(2)}</tspan> / day</text>`;

  // Streaks panel, bottom left
  const sx = 16;
  const sy = GRID_BOTTOM - 120;
  const longestSub = s.longest.length ? `${short(s.longest.start)} → ${short(s.longest.end)}` : "No streak yet";
  const currentSub = s.current ? `${short(s.currentStart)} → ${short(s.currentEnd)}` : "Starts with your next contribution";
  const streaks =
    panel(sx, sy, 300, 92, "Streaks", theme) +
    stat(sx + 20, sy + 36, num(s.longest.length), s.longest.length === 1 ? "day" : "days", "Longest", longestSub, theme) +
    stat(sx + 160, sy + 36, num(s.current), s.current === 1 ? "day" : "days", "Current", currentSub, theme);

  // footer: last updated on the left, legend on the right
  const lx = W - 16 - 5 * 15 - 34;
  const ly = H - 18;
  const legend =
    `<text x="${lx - 8}" y="${ly + 10}" text-anchor="end" class="sub">Less</text>` +
    theme.legend
      .map((c, k) => `<rect x="${lx + k * 15}" y="${ly}" width="11" height="11" rx="2" fill="${c}" stroke="${theme.border}" stroke-opacity="0.5"/>`)
      .join("") +
    `<text x="${lx + 5 * 15 + 4}" y="${ly + 10}" class="sub">More</text>`;
  const footer = `<text x="16" y="${ly + 10}" class="sub">Last 12 months · updated ${s.updated}</text>`;

  const summary =
    `${num(s.total)} contributions in the last year; longest streak ${s.longest.length} days; ` +
    `current streak ${s.current} days; best day ${s.best.count} on ${withYear(s.best.date)}.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">Contribution calendar of ${login}</title>
<desc id="d">${summary}</desc>
<style>
text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
.ttl { font-size: 16px; font-weight: 600; fill: ${theme.fg}; }
.num { font-size: 28px; font-weight: 600; fill: ${theme.accent}; }
.unit { font-size: 17px; font-weight: 600; }
.lbl { font-size: 13px; font-weight: 600; fill: ${theme.fg}; }
.sub { font-size: 12px; fill: ${theme.muted}; }
.avg { font-weight: 600; fill: ${theme.accent}; }
.bar { transform-box: fill-box; transform-origin: 50% 100%; animation: rise 0.8s cubic-bezier(0.2, 0.75, 0.25, 1) both; }
@keyframes rise { from { transform: scaleY(0.04); } to { transform: scaleY(1); } }
@media (prefers-reduced-motion: reduce) { .bar { animation: none; } }
</style>
${bars(theme)}
${contributions}
${streaks}
${legend}
${footer}
</svg>
`;
}

mkdirSync(outDir, { recursive: true });
for (const theme of Object.values(THEMES)) {
  writeFileSync(join(outDir, theme.file), svg(theme));
  console.log(`wrote ${join(outDir, theme.file)}`);
}
console.log(
  `total ${stats.total} · week ${stats.weekTotal} · best ${stats.best.count} (${stats.best.date}) · ` +
    `longest ${stats.longest.length} · current ${stats.current} · max/day ${maxCount}`,
);
