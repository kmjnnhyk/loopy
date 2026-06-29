// 10 tools — model-less, deps declared. editFile/createFile carry idempotencyKey
// to demo the at-least-once durability contract.
import { tool, io } from "loopy";
import type { FigmaData, JiraIssue, DeployResult } from "./deps";

export const editFile = tool({
  name: "editFile",
  description: "Apply a find/replace edit to a file.",
  input: io<{ path: string; find: string; replace: string }>(),
  output: io<{ applied: boolean }>(),
  deps: ["repo"],
  idempotencyKey: (i) => `edit:${i.path}:${i.find}`,
  run: async (i, { deps }) => {
    const cur = await deps.repo.read(i.path);
    await deps.repo.write(i.path, cur.replace(i.find, i.replace));
    return { applied: true };
  },
});

export const createFile = tool({
  name: "createFile",
  description: "Create a new file.",
  input: io<{ path: string; content: string }>(),
  output: io<{ created: boolean }>(),
  deps: ["repo"],
  idempotencyKey: (i) => `create:${i.path}`,
  run: async (i, { deps }) => {
    await deps.repo.write(i.path, i.content);
    return { created: true };
  },
});

export const readFile = tool({
  name: "readFile",
  description: "Read a file's contents.",
  input: io<{ path: string }>(),
  output: io<{ content: string }>(),
  deps: ["repo"],
  run: async (i, { deps }) => ({ content: await deps.repo.read(i.path) }),
});

export const fetchFigma = tool({
  name: "fetchFigma",
  description: "Fetch a Figma node.",
  input: io<{ url: string }>(),
  output: io<FigmaData>(),
  deps: ["figma"],
  run: async (i, { deps }) => deps.figma.fetchNode(i.url),
});

export const getIssue = tool({
  name: "getIssue",
  description: "Fetch a Jira issue.",
  input: io<{ key: string }>(),
  output: io<JiraIssue>(),
  deps: ["jira"],
  run: async (i, { deps }) => deps.jira.getIssue(i.key),
});

export const addComment = tool({
  name: "addComment",
  description: "Comment on a Jira issue.",
  input: io<{ key: string; body: string }>(),
  output: io<{ ok: boolean }>(),
  deps: ["jira"],
  run: async (i, { deps }) => {
    await deps.jira.comment(i.key, i.body);
    return { ok: true };
  },
});

export const transitionTo = tool({
  name: "transitionTo",
  description: "Transition a Jira issue to a new status.",
  input: io<{ key: string; to: string }>(),
  output: io<{ ok: boolean }>(),
  deps: ["jira"],
  run: async (i, { deps }) => {
    await deps.jira.transition(i.key, i.to);
    return { ok: true };
  },
});

export const waitForDeploy = tool({
  name: "waitForDeploy",
  description: "Wait for a Vercel deploy to finish.",
  input: io<{ since: number }>(),
  output: io<DeployResult>(),
  deps: ["vercel"],
  run: async (i, { deps }) => deps.vercel.waitForDeploy(i.since),
});

export const ensureRepo = tool({
  name: "ensureRepo",
  description: "Clone/ensure a repo checkout locally.",
  input: io<{ url: string }>(),
  output: io<{ path: string }>(),
  deps: ["git"],
  run: async (i, { deps }) => ({ path: await deps.git.ensureRepo(i.url) }),
});

export const openPR = tool({
  name: "openPR",
  description: "Open a GitHub pull request.",
  input: io<{ head: string; base: string; title: string }>(),
  output: io<{ url: string }>(),
  deps: ["gh"],
  run: async (i, { deps }) => ({ url: await deps.gh.openPR(i) }),
});
