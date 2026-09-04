#!/bin/zsh

set -eu

PROJECT_DIR="${0:A:h}"
cd "${PROJECT_DIR}"

NODE_BINARY="${PROJECT_DIR}/runtime/node"
if [[ ! -x "${NODE_BINARY}" ]]; then
  NODE_BINARY="/Applications/style atlas.app/Contents/Resources/style-atlas/runtime/node"
fi
if [[ ! -x "${NODE_BINARY}" ]]; then
  NODE_BINARY="$(command -v node || true)"
fi

if [[ -z "${NODE_BINARY}" ]]; then
  print -u2 -- "无法启动规则管理：未找到 Node.js。"
  print -u2 -- "请先安装 style atlas，或安装 Node.js 24 及以上版本。"
  read -k 1 "?按任意键关闭窗口。"
  exit 1
fi

exec "${NODE_BINARY}" scripts/rule-publisher.mjs
