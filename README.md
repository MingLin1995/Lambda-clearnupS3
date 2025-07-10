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

1. 標記為 `temporary=true` 且超過指定天數的檔案
2. `PickupRequest/` 路徑下且超過 `expirationDate` 的檔案
