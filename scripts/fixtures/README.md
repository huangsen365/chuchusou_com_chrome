# 测试夹具

`ccs-test-key.pem` / `ccs-test-cert.pem`：自签证书（CN=ccs-smoke-fixture，无任何线上用途），
供 `verify-extension-smoke.mjs` 的本地 HTTPS 服务器使用 —— 配合
`--host-resolver-rules` 把 www.baidu.com / www.google.com 映射到 127.0.0.1，
让"真开标签"类回归路径完全去外网化（CI 上百度反爬/网络抖动曾导致随机红）。
Chrome 以 `--ignore-certificate-errors` 启动，证书内容本身无关紧要。

这两个 pem **不进仓库**（已 gitignore）：冒烟脚本首次运行时会用 `openssl` 现生成并落在本目录，
之后复用。想重新生成直接删掉这两个文件再跑一次即可。需要 `openssl` 在 PATH 里
（macOS / Linux / Git Bash 自带）。
