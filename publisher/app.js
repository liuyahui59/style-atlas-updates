const state = {
  token: new URLSearchParams(window.location.search).get("token") || "",
  rules: [],
  selectedId: null,
  creating: false,
  file: "",
};

const elements = {
  ruleList: document.querySelector("#rule-list"),
  ruleCount: document.querySelector("#rule-count"),
  newRuleButton: document.querySelector("#new-rule-button"),
  downloadButton: document.querySelector("#download-button"),
  saveStatus: document.querySelector("#save-status"),
  editorEyebrow: document.querySelector("#editor-eyebrow"),
  editorTitle: document.querySelector("#editor-title"),
  ruleVersion: document.querySelector("#rule-version"),
  ruleForm: document.querySelector("#rule-form"),
  editorEmpty: document.querySelector("#editor-empty"),
  deleteRuleButton: document.querySelector("#delete-rule-button"),
  saveRuleButton: document.querySelector("#save-rule-button"),
  promptCount: document.querySelector("#prompt-count"),
  toast: document.querySelector("#toast"),
};

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "X-Rule-Publisher-Token": state.token,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `请求失败（${response.status}）`);
  }
  return response;
}

function notify(message, type = "success") {
  elements.toast.textContent = message;
  elements.toast.className = `toast is-visible is-${type}`;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => {
    elements.toast.className = "toast";
  }, 2600);
}

function selectedRule() {
  return state.rules.find((rule) => rule.id === state.selectedId) || null;
}

function applyPayload(payload) {
  state.rules = Array.isArray(payload.rules) ? payload.rules : [];
  state.file = String(payload.file || state.file || "");
  if (!state.creating && !state.rules.some((rule) => rule.id === state.selectedId)) {
    state.selectedId = state.rules[0]?.id || null;
  }
  renderList();
  elements.ruleCount.textContent = String(state.rules.length);
  elements.saveStatus.textContent = state.file ? `已保存到 ${state.file}` : "规则已保存";
  elements.downloadButton.disabled = false;
}

function renderList() {
  if (!state.rules.length) {
    elements.ruleList.innerHTML = '<div class="list-empty">还没有官方规则</div>';
    return;
  }
  elements.ruleList.innerHTML = state.rules.map((rule) => `
    <button class="rule-item${rule.id === state.selectedId && !state.creating ? " is-active" : ""}" type="button" data-rule-id="${escapeHTML(rule.id)}">
      <span class="rule-item-main">
        <strong>${escapeHTML(rule.name)}</strong>
        <small>${escapeHTML(rule.description || "暂无简介")}</small>
      </span>
      <span class="rule-item-version">v${escapeHTML(rule.version)}</span>
    </button>
  `).join("");
}

function updatePromptCount() {
  elements.promptCount.textContent = String(elements.ruleForm.elements.prompt.value.length);
}

function showRule(rule) {
  state.creating = false;
  state.selectedId = rule.id;
  elements.ruleForm.hidden = false;
  elements.editorEmpty.hidden = true;
  elements.editorEyebrow.textContent = "编辑规则";
  elements.editorTitle.textContent = rule.name;
  elements.ruleVersion.textContent = `版本 ${rule.version}`;
  elements.deleteRuleButton.hidden = false;
  elements.ruleForm.elements.name.value = rule.name;
  elements.ruleForm.elements.description.value = rule.description || "";
  elements.ruleForm.elements.prompt.value = rule.prompt;
  updatePromptCount();
  renderList();
}

function showNewRule() {
  state.creating = true;
  state.selectedId = null;
  elements.ruleForm.reset();
  elements.ruleForm.hidden = false;
  elements.editorEmpty.hidden = true;
  elements.editorEyebrow.textContent = "新增规则";
  elements.editorTitle.textContent = "未命名规则";
  elements.ruleVersion.textContent = "版本 1.0.0";
  elements.deleteRuleButton.hidden = true;
  updatePromptCount();
  renderList();
  elements.ruleForm.elements.name.focus();
}

function showEmpty() {
  state.creating = false;
  state.selectedId = null;
  elements.ruleForm.hidden = true;
  elements.editorEmpty.hidden = false;
  elements.editorEyebrow.textContent = "编辑规则";
  elements.editorTitle.textContent = "选择一条规则";
  elements.ruleVersion.textContent = "";
  renderList();
}

function pending(button, label) {
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = label;
  return () => {
    button.disabled = false;
    button.innerHTML = original;
  };
}

async function loadRules() {
  if (!state.token) throw new Error("管理地址缺少访问令牌，请重新运行管理工具。");
  const payload = await (await api("/api/rules")).json();
  applyPayload(payload);
  if (state.rules.length) showRule(state.rules[0]);
  else showEmpty();
}

elements.ruleList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-rule-id]");
  if (!button) return;
  const rule = state.rules.find((item) => item.id === button.dataset.ruleId);
  if (rule) showRule(rule);
});

elements.newRuleButton.addEventListener("click", showNewRule);
elements.ruleForm.elements.prompt.addEventListener("input", updatePromptCount);
elements.ruleForm.elements.name.addEventListener("input", () => {
  if (state.creating) elements.editorTitle.textContent = elements.ruleForm.elements.name.value.trim() || "未命名规则";
});

elements.ruleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const restore = pending(elements.saveRuleButton, "保存中…");
  const body = JSON.stringify({
    name: elements.ruleForm.elements.name.value,
    description: elements.ruleForm.elements.description.value,
    prompt: elements.ruleForm.elements.prompt.value,
  });
  try {
    const path = state.creating ? "/api/rules" : `/api/rules/${encodeURIComponent(state.selectedId)}`;
    const method = state.creating ? "POST" : "PATCH";
    const payload = await (await api(path, { method, body })).json();
    state.creating = false;
    state.selectedId = payload.rule.id;
    applyPayload(payload);
    showRule(payload.rule);
    notify(method === "POST" ? "官方规则已新增。" : "官方规则已更新，版本号已递增。");
  } catch (error) {
    notify(error.message, "error");
  } finally {
    restore();
  }
});

elements.deleteRuleButton.addEventListener("click", async () => {
  const rule = selectedRule();
  if (!rule || !window.confirm(`确定删除「${rule.name}」吗？`)) return;
  const restore = pending(elements.deleteRuleButton, "删除中…");
  try {
    const payload = await (await api(`/api/rules/${encodeURIComponent(rule.id)}`, { method: "DELETE" })).json();
    applyPayload(payload);
    if (state.rules.length) showRule(state.rules[0]);
    else showEmpty();
    notify("官方规则已删除。规则文件保留了兼容旧客户端所需的删除标记。");
  } catch (error) {
    notify(error.message, "error");
  } finally {
    restore();
  }
});

elements.downloadButton.addEventListener("click", async () => {
  const restore = pending(elements.downloadButton, "准备中…");
  try {
    const response = await api("/download");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "analysis-rules.json";
    link.click();
    URL.revokeObjectURL(url);
    notify("规则文件已下载。 ");
  } catch (error) {
    notify(error.message, "error");
  } finally {
    restore();
  }
});

loadRules().catch((error) => {
  elements.saveStatus.textContent = error.message;
  elements.saveStatus.classList.add("is-error");
  elements.downloadButton.disabled = true;
  showEmpty();
  notify(error.message, "error");
});
