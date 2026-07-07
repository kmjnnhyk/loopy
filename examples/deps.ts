// Consumer-side dependency registry augmentation (step 0 of using loopy).
// 7 deps — the realistic surface drawn from bell-agent.

export interface FigmaData {
  readonly nodeId: string;
  readonly frames: readonly string[];
}
export interface JiraIssue {
  readonly key: string;
  readonly summary: string;
  readonly description: string;
}
export interface DeployResult {
  readonly ok: boolean;
  readonly url: string;
}
export interface ClaudeResult {
  readonly committed: boolean;
  readonly sha: string | null;
}

export interface GitRepo {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  find(query: string): Promise<readonly string[]>;
}
export interface FigmaApi {
  fetchNode(url: string): Promise<FigmaData>;
}
export interface JiraApi {
  getIssue(key: string): Promise<JiraIssue>;
  comment(key: string, body: string): Promise<void>;
  transition(key: string, to: string): Promise<void>;
}
export interface VercelApi {
  waitForDeploy(since: number): Promise<DeployResult>;
}
export interface GitCli {
  ensureRepo(url: string): Promise<string>;
}
export interface GitHubCli {
  openPR(opts: { head: string; base: string; title: string }): Promise<string>;
}
export interface Shell {
  claude(repoPath: string, prompt: string): Promise<ClaudeResult>;
}

declare module "@loopyjs/core" {
  interface LoopyDeps {
    repo: GitRepo;
    figma: FigmaApi;
    jira: JiraApi;
    vercel: VercelApi;
    git: GitCli;
    gh: GitHubCli;
    shell: Shell;
  }
}
