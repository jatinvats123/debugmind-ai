#!/usr/bin/env node
/**
 * Render a captured terminal session to an animated SVG.
 *
 * Why SVG and not a GIF: this machine has no asciinema/agg/ffmpeg and the
 * project forbids paid or native dependencies, so the cast is generated from
 * the raw ANSI capture with zero dependencies. Animated SVG renders inline on
 * GitHub (same mechanism the widely used typing-SVG badges rely on).
 *
 * The frames contain only lines that the run actually printed. Long runs are
 * time-compressed by advancing several lines per frame — nothing is invented,
 * and the complete transcript is committed alongside for verification.
 *
 *   node scripts/make-demo-svg.js <raw-capture> <out.svg> [--title "..."]
 */
const fs = require('fs');

const ANSI_COLORS = {
  30: '#3b4048', 31: '#e06c75', 32: '#98c379', 33: '#e5c07b',
  34: '#61afef', 35: '#c678dd', 36: '#56b6c2', 37: '#dcdfe4',
  90: '#7f848e', 91: '#e06c75', 92: '#98c379', 93: '#e5c07b',
  94: '#61afef', 95: '#c678dd', 96: '#56b6c2', 97: '#ffffff',
};
const DEFAULT_FG = '#dcdfe4';

const COLS = 104;
const ROWS = 28;
const CHAR_W = 7.4;
const LINE_H = 17;
const PAD_X = 14;
const PAD_Y = 34;
const FRAME_SECONDS = 0.42;
const MAX_FRAMES = 64;

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Split one raw line into {text,color} runs, honouring SGR colour codes. */
function parseAnsiLine(raw) {
  const runs = [];
  let color = DEFAULT_FG;
  let bold = false;
  let buffer = '';
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let match;

  const flush = () => {
    if (buffer) runs.push({ text: buffer, color, bold });
    buffer = '';
  };

  while ((match = re.exec(raw)) !== null) {
    buffer += raw.slice(last, match.index);
    last = re.lastIndex;
    flush();
    for (const codeStr of match[1].split(';')) {
      const code = parseInt(codeStr || '0', 10);
      if (code === 0) {
        color = DEFAULT_FG;
        bold = false;
      } else if (code === 1) bold = true;
      else if (code === 2) color = '#7f848e';
      else if (ANSI_COLORS[code]) color = ANSI_COLORS[code];
    }
  }
  buffer += raw.slice(last);
  flush();
  return runs;
}

/** Truncate a run list to a column budget so long lines cannot overflow the frame. */
function clampRuns(runs, maxCols) {
  const out = [];
  let used = 0;
  for (const run of runs) {
    if (used >= maxCols) break;
    const room = maxCols - used;
    const text = run.text.length > room ? run.text.slice(0, room - 1) + '…' : run.text;
    out.push({ ...run, text });
    used += text.length;
  }
  return out;
}

function build(rawPath, outPath, title) {
  const raw = fs.readFileSync(rawPath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    // Drop the trailing blank tail; keep interior blanks for readability.
    .filter((l, i, arr) => l.trim() !== '' || (i < arr.length - 1 && arr.slice(i + 1).some((x) => x.trim())))
    .map((l) => clampRuns(parseAnsiLine(l), COLS));

  const step = Math.max(1, Math.ceil(lines.length / MAX_FRAMES));
  const frames = [];
  for (let end = 1; end <= lines.length; end += step) {
    frames.push(lines.slice(Math.max(0, end - ROWS), end));
  }
  // Hold on the final screen so the green result is readable before looping.
  const holdFrames = 6;
  for (let i = 0; i < holdFrames; i++) frames.push(lines.slice(Math.max(0, lines.length - ROWS)));

  const total = (frames.length * FRAME_SECONDS).toFixed(2);
  const visiblePct = (100 / frames.length).toFixed(4);
  const width = Math.round(COLS * CHAR_W + PAD_X * 2);
  const height = Math.round(ROWS * LINE_H + PAD_Y + 16);

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono',monospace" font-size="12.5">`
  );
  parts.push(`<title>${esc(title)}</title>`);
  parts.push(`<style>
    .f { opacity: 0; animation: cast ${total}s steps(1,end) infinite; }
    @keyframes cast { 0% { opacity: 1 } ${visiblePct}% { opacity: 0 } 100% { opacity: 0 } }
    @media (prefers-reduced-motion: reduce) { .f { animation: none } .f:last-of-type { opacity: 1 } }
  </style>`);
  parts.push(`<rect width="${width}" height="${height}" rx="8" fill="#1e2127"/>`);
  parts.push(`<rect width="${width}" height="26" rx="8" fill="#282c34"/>`);
  parts.push(`<rect y="18" width="${width}" height="8" fill="#282c34"/>`);
  parts.push('<circle cx="16" cy="13" r="4.5" fill="#e06c75"/><circle cx="32" cy="13" r="4.5" fill="#e5c07b"/><circle cx="48" cy="13" r="4.5" fill="#98c379"/>');
  parts.push(`<text x="64" y="17" fill="#7f848e" font-size="11">${esc(title)}</text>`);

  frames.forEach((frame, index) => {
    parts.push(`<g class="f" style="animation-delay:${(index * FRAME_SECONDS).toFixed(2)}s">`);
    frame.forEach((runs, row) => {
      const y = PAD_Y + row * LINE_H;
      let x = PAD_X;
      for (const run of runs) {
        if (run.text.trim()) {
          parts.push(
            `<text x="${x.toFixed(1)}" y="${y}" fill="${run.color}"${run.bold ? ' font-weight="bold"' : ''} xml:space="preserve">${esc(run.text)}</text>`
          );
        }
        x += run.text.length * CHAR_W;
      }
    });
    parts.push('</g>');
  });

  parts.push('</svg>');
  fs.writeFileSync(outPath, parts.join('\n'));

  return { frames: frames.length, seconds: total, lines: lines.length, bytes: fs.statSync(outPath).size };
}

const [, , rawPath, outPath, ...rest] = process.argv;
if (!rawPath || !outPath) {
  console.error('usage: node scripts/make-demo-svg.js <raw-capture> <out.svg> [--title "..."]');
  process.exit(1);
}
const titleIndex = rest.indexOf('--title');
const title = titleIndex !== -1 ? rest[titleIndex + 1] : 'npm run agent:offline';
const stats = build(rawPath, outPath, title);
console.log(
  `wrote ${outPath}: ${stats.frames} frames from ${stats.lines} real output lines, ` +
    `${stats.seconds}s loop, ${(stats.bytes / 1024).toFixed(0)} KB`
);
