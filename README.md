# style atlas updates

这是 style atlas 客户端使用的公开更新仓库，只发布官方分析规则成品、软件更新清单和 GitHub Release 安装包，不包含程序源码、规则管理器或用户数据。

## 内容

- `official-rules/analysis-rules.json`：客户端可联网更新的官方分析规则。
- `releases/app-update.json`：客户端用于检查软件版本和获取 DMG 下载地址的更新清单。
- GitHub Releases：经过发布者校验的 macOS DMG 安装包。

规则与更新清单由发行方本地工具生成；管理工具不纳入本仓库版本控制。客户端只以只读方式访问这里的 HTTPS 文件。
