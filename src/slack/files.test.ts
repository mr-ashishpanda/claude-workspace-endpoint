import { describe, it, expect } from "vitest";
import {
  SlackFile,
  isSupportedImage,
  partitionFiles,
  SUPPORTED_IMAGE_MIME,
  formatUnsupportedNotice,
  buildImagePrompt,
} from "./files.js";

const file = (over: Partial<SlackFile> = {}): SlackFile => ({
  id: "F1",
  name: "img.png",
  mimetype: "image/png",
  urlPrivate: "https://files.slack.com/F1",
  ...over,
});

describe("isSupportedImage", () => {
  it("accepts exactly the Anthropic vision image types", () => {
    expect([...SUPPORTED_IMAGE_MIME].sort()).toEqual(
      ["image/gif", "image/jpeg", "image/png", "image/webp"].sort(),
    );
    for (const m of SUPPORTED_IMAGE_MIME) {
      expect(isSupportedImage(m)).toBe(true);
    }
  });

  it("is case-insensitive on the mimetype", () => {
    expect(isSupportedImage("IMAGE/PNG")).toBe(true);
  });

  it("rejects other image formats and non-images", () => {
    for (const m of ["image/bmp", "image/tiff", "image/svg+xml", "application/pdf", "text/plain"]) {
      expect(isSupportedImage(m)).toBe(false);
    }
  });
});

describe("partitionFiles", () => {
  it("splits supported images from unsupported files", () => {
    const png = file({ id: "A", mimetype: "image/png" });
    const pdf = file({ id: "B", name: "doc.pdf", mimetype: "application/pdf" });
    const webp = file({ id: "C", name: "shot.webp", mimetype: "image/webp" });
    const { images, unsupported } = partitionFiles([png, pdf, webp]);
    expect(images.map((f) => f.id)).toEqual(["A", "C"]);
    expect(unsupported.map((f) => f.id)).toEqual(["B"]);
  });

  it("returns empty arrays for no files", () => {
    expect(partitionFiles([])).toEqual({ images: [], unsupported: [] });
  });
});

describe("formatUnsupportedNotice", () => {
  it("names each unsupported file and its type", () => {
    const notice = formatUnsupportedNotice([
      file({ name: "report.pdf", mimetype: "application/pdf" }),
      file({ name: "data.zip", mimetype: "application/zip" }),
    ]);
    expect(notice).toContain(":warning:");
    expect(notice).toContain("report.pdf");
    expect(notice).toContain("application/pdf");
    expect(notice).toContain("data.zip");
    expect(notice).toContain("not supported");
  });

  it("uses singular grammar for one file and plural for many", () => {
    const one = formatUnsupportedNotice([file({ name: "a.pdf", mimetype: "application/pdf" })]);
    expect(one).toContain("file is not supported and was skipped");
    const many = formatUnsupportedNotice([
      file({ name: "a.pdf", mimetype: "application/pdf" }),
      file({ name: "b.zip", mimetype: "application/zip" }),
    ]);
    expect(many).toContain("files are not supported and were skipped");
  });
});

describe("buildImagePrompt", () => {
  it("returns the text unchanged when there are no images", () => {
    expect(buildImagePrompt("hello", [])).toBe("hello");
  });

  it("appends the absolute image paths and a view instruction", () => {
    const p = buildImagePrompt("what is this?", ["/data/media/x/a.png", "/data/media/x/b.png"]);
    expect(p).toContain("what is this?");
    expect(p).toContain("/data/media/x/a.png");
    expect(p).toContain("/data/media/x/b.png");
    expect(p.toLowerCase()).toContain("read");
  });

  it("handles an image-only message (no caption)", () => {
    const p = buildImagePrompt("", ["/data/media/x/a.png"]);
    expect(p).toContain("/data/media/x/a.png");
    expect(p.trim().length).toBeGreaterThan(0);
  });
});
