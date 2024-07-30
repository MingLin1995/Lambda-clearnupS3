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
    const totalDeletedObjects = await processAllFolders();
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
 * 處理指定的資料夾
 * @returns 刪除的檔案總數
 */
async function processAllFolders(): Promise<number> {
  const bucketName = process.env.AWS_S3_BUCKET as string;
  // 處理 Common 和 PickupRequest 兩個資料夾
  const folders = ["Common", "PickupRequest"];
  let totalDeletedObjects = 0;

  for (const folder of folders) {
    totalDeletedObjects += await processFolderContents(bucketName, folder);
  }

  return totalDeletedObjects;
}

/**
 * 處理資料夾中所有檔案
 * @returns 刪除的檔案數量
 */
async function processFolderContents(
  bucketName: string,
  folder: string
): Promise<number> {
  const listObjectsResponse = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: `${folder}/`, // 取得的資料夾前綴
    })
  );

  if (!listObjectsResponse.Contents) {
    return 0;
  }

  const objectsToDelete = await Promise.all(
    listObjectsResponse.Contents.map((obj) =>
      processObject(bucketName, folder, obj)
    )
  );

  const filteredObjectsToDelete = objectsToDelete.filter(
    (obj) => obj !== null
  ) as { Key: string }[];

  if (filteredObjectsToDelete.length > 0) {
    await deleteObjects(bucketName, filteredObjectsToDelete);
    console.log(
      `已從 ${folder} 資料夾刪除 ${filteredObjectsToDelete.length} 個資料`
    );
  }

  return filteredObjectsToDelete.length;
}

/**
 * 檢查是否應該要刪除
 * @returns 如果對象需要刪除，回傳 Key；否則回傳 null
 */
async function processObject(
  bucketName: string,
  folder: string,
  obj: any
): Promise<{ Key: string } | null> {
  // 取得S3所有資料
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
    // 暫時性文件，檢查是否超過一天
    return { Key: obj.Key! };
  } else if (folder === "PickupRequest" && !isTemporary) {
    // PickupRequest 中的非暫時性文件，檢查 expirationDate
    const expirationDate = headObjectResponse.Metadata?.expirationDate;
    if (expirationDate && now > new Date(expirationDate)) {
      return { Key: obj.Key! };
    }
  }

  return null;
}

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
