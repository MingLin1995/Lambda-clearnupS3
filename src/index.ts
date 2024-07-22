import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Handler } from "aws-lambda";

const s3Client = new S3Client({ region: process.env.AWS_REGION });

export const handler: Handler = async (event: any) => {
  const bucketName = process.env.AWS_S3_BUCKET as string;
  const expirationDays = parseInt(process.env.EXPIRATION_DAYS || "1");

  try {
    const listObjectsResponse = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: "", // 可設定前綴
      })
    );

    if (listObjectsResponse.Contents) {
      const objectsToDelete = [];

      for (const obj of listObjectsResponse.Contents) {
        const headObjectResponse = await s3Client.send(
          new HeadObjectCommand({
            Bucket: bucketName,
            Key: obj.Key!,
          })
        );

        const isTemporary = headObjectResponse.Metadata?.temporary === "true";
        const uploadTime = new Date(headObjectResponse.LastModified!);

        if (
          isTemporary &&
          (new Date().getTime() - uploadTime.getTime()) /
            (1000 * 60 * 60 * 24) >
            expirationDays
        ) {
          objectsToDelete.push({ Key: obj.Key! });
        }
      }

      if (objectsToDelete.length > 0) {
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: { Objects: objectsToDelete },
          })
        );

        console.log(`Deleted ${objectsToDelete.length} objects`);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify("Cleanup complete"),
    };
  } catch (error) {
    console.error("Error cleaning up unused files:", error);

    return {
      statusCode: 500,
      body: JSON.stringify("Error occurred"),
    };
  }
};
