# style atlas updates

这是 style atlas 客户端使用的公开更新仓库，负责维护和发布官方分析规则、软件更新清单和 GitHub Release 安装包。这里不包含客户端程序源代码或用户数据。

## 内容

- `official-rules/analysis-rules.json`：客户端可联网更新的官方分析规则。
- `releases/app-update.json`：客户端用于检查软件版本和获取 DMG 下载地址的更新清单。
- `管理官方规则.command`：发行方本机使用的规则编辑入口。
- `publisher/`、`scripts/`、`src/`：独立规则管理器及规则校验逻辑，不含客户端源码。
- GitHub Releases：经过发布者校验的 macOS DMG 安装包。

## 编辑和发布规则

1. 双击 `管理官方规则.command`。工具会优先使用已安装 style atlas 内置的 Node.js，也可以使用系统 Node.js 24 或更高版本。
2. 在打开的本机页面中新增、修改或删除规则；保存会直接更新 `official-rules/analysis-rules.json`。
3. 在 GitHub Desktop 中选择本仓库，检查差异后提交并推送。
4. 客户端检查规则更新时会从本仓库读取最新清单。

也可以在终端运行 `npm run manage`。`npm run validate` 会检查管理器语法、规则版本及 SHA-256 逻辑。

规则管理页只监听 `127.0.0.1`，每次启动生成临时访问令牌。客户端只以只读方式访问这里公开的 HTTPS 规则文件。

## 软件更新

软件更新清单由私有源码仓库的 `npm run distribution:sync` 写入 `releases/app-update.json`。安装包放在本仓库的 GitHub Releases 中，不直接提交到 Git 历史。
