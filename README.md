```
npx tsc
cd dist
zip -r ../my-lambda-cleanup.zip index.js
cd ..
zip -r my-lambda-cleanup.zip node_modules
```

打包上傳 Lambda
配置環境變數 Configuration(組態) > Environment variables
AWS_S3_BUCKET
AWS_REGION
EXPIRATION_DAYS
