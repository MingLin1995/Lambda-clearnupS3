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
        const objectsToDelete = await Promise.all(
          (listObjectsResponse.Contents ?? []).map((obj) =>
            processObject(bucketName, obj)
          )
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
 * 處理單個物件，決定是否需要刪除
 * @param bucketName S3 存儲桶名稱
 * @param obj S3 物件
 * @returns 如果物件需要刪除，返回包含 Key 的物件；否則返回 null
 */
async function processObject(
  bucketName: string,
  obj: any
): Promise<{ Key: string } | null> {
  console.log("processObject start", obj.Key);
  try {
    const headObjectResponse = await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: obj.Key!,
      })
    );
    const isTemporary = headObjectResponse.Metadata?.temporary === "true";
    const uploadTime = new Date(headObjectResponse.LastModified!);
    const now = new Date();
    if (isTemporary && now.getTime() - uploadTime.getTime() > oneDayInMs) {
      console.log("processObject: will delete temporary", obj.Key);
      return { Key: obj.Key! };
    } else if (obj.Key!.startsWith("PickupRequest/") && !isTemporary) {
      const expirationDate = headObjectResponse.Metadata?.expirationDate;
      if (expirationDate && now > new Date(expirationDate)) {
        console.log("processObject: will delete expired PickupRequest", obj.Key);
        return { Key: obj.Key! };
      }
    }
    console.log("processObject: skip", obj.Key);
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
