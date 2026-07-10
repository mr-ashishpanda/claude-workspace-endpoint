/**
 * Slack file attachments: the minimal shape the bridge reads, the set of image
 * types Claude can actually view, and the partition into supported vs not.
 */

/** A Slack file attachment, normalized from the raw event's `files[]`. */
export interface SlackFile {
  /** Slack file id. */
  id: string;
  /** Original filename (used in the download path and notices). */
  name: string;
  /** MIME type reported by Slack, e.g. "image/png". */
  mimetype: string;
  /** Authenticated download URL (needs the bot token as a Bearer header). */
  urlPrivate: string;
}

/**
 * Image types Claude Code can read — exactly the Anthropic vision API set.
 * Anything else (other image formats, PDFs, docs, archives) is unsupported.
 */
export const SUPPORTED_IMAGE_MIME: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

/** True if `mimetype` is an image type Claude can view (case-insensitive). */
export function isSupportedImage(mimetype: string): boolean {
  return SUPPORTED_IMAGE_MIME.includes(mimetype.trim().toLowerCase());
}

export interface PartitionedFiles {
  /** Files Claude can view. */
  images: SlackFile[];
  /** Files of an unsupported type — the user is told these are skipped. */
  unsupported: SlackFile[];
}

/** Split attachments into supported images and everything else. */
export function partitionFiles(files: SlackFile[]): PartitionedFiles {
  const images: SlackFile[] = [];
  const unsupported: SlackFile[] = [];
  for (const f of files) {
    (isSupportedImage(f.mimetype) ? images : unsupported).push(f);
  }
  return { images, unsupported };
}

/** The Slack notice posted when a user uploads files the bridge can't hand to Claude. */
export function formatUnsupportedNotice(files: SlackFile[]): string {
  const lines = files.map((f) => `• ${f.name} (${f.mimetype})`);
  const clause =
    files.length === 1
      ? "file is not supported and was skipped"
      : "files are not supported and were skipped";
  return (
    `:warning: The following ${clause}:\n` +
    `${lines.join("\n")}\n` +
    `Supported image types: ${SUPPORTED_IMAGE_MIME.join(", ")}.`
  );
}

/**
 * Compose the prompt sent to Claude when images are attached. The absolute
 * paths (in the app data dir) are listed with an instruction to view them via
 * the Read tool. With no images the text is returned unchanged.
 */
export function buildImagePrompt(text: string, imagePaths: string[]): string {
  if (imagePaths.length === 0) return text;
  const list = imagePaths.map((p) => `- ${p}`).join("\n");
  const n = imagePaths.length;
  const header =
    `The user attached ${n} image file${n === 1 ? "" : "s"}. ` +
    `View ${n === 1 ? "it" : "them"} with your Read tool:\n${list}`;
  const caption = text.trim();
  return caption ? `${caption}\n\n${header}` : header;
}
