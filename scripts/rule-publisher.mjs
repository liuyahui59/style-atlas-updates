import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createOfficialRule,
  deleteOfficialRule,
  loadOfficialRuleManifest,
  saveOfficialRuleManifest,
  updateOfficialRule,
} from "../src/official-rule-store.mjs";

const ROOT_DIR = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const PUBLISHER_DIR = path.join(ROOT_DIR, "publisher");
const MANIFEST_PATH = path.join(ROOT_DIR, "official-rules", "analysis-rules.json");
const HOST = "127.0.0.1";
const PREFERRED_PORT = Number(process.env.STYLE_ATLAS_RULE_MANAGER_PORT || 4188);
const MAX_PORT_ATTEMPTS = 20;
const TOKEN = randomBytes(24).toString("hex");
const BODY_LIMIT = 1024 * 1024;
const NO_OPEN = process.argv.includes("--no-open");
const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);

let mutationQueue = Promise.resolve();

async function saveManifest(manifest) {
  await saveOfficialRuleManifest(MANIFEST_PATH, manifest);
}

function headers(contentType = null) {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, headers("application/json; charset=utf-8"));
  response.end(`${JSON.stringify(payload)}\n`);
}

function visiblePayload(manifest) {
  const rules = manifest.rules.filter((rule) => rule.deleted !== true);
  return {
    schemaVersion: manifest.schemaVersion,
    rules,
    total: rules.length,
    file: path.relative(ROOT_DIR, MANIFEST_PATH),
  };
}

function authorized(request) {
  return request.headers["x-rule-publisher-token"] === TOKEN;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error("请求内容超过 1 MB。");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new Error("请求内容不是有效 JSON。");
  }
}

function enqueueMutation(task) {
  const next = mutationQueue.then(task, task);
  mutationQueue = next.catch(() => {});
  return next;
}

async function serveStatic(response, pathname) {
  const filename = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!/^(index\.html|app\.js|styles\.css)$/.test(filename)) return false;
  const filePath = path.join(PUBLISHER_DIR, filename);
  const fileStat = await stat(filePath);
  response.writeHead(200, {
    ...headers(MIME_TYPES.get(path.extname(filePath)) || "application/octet-stream"),
    "Content-Length": fileStat.size,
  });
  createReadStream(filePath).pipe(response);
  return true;
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${HOST}:${selectedPort}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/") || pathname === "/download") {
    if (!authorized(request)) {
      sendJson(response, 403, { error: "管理会话无效，请重新启动规则发布管理。" });
      return;
    }
  }

  if (request.method === "GET" && pathname === "/api/rules") {
    sendJson(response, 200, visiblePayload(await loadOfficialRuleManifest(MANIFEST_PATH)));
    return;
  }

  if (request.method === "POST" && pathname === "/api/rules") {
    const input = await readJsonBody(request);
    const result = await enqueueMutation(async () => {
      const manifest = await loadOfficialRuleManifest(MANIFEST_PATH);
      const created = createOfficialRule(manifest, input);
      await saveManifest(created.manifest);
      return created;
    });
    sendJson(response, 201, { rule: result.rule, ...visiblePayload(result.manifest) });
    return;
  }

  const itemMatch = pathname.match(/^\/api\/rules\/([^/]+)$/u);
  if (itemMatch && request.method === "PATCH") {
    const id = decodeURIComponent(itemMatch[1]);
    const input = await readJsonBody(request);
    const result = await enqueueMutation(async () => {
      const manifest = await loadOfficialRuleManifest(MANIFEST_PATH);
      const updated = updateOfficialRule(manifest, id, input);
      await saveManifest(updated.manifest);
      return updated;
    });
    sendJson(response, 200, { rule: result.rule, ...visiblePayload(result.manifest) });
    return;
  }

  if (itemMatch && request.method === "DELETE") {
    const id = decodeURIComponent(itemMatch[1]);
    const manifest = await enqueueMutation(async () => {
      const current = await loadOfficialRuleManifest(MANIFEST_PATH);
      const next = deleteOfficialRule(current, id);
      await saveManifest(next);
      return next;
    });
    sendJson(response, 200, visiblePayload(manifest));
    return;
  }

  if (request.method === "GET" && pathname === "/download") {
    const manifest = await loadOfficialRuleManifest(MANIFEST_PATH);
    const body = `${JSON.stringify(manifest, null, 2)}\n`;
    response.writeHead(200, {
      ...headers("application/json; charset=utf-8"),
      "Content-Disposition": 'attachment; filename="analysis-rules.json"',
      "Content-Length": Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }

  if (request.method === "GET" && await serveStatic(response, pathname)) return;
  sendJson(response, 404, { error: "Not found" });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  });
});

let selectedPort = PREFERRED_PORT;
let portAttempts = 0;

server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && portAttempts < MAX_PORT_ATTEMPTS) {
    portAttempts += 1;
    selectedPort += 1;
    console.warn(`端口被占用，改用 ${selectedPort}。`);
    setTimeout(() => server.listen(selectedPort, HOST), 50);
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

server.on("listening", () => {
  const url = `http://${HOST}:${selectedPort}/?token=${TOKEN}`;
  console.log("\nSTYLE ATLAS 官方规则发布管理");
  console.log(`管理地址  ${url}`);
  console.log(`规则文件  ${MANIFEST_PATH}\n`);
  console.log("保存后请在 GitHub Desktop 提交并推送 2-规则发布。\n");
  if (!NO_OPEN && process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  }
});

server.listen(selectedPort, HOST);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
