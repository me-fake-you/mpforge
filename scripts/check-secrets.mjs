import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  findRepositoryRoot,
  isExecutedDirectly,
  printIssues,
  candidateFiles,
} from "./qa-lib.mjs";

const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export const secretRules = Object.freeze([
  {
    id: "private-key",
    expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  { id: "aws-access-key", expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  {
    id: "github-token",
    expression: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g,
  },
  { id: "slack-token", expression: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { id: "stripe-live-key", expression: /\bsk_live_[A-Za-z0-9]{20,}\b/g },
  {
    id: "assigned-secret",
    expression:
      /\b(?:app[_-]?secret|client[_-]?secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?([A-Za-z0-9_+/=-]{24,})/gi,
    accept: (match) => {
      const candidate = match[1] ?? "";
      return !/^(?:sk-)?(?:0123456789|1234567890){2,}$/i.test(candidate);
    },
  },
]);

function lineNumberAt(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

export function scanText(text, rules = secretRules) {
  const findings = [];
  for (const rule of rules) {
    rule.expression.lastIndex = 0;
    for (const match of text.matchAll(rule.expression)) {
      if (rule.accept && !rule.accept(match)) continue;
      findings.push({
        rule: rule.id,
        line: lineNumberAt(text, match.index ?? 0),
      });
    }
  }
  return findings.sort(
    (left, right) =>
      left.line - right.line || left.rule.localeCompare(right.rule),
  );
}

function isProbablyBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
  return sample.includes(0);
}

export function scanTrackedSecrets(root) {
  const issues = [];
  for (const relativePath of candidateFiles(root)) {
    const absolutePath = path.join(root, relativePath);
    if (!existsSync(absolutePath)) continue;
    const buffer = readFileSync(absolutePath);
    if (buffer.length > MAX_TEXT_BYTES || isProbablyBinary(buffer)) continue;
    const text = buffer.toString("utf8");
    for (const finding of scanText(text)) {
      issues.push(
        `${relativePath}:${finding.line} [${finding.rule}] possible secret (value redacted)`,
      );
    }
  }
  return issues;
}

if (isExecutedDirectly(import.meta.url)) {
  const root = findRepositoryRoot();
  process.exitCode = printIssues("secret scan", scanTrackedSecrets(root));
}
