import { ALLOWED_EXTENSIONS, type FileExtension } from "../types.js";

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_FILE_NAME_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreateJobInput {
  studentName: string;
  studentEmail: string;
  fileName: string;
  fileExtension: FileExtension;
  fileSize: number;
}

export type ValidationResult =
  | { ok: true; value: CreateJobInput }
  | { ok: false; message: string };

function invalid(message: string): ValidationResult {
  return { ok: false, message };
}

export function getExtension(fileName: string): FileExtension | undefined {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ALLOWED_EXTENSIONS.find((allowed) => allowed === ext);
}

/** Reduces a client-supplied filename to something safe to use in an S3 key. */
export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  return base.replace(/[^A-Za-z0-9._ -]/g, "_").trim();
}

export function validateCreateJob(
  body: unknown,
  maxFileSizeBytes: number,
): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return invalid("Request body must be a JSON object.");
  }
  const { studentName, studentEmail, fileName, fileSize } = body as Record<
    string,
    unknown
  >;

  if (typeof studentName !== "string" || !studentName.trim()) {
    return invalid("Name is required.");
  }
  if (studentName.trim().length > MAX_NAME_LENGTH) {
    return invalid(`Name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  }

  if (
    typeof studentEmail !== "string" ||
    studentEmail.length > MAX_EMAIL_LENGTH ||
    !EMAIL_PATTERN.test(studentEmail.trim())
  ) {
    return invalid("A valid student email is required.");
  }

  if (typeof fileName !== "string" || !fileName.trim()) {
    return invalid("A file is required.");
  }
  const safeFileName = sanitizeFileName(fileName);
  if (!safeFileName || safeFileName.length > MAX_FILE_NAME_LENGTH) {
    return invalid("The file name is not valid.");
  }
  const fileExtension = getExtension(safeFileName);
  if (!fileExtension) {
    return invalid(
      `File must be one of: ${ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(", ")}.`,
    );
  }

  if (
    typeof fileSize !== "number" ||
    !Number.isInteger(fileSize) ||
    fileSize <= 0
  ) {
    return invalid("The file is empty.");
  }
  if (fileSize > maxFileSizeBytes) {
    const maxMb = Math.floor(maxFileSizeBytes / (1024 * 1024));
    return invalid(`File must be ${maxMb} MB or smaller.`);
  }

  return {
    ok: true,
    value: {
      studentName: studentName.trim(),
      studentEmail: studentEmail.trim().toLowerCase(),
      fileName: safeFileName,
      fileExtension,
      fileSize,
    },
  };
}
