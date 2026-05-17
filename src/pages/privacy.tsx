/**
 * Plasmo page: privacy.html (隐私权政策)
 *
 * Phase 7 起步示例 —— 把 legacy privacy.html 改写为 React entry。
 * 本文件不替换生产 privacy.html；生产仍由 build.sh 复制 legacy 文件。
 * Plasmo build 输出会同时存在 src 出的 privacy.html 与 legacy 拷贝的同名文件，
 * 后者由 postbuild 覆盖（保持兼容直到 entrypoint 正式切换）。
 *
 * 内容与 legacy 中英双语策略 1:1 对齐。
 */

import { useState } from "react"

const LAST_UPDATED_ZH = "2025年11月"
const LAST_UPDATED_EN = "January 2025"
const EMAIL_BASE64 = "c3VwcG9ydEBjaHVjaHVzb3UuY29t"

type Lang = "zh" | "en"

interface Section {
  zh: { heading: string; body: React.ReactNode }
  en: { heading: string; body: React.ReactNode }
}

const SECTIONS: Section[] = [
  {
    zh: {
      heading: "1. 信息收集与使用",
      body: (
        <>
          <h3>1.1 我们不收集的信息</h3>
          <p>触触搜扩展程序<strong>不会收集、存储或传输</strong>以下任何信息：</p>
          <ul>
            <li>您的浏览历史记录</li>
            <li>您访问的网站URL（除非您主动使用搜索功能）</li>
            <li>您选中或处理的文本内容</li>
            <li>剪贴板中的任何数据</li>
            <li>个人身份信息（姓名、邮箱、电话等）</li>
            <li>任何其他个人隐私数据</li>
          </ul>
          <h3>1.2 本地存储的数据</h3>
          <p>以下数据仅保存在您的浏览器本地存储中，不会上传到任何服务器：</p>
          <ul>
            <li><strong>用户设置</strong>：包括快捷键配置、搜索引擎偏好、界面显示选项等</li>
            <li><strong>黑名单设置</strong>：您添加的不希望显示悬浮菜单的网站列表</li>
            <li><strong>功能开关状态</strong>：各项功能的启用/禁用状态</li>
          </ul>
          <p>这些数据仅用于保持您的个性化设置，您可以随时通过卸载扩展来清除所有本地数据。</p>
        </>
      )
    },
    en: {
      heading: "1. Information Collection and Use",
      body: (
        <>
          <h3>1.1 What We DO NOT Collect</h3>
          <p>ChuchuSou extension <strong>does NOT collect, store, or transmit</strong> any of the following:</p>
          <ul>
            <li>Your browsing history</li>
            <li>Website URLs you visit (unless you actively use search functions)</li>
            <li>Text content you select or process</li>
            <li>Any data from your clipboard</li>
            <li>Personal identification information (name, email, phone, etc.)</li>
            <li>Any other personal privacy data</li>
          </ul>
          <h3>1.2 Local Storage Data</h3>
          <p>The following data is stored only in your browser's local storage and never uploaded to any server:</p>
          <ul>
            <li><strong>User Settings</strong>: Including keyboard shortcuts, search engine preferences, UI display options, etc.</li>
            <li><strong>Blacklist Settings</strong>: List of websites where you don't want the floating menu to appear</li>
            <li><strong>Feature Toggle States</strong>: Enable/disable status of various features</li>
          </ul>
          <p>This data is only used to maintain your personalized settings. You can clear all local data at any time by uninstalling the extension.</p>
        </>
      )
    }
  },
  {
    zh: {
      heading: "2. 权限使用说明",
      body: (
        <>
          <p>触触搜请求以下权限仅用于实现核心功能，具体用途如下：</p>
          <h3>2.1 activeTab（活动标签页）</h3>
          <p>用于读取当前标签页中用户主动选中的文本、页面标题和URL信息，这是实现智能关键词提取的基础。</p>
          <h3>2.2 clipboardWrite（剪贴板写入）</h3>
          <p>当您点击"复制"或"剪切"按钮时，将处理后的文本写入系统剪贴板。</p>
          <h3>2.3 clipboardRead（剪贴板读取）</h3>
          <p>支持读取剪贴板内容进行Base64、URL等编解码操作（仅在您主动使用相关功能时）。</p>
          <h3>2.4 storage（本地存储）</h3>
          <p>保存您的个性化设置和偏好配置到浏览器本地存储（chrome.storage.local），确保设置持久化。</p>
          <h3>2.5 contextMenus（右键菜单）</h3>
          <p>在右键菜单中添加快捷搜索选项，显示智能提取的关键词。</p>
          <h3>2.6 scripting（脚本注入）</h3>
          <p>向网页注入内容脚本以检测文本选择事件和显示悬浮菜单。</p>
          <h3>2.7 主机权限（&lt;all_urls&gt;）</h3>
          <p>需要在所有网页上工作以提供统一的文本处理体验。该权限仅用于：</p>
          <ul>
            <li>检测用户主动选中的文本</li>
            <li>从搜索引擎URL中提取关键词（如百度、Google等）</li>
            <li>显示悬浮菜单和处理用户交互</li>
          </ul>
          <p><strong>重要说明：</strong>我们不会访问、读取或修改任何用户未主动选择的页面内容。</p>
        </>
      )
    },
    en: {
      heading: "2. Permission Usage",
      body: (
        <>
          <p>ChuchuSou requests the following permissions solely for core functionality:</p>
          <h3>2.1 activeTab</h3>
          <p>Used to read user-selected text, page title, and URL information from the current tab for intelligent keyword extraction.</p>
          <h3>2.2 clipboardWrite</h3>
          <p>Writes processed text to the system clipboard when you click "Copy" or "Cut" buttons.</p>
          <h3>2.3 clipboardRead</h3>
          <p>Reads clipboard content for Base64, URL encoding/decoding operations (only when you actively use these features).</p>
          <h3>2.4 storage</h3>
          <p>Saves your personalized settings and preferences to browser's local storage (chrome.storage.local) for persistence.</p>
          <h3>2.5 contextMenus</h3>
          <p>Adds quick search options to the context menu, displaying intelligently extracted keywords.</p>
          <h3>2.6 scripting</h3>
          <p>Injects content scripts into web pages to detect text selection events and display floating menus.</p>
          <h3>2.7 Host Permissions (&lt;all_urls&gt;)</h3>
          <p>Required to work on all web pages to provide a consistent text processing experience. This permission is only used for:</p>
          <ul>
            <li>Detecting user-selected text</li>
            <li>Extracting keywords from search engine URLs (Baidu, Google, etc.)</li>
            <li>Displaying floating menus and handling user interactions</li>
          </ul>
          <p><strong>Important Note:</strong> We do not access, read, or modify any page content that users have not actively selected.</p>
        </>
      )
    }
  },
  {
    zh: {
      heading: "3. 第三方服务",
      body: (
        <>
          <p>当您使用搜索或AI对话功能时，您将被重定向到以下第三方服务：</p>
          <ul>
            <li><strong>搜索引擎</strong>：百度、Google、必应、知乎、京东、淘宝等</li>
            <li><strong>AI服务</strong>：ChatGPT（OpenAI）、Claude（Anthropic）、通义千问、文心一言等</li>
            <li><strong>翻译服务</strong>：百度翻译、Google翻译</li>
          </ul>
          <p>触触搜仅将您选中的文本作为URL参数传递给这些服务。这些第三方服务有各自的隐私政策，请您在使用前查阅：</p>
          <ul>
            <li>OpenAI 隐私政策：<a href="https://openai.com/privacy" target="_blank" rel="noopener noreferrer">https://openai.com/privacy</a></li>
            <li>Anthropic 隐私政策：<a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer">https://www.anthropic.com/privacy</a></li>
            <li>Google 隐私政策：<a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">https://policies.google.com/privacy</a></li>
          </ul>
        </>
      )
    },
    en: {
      heading: "3. Third-Party Services",
      body: (
        <>
          <p>When you use search or AI conversation features, you will be redirected to the following third-party services:</p>
          <ul>
            <li><strong>Search Engines</strong>: Baidu, Google, Bing, Zhihu, JD, Taobao, etc.</li>
            <li><strong>AI Services</strong>: ChatGPT (OpenAI), Claude (Anthropic), Tongyi Qianwen, Wenxin Yiyan, etc.</li>
            <li><strong>Translation Services</strong>: Baidu Translate, Google Translate</li>
          </ul>
          <p>ChuchuSou only passes your selected text as URL parameters to these services. These third-party services have their own privacy policies. Please review them before use:</p>
          <ul>
            <li>OpenAI Privacy Policy: <a href="https://openai.com/privacy" target="_blank" rel="noopener noreferrer">https://openai.com/privacy</a></li>
            <li>Anthropic Privacy Policy: <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer">https://www.anthropic.com/privacy</a></li>
            <li>Google Privacy Policy: <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">https://policies.google.com/privacy</a></li>
          </ul>
        </>
      )
    }
  },
  {
    zh: {
      heading: "4. 数据安全",
      body: (
        <>
          <p>由于所有数据处理都在您的本地设备完成，触触搜不涉及任何数据传输或云端存储，因此：</p>
          <ul>
            <li>您的数据不会面临服务器泄露风险</li>
            <li>没有任何第三方可以访问您的使用数据</li>
            <li>您的隐私完全掌握在自己手中</li>
          </ul>
        </>
      )
    },
    en: {
      heading: "4. Data Security",
      body: (
        <>
          <p>Since all data processing is completed on your local device, ChuchuSou does not involve any data transmission or cloud storage. Therefore:</p>
          <ul>
            <li>Your data is not at risk of server breaches</li>
            <li>No third party can access your usage data</li>
            <li>Your privacy is completely in your own hands</li>
          </ul>
        </>
      )
    }
  },
  {
    zh: {
      heading: "5. 用户权利",
      body: (
        <>
          <p>您拥有以下权利：</p>
          <ul>
            <li><strong>访问权</strong>：通过扩展设置页面查看所有保存的配置</li>
            <li><strong>删除权</strong>：随时通过设置重置或卸载扩展来清除所有本地数据</li>
            <li><strong>控制权</strong>：完全控制扩展的启用/禁用以及各项功能的使用</li>
          </ul>
        </>
      )
    },
    en: {
      heading: "5. User Rights",
      body: (
        <>
          <p>You have the following rights:</p>
          <ul>
            <li><strong>Access Right</strong>: View all saved configurations through the extension settings page</li>
            <li><strong>Deletion Right</strong>: Clear all local data at any time by resetting settings or uninstalling the extension</li>
            <li><strong>Control Right</strong>: Full control over enabling/disabling the extension and using various features</li>
          </ul>
        </>
      )
    }
  },
  {
    zh: {
      heading: "6. 儿童隐私",
      body: (
        <p>触触搜不会主动收集任何用户的个人信息，包括未满13岁的儿童。如果您是家长并认为您的孩子在使用本扩展，请放心，我们不会收集任何个人数据。</p>
      )
    },
    en: {
      heading: "6. Children's Privacy",
      body: (
        <p>ChuchuSou does not actively collect personal information from any user, including children under 13. If you are a parent and believe your child is using this extension, rest assured that we do not collect any personal data.</p>
      )
    }
  },
  {
    zh: {
      heading: "7. 隐私政策更新",
      body: (
        <p>我们可能会不定期更新本隐私政策。任何更改将在此页面发布，重大变更会在扩展更新说明中通知用户。建议您定期查看本政策以了解最新信息。</p>
      )
    },
    en: {
      heading: "7. Privacy Policy Updates",
      body: (
        <p>We may update this privacy policy from time to time. Any changes will be posted on this page, and significant changes will be communicated in the extension update notes. We recommend reviewing this policy regularly for the latest information.</p>
      )
    }
  }
]

const CORE_COMMITMENT_ZH =
  "触触搜扩展程序高度重视您的隐私。所有数据处理均在您的本地设备上完成，我们不会收集、存储或上传您的任何个人数据。"
const CORE_COMMITMENT_EN =
  "ChuchuSou extension highly values your privacy. All data processing is done locally on your device. We do not collect, store, or upload any of your personal data."

function PrivacyPage() {
  const [lang, setLang] = useState<Lang>("zh")
  const [email, setEmail] = useState<string | null>(null)

  const showEmail = () => {
    setEmail(atob(EMAIL_BASE64))
  }

  const styles = `
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; line-height:1.8; color:#333; background:linear-gradient(135deg,#0ea5e9 0%,#0284c7 100%); padding:20px; min-height:100vh; }
    .container { max-width:900px; margin:0 auto; background:white; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,0.3); overflow:hidden; }
    .header { background:linear-gradient(135deg,#0ea5e9,#0284c7); color:white; padding:40px; text-align:center; }
    .header h1 { font-size:2em; margin-bottom:10px; }
    .header p { opacity:0.9; }
    .content { padding:40px; }
    .lang-toggle { display:flex; justify-content:center; gap:8px; margin-bottom:24px; }
    .lang-toggle button { padding:8px 24px; border:1.5px solid #0ea5e9; background:white; color:#0ea5e9; border-radius:24px; cursor:pointer; font-weight:600; transition:all 0.2s; }
    .lang-toggle button.active { background:#0ea5e9; color:white; }
    h2 { font-size:1.4em; color:#0284c7; margin:32px 0 12px; }
    h3 { font-size:1.1em; color:#0369a1; margin:20px 0 8px; }
    p { margin:8px 0; }
    ul { margin:8px 0 8px 24px; }
    li { margin:4px 0; }
    a { color:#0284c7; text-decoration:none; }
    a:hover { text-decoration:underline; }
    .highlight { background:#e0f2fe; border-left:4px solid #0ea5e9; padding:16px 20px; border-radius:0 8px 8px 0; margin:16px 0; }
    .footer { background:#f1f5f9; padding:24px 40px; text-align:center; color:#475569; }
  `

  return (
    <html lang={lang === "zh" ? "zh-CN" : "en"}>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>触触搜 - 隐私权政策 Privacy Policy</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </head>
      <body>
        <div className="container">
          <div className="header">
            <h1>{lang === "zh" ? "隐私权政策" : "Privacy Policy"}</h1>
            <p>{lang === "zh" ? "触触搜 ChuchuSou Chrome 扩展" : "ChuchuSou Chrome Extension"}</p>
          </div>

          <div className="content">
            <div className="lang-toggle">
              <button onClick={() => setLang("zh")} className={lang === "zh" ? "active" : ""}>
                中文
              </button>
              <button onClick={() => setLang("en")} className={lang === "en" ? "active" : ""}>
                English
              </button>
            </div>

            <div className="highlight">
              <p>
                <strong>{lang === "zh" ? "核心承诺：" : "Core Commitment: "}</strong>
                {lang === "zh" ? CORE_COMMITMENT_ZH : CORE_COMMITMENT_EN}
              </p>
            </div>

            {SECTIONS.map((s, i) => (
              <div key={i}>
                <h2>{s[lang].heading}</h2>
                {s[lang].body}
              </div>
            ))}

            <h2>{lang === "zh" ? "8. 联系我们" : "8. Contact Us"}</h2>
            <ul>
              <li>
                {lang === "zh" ? "官方网站：" : "Official Website: "}
                <a href="https://chuchusou.com" target="_blank" rel="noopener noreferrer">
                  https://chuchusou.com
                </a>
              </li>
              <li>
                {lang === "zh" ? "电子邮箱：" : "Email: "}
                {email ? (
                  <a href={`mailto:${email}`}>{email}</a>
                ) : (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      showEmail()
                    }}
                  >
                    {lang === "zh" ? "点击显示邮箱" : "Click to show email"}
                  </a>
                )}
              </li>
            </ul>

            <div className="highlight">
              <p>
                <strong>{lang === "zh" ? "最后更新日期：" : "Last Updated: "}</strong>
                {lang === "zh" ? LAST_UPDATED_ZH : LAST_UPDATED_EN}
              </p>
            </div>
          </div>

          <div className="footer">
            <p>
              <strong>触触搜 ChuchuSou</strong> - {lang === "zh" ? "轻触即搜，一触即达" : "Touch to Search"}
            </p>
          </div>
        </div>
      </body>
    </html>
  )
}

export default PrivacyPage
