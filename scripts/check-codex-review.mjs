import { pathToFileURL } from "node:url";

export const CODEX_LOGIN = "chatgpt-codex-connector[bot]";

export function findCodexSignal({ reviews, reactions, headSha, reviewSince }) {
  const review = reviews.find(
    (candidate) =>
      candidate.user?.login === CODEX_LOGIN &&
      candidate.commit_id === headSha &&
      candidate.state !== "DISMISSED",
  );
  if (review) {
    return {
      kind: "review",
      detail: review.html_url ?? `review ${review.id}`,
    };
  }

  const since = Date.parse(reviewSince);
  const reaction = reactions.find(
    (candidate) =>
      candidate.user?.login === CODEX_LOGIN &&
      candidate.content === "+1" &&
      Date.parse(candidate.created_at) >= since,
  );
  if (reaction) {
    return {
      kind: "reaction",
      detail: `thumbs-up at ${reaction.created_at}`,
    };
  }

  return undefined;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function github(path) {
  const response = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${requiredEnv("GITHUB_TOKEN")}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}: ${await response.text()}`);
  }
  return response.json();
}

async function main() {
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const prNumber = requiredEnv("PR_NUMBER");
  const headSha = requiredEnv("HEAD_SHA");
  const reviewSince = requiredEnv("REVIEW_SINCE");
  const attempts = Number(process.env.CODEX_REVIEW_ATTEMPTS ?? 60);
  const intervalMs = Number(process.env.CODEX_REVIEW_INTERVAL_MS ?? 20_000);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const [reviews, reactions] = await Promise.all([
      github(`/repos/${repository}/pulls/${prNumber}/reviews?per_page=100`),
      github(`/repos/${repository}/issues/${prNumber}/reactions?per_page=100`),
    ]);
    const signal = findCodexSignal({ reviews, reactions, headSha, reviewSince });
    if (signal) {
      console.log(`Codex review confirmed by ${signal.kind}: ${signal.detail}`);
      return;
    }

    if (attempt < attempts) {
      console.log(`Waiting for Codex review of ${headSha.slice(0, 12)} (${attempt}/${attempts})...`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(
    `No Codex review or fresh Codex thumbs-up was found for PR #${prNumber} at ${headSha}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
