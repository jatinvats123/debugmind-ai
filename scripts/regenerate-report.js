/**
 * Rebuild debug-report.md (and the finalReport section of debug-log.json)
 * from an existing debug-log.json — no agent re-run needed.
 *
 * Usage: node scripts/regenerate-report.js [path/to/debug-log.json]
 */
const fs = require('fs');
const path = require('path');
const { buildReport, renderMarkdown } = require('../agent/report');

const root = path.resolve(__dirname, '..');
const logPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'debug-log.json');

if (!fs.existsSync(logPath)) {
  console.error(`Log file not found: ${logPath}`);
  process.exit(1);
}

const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
if (!log.sessions || log.sessions.length === 0) {
  console.error('The log contains no bug sessions — nothing to report on.');
  process.exit(1);
}
if (!log.finalReport) {
  console.error('The log has no finalReport (run may have crashed early) — cannot recover final test state.');
  process.exit(1);
}

const report = buildReport({
  sessions: log.sessions,
  finalTestState: log.finalReport.finalTestState,
  usage: log.usage,
  durationSeconds: log.finalReport.durationSeconds,
  events: log.events,
  completedAt: log.finalReport.completedAt,
});

log.finalReport = report;
fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

const reportPath = path.join(path.dirname(logPath), 'debug-report.md');
fs.writeFileSync(reportPath, renderMarkdown(report));

console.log(`Regenerated ${reportPath}`);
console.log(`Updated finalReport in ${logPath}`);
for (const b of report.bugs) {
  console.log(
    `  Bug #${b.bugNum}: ${b.status} | difficulty ${b.difficulty.rating} | confidence ${b.confidenceScore.percent}% | ${b.diffs.length} diff snippet(s)`
  );
}
