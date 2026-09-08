import { LINTER_VERSION } from "./platform-config.js";
import type { LintIssue, LintReport, SarifLog } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function serializeLintReport(report: LintReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatLintHtml(report: LintReport): string {
  const rows = report.diagnostics
    .map(
      (item) => `
      <tr class="${item.severity.toLocaleLowerCase()}">
        <td><strong>${escapeHtml(item.severity)}</strong></td>
        <td><code>${escapeHtml(item.rule_id)}</code></td>
        <td>${escapeHtml(item.category)}</td>
        <td>${escapeHtml(item.file)}:${item.line}:${item.column}</td>
        <td>${escapeHtml(item.message)}<br><small>${escapeHtml(item.suggestion)}</small></td>
        <td><code>${escapeHtml(item.fingerprint)}</code></td>
      </tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>MPForge lint report</title>
  <style>
    body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#202124;background:#fff}
    header{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap}table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #d9dde3;padding:8px;text-align:left;vertical-align:top}th{background:#f4f6f8}
    tr.error{border-left:5px solid #b42318}tr.warning{border-left:5px solid #b54708}tr.info{border-left:5px solid #175cd3}
    code{overflow-wrap:anywhere}small{color:#475467}
  </style>
</head>
<body>
  <header><h1>MPForge deterministic lint</h1><strong>${report.publish_blocked ? "PUBLISH BLOCKED" : "NO LINT ERROR"}</strong></header>
  <p>${report.error_count} ERROR · ${report.warning_count} WARNING · ${report.info_count} INFO</p>
  <p>Article: <code>${escapeHtml(report.article_id)}</code> · ruleset: <code>${escapeHtml(report.ruleset_version)}</code></p>
  <table><thead><tr><th>Severity</th><th>Rule</th><th>Category</th><th>Location</th><th>Finding</th><th>Fingerprint</th></tr></thead>
  <tbody>${rows}</tbody></table>
</body>
</html>
`;
}

function sarifLevel(issue: LintIssue): "error" | "warning" | "note" {
  return issue.severity === "ERROR"
    ? "error"
    : issue.severity === "WARNING"
      ? "warning"
      : "note";
}

export function toSarif(report: LintReport): SarifLog {
  const rules = [
    ...new Map(report.diagnostics.map((item) => [item.rule_id, item])).values(),
  ]
    .sort((a, b) => a.rule_id.localeCompare(b.rule_id))
    .map((item) => ({
      id: item.rule_id,
      shortDescription: { text: item.message },
      helpUri: `https://mpforge.local/docs/${encodeURIComponent(item.documentation_key)}`,
      properties: {
        category: item.category,
        autofix_available: item.autofix_available,
        autofix_safe: item.autofix_safe,
      },
    }));
  const results = report.diagnostics.map((item) => ({
    ruleId: item.rule_id,
    level: sarifLevel(item),
    message: { text: item.message },
    fingerprints: { "mpforge/v1": item.fingerprint },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: item.file.replace(/\\/g, "/") },
          region: {
            startLine: item.line,
            startColumn: item.column,
            snippet: { text: item.excerpt },
          },
        },
      },
    ],
    properties: { category: item.category, suggestion: item.suggestion },
  }));
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: { name: "MPForge Linter", version: LINTER_VERSION, rules },
        },
        results,
      },
    ],
  };
}

export function serializeLintSarif(report: LintReport): string {
  return `${JSON.stringify(toSarif(report), null, 2)}\n`;
}
