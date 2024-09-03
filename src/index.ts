import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Handler } from "aws-lambda";

// 初始化 S3
const s3Client = new S3Client({ region: process.env.AWS_REGION });
const oneDayInMs = 24 * 60 * 60 * 1000; // 一天

export const handler: Handler = async (event: any) => {
  try {
    const totalDeletedObjects = await processAllObjects();
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
  const bucketName = process.env.AWS_S3_BUCKET as string;
  let totalDeletedObjects = 0;
  let continuationToken: string | undefined;

  // 分頁處理
  do {
    // 列出 S3 存儲桶中所有物件
    const listObjectsResponse = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        ContinuationToken: continuationToken,
      })
    );

    if (listObjectsResponse.Contents) {
      const objectsToDelete = await Promise.all(
        listObjectsResponse.Contents.map((obj) =>
          processObject(bucketName, obj)
        )
      );

      // 過濾出需要刪除的物件
      const filteredObjectsToDelete = objectsToDelete.filter(
        (obj) => obj !== null
      ) as { Key: string }[];

      if (filteredObjectsToDelete.length > 0) {
        // 刪除符合條件的物件
        await deleteObjects(bucketName, filteredObjectsToDelete);
        totalDeletedObjects += filteredObjectsToDelete.length;
        console.log(`已刪除 ${filteredObjectsToDelete.length} 個檔案`);
      }
    }
    // 取得下一頁的標記
    continuationToken = listObjectsResponse.NextContinuationToken;
  } while (continuationToken);

  return totalDeletedObjects;
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
  // 取的該物件資料
  const headObjectResponse = await s3Client.send(
    new HeadObjectCommand({
      Bucket: bucketName,
      Key: obj.Key!,
    })
  );

  const isTemporary = headObjectResponse.Metadata?.temporary === "true";
  const uploadTime = new Date(headObjectResponse.LastModified!);
  const now = new Date();

  // 檢查是否為臨時文件且超過一天
  if (isTemporary && now.getTime() - uploadTime.getTime() > oneDayInMs) {
    return { Key: obj.Key! };
  } else if (obj.Key!.startsWith("PickupRequest/") && !isTemporary) {
    // 對於 PickupRequest 資料夾中的非臨時文件，檢查是否過期
    const expirationDate = headObjectResponse.Metadata?.expirationDate;
    if (expirationDate && now > new Date(expirationDate)) {
      return { Key: obj.Key! };
    }
  }

  return null;
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
  await s3Client.send(
    new DeleteObjectsCommand({
      Bucket: bucketName,
      Delete: { Objects: objects },
    })
  );
}
