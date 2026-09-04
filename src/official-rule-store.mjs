import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const ANALYSIS_RULES_SCHEMA_VERSION = "style-atlas-rules-v1";
const MAX_RULES = 50;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_PROMPT_LENGTH = 8000;
const BUNDLED_IDS = new Set([
  "general",
  "product-ui",
  "brand-visual",
  "commerce-campaign",
  "editorial-layout",
  "packaging",
  "illustration-3d",
]);

export function analysisRuleSha256(rule) {
  return createHash("sha256")
    .update(JSON.stringify({
      id: rule.id,
      name: rule.name,
      description: rule.description,
      version: rule.version,
      prompt: rule.prompt,
      ...(rule.deleted === true ? { deleted: true } : {}),
    }))
    .digest("hex");
}

function requiredText(value, label, maximum) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${label}不能为空。`);
  if (normalized.length > maximum) throw new RangeError(`${label}不可超过 ${maximum} 个字符。`);
  return normalized;
}

function optionalText(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function normalizeVersion(value) {
  const normalized = requiredText(value || "1.0.0", "版本号", 40);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new TypeError("版本号必须使用 1.0.0 形式。");
  }
  return normalized;
}

function incrementPatch(value) {
  const match = normalizeVersion(value).match(/^(\d+)\.(\d+)\.(\d+)/);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function normalizeId(value) {
  const id = requiredText(value, "规则 ID", 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) throw new TypeError("规则 ID 格式不正确。");
  return id;
}

function normalizeRule(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("规则必须是 object。");
  }
  const rule = {
    id: normalizeId(value.id),
    name: requiredText(value.name, "规则名称", MAX_NAME_LENGTH),
    description: optionalText(value.description, MAX_DESCRIPTION_LENGTH),
    version: normalizeVersion(value.version),
    prompt: requiredText(value.prompt, "规则内容", MAX_PROMPT_LENGTH),
    ...(value.deleted === true ? { deleted: true } : {}),
  };
  rule.sha256 = analysisRuleSha256(rule);
  if (value.sha256 && String(value.sha256).toLowerCase() !== rule.sha256) {
    throw new Error(`规则 ${rule.id} 的 SHA-256 校验失败。`);
  }
  return rule;
}

export function normalizeOfficialRuleManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("规则清单必须是 object。");
  }
  if (value.schemaVersion !== ANALYSIS_RULES_SCHEMA_VERSION) {
    throw new TypeError("规则清单版本不兼容。");
  }
  if (!Array.isArray(value.rules)) throw new TypeError("规则清单缺少 rules 数组。");
  if (value.rules.length > MAX_RULES) throw new RangeError(`官方规则最多 ${MAX_RULES} 条。`);
  const ids = new Set();
  const rules = value.rules.map((item) => {
    const rule = normalizeRule(item);
    if (ids.has(rule.id)) throw new TypeError(`规则 ID 重复：${rule.id}`);
    ids.add(rule.id);
    return rule;
  });
  return { schemaVersion: ANALYSIS_RULES_SCHEMA_VERSION, rules };
}

export function createOfficialRule(manifest, input, options = {}) {
  const current = normalizeOfficialRuleManifest(manifest);
  if (current.rules.length >= MAX_RULES) throw new RangeError(`官方规则最多 ${MAX_RULES} 条。`);
  let id = options.id || `official-${randomUUID()}`;
  while (current.rules.some((rule) => rule.id === id)) id = `official-${randomUUID()}`;
  const rule = normalizeRule({ ...input, id, version: "1.0.0", sha256: undefined });
  return {
    rule,
    manifest: { ...current, rules: [...current.rules, rule] },
  };
}

export function updateOfficialRule(manifest, id, input) {
  const current = normalizeOfficialRuleManifest(manifest);
  const index = current.rules.findIndex((rule) => rule.id === id && rule.deleted !== true);
  if (index < 0) throw new Error("找不到这条官方规则。");
  const existing = current.rules[index];
  const rule = normalizeRule({
    ...existing,
    ...input,
    id: existing.id,
    version: incrementPatch(existing.version),
    deleted: false,
    sha256: undefined,
  });
  const rules = [...current.rules];
  rules[index] = rule;
  return { rule, manifest: { ...current, rules } };
}

export function deleteOfficialRule(manifest, id) {
  const current = normalizeOfficialRuleManifest(manifest);
  const index = current.rules.findIndex((rule) => rule.id === id && rule.deleted !== true);
  if (index < 0) throw new Error("找不到这条官方规则。");
  const existing = current.rules[index];
  const rules = [...current.rules];
  if (BUNDLED_IDS.has(id)) {
    rules[index] = normalizeRule({
      ...existing,
      version: incrementPatch(existing.version),
      deleted: true,
      sha256: undefined,
    });
  } else {
    rules.splice(index, 1);
  }
  return { ...current, rules };
}

export async function loadOfficialRuleManifest(filePath) {
  return normalizeOfficialRuleManifest(JSON.parse(await readFile(filePath, "utf8")));
}

export async function saveOfficialRuleManifest(filePath, manifest) {
  const normalized = normalizeOfficialRuleManifest(manifest);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
  return normalized;
}
