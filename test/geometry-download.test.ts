import { describe, expect, it, vi } from "vitest";

import {
  downloadGeometry,
  type BrowserDownloadEnvironment,
  type ConnectedDownloadHost,
} from "../src/ui/geometry-download.js";

describe("geometry downloads", () => {
  it("sends inline binary geometry through an advertised host bridge", async () => {
    const downloadFile = vi.fn(async () => ({}));

    await downloadGeometry(
      {
        format: "stl",
        buffer: new Uint8Array([0, 255, 16]),
        fileName: "test part.stl",
        mimeType: "model/stl",
      },
      "fallback.stl",
      { host: host(downloadFile, true) },
    );

    expect(downloadFile).toHaveBeenCalledOnce();
    expect(downloadFile).toHaveBeenCalledWith({
      contents: [{
        type: "resource",
        resource: {
          uri: "file:///test%20part.stl",
          mimeType: "model/stl",
          blob: "AP8Q",
        },
      }],
    });
  });

  it("attempts the host bridge when a connected host omits the optional capability", async () => {
    const downloadFile = vi.fn(async () => ({}));
    const browser = fakeBrowser();

    await downloadGeometry(
      { format: "3mf", bytes: [80, 75], fileName: "part.3mf" },
      "fallback.3mf",
      { host: host(downloadFile, false), browser: browser.environment },
    );

    expect(downloadFile).toHaveBeenCalledOnce();
    expect(browser.anchor.click).not.toHaveBeenCalled();
  });

  it("passes URL-only geometry to the host as a resource link", async () => {
    const downloadFile = vi.fn(async () => ({}));

    await downloadGeometry(
      { format: "stl", url: "https://example.test/model.stl" },
      "model.stl",
      { host: host(downloadFile, true) },
    );

    expect(downloadFile).toHaveBeenCalledWith({
      contents: [{
        type: "resource_link",
        uri: "https://example.test/model.stl",
        name: "model.stl",
        mimeType: "model/stl",
      }],
    });
  });

  it("reports host denial without attempting a sandbox-blocked anchor fallback", async () => {
    const downloadFile = vi.fn(async () => ({ isError: true }));
    const browser = fakeBrowser();

    await expect(downloadGeometry(
      { format: "stl", bytes: [1, 2, 3] },
      "part.stl",
      { host: host(downloadFile, true), browser: browser.environment },
    )).rejects.toThrow("The host declined the download.");

    expect(browser.anchor.click).not.toHaveBeenCalled();
  });

  it("reports bridge failures and notes a missing capability advertisement", async () => {
    const downloadFile = vi.fn(async () => {
      throw new Error("Method not found");
    });

    await expect(downloadGeometry(
      { format: "3mf", bytes: [1, 2, 3] },
      "part.3mf",
      { host: host(downloadFile, false) },
    )).rejects.toThrow(
      "The connected host could not download the file. The host did not advertise file-download support.",
    );
  });

  it("uses and cleans up a blob URL in a standalone browser", async () => {
    const browser = fakeBrowser();

    await downloadGeometry(
      { format: "stl", buffer: new Uint8Array([1, 2, 3]) },
      "standalone.stl",
      { browser: browser.environment },
    );

    expect(browser.createObjectUrl).toHaveBeenCalledOnce();
    const blob = browser.createObjectUrl.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe("model/stl");
    expect(blob?.size).toBe(3);
    expect(browser.anchor).toMatchObject({
      href: "blob:geometry",
      download: "standalone.stl",
      rel: "noopener",
      hidden: true,
    });
    expect(browser.appendAnchor).toHaveBeenCalledWith(browser.anchor);
    expect(browser.anchor.click).toHaveBeenCalledOnce();
    expect(browser.anchor.remove).toHaveBeenCalledOnce();
    expect(browser.revokeObjectUrl).not.toHaveBeenCalled();

    browser.runCleanup();
    expect(browser.revokeObjectUrl).toHaveBeenCalledWith("blob:geometry");
  });

  it("keeps URL-only standalone downloads functional without creating a blob", async () => {
    const browser = fakeBrowser();

    await downloadGeometry(
      { format: "3mf", url: "https://example.test/model.3mf" },
      "model.3mf",
      { browser: browser.environment },
    );

    expect(browser.anchor.href).toBe("https://example.test/model.3mf");
    expect(browser.anchor.click).toHaveBeenCalledOnce();
    expect(browser.createObjectUrl).not.toHaveBeenCalled();
    expect(browser.setTimeout).not.toHaveBeenCalled();
  });
});

function host(
  downloadFile: ConnectedDownloadHost["downloadFile"],
  capabilityAdvertised: boolean,
): ConnectedDownloadHost {
  return { capabilityAdvertised, downloadFile };
}

function fakeBrowser() {
  const anchor = {
    href: "",
    download: "",
    rel: "",
    hidden: false,
    click: vi.fn(),
    remove: vi.fn(),
  };
  const appendAnchor = vi.fn();
  const createObjectUrl = vi.fn((_blob: Blob) => "blob:geometry");
  const revokeObjectUrl = vi.fn();
  let cleanup: (() => void) | undefined;
  const setTimeout = vi.fn((callback: () => void, _delay: number) => {
    cleanup = callback;
    return 1;
  });
  const environment: BrowserDownloadEnvironment = {
    createAnchor: () => anchor,
    appendAnchor,
    createObjectUrl,
    revokeObjectUrl,
    setTimeout,
  };

  return {
    anchor,
    appendAnchor,
    createObjectUrl,
    revokeObjectUrl,
    setTimeout,
    environment,
    runCleanup: () => cleanup?.(),
  };
}
