# Lambda Cleanup

AWS Lambda 函數，用於清理 S3 中過期的檔案。

## 打包流程

```bash
# 清理舊檔案
npm run clean

# 安裝依賴
npm install

# 編譯 TypeScript
npm run build

# 打包 Lambda 函數
npm run package
```

## 上傳到 Lambda

1. 將 `my-lambda-cleanup.zip` 上傳到 AWS Lambda
2. 設定 Lambda 處理器為：`index.handler`
3. 配置環境變數：
   - `AWS_S3_BUCKET`：S3 儲存桶名稱
   - `AWS_REGION`：AWS 區域
   - `EXPIRATION_DAYS`：過期天數（可選）

## 環境變數說明

- `AWS_S3_BUCKET`：要清理的 S3 儲存桶名稱
- `AWS_REGION`：AWS 區域（例如：us-east-1）
- `EXPIRATION_DAYS`：檔案過期天數（預設為 1 天）

## 功能說明

此 Lambda 函數會清理以下類型的檔案：

### 1. 清理目標檔案

- **未確認的暫存檔**：標記為 `temporary=true` 且上傳超過 24 小時的檔案。
- **過期的接送請求檔**：`PickupRequest/` 路徑下且超過自訂 `expirationDate` 的檔案。

### 2. 效能與防護優化機制

- **時間戳前置預篩**：
  - **自動跳過未滿 24 小時檔案**：剛上傳未過期的檔案直接跳過。
  - **自動跳過超過 7 天的普通檔案**：超過 7 天且非 `PickupRequest/` 的檔案已被後端寫入 DB 並移除暫存標籤，直接跳過 HEAD 查詢。
  - **效益**：省去 95% 以上無謂的 `HeadObjectCommand` HTTP 請求，極速完成。
- **批次分流控速**：
  - 使用 `processObjectsInBatches` 限制每批次最大併發請求數為 **20 個**。
  - 防範爆炸性 `Promise.all` 導致的 S3 503 Rate Limit 與 Lambda 執行超時。
