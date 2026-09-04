import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ANALYSIS_RULES_SCHEMA_VERSION,
  createOfficialRule,
  deleteOfficialRule,
  loadOfficialRuleManifest,
  normalizeOfficialRuleManifest,
  saveOfficialRuleManifest,
  updateOfficialRule,
} from "../src/official-rule-store.mjs";

function manifest(rules = []) {
  return normalizeOfficialRuleManifest({
    schemaVersion: ANALYSIS_RULES_SCHEMA_VERSION,
    rules,
  });
}

test("published manifest is valid and contains the official rules", async () => {
  const filePath = fileURLToPath(new URL("../official-rules/analysis-rules.json", import.meta.url));
  const current = await loadOfficialRuleManifest(filePath);
  assert.equal(current.schemaVersion, ANALYSIS_RULES_SCHEMA_VERSION);
  assert.ok(current.rules.length > 0);
});

test("publisher creates and updates official rules with immutable ids", () => {
  const initial = manifest();
  const created = createOfficialRule(initial, {
    name: "社交媒体",
    description: "关注社交媒体传播",
    prompt: "分析封面识别和信息节奏。",
  }, { id: "official-social-media" });
  assert.equal(created.rule.version, "1.0.0");
  assert.equal(created.rule.id, "official-social-media");

  const updated = updateOfficialRule(created.manifest, created.rule.id, {
    name: "社交媒体内容",
    description: "关注传播与平台适配",
    prompt: "分析封面识别、信息节奏与平台尺寸适配。",
  });
  assert.equal(updated.rule.version, "1.0.1");
  assert.equal(updated.rule.id, created.rule.id);
  assert.notEqual(updated.rule.sha256, created.rule.sha256);

  const removed = deleteOfficialRule(updated.manifest, created.rule.id);
  assert.equal(removed.rules.some((rule) => rule.id === created.rule.id), false);
});

test("publisher keeps a hidden tombstone when deleting a bundled rule", () => {
  const initial = manifest([{
    id: "packaging",
    name: "包装设计",
    description: "关注包装设计。",
    version: "1.0.0",
    prompt: "分析包装结构和视觉层级。",
  }]);
  const removed = deleteOfficialRule(initial, "packaging");
  const tombstone = removed.rules.find((rule) => rule.id === "packaging");
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.version, "1.0.1");
});

test("publisher saves and reloads a Git-ready manifest atomically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "style-atlas-rules-test-"));
  const filePath = path.join(directory, "analysis-rules.json");
  try {
    const saved = await saveOfficialRuleManifest(filePath, manifest());
    const loaded = await loadOfficialRuleManifest(filePath);
    assert.deepEqual(loaded, saved);
    assert.match(await readFile(filePath, "utf8"), /"schemaVersion": "style-atlas-rules-v1"/);
    assert.equal(loaded.rules.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("publisher rejects a manifest with a forged checksum", () => {
  const value = manifest([{
    id: "general",
    name: "通用视觉研究",
    description: "通用规则。",
    version: "1.0.0",
    prompt: "分析视觉特征。",
  }]);
  value.rules[0].sha256 = "0".repeat(64);
  assert.throws(() => normalizeOfficialRuleManifest(value), /SHA-256/);
});
