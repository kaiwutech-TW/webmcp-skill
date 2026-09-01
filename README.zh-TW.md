# webmcp-skill（繁體中文）

**教你的 coding agent 把網站接上 [WebMCP](https://github.com/webmachinelearning/webmcp) 的
agent skill**——從一套真的在線上被 agent 操作的 ERP（E-ternal）實戰經驗蒸餾而成。

## 這是什麼

WebMCP 讓網頁把「工具」註冊給使用者帶來的瀏覽器 AI（ChatGPT 內建瀏覽器、新版 Chrome）——
AI 不再隔著螢幕亂點，而是直接呼叫網站開放的功能；人與 AI 看同一個畫面、用同一個登入身分。

這個 repo 是給**開發者的 AI 助理**讀的 playbook：裝好之後，對 Claude Code（或任何支援
Agent Skills 格式的工具）說「幫這個網站加上 WebMCP」，它就會照著我們驗證過的做法蓋。

## 內容

- `skills/webmcp-integration/SKILL.md`——完整 playbook（英文，為模型而寫）：
  - API 實況速查（**兩個入口都要認**：ChatGPT 用 `document.modelContext`、Chrome 用 `navigator.modelContext`）
  - 六個實際踩過的瀏覽器陷阱（例：**瀏覽器不會幫你驗參數**、Chrome 151 沒有 `unregisterTool`）
  - 五道結構性防線：紅線做在註冊層（危險工具「不存在」）、中央驗參＋結構化拒絕、
    不可信文字隔離圍欄（防 prompt injection）、送出冪等、schema 即活的邊界
  - 人類簽核閘、讓 agent 走得順的細節、測試到 CI 級證據的做法
- `references/templates/`——四支可直接複製的 TypeScript 起手式（MIT、無框架依賴）

## 安裝（Claude Code）

```bash
git clone https://github.com/kaiwutech-TW/webmcp-skill
cp -r webmcp-skill/skills/webmcp-integration ~/.claude/skills/
```

## 出處與實證

為 2026 OpenAI WebMCP Challenge 打造，母體是開源 ERP
[E-ternal](https://github.com/kaiwutech-TW/e-ternal-public)。
線上展示：<https://et-demo.kaiwu.com.tw>（帳號 `judge`／密碼 `webmcp-judge`）·
[兩分鐘影片](https://youtu.be/iiRdpZtWoyk)。playbook 裡每一條防線在母體 repo 都有對應測試。

想讓自己的網站或內部系統「接得住 AI」？這正是[凱吳科技](https://kaiwu.com.tw)在做的事。

MIT © 2026 Kaiwu Tech
