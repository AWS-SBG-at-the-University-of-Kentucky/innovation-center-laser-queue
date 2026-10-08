function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

// Set on every Lambda by the CDK stack (infra/lib/laser-queue-stack.ts).
export const config = {
  get tableName() {
    return required("TABLE_NAME");
  },
  get bucketName() {
    return required("BUCKET_NAME");
  },
  get maxFileSizeBytes() {
    return Number(required("MAX_FILE_SIZE_BYTES"));
  },
  get urlExpirySeconds() {
    return Number(required("URL_EXPIRY_SECONDS"));
  },
};
