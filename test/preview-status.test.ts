import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { previewStatusText } from "../src/ui/preview-status.js";

describe("preview geometry status", () => {
  it("describes an empty idle preview", () => {
    expect(previewStatusText({ hasGeometry: false, rendering: false }))
      .toBe("No geometry yet");
  });

  it("describes an active render without invented progress", () => {
    expect(previewStatusText({ hasGeometry: false, rendering: true }))
      .toBe("Rendering...");
  });

  it("formats and bounds real renderer progress", () => {
    expect(previewStatusText({ hasGeometry: false, rendering: true, progress: 37.6 }))
      .toBe("Rendering... 38%");
    expect(previewStatusText({ hasGeometry: false, rendering: true, progress: 120 }))
      .toBe("Rendering... 100%");
  });

  it("shows no overlay whenever geometry is present", () => {
    expect(previewStatusText({ hasGeometry: true, rendering: false }))
      .toBe("");
    expect(previewStatusText({ hasGeometry: true, rendering: true, progress: 50 }))
      .toBe("");
  });

  it("lets the hidden attribute remove the overlay from layout", () => {
    const styles = readFileSync(
      new URL("../src/ui/styles.css", import.meta.url),
      "utf8",
    );

    expect(styles).toMatch(
      /\.preview-empty\[hidden\]\s*\{\s*display:\s*none;/,
    );
  });
});
