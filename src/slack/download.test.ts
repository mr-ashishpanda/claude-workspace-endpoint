import { describe, it, expect } from "vitest";
import { createFileDownloader } from "./download.js";
import { SlackFile } from "./files.js";

const file: SlackFile = {
  id: "F1",
  name: "diagram.png",
  mimetype: "image/png",
  urlPrivate: "https://files.slack.com/files-pri/T1-F1/diagram.png",
};

describe("createFileDownloader", () => {
  it("GETs url_private with the bot token and returns the bytes", async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {};
    const fakeFetch = (async (url: string, init: { headers: Record<string, string> }) => {
      seen.url = url;
      seen.headers = init.headers;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode("PNGBYTES").buffer,
      };
    }) as unknown as typeof fetch;

    const download = createFileDownloader("xoxb-secret", fakeFetch);
    const bytes = await download(file);

    expect(seen.url).toBe(file.urlPrivate);
    expect(seen.headers?.Authorization).toBe("Bearer xoxb-secret");
    expect(bytes.toString()).toBe("PNGBYTES");
  });

  it("throws on a non-OK response", async () => {
    const fakeFetch = (async () => ({
      ok: false,
      status: 403,
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch;
    const download = createFileDownloader("xoxb-secret", fakeFetch);
    await expect(download(file)).rejects.toThrow(/403/);
  });
});
