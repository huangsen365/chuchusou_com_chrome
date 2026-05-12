# Chrome Web Store API 自动发布参考

> 写作日期：2026-05-12（v1.6.3 release 后）
> 用途：以后想把"上传 zip + 触发发布"自动化时翻这份文档，省得每次重新查官方资料。
> 当前状态：**未实施**，仍走 devconsole 手动上架。

## TL;DR

Chrome Web Store 官方有 Publish API（v1.1），可以自动化两个动作：
1. 上传 zip 包
2. 触发发布（提交审核 / 发布到所有用户 / trustedTesters）

但 API **不能**改商店上的文案 / 截图 / 分类等列表元数据（listing metadata）—— 那部分必须手填 devconsole。

所以即使接通 API，**只能省每次发版的"拖 zip + 点 Publish"两步**，不能省"维护商店描述 / 截图"那部分。

---

## 范围划分（API 能/不能干什么）

### ✅ API 能自动化

| 动作 | 端点 | 说明 |
|---|---|---|
| 上传 zip | `PUT /upload/chromewebstore/v1.1/items/{appId}` | 替代 devconsole 拖拽 zip 的动作 |
| 触发发布 | `POST /chromewebstore/v1.1/items/{appId}/publish` | 替代 devconsole 点 "Submit for review" / "Publish" |
| 查询当前 item 状态 | `GET /chromewebstore/v1.1/items/{appId}` | 看上次审核状态 |

发布 target 参数：
- `publishTarget=default` —— 发布给所有用户（默认）
- `publishTarget=trustedTesters` —— 仅推送给信任的测试用户

### ❌ API 不能自动化（必须手填 devconsole）

| 字段 | 说明 |
|---|---|
| 扩展名称（Name） | 商店搜索标题 |
| 简短说明（Short description）| 132 字内，搜索卡片下显示 |
| 详细描述（Detailed description）| 16000 字内，详情页全文 |
| 截图（Screenshots）| 1280×800 或 640×400 |
| 宣传图（Promo tiles）| 440×280 / 1400×560 |
| 分类（Category）| 生产力 / 工具 / 等 |
| 隐私政策 URL |  |
| 单一用途声明（Single Purpose）|  |
| 权限说明（Permissions justification）| 审核员会逐项问 |
| 主页 URL / 支持邮箱 / 地区 / 定价 |  |

> Google 这么多年没开放 listing metadata 编程接口，主要是审核要看"人写的话术"，防止刷量灌词。所以 `releases/store-listing.txt` 这种**人工 SSoT** 长期都需要维护。

---

## 一次性接入步骤（≈ 30-60 分钟）

整个流程要在浏览器里登录 Google 一次，之后纯命令行。

### Step 1：Google Cloud Console 建项目 + 开 API

1. 打开 https://console.cloud.google.com
2. 新建一个项目（名字随便，例如 `chuchusou-cws-publish`）
3. 左侧 **APIs & Services → Library**
4. 搜 **Chrome Web Store API** → 点 Enable

### Step 2：创 OAuth 2.0 桌面凭证

1. **APIs & Services → Credentials**
2. **Create Credentials → OAuth client ID**
3. Application type 选 **Desktop app**
4. 名字随便（`chuchusou-cws-cli`）
5. 创建后得到 `client_id` 和 `client_secret`，下载 JSON 或复制下来

> 第一次用 OAuth 还要去 **OAuth consent screen** 把 user type 选 External（仅自己用也行），scopes 加 `https://www.googleapis.com/auth/chromewebstore`，把自己的 Gmail 加进 test users。

### Step 3：拿 `refresh_token`（一次性浏览器授权）

这一步必须有浏览器，本机或借同事的都行。三种做法：

**做法 A：手贴 URL（最稳）**

1. 在浏览器打开：
   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fchromewebstore&client_id=<你的 client_id>&redirect_uri=urn:ietf:wg:oauth:2.0:oob
   ```
2. 登录你的开发者账号（必须是 Chrome Web Store 上传过插件的那个 Gmail）→ 同意授权
3. 回调页会显示一串 `code=XXX`，复制下来
4. 终端跑：
   ```bash
   curl https://accounts.google.com/o/oauth2/token \
     -d client_id=<你的 client_id> \
     -d client_secret=<你的 client_secret> \
     -d code=<刚才那串 code> \
     -d grant_type=authorization_code \
     -d redirect_uri=urn:ietf:wg:oauth:2.0:oob
   ```
5. 响应 JSON 里的 `refresh_token` 就是要存起来的长期票据

> **注意**：`urn:ietf:wg:oauth:2.0:oob` 是 OOB（out-of-band）授权方式，2022 后 Google 标记为 deprecated 但仍可用。如果以后被关，需要换成 loopback 方式（本地起个临时 server 接 callback）。

**做法 B：用 `chrome-webstore-upload-cli` 帮你跑授权**

```bash
npm i -g chrome-webstore-upload-cli
chrome-webstore-upload init     # 交互式问 client_id / client_secret 然后浏览器弹授权
```

会把 `refresh_token` 帮你拿到，存进 `~/.chrome-webstore-upload`。

### Step 4：把三个 secret 存到 `.env`（gitignore）

```bash
# .env  ← 已在 .gitignore
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
GOOGLE_REFRESH_TOKEN=1//xxx
CWS_APP_ID=<扩展 ID，devconsole URL 末尾那串 32 位字母>
```

> `CWS_APP_ID` 在 [devconsole](https://chrome.google.com/webstore/devconsole) 进入扩展后地址栏可看到，例如 `https://chrome.google.com/webstore/devconsole/item/abcd...xyz/`。

---

## 实际调用脚本（参考）

### 用现成 CLI（最快，10 行 shell）

```bash
# package.json devDependencies 加
npm i -D chrome-webstore-upload-cli

# scripts/cws-publish.sh
#!/usr/bin/env bash
set -e
source .env
VERSION=$(jq -r .version manifest.json)
ZIP_PATH="../chuchusou_chrome_extension_v${VERSION}.zip"

npx chrome-webstore-upload upload \
  --source "$ZIP_PATH" \
  --extension-id "$CWS_APP_ID" \
  --client-id "$GOOGLE_CLIENT_ID" \
  --client-secret "$GOOGLE_CLIENT_SECRET" \
  --refresh-token "$GOOGLE_REFRESH_TOKEN"

npx chrome-webstore-upload publish \
  --extension-id "$CWS_APP_ID" \
  --client-id "$GOOGLE_CLIENT_ID" \
  --client-secret "$GOOGLE_CLIENT_SECRET" \
  --refresh-token "$GOOGLE_REFRESH_TOKEN"
```

### 用纯 curl（不想加依赖）

```bash
# Step 1: 用 refresh_token 换 access_token
ACCESS_TOKEN=$(curl -s https://www.googleapis.com/oauth2/v4/token \
  -d "client_id=$GOOGLE_CLIENT_ID" \
  -d "client_secret=$GOOGLE_CLIENT_SECRET" \
  -d "refresh_token=$GOOGLE_REFRESH_TOKEN" \
  -d "grant_type=refresh_token" | jq -r .access_token)

# Step 2: 上传 zip
curl -s -X PUT \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "x-goog-api-version: 2" \
  -T "$ZIP_PATH" \
  "https://www.googleapis.com/upload/chromewebstore/v1.1/items/$CWS_APP_ID"

# Step 3: 触发发布
curl -s -X POST \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "x-goog-api-version: 2" \
  -H "Content-Length: 0" \
  "https://www.googleapis.com/chromewebstore/v1.1/items/$CWS_APP_ID/publish"
```

> `access_token` 有 1 小时有效期，每次发版重新换一次即可。`refresh_token` 一般不过期，除非你在 Google Account 安全页主动撤销。

---

## 嵌入 `/release` skill 的位置

如果将来要做，在 `.claude/skills/release/SKILL.md` 的 **Step 10**（上架商店）替换为：

```bash
./scripts/cws-publish.sh
```

放在 `git push --tags` 之后，跑成功了就完事；失败了人工 fallback 到 devconsole。

---

## 风险与注意事项

- **`publish` 调用 = 提交审核**，不是直接上线。审核仍要 24h - 7 天（取决于变更类型）。
- **同一版本号不能重复上传**：API 会返回 400。先 bump 版本再跑脚本。
- **listing metadata 仍要 devconsole**：如果你这一版改了商店描述（像 v1.6.2 那样加 SEO 关键字），脚本只能传 zip，描述还得手填。
- **`refresh_token` 是高敏感凭据**：泄露等于把发版权交出去。**永远不要提交到 git**，建议存 1Password 或 macOS Keychain，`.env` 加 600 权限。
- **OOB 授权方式可能被弃用**：2022 后 Google 公告说要逐步关 OOB（`urn:ietf:wg:oauth:2.0:oob`）。被关的话改用 loopback redirect（本地 `http://127.0.0.1:8080/oauth2callback`）。
- **多账户场景**：如果上传账号不是项目所有者，要先在 devconsole 把那个账号加为 collaborator。

---

## 参考资料

- 官方文档：https://developer.chrome.com/docs/webstore/using-api
- API Reference：https://developer.chrome.com/docs/webstore/api
- CLI 工具：https://github.com/fregante/chrome-webstore-upload-cli
- Node SDK（如果想直接用 JS）：https://github.com/fregante/chrome-webstore-upload

---

## 决策记录（为什么 v1.6.3 还没接）

- 单人项目，发版频率低（每周 0-3 次）
- 实际能省的就是「拖 zip + 点 Publish」两步，约 30 秒
- 接入要 30-60 分钟 + 三个 secret 长期维护
- 真正费时间的是「写 store-listing.txt 文案 + 跑截图」，API 解决不了

**结论**：现在不接，将来如果发版频率涨到每周 5+ 次（或加了 trustedTesters 内测渠道）再回头来读这份文档实施。
