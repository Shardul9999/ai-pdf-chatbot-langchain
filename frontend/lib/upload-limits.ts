export const MAX_FILE_BYTES = 3 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_FILES = 5;
export const MAX_PAGES = 100;
export const MAX_TEXT_CHARS = 250000;
export const MAX_CHUNKS = 400;

export function uploadError(files: File[]): string | null {
  if (!files.length || files.length > MAX_FILES)
    return 'Choose between 1 and 5 PDFs.';
  if (
    files.some(
      (f) => f.type !== 'application/pdf' || !f.size || f.size > MAX_FILE_BYTES,
    )
  )
    return 'Each file must be a nonempty PDF no larger than 3 MB.';
  if (files.reduce((n, f) => n + f.size, 0) > MAX_UPLOAD_BYTES - 16384)
    return 'Upload fewer PDFs at once (combined limit is just under 4 MB).';
  if (new Set(files.map((f) => f.name)).size !== files.length)
    return 'Choose files with different names.';
  return null;
}
