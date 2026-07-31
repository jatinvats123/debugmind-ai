#!/usr/bin/env node
/**
 * Render a run's JSONL trace to a single self-contained HTML timeline.
 *
 * No server, no framework, no build step, no network: the data is embedded in
 * the file, so the output can be opened from disk, attached to a bug report, or
 * committed as an artifact.
 *
 *   node scripts/trace-view.js [trace.jsonl] [-o out.html] [--open]
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { input: path.join(REPO_ROOT, 'debug-trace.jsonl'), out: null, open: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-o' || argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--open') args.open = true;
    else rest.push(argv[i]);
  }
  if (rest[0]) args.input = rest[0];
  if (!args.out) args.out = path.join(path.dirname(args.input), 'debug-trace.html');
  return args;
}

function readTrace(file) {
  if (!fs.existsSync(file)) {
    console.error(`Trace not found: ${file}\nRun the agent first (npm run agent:offline) to produce one.`);
    process.exit(1);
  }
  const events = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* a partial final line is expected if a run was killed mid-write */
    }
  }
  return events;
}

/** Condense raw events into the story a reviewer wants: what did it believe, and why. */
function buildTimeline(events) {
  const bugs = new Map();
  const ensure = (n) => {
    if (!bugs.has(n)) {
      bugs.set(n, { bug: n, target: null, steps: [], hypotheses: [], confirmations: [], learnings: [], result: null });
    }
    return bugs.get(n);
  };

  let manifest = null;
  let baseline = null;
  let pendingCall = null;

  for (const e of events) {
    if (e.type === 'run_manifest') manifest = e.manifest;
    if (e.type === 'baseline_tests') baseline = e.summary;

    if (e.bug == null) continue;
    const bug = ensure(e.bug);

    switch (e.type) {
      case 'bug_start':
        bug.target = e.target;
        break;
      case 'model_thinking':
        bug.steps.push({ kind: 'thinking', t: e.elapsedMs, phase: e.phase, text: e.text });
        break;
      case 'model_text':
        bug.steps.push({ kind: 'reasoning', t: e.elapsedMs, phase: e.phase, text: e.text });
        break;
      case 'model_turn':
        bug.steps.push({
          kind: 'turn', t: e.elapsedMs, phase: e.phase,
          durationMs: e.durationMs, inputTokens: e.inputTokens, outputTokens: e.outputTokens,
        });
        break;
      case 'tool_call':
        pendingCall = { kind: 'tool', t: e.elapsedMs, phase: e.phase, tool: e.tool, input: e.input };
        bug.steps.push(pendingCall);
        break;
      case 'tool_result':
        if (pendingCall && pendingCall.tool === e.tool && pendingCall.result === undefined) {
          pendingCall.result = e.result;
          pendingCall.isError = e.isError;
          pendingCall.durationMs = e.durationMs;
        } else {
          bug.steps.push({ kind: 'tool', t: e.elapsedMs, phase: e.phase, tool: e.tool, result: e.result, isError: e.isError, durationMs: e.durationMs });
        }
        pendingCall = null;
        break;
      case 'hypotheses_recorded':
        bug.hypotheses.push(...(e.hypotheses || []));
        bug.steps.push({ kind: 'hypotheses', t: e.elapsedMs, phase: e.phase, hypotheses: e.hypotheses });
        break;
      case 'hypothesis_confirmed':
        bug.confirmations.push(e);
        bug.steps.push({ kind: 'confirmed', t: e.elapsedMs, phase: e.phase, id: e.id, method: e.method, evidence: e.evidence, confidence: e.confidence });
        break;
      case 'fix_applied':
        bug.steps.push({ kind: 'fix', t: e.elapsedMs, phase: e.phase, file: e.file, reason: e.reason, patch: e.patch });
        break;
      case 'revert':
        bug.steps.push({ kind: 'revert', t: e.elapsedMs, phase: e.phase, file: e.file, restoredTo: e.restoredTo });
        break;
      case 'learning_recorded':
        bug.learnings.push(e);
        bug.steps.push({ kind: 'learning', t: e.elapsedMs, phase: e.phase, ruledOut: e.what_it_rules_out, revised: e.revised_thinking, summary: e.failed_attempt_summary });
        break;
      case 'attempt_failed':
        bug.steps.push({ kind: 'attempt_failed', t: e.elapsedMs, phase: e.phase, attemptNum: e.attemptNum, maxAttempts: e.maxAttempts, detail: e.detail });
        break;
      case 'harness':
        bug.steps.push({ kind: 'harness', t: e.elapsedMs, phase: e.phase, message: e.message });
        break;
      case 'bug_resolved':
        bug.result = { status: 'fixed', ...e };
        break;
      case 'bug_needs_review':
        bug.result = { status: 'needs_human_review', ...e };
        break;
      default:
        break;
    }
  }

  return { manifest, baseline, bugs: [...bugs.values()] };
}

const STYLE = `
:root{--bg:#0f1115;--panel:#171a21;--line:#242833;--fg:#d7dae0;--dim:#8b93a1;
--blue:#61afef;--green:#98c379;--red:#e06c75;--yellow:#e5c07b;--purple:#c678dd;--cyan:#56b6c2}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wrap{max-width:1080px;margin:0 auto;padding:28px 20px 80px}
h1{font-size:22px;margin:0 0 4px}
.sub{color:var(--dim);font-size:13px;margin-bottom:20px}
.manifest{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin-bottom:22px;font-size:12.5px;color:var(--dim);display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px 18px}
.manifest b{color:var(--fg);font-weight:600}
.bug{border:1px solid var(--line);border-radius:10px;margin-bottom:18px;overflow:hidden;background:var(--panel)}
.bughead{padding:13px 16px;background:#1b1f27;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.bughead .n{color:var(--dim);font-size:12px}
.bughead .t{font-weight:600}
.pill{font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--dim)}
.pill.ok{color:var(--green);border-color:#2f4a33}
.pill.warn{color:var(--yellow);border-color:#4a4227}
.steps{padding:6px 0}
.step{display:grid;grid-template-columns:62px 22px 1fr;gap:10px;padding:5px 16px;align-items:start}
.step:hover{background:#1b1f27}
.time{color:#5d6675;font-size:11px;text-align:right;padding-top:3px;font-family:ui-monospace,monospace}
.icon{text-align:center;padding-top:1px}
.body{min-width:0}
.label{font-size:12px;color:var(--dim)}
.tool{color:var(--blue)}
.tool.err{color:var(--red)}
pre{margin:5px 0 0;padding:8px 10px;background:#0c0e12;border:1px solid var(--line);border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;color:#b6bcc8}
.reason{color:#c8cdd6}
.think{color:#79808e;font-style:italic}
.hyp{border-left:2px solid var(--purple);padding:4px 0 4px 10px;margin:4px 0}
.hyp .id{color:var(--purple);font-weight:600}
.hyp .why{color:var(--dim);font-size:12.5px}
.conf{border-left:2px solid var(--green);padding:4px 0 4px 10px;margin:4px 0}
.learn{border-left:2px solid var(--yellow);padding:4px 0 4px 10px;margin:4px 0}
.fail{color:var(--red);font-weight:600}
.fix{border-left:2px solid var(--green);padding:4px 0 4px 10px;margin:4px 0}
.diff .add{color:var(--green)}.diff .del{color:var(--red)}.diff .ctx{color:#7d8492}
.result{padding:12px 16px;border-top:1px solid var(--line);background:#12151b}
.controls{margin:0 0 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--dim)}
.controls label{cursor:pointer;user-select:none}
.hidden{display:none !important}
`;

const SCRIPT = `
const state={thinking:true,tools:true};
function apply(){
  document.querySelectorAll('[data-kind=thinking]').forEach(el=>el.classList.toggle('hidden',!state.thinking));
  document.querySelectorAll('[data-kind=tool]').forEach(el=>el.classList.toggle('hidden',!state.tools));
}
document.addEventListener('change',e=>{
  if(e.target.id==='t-think'){state.thinking=e.target.checked;apply();}
  if(e.target.id==='t-tools'){state.tools=e.target.checked;apply();}
});
apply();
`;

const esc = (s) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const clip = (s, n) => {
  const str = String(s == null ? '' : s);
  return str.length > n ? str.slice(0, n) + '\n…[truncated in viewer]' : str;
};

const ms = (t) => (t == null ? '' : t < 1000 ? `${t}ms` : `${(t / 1000).toFixed(1)}s`);
const clock = (t) => {
  if (t == null) return '';
  const s = Math.floor(t / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function renderDiff(patch) {
  return clip(patch, 4000)
    .split('\n')
    .filter((l) => !/^(---|\+\+\+|===|Index:)/.test(l))
    .map((l) => {
      const cls = l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : 'ctx';
      return `<span class="${cls}">${esc(l)}</span>`;
    })
    .join('\n');
}

const ICONS = {
  thinking: '💭', reasoning: '💬', tool: '⚙', hypotheses: '◆', confirmed: '✓',
  fix: '✎', revert: '↩', learning: '✎', attempt_failed: '✗', harness: '⚖', turn: '·',
};

function renderStep(step) {
  const icon = ICONS[step.kind] || '·';
  let body = '';

  switch (step.kind) {
    case 'thinking':
      body = `<div class="think">${esc(clip(step.text, 700))}</div>`;
      break;
    case 'reasoning':
      body = `<div class="reason">${esc(clip(step.text, 1200))}</div>`;
      break;
    case 'turn':
      body = `<span class="label">model turn — ${ms(step.durationMs)}, ${step.inputTokens} in / ${step.outputTokens} out</span>`;
      break;
    case 'tool': {
      const args = step.input ? esc(clip(JSON.stringify(step.input), 300)) : '';
      body =
        `<span class="tool${step.isError ? ' err' : ''}">${esc(step.tool)}</span>` +
        `<span class="label">(${args})${step.durationMs != null ? ' — ' + ms(step.durationMs) : ''}</span>` +
        (step.result ? `<pre>${esc(clip(step.result, 2200))}</pre>` : '');
      break;
    }
    case 'hypotheses':
      body = (step.hypotheses || [])
        .map(
          (h) =>
            `<div class="hyp"><span class="id">${esc(h.id)}</span> <span class="label">(${esc(h.likelihood)})</span> ${esc(h.summary)}` +
            `<div class="why">${esc(h.suspected_location)} — ${esc(clip(h.reasoning, 500))}</div></div>`
        )
        .join('');
      break;
    case 'confirmed':
      body =
        `<div class="conf"><b>${esc(step.id)} confirmed</b> <span class="label">via ${esc(step.method)}</span>` +
        `<div class="why">${esc(clip(step.evidence, 600))}</div></div>`;
      break;
    case 'fix':
      body =
        `<div class="fix"><b>edit</b> <span class="label">${esc(step.file)}</span>` +
        `<div class="reason">${esc(clip(step.reason, 500))}</div>` +
        `<pre class="diff">${renderDiff(step.patch || '')}</pre></div>`;
      break;
    case 'revert':
      body = `<span class="label">reverted <b>${esc(step.file)}</b> → ${esc(step.restoredTo)}</span>`;
      break;
    case 'learning':
      body =
        `<div class="learn"><b>learning</b><div class="why">ruled out: ${esc(clip(step.ruledOut, 400))}</div>` +
        `<div class="why">revised: ${esc(clip(step.revised, 400))}</div></div>`;
      break;
    case 'attempt_failed':
      body = `<span class="fail">attempt ${step.attemptNum}/${step.maxAttempts} failed</span> <span class="label">${esc(clip(step.detail, 400))}</span>`;
      break;
    case 'harness':
      body = `<span class="label">⚖ ${esc(clip(step.message, 400))}</span>`;
      break;
    default:
      body = `<span class="label">${esc(step.kind)}</span>`;
  }

  return `<div class="step" data-kind="${step.kind}"><div class="time">${clock(step.t)}</div><div class="icon">${icon}</div><div class="body">${body}</div></div>`;
}

function renderHtml({ manifest, baseline, bugs }, sourceName) {
  const p = (manifest && manifest.provider) || {};
  const manifestRows = manifest
    ? [
        ['run', manifest.runId],
        ['model', `${p.model}${manifest.resolvedModel && manifest.resolvedModel.version ? ` (${manifest.resolvedModel.version})` : ''}`],
        ['temperature', String(p.temperature)],
        ['prompt hash', (manifest.hashes && manifest.hashes.systemPrompt || '').slice(0, 12)],
        ['source hash', (manifest.hashes && manifest.hashes.appSource || '').slice(0, 12)],
        ['node', manifest.runtime && manifest.runtime.node],
        ['commit', manifest.git && manifest.git.commit ? manifest.git.commit.slice(0, 8) + (manifest.git.dirty ? ' (dirty)' : '') : '—'],
      ]
        .map(([k, v]) => `<div><b>${esc(k)}</b> ${esc(v || '—')}</div>`)
        .join('')
    : '<div>No manifest in this trace.</div>';

  const body = bugs
    .map((bug) => {
      const status = bug.result ? bug.result.status : 'incomplete';
      const pill =
        status === 'fixed'
          ? '<span class="pill ok">fixed</span>'
          : status === 'needs_human_review'
            ? '<span class="pill warn">needs human review</span>'
            : '<span class="pill">incomplete</span>';
      const counts =
        `<span class="pill">${bug.hypotheses.length} hypotheses</span>` +
        `<span class="pill">${bug.confirmations.length} confirmed</span>` +
        (bug.learnings.length ? `<span class="pill">${bug.learnings.length} learnings</span>` : '');

      const result = bug.result
        ? `<div class="result"><b>root cause:</b> ${esc(bug.result.root_cause || '—')}` +
          (bug.result.confidence != null ? ` <span class="label">· confidence ${esc(bug.result.confidence)}</span>` : '') +
          `</div>`
        : '';

      return (
        `<div class="bug"><div class="bughead"><span class="n">BUG #${bug.bug}</span>` +
        `<span class="t">${esc(bug.target ? bug.target.fullName : '')}</span>${pill}${counts}</div>` +
        `<div class="steps">${bug.steps.map(renderStep).join('')}</div>${result}</div>`
      );
    })
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DebugMind trace — ${esc(sourceName)}</title><style>${STYLE}</style></head>
<body><div class="wrap">
<h1>DebugMind run trace</h1>
<div class="sub">${esc(sourceName)} · ${bugs.length} bug session(s)${baseline ? ` · baseline ${baseline.numPassedTests} passing / ${baseline.numFailedTests} failing` : ''}</div>
<div class="manifest">${manifestRows}</div>
<div class="controls">
  <label><input type="checkbox" id="t-think" checked> show model thinking</label>
  <label><input type="checkbox" id="t-tools" checked> show tool calls</label>
</div>
${body || '<p class="sub">No bug sessions in this trace.</p>'}
</div><script>${SCRIPT}</script></body></html>`;
}

const args = parseArgs(process.argv.slice(2));
const events = readTrace(args.input);
const timeline = buildTimeline(events);
const html = renderHtml(timeline, path.basename(args.input));
fs.writeFileSync(args.out, html);

const steps = timeline.bugs.reduce((n, b) => n + b.steps.length, 0);
console.log(
  `wrote ${path.relative(REPO_ROOT, args.out)} — ${events.length} events, ` +
    `${timeline.bugs.length} bug session(s), ${steps} timeline steps, ${(fs.statSync(args.out).size / 1024).toFixed(0)} KB`
);

if (args.open) {
  const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  execFile(opener, [args.out], () => {});
}
