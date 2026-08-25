# 站点内嵌速答适配器

站点内嵌速答采用“共享运行时 + 网站适配器”结构。共享层负责动态扫描、按钮注入、
去重、状态恢复、Toast 和 `速答 · ChatGPT` 投递；网站适配器只处理本站 DOM。

## 分层

- `src/content-modules/siteFastQaRuntime.ts`：TypeScript 共享运行时与内容契约。
- `modules/siteFastQaRuntime.js`：当前生产 manifest 实际加载的 legacy 共享运行时。
- `src/content-modules/xTweetFastQa.ts` / `modules/xTweetFastQa.js`：X 适配器。
- `src/content-modules/zhihuFastQa.ts` / `modules/zhihuFastQa.js`：知乎适配器。

共享内容契约 `SiteFastQaContent` 包含平台、内容类型、稳定来源键、最终速答输入、
正文、可选标题/永久链接和正文完整性标记。运行时用 `sourceKey` 同步同一内容的多个
按钮，并在网站重建操作栏后恢复 busy / success / error 状态。

## 新增网站

实现一个 `SiteFastQaAdapter`，只需要提供：

1. `isSupported`：严格匹配允许的域名。
2. `findRoots`：返回页面内每个独立内容根节点。
3. `extract`：只从当前根节点生成 `SiteFastQaContent`，不能混入相邻内容或评论。
4. `prepare`：可选；使用网站原生机制展开或加载全文，完成后由运行时重新提取。
5. `findActionContainer` / `insertHost`：定位操作栏并决定按钮位置。
6. `ownsElement`：存在嵌套内容时，确保按钮属于正确根节点。
7. 本站样式、无障碍文案、可见状态文字和 Toast 文案。

然后完成四处接线：

1. 在 `src/content.ts` 导入、公开并启动 TypeScript 适配器。
2. 在 `manifest.json` 中把 legacy 适配器放在 `siteFastQaRuntime.js` 之后。
3. 新增双轨专项校验，覆盖正文隔离、输入格式、URL 安全和 manifest 加载顺序。
4. 在 `scripts/verify-extension-smoke.mjs` 增加真实域名映射夹具，验证生产 build 的
   单实例注入、按钮位置、动态 DOM 重建和现有 ChatGPT fastqa 链路。

## 适配约束

- 优先使用永久链接、ARIA、`itemprop`、`data-testid` 和稳定语义类名，不依赖散列类名。
- 正文与标题必须用明确边界包装后再交给现有速答模板。
- 折叠正文不能静默当作全文发送；展开失败应显示错误并允许重试。
- 监听器必须经过 `requestAnimationFrame` 合并扫描，并用标记属性保证幂等注入。
- 当前生产仍走 legacy 内容脚本，因此 TypeScript 与 legacy 实现必须同步修改、同步测试。
