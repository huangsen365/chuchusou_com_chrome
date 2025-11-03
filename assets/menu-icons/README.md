# Menu Icons

Place extension-local context-menu icons here. Preferred sizes: **16x16** or **32x32** PNG/WebP with transparent background.

File naming suggestion: `<menu-id>-16.png` (e.g. `ccs-google-16.png`). Update `config/menuIcons.json` to reference the local file.

## Known limitation (Chrome)

- Chrome 的右键菜单图标 API（`contextMenus.update({ icons })`）目前在部分系统/频道处于实验状态。
- 即使传入 `ImageData` 或扩展内资源 URL，Chrome 稳定版在很多情况下不会显示二级菜单项的图标。
- 代码已经实现了读取本地/远程 favicon、转成 `ImageData` 并调用 `chrome.contextMenus.update`。若将来 Chromium 放开限制即可直接生效。
- 若必须显示图标，可考虑：
  1. 只对顶层菜单项测试（某些平台支持）；
  2. 在页面上用内容脚本渲染自定义浮动面板/按钮；
  3. 关注 Chromium bug（例如 crbug.com/1148282）后续进展。
