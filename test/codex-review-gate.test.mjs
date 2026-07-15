import { describe, expect, it } from "vitest";

import { CODEX_LOGIN, findCodexSignal, githubPages } from "../scripts/check-codex-review.mjs";

const headSha = "0123456789abcdef";
const reviewSince = "2026-07-15T20:00:00Z";

describe("Codex review gate", () => {
  it("loads every API page before checking for a review signal", async () => {
    const requested = [];
    const firstPage = Array.from({ length: 100 }, (_, id) => ({ id }));
    const finalPage = [{ id: 100 }];

    const items = await githubPages("/reviews", async (path) => {
      requested.push(path);
      return path.endsWith("page=1") ? firstPage : finalPage;
    });

    expect(items).toHaveLength(101);
    expect(requested).toEqual([
      "/reviews?per_page=100&page=1",
      "/reviews?per_page=100&page=2",
    ]);
  });

  it("accepts a Codex review of the current head", () => {
    const signal = findCodexSignal({
      headSha,
      reviewSince,
      reactions: [],
      reviews: [
        {
          commit_id: headSha,
          html_url: "https://github.com/example/repo/pull/1#pullrequestreview-1",
          state: "COMMENTED",
          user: { login: CODEX_LOGIN },
        },
      ],
    });

    expect(signal?.kind).toBe("review");
  });

  it("accepts a fresh Codex thumbs-up when the review found no issues", () => {
    const signal = findCodexSignal({
      headSha,
      reviewSince,
      reviews: [],
      reactions: [
        {
          content: "+1",
          created_at: "2026-07-15T20:01:00Z",
          user: { login: CODEX_LOGIN },
        },
      ],
    });

    expect(signal?.kind).toBe("reaction");
  });

  it("rejects reviews of older commits and stale reactions", () => {
    const signal = findCodexSignal({
      headSha,
      reviewSince,
      reviews: [
        {
          commit_id: "older",
          state: "COMMENTED",
          user: { login: CODEX_LOGIN },
        },
      ],
      reactions: [
        {
          content: "+1",
          created_at: "2026-07-15T19:59:59Z",
          user: { login: CODEX_LOGIN },
        },
      ],
    });

    expect(signal).toBeUndefined();
  });

  it("rejects review signals from other actors", () => {
    const signal = findCodexSignal({
      headSha,
      reviewSince,
      reviews: [
        {
          commit_id: headSha,
          state: "APPROVED",
          user: { login: "someone-else" },
        },
      ],
      reactions: [
        {
          content: "+1",
          created_at: "2026-07-15T20:01:00Z",
          user: { login: "someone-else" },
        },
      ],
    });

    expect(signal).toBeUndefined();
  });
});
