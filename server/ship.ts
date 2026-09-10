/**
 * Everything the ship card knows, computed on the daemon.
 *
 * This mirrors `~/.pi/agent/extensions/ship` step for step, because a card that
 * disagrees with `/ship` is worse than no card. Where the two could drift, this
 * file errs toward reporting a blocker: an undecidable check is a failure, not
 * a silent pass, so the card never offers a one-tap ship that `/ship` refuses.
 *
 * Two deliberate differences from the extension, both to keep it read-only:
 * - It never fetches. `/ship` fetches and rebases onto a trunk that moved; that
 *   is a `warn` row here rather than a blocker, because the extension fixes it.
 * - It never writes. `/ship` lets a formatter rewrite and restage a file, so a
 *   style complaint on a rewritable file is not a blocker here either. Only a
 *   formatter that cannot parse the file, or a lint finding, blocks.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { ShipCheck, ShipVerdict } from "../shared/ship";
import { SHIP_VERDICT_KIND, SHIP_VERDICT_VERSION } from "../shared/ship";

const GIT_TIMEOUT_MS = 15_000;
/**
 * `/ship` allows 90s per tool because a human is waiting on a commit. Nothing
 * is waiting on a card, so a tool that runs long is reported as undetermined
 * and `/ship` gets to be the one that waits.
 */
const CHECK_TIMEOUT_MS = 30_000;
const MAX_CHECK_FILES = 200;
const MAX_REASON_CHARS = 140;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const QUALITY_CACHE_ENTRIES = 32;
const QUALITY_CACHE_TTL_MS = 10 * 60_000;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  readonly killed: boolean;
}

function run(
  file: string,
  args: readonly string[],
  cwd: string,
  timeout: number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { cwd, timeout, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" },
      (error, stdout, stderr) => {
        const failure = error as (Error & { code?: number | string; killed?: boolean }) | null;
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code: failure === null ? 0 : typeof failure.code === "number" ? failure.code : 1,
          killed: failure?.killed === true,
        });
      },
    );
  });
}

type Git = (args: readonly string[], timeout?: number) => Promise<RunResult>;

function gitIn(cwd: string): Git {
  return (args, timeout = GIT_TIMEOUT_MS) => run("git", args, cwd, timeout);
}

function parseNullSeparated(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

function bound(line: string): string {
  return line.length <= MAX_REASON_CHARS ? line : `${line.slice(0, MAX_REASON_CHARS)}…`;
}

/**
 * One line a human can act on, out of a wall of tool output.
 *
 * A linter leads with the file path, which says nothing, and ends with a count
 * of what it found, which says everything, so the summary wins when there is
 * one and the first real finding wins when there is not.
 */
function firstLine(result: RunResult): string {
  const lines = [result.stderr, result.stdout]
    .join("\n")
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (lines.length === 0) return "no output";

  const summary = lines.find((line) => /\d+\s+problems?\b/i.test(line) || line.startsWith("✖"));
  if (summary) return bound(summary.replace(/^✖\s*/, ""));

  const finding = lines.find((line) => /^\d+:\d+\s+(?:error|warning)/i.test(line));
  if (finding) return bound(finding);

  return bound(lines[0] ?? "no output");
}

function pass(id: string, label: string): ShipCheck {
  return { id, label, status: "pass", reason: null };
}

function fail(id: string, label: string, reason: string): ShipCheck {
  return { id, label, status: "fail", reason };
}

function warn(id: string, label: string, reason: string): ShipCheck {
  return { id, label, status: "warn", reason };
}

function skip(id: string, label: string, reason: string): ShipCheck {
  return { id, label, status: "skip", reason };
}

// ---------------------------------------------------------------------------
// Ported from the extension. Kept literal so the two cannot drift apart.
// ---------------------------------------------------------------------------

/** `ship/index.ts` GIT_OPERATION_MARKERS. */
const GIT_OPERATION_MARKERS = [
  "rebase-merge",
  "rebase-apply",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "BISECT_LOG",
];

/** `ship-destination.ts` TRUNK_CANDIDATES. */
const TRUNK_CANDIDATES = ["main", "master", "trunk", "develop"] as const;

/** `ship/index.ts` isExampleSecret + isSensitivePath. */
function isExampleSecret(path: string): boolean {
  const lower = path.toLowerCase();
  return /(?:^|[._-])(example|sample|template)(?:[._-]|$)/.test(lower);
}

export function isSensitivePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const name = basename(normalized);

  if (isExampleSecret(name)) return false;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if ([".netrc", ".npmrc", ".pypirc", "credentials.json", "auth.json"].includes(name)) {
    return true;
  }
  if (/^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.pub)?$/.test(name)) return true;
  if (/\.(?:pem|key|p12|pfx|jks|keystore)$/.test(name)) return true;
  if (/(?:^|\/)\.aws\/credentials$/.test(normalized)) return true;
  if (/(?:^|\/)\.ssh\/(?:config|authorized_keys|known_hosts)$/.test(normalized)) return true;
  if (/(?:^|\/)(?:secrets?|credentials?)(?:\.(?:json|ya?ml|toml|ini))?$/.test(normalized)) {
    return true;
  }
  return false;
}

/** `ship/index.ts` PRETTIER_EXTS, ESLINT_EXTS, CHECK_SPECS. */
const PRETTIER_EXTS = [
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts",
  "json", "jsonc", "css", "scss", "less", "html", "vue",
  "svelte", "md", "mdx", "yaml", "yml",
];
const ESLINT_EXTS = ["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "vue", "svelte"];

interface CheckSpec {
  readonly label: string;
  readonly tool: string;
  readonly source: "local" | "path";
  readonly exts: readonly string[];
  readonly args: readonly string[];
  readonly failOnStdout?: boolean;
  /** Present means `/ship` rewrites and restages instead of failing. */
  readonly writeArgs?: readonly string[];
  readonly cacheArgs?: (cacheFile: string) => readonly string[];
}

const CHECK_SPECS: readonly CheckSpec[] = [
  { label: "prettier", tool: "prettier", source: "local", exts: PRETTIER_EXTS, args: ["--check"], writeArgs: ["--write", "--log-level=warn"] },
  { label: "eslint", tool: "eslint", source: "local", exts: ESLINT_EXTS, args: [], cacheArgs: (file) => ["--cache", "--cache-location", file] },
  { label: "ruff check", tool: "ruff", source: "path", exts: ["py", "pyi"], args: ["check"] },
  { label: "ruff format", tool: "ruff", source: "path", exts: ["py", "pyi"], args: ["format", "--check"], writeArgs: ["format"] },
  { label: "gofmt", tool: "gofmt", source: "path", exts: ["go"], args: ["-l"], failOnStdout: true, writeArgs: ["-w"] },
  { label: "rustfmt", tool: "rustfmt", source: "path", exts: ["rs"], args: ["--check"], writeArgs: [] },
];

/** `ship-quality.ts` filesForSpec. */
function filesForSpec(files: readonly string[], spec: CheckSpec): string[] {
  return files.filter((file) => {
    const dot = file.lastIndexOf(".");
    if (dot < 0) return false;
    return spec.exts.includes(file.slice(dot + 1).toLowerCase());
  });
}

/** `ship-quality.ts` resolveTool. Never `npx`, never a download. */
async function resolveTool(spec: CheckSpec, repoRoot: string): Promise<string | undefined> {
  if (spec.source === "local") {
    const binary = join(repoRoot, "node_modules", ".bin", spec.tool);
    return existsSync(binary) ? binary : undefined;
  }
  const found = await run("which", [spec.tool], repoRoot, GIT_TIMEOUT_MS);
  return found.code === 0 && found.stdout.trim() ? spec.tool : undefined;
}

/** `ship/index.ts` hasPreCommitHook. */
function hasPreCommitHook(repoRoot: string, gitDir: string | undefined): boolean {
  if (existsSync(join(repoRoot, ".husky", "pre-commit"))) return true;
  if (!gitDir) return false;
  return existsSync(join(gitDir, "hooks", "pre-commit"));
}

// ---------------------------------------------------------------------------
// Quality cache
// ---------------------------------------------------------------------------

interface QualityResult {
  readonly checks: ShipCheck[];
  readonly at: number;
}

const qualityCache = new Map<string, QualityResult>();

/**
 * Keyed by working directory, HEAD, and the exact dirty state of the files that
 * would be checked. Porcelain status alone is not enough: editing a file that
 * was already modified does not change its status line, so size and mtime go
 * into the digest too.
 */
function qualityKey(cwd: string, head: string, status: string, files: readonly string[], repoRoot: string): string {
  const digest = createHash("sha256");
  digest.update(status);
  for (const file of [...files].sort()) {
    digest.update("\0");
    digest.update(file);
    try {
      const stat = statSync(join(repoRoot, file));
      digest.update(`:${stat.size}:${stat.mtimeMs}`);
    } catch {
      digest.update(":missing");
    }
  }
  return `${cwd}\0${head}\0${digest.digest("hex")}`;
}

function readQualityCache(key: string): ShipCheck[] | undefined {
  const hit = qualityCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > QUALITY_CACHE_TTL_MS) {
    qualityCache.delete(key);
    return undefined;
  }
  // Refresh insertion order so a directory in active use is evicted last.
  qualityCache.delete(key);
  qualityCache.set(key, hit);
  return hit.checks;
}

function writeQualityCache(key: string, checks: ShipCheck[]): void {
  qualityCache.set(key, { checks, at: Date.now() });
  while (qualityCache.size > QUALITY_CACHE_ENTRIES) {
    const oldest = qualityCache.keys().next();
    if (oldest.done) break;
    qualityCache.delete(oldest.value);
  }
}

export function clearQualityCache(): void {
  qualityCache.clear();
}

// ---------------------------------------------------------------------------
// Quality checks
// ---------------------------------------------------------------------------

/**
 * Mirrors `runStagedChecks`, read-only.
 *
 * `heldBack` is the set `/ship` refuses to rewrite because it carries unstaged
 * edits alongside staged ones. For those, a formatter complaint is a hard
 * failure in the extension, so it is a blocker here. For everything else the
 * extension rewrites and restages, so only a crash, exit 2 or worse, blocks.
 */
async function runQualityChecks(
  repoRoot: string,
  gitDir: string | undefined,
  files: readonly string[],
  heldBack: ReadonlySet<string>,
): Promise<ShipCheck[]> {
  if (hasPreCommitHook(repoRoot, gitDir)) {
    return [skip("quality", "Quality checks", "a pre-commit hook runs them at commit time")];
  }
  if (files.length === 0) {
    return [skip("quality", "Quality checks", "no added or modified files")];
  }
  if (files.length > MAX_CHECK_FILES) {
    return [
      skip("quality", "Quality checks", `${files.length} files exceeds the ${MAX_CHECK_FILES}-file limit`),
    ];
  }

  const checks: ShipCheck[] = [];

  for (const spec of CHECK_SPECS) {
    const scoped = filesForSpec(files, spec);
    if (scoped.length === 0) continue;

    const binary = await resolveTool(spec, repoRoot);
    if (!binary) continue;

    const id = `quality:${spec.label}`;
    const cached =
      spec.cacheArgs && gitDir
        ? spec.cacheArgs(join(gitDir, `paseo-ship-${spec.label.replace(/\s+/g, "-")}-cache`))
        : [];

    // The extension rewrites these and restages, so their style findings never
    // stop a ship. Only the files it will not touch are judged.
    const rewritable = spec.writeArgs ? scoped.filter((file) => !heldBack.has(file)) : [];
    const rewritableSet = new Set(rewritable);
    const judged = scoped.filter((file) => !rewritableSet.has(file));

    if (judged.length > 0) {
      const result = await run(binary, [...cached, ...spec.args, ...judged], repoRoot, CHECK_TIMEOUT_MS);
      if (result.killed) {
        checks.push(fail(id, spec.label, `did not finish in ${CHECK_TIMEOUT_MS / 1_000}s, so /ship will run it`));
        continue;
      }
      const failed = spec.failOnStdout
        ? result.code !== 0 || result.stdout.trim().length > 0
        : result.code !== 0;
      if (failed) {
        const hint = spec.writeArgs ? " (unstaged edits, /ship will not rewrite it)" : "";
        checks.push(fail(id, spec.label, `${firstLine(result)}${hint}`));
        continue;
      }
    }

    if (rewritable.length > 0) {
      // Read-only stand-in for the extension's `--write` pass: a style diff is
      // exit 1 and gets fixed, a parse error is exit 2 and stops the ship.
      const result = await run(binary, [...cached, ...spec.args, ...rewritable], repoRoot, CHECK_TIMEOUT_MS);
      if (result.killed) {
        checks.push(fail(id, spec.label, `did not finish in ${CHECK_TIMEOUT_MS / 1_000}s, so /ship will run it`));
        continue;
      }
      if (result.code >= 2) {
        checks.push(fail(id, spec.label, firstLine(result)));
        continue;
      }
    }

    checks.push(pass(id, spec.label));
  }

  if (checks.length === 0) {
    return [skip("quality", "Quality checks", "no matching tool installed")];
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Destination, mirroring ship-destination.ts without a fetch
// ---------------------------------------------------------------------------

interface Destination {
  readonly kind: "trunk" | "branch";
  readonly ref: string;
  readonly reason: string;
}

async function remoteRefExists(git: Git, ref: string): Promise<boolean> {
  const result = await git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${ref}`]);
  return result.code === 0 && result.stdout.trim().length > 0;
}

async function resolveTrunk(git: Git): Promise<string | undefined> {
  const head = await git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const named = head.stdout.trim().replace(/^origin\//, "");
  if (head.code === 0 && named) return named;

  for (const candidate of TRUNK_CANDIDATES) {
    if (await remoteRefExists(git, candidate)) return candidate;
  }
  return undefined;
}

async function currentBranch(git: Git): Promise<string | undefined> {
  const result = await git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (result.code !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

async function readUpstream(git: Git): Promise<string | undefined> {
  const result = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  if (result.code !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

async function resolveDestination(
  git: Git,
  branch: string | undefined,
): Promise<Destination | undefined> {
  const trunk = await resolveTrunk(git);
  if (!trunk) return undefined;

  if (!branch) {
    return { kind: "trunk", ref: trunk, reason: "a detached HEAD has no branch to push" };
  }
  if (branch === trunk) {
    return { kind: "trunk", ref: trunk, reason: `you are on ${trunk}` };
  }

  const upstream = await readUpstream(git);
  if (upstream) {
    return { kind: "branch", ref: branch, reason: `${branch} tracks ${upstream}` };
  }
  if (await remoteRefExists(git, branch)) {
    return { kind: "branch", ref: branch, reason: `origin/${branch} already exists` };
  }
  return {
    kind: "trunk",
    ref: trunk,
    reason: `${branch} was never pushed, so it is a local worktree branch`,
  };
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

function emptyVerdict(cwd: string, isRepo: boolean, error: string | null): ShipVerdict {
  return {
    kind: SHIP_VERDICT_KIND,
    version: SHIP_VERDICT_VERSION,
    checkedAt: new Date().toISOString(),
    cwd,
    isRepo,
    branch: null,
    base: null,
    destinationKind: null,
    destinationReason: null,
    ahead: 0,
    behind: 0,
    changedFiles: 0,
    checks: [],
    qualityFromCache: false,
    error,
  };
}

export async function readShipVerdictHandler(input: {
  cwd: string;
  force?: boolean;
}): Promise<ShipVerdict> {
  const { cwd, force = false } = input;
  if (!cwd.trim()) return emptyVerdict(cwd, false, null);

  try {
    return await computeVerdict(cwd, force);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[paseo-ship-check] ship verdict failed", error);
    return emptyVerdict(cwd, true, message);
  }
}

async function computeVerdict(cwd: string, force: boolean): Promise<ShipVerdict> {
  const git = gitIn(cwd);

  const inside = await git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    return emptyVerdict(cwd, false, null);
  }

  const [gitDirResult, topLevelResult, headResult] = await Promise.all([
    git(["rev-parse", "--absolute-git-dir"]),
    git(["rev-parse", "--show-toplevel"]),
    git(["rev-parse", "HEAD"]),
  ]);
  const gitDir = gitDirResult.code === 0 ? gitDirResult.stdout.trim() : undefined;
  const repoRoot = topLevelResult.code === 0 ? topLevelResult.stdout.trim() : cwd;
  const head = headResult.code === 0 ? headResult.stdout.trim() : "";

  const checks: ShipCheck[] = [];

  // 1. A half-finished rebase makes every answer below it meaningless.
  const running = gitDir
    ? GIT_OPERATION_MARKERS.filter((marker) => existsSync(join(gitDir, marker)))
    : [];
  checks.push(
    running.length > 0
      ? fail("git-operation", "No git operation running", `${running.join(", ")} in progress`)
      : pass("git-operation", "No git operation running"),
  );

  // 2. Unmerged index entries, from a paused rebase or a conflicted autostash.
  const unmerged = await git(["ls-files", "--unmerged", "-z"]);
  const unmergedPaths =
    unmerged.code === 0
      ? [...new Set(parseNullSeparated(unmerged.stdout).map((entry) => entry.split("\t")[1] ?? entry))]
      : [];
  checks.push(
    unmergedPaths.length > 0
      ? fail(
          "unmerged",
          "No unmerged paths",
          `${unmergedPaths.length} conflicted path${unmergedPaths.length === 1 ? "" : "s"}: ${unmergedPaths.slice(0, 2).join(", ")}`,
        )
      : pass("unmerged", "No unmerged paths"),
  );

  // 3. Destination.
  const branch = await currentBranch(git);
  const destination = await resolveDestination(git, branch);
  checks.push(
    destination
      ? pass("destination", "Destination resolved")
      : fail(
          "destination",
          "Destination resolved",
          `origin/HEAD is unset and none of ${TRUNK_CANDIDATES.join(", ")} exist on origin`,
        ),
  );

  // 4. Somewhere to push to.
  const pushUrl = await git(["remote", "get-url", "--push", "origin"]);
  checks.push(
    pushUrl.code === 0 && pushUrl.stdout.trim()
      ? pass("push-url", "origin has a push URL")
      : fail("push-url", "origin has a push URL", "remote origin has no push URL"),
  );

  // 5. What would be staged. Staged paths win when there are any, exactly as
  //    /ship does; otherwise it stages everything and ships that.
  const staged = await git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACDMRTUXB"]);
  const stagedPaths = parseNullSeparated(staged.stdout);
  let candidatePaths = stagedPaths;
  let heldBack: ReadonlySet<string> = new Set<string>();

  if (stagedPaths.length === 0) {
    const candidates = await git([
      "ls-files",
      "--modified",
      "--deleted",
      "--others",
      "--exclude-standard",
      "-z",
    ]);
    candidatePaths = [...new Set(parseNullSeparated(candidates.stdout))];
  } else {
    const unstaged = await git(["diff", "--name-only", "-z", "--diff-filter=ACM"]);
    heldBack = new Set(parseNullSeparated(unstaged.stdout));
  }

  const sensitive = candidatePaths.filter(isSensitivePath);
  checks.push(
    sensitive.length > 0
      ? fail("sensitive", "No sensitive paths", `refuses to commit ${sensitive.slice(0, 2).join(", ")}`)
      : pass("sensitive", "No sensitive paths"),
  );

  // 6. Ahead and behind, read from the refs already on disk. No fetch.
  let ahead = 0;
  let behind = 0;
  const base = destination ? `origin/${destination.ref}` : null;
  if (destination && (await remoteRefExists(git, destination.ref))) {
    const counts = await git(["rev-list", "--left-right", "--count", `${base}...HEAD`]);
    if (counts.code === 0) {
      const [left, right] = counts.stdout.trim().split(/\s+/);
      behind = Number.parseInt(left ?? "0", 10) || 0;
      ahead = Number.parseInt(right ?? "0", 10) || 0;
    }
    if (behind > 0) {
      checks.push(
        warn("base-sync", "Base branch not ahead", `${base} is ${behind} ahead; /ship rebases onto it`),
      );
    } else {
      checks.push(pass("base-sync", "Base branch not ahead"));
    }
    if (destination.kind === "trunk" && ahead > 0) {
      checks.push(
        warn(
          "riders",
          "No unrelated commits riding along",
          `/ship will ask before landing ${ahead} existing commit${ahead === 1 ? "" : "s"}`,
        ),
      );
    }
  } else if (destination) {
    checks.push(skip("base-sync", "Base branch not ahead", `${base} does not exist yet`));
  }

  // 7. Quality, cached against the exact tree it was run on.
  const checkFiles = candidatePaths.filter((path) => existsSync(join(repoRoot, path)));
  let qualityFromCache = false;

  if (candidatePaths.length > 0 && checks.every((check) => check.status !== "fail")) {
    const status = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const key = qualityKey(cwd, head, status.stdout, checkFiles, repoRoot);
    const cached = force ? undefined : readQualityCache(key);
    if (cached) {
      qualityFromCache = true;
      checks.push(...cached);
    } else {
      const quality = await runQualityChecks(repoRoot, gitDir, checkFiles, heldBack);
      writeQualityCache(key, quality);
      checks.push(...quality);
    }
  } else if (candidatePaths.length > 0) {
    checks.push(skip("quality", "Quality checks", "not run while a blocker is unresolved"));
  }

  return {
    kind: SHIP_VERDICT_KIND,
    version: SHIP_VERDICT_VERSION,
    checkedAt: new Date().toISOString(),
    cwd,
    isRepo: true,
    branch: branch ?? null,
    base,
    destinationKind: destination?.kind ?? null,
    destinationReason: destination?.reason ?? null,
    ahead,
    behind,
    changedFiles: candidatePaths.length,
    checks,
    qualityFromCache,
    error: null,
  };
}
