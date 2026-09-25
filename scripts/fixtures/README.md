# 测试夹具

`ccs-test-key.pem` / `ccs-test-cert.pem`：自签证书（CN=ccs-smoke-fixture，无任何线上用途），
供 `verify-extension-smoke.mjs` 的本地 HTTPS 服务器使用 —— 配合
`--host-resolver-rules` 把 www.baidu.com / www.google.com 映射到 127.0.0.1，
让"真开标签"类回归路径完全去外网化（CI 上百度反爬/网络抖动曾导致随机红）。
Chrome 以 `--ignore-certificate-errors` 启动，证书内容本身无关紧要。

这两个 pem **不进仓库**（已 gitignore）：冒烟脚本首次运行时会用 `openssl` 现生成并落在本目录，
之后复用。想重新生成直接删掉这两个文件再跑一次即可。需要 `openssl` 在 PATH 里
（macOS / Linux / Git Bash 自带）。

`golden/*.json`：SW 模块行为快照（`verify-background-utils` / `-pure-modules` / `-extras` 对照用），
由 `scripts/lib/golden.mjs` 读写。最初录自 legacy 与 TS 移植版逐项一致时的输出。行为有意变更后用
`UPDATE_GOLDEN=1 node scripts/verify-background-xxx.mjs` 刷新，提交前审一遍 diff —— 快照变了就说明用户可见行为变了。
