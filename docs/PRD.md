# Comux

## **1. 專案目標**

Comux 旨在打造一個高度整合的 AI 開發與運維（AI-Ops）平台。透過封裝 **Claude Code (Max Plan)**、**Tmux** 與 **Cloud API**，實現跨裝置（手機/桌面）的持久化開發環境。其核心價值在於「知識與憑證解耦」，讓 AI Agent 能在受控的環境下，自主完成從代碼開發到基礎設施部署的全流程工作。

---

## **2. 系統架構與網路設計**

- **基礎設施**：基於 **GCP VM** 建立獨立開發環境。
- **網路層**：使用 **Tailscale** 建立零信任內網（Zero Trust），所有開發機、Stage 及 Production 環境僅透過私有網格互聯，不對公網開放。
- **訪問控制**：Web UI 限制僅能由 Tailscale 內網存取，並整合 GCP IAP 或 SSO MFA 驗證，確保行動端連線安全且簡便。

---

## **3. 核心功能模組**

### **A. Session 持久化管理 (Persistent Layer)**

- **技術實作**：利用 libtmux 管理後端 Session，前端透過 Xterm.js 進行終端渲染。
- **跨裝置同步**：支援手機與電腦無縫切換，AI 執行長任務時（如跑測試或部署）不因斷線而中斷。

### **B. AI Agent 整合與指令攔截**

- **核心引擎**：原生驅動 Claude Code CLI。
- **安全護欄 (Guardrails)**：Comux 後端實時監控終端輸出入。針對 rm -rf, gcloud delete, cf-delete 等高風險指令，強制觸發 Web UI 人工確認。

### **C. Web IDE 與 記憶層 (Memory Layer)**

- **編輯器**：整合 **Monaco Editor**，支援專案檔案即時編輯與自動儲存。
- **知識庫**：
  - **.claudedoc/ (進版控)**：顯性化專案知識（如 Docker 版本限制、特定語法禁忌、維運標準手冊）。
  - **AI 記憶導向**：自動將 .claudedoc/ 內容作為 System Prompt 注入 Claude Code。

### **D. 自動化運維與資源管理 (AI-Ops)**

- **環境對照表 (Inventory)**：維護專案、開發機 IP、容器名稱、網域之映射關係資料庫。
- **Cloud API 整合**：
  - **Cloudflare**：動態建立 DNS 指向，管理 \*.dev 網域。
  - **GCP CLI**：透過封裝指令，讓 AI 能動態建立 VM、部署 Cloud Run。
- **憑證管理 (Vault)**：由 Comux 管理 API Token 與 SSH Key，動態注入環境變數，禁止代碼目錄出現明文憑證。

---

## **4. 數據與知識組織規範**

| **目錄/組件**         | **版控狀態** | **內容與用途**                                         |
| --------------------- | ------------ | ------------------------------------------------------ |
| **.claudedoc/**       | **進入版控** | 專案規格、部署 Metadata、AI 指令範本。                 |
| **.comux/**          | **進入版控** | 標準化部署腳本（使用變數而非寫死資訊）。               |
| **.claudecodeignore** | **進入版控** | 排除 refs/、敏感 Log、個人臨時筆記。                   |
| **Vault (系統級)**    | **不進版控** | 儲存 Cloudflare Token, GCP Service Account, SSH Keys。 |

---

## **5. 工作流 (Workflow)**

1. **初始化**：開發者開起 Session，Comux 從 Vault 注入該專案所需的 SSH Key 與 API Token。
2. **AI 開發**：透過 Comux 操作 Claude Code，AI 參考 .claudedoc/ 規範進行開發與本地測試。
3. **基礎設施操作**：指令如「幫我開一個新的測試環境」，Comux 調用 gcloud 與 Cloudflare 腳本並要求開發者點擊「確認」。
4. **提交與弱掃**：
   - 開發者發起 PR。
   - CI 自動觸發 **Semgrep** (SAST) 與 **Gitleaks** 掃描。
5. **部署與驗收**：非工程同事部署至 Stage 驗收，確認無誤後由工程部合併至 Main 部署 Production。

---

## **6. 待辦事項 (Todo List)**

### **階段一：基礎設施與安全性 (Week 1-2)**

- [ ] 建立 GCP VM 模板（內建 Tailscale, Docker, gcloud, Claude Code）。
- [ ] 實作 Comux 後端與 Tmux 的 API 對接（啟動、重連、關閉）。
- [ ] 配置 Tailscale 與防火牆，確保 Web UI 僅內網可見。

### **階段二：編輯器與知識庫 (Week 3)**

- [ ] 整合 Monaco Editor 與 Web 檔案瀏覽器。
- [ ] 實作 .claudedoc/ 自動索引功能，將其內容自動與 Claude 對話上下文關聯。
- [ ] 實作 Vault 模組，加密存儲 Cloudflare 與 GCP 憑證。

### **階段三：自動化運維 (Week 4+)**

- [ ] 編寫 Cloudflare DNS 動態更新之封裝腳本。
- [ ] 建立專案對照表 (SQLite/YAML)，實現專案與主機的一鍵關聯查詢。
- [ ] 在 Web UI 增加「高風險指令確認」彈窗機制。

---

## **7. 注意事項**

- **成本控制**：建立 GCP 資源自動關閉機制（預設閒置 4 小時關機）。
- **數據隱私**：務必檢查並關閉所有開發者帳號的「AI 模型訓練」選項。
- **手機適配**：針對終端操作設計「快捷常用鍵」列，提升行動端操作體驗。

ref: https://github.com/windmill-labs/comux 這個要做的事好像跟我們系統想做的很像

## 加入 Tailscale:

安裝: 
curl -fsSL https://tailscale.com/install.sh | sh

例如:
sudo tailscale up --ssh --advertise-tags=tag:your-app
sudo tailscale up --ssh --advertise-tags=tag:your-app-gcp

但有時候容器沒有立即反應，此時改為執行:
sudo tailscale up --ssh --force-reauth

通常就會立即可以通過授權，此時再到 Tailscale 後台找到這台vm再編輯 ACL Tags，勾選要設定的tag就好了
