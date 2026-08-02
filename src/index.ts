import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Handler } from "aws-lambda";
import { NodeHttpHandler } from "@aws-sdk/node-http-handler";
import { Agent } from "https";

// 初始化 S3
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  requestHandler: new NodeHttpHandler({
    httpsAgent: new Agent({ keepAlive: false }),
  }),
});
const oneDayInMs = 24 * 60 * 60 * 1000; // 一天

export const handler: Handler = async (event: any, context: any) => {
  context.callbackWaitsForEmptyEventLoop = false;
  console.log("Lambda handler start");
  try {
    const totalDeletedObjects = await processAllObjects();
    console.log("Lambda handler success");
    return {
      statusCode: 200,
      body: JSON.stringify(`清理完成，總共刪除 ${totalDeletedObjects} 個檔案`),
    };
  } catch (error) {
    console.error("清理過期文件時出錯:", error);
    return {
      statusCode: 500,
      body: JSON.stringify("發生錯誤"),
    };
  }
};

/**
 * 處理 S3 存儲桶中的所有物件
 * @returns 刪除的物件總數
 */

async function processAllObjects(): Promise<number> {
  console.log("processAllObjects start");
  const bucketName = process.env.AWS_S3_BUCKET as string;
  let totalDeletedObjects = 0;
  let continuationToken: string | undefined;
  try {
    // 分頁處理
    do {
      const listObjectsResponse = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          ContinuationToken: continuationToken,
        })
      );
      if (listObjectsResponse.Contents) {
        const objectsToDelete = await processObjectsInBatches(
          bucketName,
          listObjectsResponse.Contents,
          20
        );
        const filteredObjectsToDelete = objectsToDelete.filter(
          (obj) => obj !== null
        ) as { Key: string }[];
        if (filteredObjectsToDelete.length > 0) {
          await deleteObjects(bucketName, filteredObjectsToDelete);
          totalDeletedObjects += filteredObjectsToDelete.length;
          console.log(`已刪除 ${filteredObjectsToDelete.length} 個檔案`);
        }
      }
      continuationToken = listObjectsResponse.NextContinuationToken;
    } while (continuationToken);
    console.log("processAllObjects end");
    return totalDeletedObjects;
  } catch (err) {
    console.error("processAllObjects error:", err);
    throw err;
  }
}

/**
 * 批次分流處理物件陣列，限制併發數 (Batch Chunking)，避免 N+1 請求過載與 S3 Rate Limit 限制
 */
async function processObjectsInBatches(
  bucketName: string,
  contents: any[],
  batchSize = 20
): Promise<({ Key: string } | null)[]> {
  const results: ({ Key: string } | null)[] = [];
  for (let i = 0; i < contents.length; i += batchSize) {
    const batch = contents.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((obj) => processObject(bucketName, obj))
    );
    results.push(...batchResults);
  }
  return results;
}

/**
 * 處理單個物件，決定是否需要刪除
 * @param bucketName S3 存儲桶名稱
 * @param obj S3 物件
 * @returns 如果物件需要刪除，返回包含 Key 的物件；否則返回 null
 */
async function processObject(
  bucketName: string,
  obj: any
): Promise<{ Key: string } | null> {
  if (!obj || !obj.Key) return null;

  const now = new Date();
  const uploadTime = obj.LastModified ? new Date(obj.LastModified) : new Date();
  const fileAgeMs = now.getTime() - uploadTime.getTime();

  // 1. 上傳未滿 24 小時的檔案，絕不可能為已過期的暫存檔，直接跳過 (省去 HEAD 請求)
  if (fileAgeMs < oneDayInMs) {
    return null;
  }

  // 2. 超過 7 天且非 PickupRequest/ 的檔案，代表早已確定寫入 DB 並轉為永久檔案，直接跳過 (省去 HEAD 請求)
  const isPickupRequest = obj.Key.startsWith("PickupRequest/");
  if (!isPickupRequest && fileAgeMs > 7 * oneDayInMs) {
    return null;
  }

  // 3. 僅對需進一步確認元數據的檔案發送 HeadObjectCommand
  try {
    const headObjectResponse = await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: obj.Key,
      })
    );
    const isTemporary = headObjectResponse.Metadata?.temporary === "true";

    if (isTemporary && fileAgeMs > oneDayInMs) {
      console.log("processObject: will delete temporary file", obj.Key);
      return { Key: obj.Key };
    } else if (isPickupRequest && !isTemporary) {
      const expirationDate =
        headObjectResponse.Metadata?.expirationDate ||
        headObjectResponse.Metadata?.expirationdate;
      if (expirationDate && now > new Date(expirationDate)) {
        console.log("processObject: will delete expired PickupRequest", obj.Key);
        return { Key: obj.Key };
      }
    }
    return null;
  } catch (err) {
    console.error("processObject error:", obj.Key, err);
    return null;
  }
}

/**
 * 從 S3 存儲桶中刪除指定的物件
 * @param bucketName S3 存儲桶名稱
 * @param objects 要刪除的物件
 */
async function deleteObjects(
  bucketName: string,
  objects: { Key: string }[]
): Promise<void> {
  console.log("deleteObjects start", objects.map(o => o.Key));
  try {
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: objects },
      })
    );
    console.log("deleteObjects success", objects.map(o => o.Key));
  } catch (err) {
    console.error("deleteObjects error:", err);
    throw err;
  }
}
