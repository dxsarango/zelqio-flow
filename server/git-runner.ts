import { execFile } from "node:child_process";
import { redactSecrets } from "./quota-signal";

export type GitCommand = "git" | "gh";
/** `extra` adds environment variables after Git's location variables were removed, for example a private index file. */
export type GitRunner = (command: GitCommand, args: readonly string[], cwd: string, extra?: Readonly<Record<string, string>>) => Promise<string>;

export class GitCommandError extends Error {
  constructor(readonly command: GitCommand, readonly code: number | string | undefined, detail: string) {
    super(`${command} failed: ${detail}`);
  }
}

export function runGitCommand(timeout = 25_000): GitRunner {
  return (command, args, cwd, extra) => new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GH_HOST: "github.com" };
    for (const key of Object.keys(env)) {
      if (/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG.*|TRACE.*|CURL_VERBOSE|EXTERNAL_DIFF)$/i.test(key)) {
        Reflect.deleteProperty(env, key);
      }
    }
    Object.assign(env, extra);
    execFile(command, [...args], { cwd, env, timeout, windowsHide: true, maxBuffer: 12 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      const detail = redactSecrets(stderr)
        .replace(/\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[redacted]")
        .replace(/\b(?:GH_TOKEN|GITHUB_TOKEN|GITHUB_PAT|ACCESS_TOKEN)\s*[:=]\s*\S+/gi, "[redacted]")
        .replace(/(https?:\/\/)[^\s/]+@/gi, "$1[redacted]@")
        .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, "$1[redacted]")
        .trim().slice(0, 500);
      reject(new GitCommandError(command, error.code, detail || (error.killed ? "timed out" : "command failed")));
    });
  });
}
