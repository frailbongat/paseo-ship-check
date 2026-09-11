/**
 * What `/ship` said when it finished, read back out of the text it said it in.
 *
 * The verdict card in `shared/timeline.ts` is computed: the daemon runs the
 * checks itself and publishes a row. This one is the opposite. The ship has
 * already happened somewhere this plugin was not, and all that is left of it is
 * a line of prose in the agent timeline:
 *
 *     Shipped 1a2b3c4 to origin/main.
 *
 * That line is the head of the step 8 report, which the agent writes into an
 * assistant message a token at a time. So the text this reads is a text that
 * grows, and the parser is written for a report that is half here.
 *
 * Everything after the shipped line is optional, because the two sources word
 * it differently and a model words it differently every run. A field that was
 * not said is `null` and the card says so, rather than the parser guessing.
 * Nothing but the shipped line itself decides whether this is a ship report at
 * all, which is what keeps an ordinary message ordinary.
 *
 * There is no phase to read. Paseo reports `streaming` for a loading thought
 * and a running tool call, and `complete` for a message row that is three
 * tokens in, so the text's own shape is the only evidence there is. The one
 * field that waits for that evidence is the destination: a card is read for its
 * branch name, and half of `origin/main` is a different branch.
 *
 * Nothing else waits, and the card shows no progress of its own. A subject that
 * fills in as it is typed is the report arriving, and Paseo's stream footer is
 * already saying that a turn is running.
 */

import { z } from "zod";

export const SHIP_RESULT_KIND = "ship-result";
export const SHIP_RESULT_VERSION = 1;

export const ShipResultSchema = z.object({
  /** The commit hash exactly as it was written, 7 to 40 hex characters. */
  sha: z.string(),
  /** The branch the commit landed on, `main` out of `origin/main`. */
  branch: z.string(),
  /** The remote it landed on, when the destination named one. */
  remote: z.string().nullable(),
  /** The commit subject, when the report repeated it. */
  subject: z.string().nullable(),
  /** Which checks ran, or why they were skipped, in the report's own words. */
  checks: z.string().nullable(),
  /** False for a commit whose push failed, which is still worth a card. */
  pushed: z.boolean(),
  /** Whatever else the report said, kept rather than dropped on the floor. */
  note: z.string().nullable(),
});

export type ShipResult = z.infer<typeof ShipResultSchema>;

/** Conventional Commit types, which is the shape `/ship` writes a subject in. */
const COMMIT_TYPES = "feat|fix|refactor|perf|docs|test|chore|build|ci|style|revert";
const SUBJECT_LINE = new RegExp(`^(?:${COMMIT_TYPES})(?:\\([^)]*\\))?!?: .+`);
/** A label the report may have put in front of the subject. */
const SUBJECT_LABEL = /^(?:subject|commit|message)\s*[:-]\s*/i;

const SHA = "[0-9a-f]{7,40}";
/**
 * The destination token. Stopped only by whitespace, a backtick, or a bracket,
 * because a branch name may carry dots and slashes; trailing sentence
 * punctuation is trimmed off afterwards instead of being excluded here.
 */
const TARGET = "[^\\s`)\\]]+";
/** `- `, `> `, and `**` are how a model dresses the same sentence up. */
const LINE_LEAD = "[ \\t]*(?:[-*>]\\s*)?(?:\\*\\*)?";

const SHIPPED = new RegExp(
  `(?:^|\\n)${LINE_LEAD}Shipped(?:\\*\\*)?\\s+\`?(${SHA})\`?\\s+to\\s+\`?(${TARGET})`,
  "i",
);
/**
 * The other ending worth a card: the commit exists and the push did not happen.
 * The skill asks for it explicitly, and it is the run where a reader most needs
 * the hash, because it is the only place the work is.
 */
const COMMITTED = new RegExp(
  `(?:^|\\n)${LINE_LEAD}Committed(?:\\*\\*)?\\s+\`?(${SHA})\`?\\s+but the push to\\s+\`?(${TARGET})\`?\\s+failed`,
  "i",
);

const CHECKS_LABEL = /^(?:checks?|quality checks?|scoped checks?)\s*[:-]\s*(.+)$/i;
/** A sentence about checks has to name one and say what became of it. */
const CHECK_SUBJECTS = /\b(checks?|lint(?:ing)?|prettier|eslint|ruff|gofmt|rustfmt|pre-commit)\b/i;
const CHECK_OUTCOMES = /\b(ran|run|passed|clean|skipp?ed|skip|none|no)\b/i;

/**
 * Remote names, because `origin/main` and `feature/login` are the same shape.
 * The destination is a remote-qualified ref when `/ship` targets a trunk and a
 * bare branch otherwise, and only the first word tells the two apart. A remote
 * named something else loses its half of the branch line and nothing more.
 */
const KNOWN_REMOTES = new Set(["origin", "upstream", "fork", "github", "gitlab"]);

/** Past this a field stops being a line on a card and starts being a page. */
const MAX_FIELD_LENGTH = 160;
const MAX_NOTE_LINES = 6;
const MAX_NOTE_LENGTH = 400;

function trimPunctuation(value: string): string {
  return value.replace(/[.,;:]+$/, "");
}

function cap(value: string, limit = MAX_FIELD_LENGTH): string {
  const text = value.trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/** A line with its Markdown taken off, so one regex can read either source. */
function undress(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]\s+|>\s*)?/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
}

export function splitTarget(target: string): { remote: string | null; branch: string } {
  const slash = target.indexOf("/");
  if (slash <= 0) return { remote: null, branch: target };
  const head = target.slice(0, slash);
  if (!KNOWN_REMOTES.has(head.toLowerCase())) return { remote: null, branch: target };
  return { remote: head, branch: target.slice(slash + 1) };
}

/** Seven characters is what git prints and what the card has room for. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * Whether the destination that was just matched is the whole destination.
 *
 * `origin/main` and `origin/mai` are both a token followed by nothing, and the
 * card is the one place a reader takes a branch name at its word. Sentence
 * punctuation on the end settles it, and so does any character at all after it,
 * because the writer has moved on. A report that has run out of text on a bare
 * branch name is not read as one until it says something else, which costs the
 * card a token and saves it from naming a branch that does not exist.
 */
function destinationSettled(text: string, end: number, target: string): boolean {
  return /[.,;:)]$/.test(target) || end < text.length;
}

function findSubject(lines: string[], skip: Set<number>): { subject: string; line: number } | null {
  for (const [index, raw] of lines.entries()) {
    if (skip.has(index)) continue;
    const line = undress(raw).replace(SUBJECT_LABEL, "");
    if (SUBJECT_LINE.test(line)) return { subject: cap(line), line: index };
  }
  return null;
}

function findChecks(lines: string[], skip: Set<number>): { checks: string; line: number } | null {
  for (const [index, raw] of lines.entries()) {
    if (skip.has(index)) continue;
    const labelled = CHECKS_LABEL.exec(undress(raw));
    if (labelled?.[1]) return { checks: cap(labelled[1]), line: index };
  }
  for (const [index, raw] of lines.entries()) {
    if (skip.has(index)) continue;
    const line = undress(raw);
    if (!CHECK_SUBJECTS.test(line) || !CHECK_OUTCOMES.test(line)) continue;
    return { checks: cap(line), line: index };
  }
  return null;
}

/**
 * Everything the card did not claim, kept as one muted block.
 *
 * A report carries the commit body, a push that needs a follow-up, a local
 * trunk left behind, and whatever else the agent had to say, and none of it is
 * the plugin's to throw away: the message this replaces showed all of it.
 * Fenced output is dropped, because a card is not a terminal and the fence is
 * the one thing in a report that was never prose.
 */
function collectNote(lines: string[], skip: Set<number>): string | null {
  const kept: string[] = [];
  let fenced = false;
  for (const [index, raw] of lines.entries()) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || skip.has(index)) continue;
    const line = undress(raw);
    if (!line) continue;
    kept.push(/^\s*[-*+]\s+/.test(raw) ? `· ${line}` : line);
    if (kept.length === MAX_NOTE_LINES) break;
  }
  const note = kept.join("\n");
  return note ? cap(note, MAX_NOTE_LENGTH) : null;
}

/** Which line of the report a character offset fell on. */
function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split(/\r?\n/).length - 1;
}

/**
 * Read a ship report out of one message's text, or decide it is not one.
 *
 * Pure and synchronous, because a timeline transformer is both. `null` is the
 * ordinary answer: nearly every message that reaches this is not a ship report,
 * and the item goes on rendering the way it always did.
 */
export function parseShipReport(text: string): ShipResult | null {
  const failed = COMMITTED.exec(text);
  const shipped = failed ? null : SHIPPED.exec(text);
  const match = failed ?? shipped;
  if (!match) return null;

  const [sentence, sha, rawTarget] = match;
  if (!sha || !rawTarget) return null;
  if (!destinationSettled(text, match.index + sentence.length, rawTarget)) return null;

  const { remote, branch } = splitTarget(trimPunctuation(rawTarget));
  if (!branch) return null;

  // Every line, including the half-written one on the end. A subject that fills
  // in as it is typed is the report arriving; a destination that does the same
  // is a lie the reader would have copied, which is why only that one waits.
  const lines = text.split(/\r?\n/);
  const claimed = new Set<number>();
  // The pattern opens on the newline in front of the sentence, so the sentence
  // itself starts one character later whenever it matched one.
  const start = match.index + (sentence.startsWith("\n") ? 1 : 0);
  for (let line = lineAt(text, start); line <= lineAt(text, match.index + sentence.length); line++) {
    claimed.add(line);
  }

  const subject = findSubject(lines, claimed);
  if (subject) claimed.add(subject.line);
  const checks = findChecks(lines, claimed);
  if (checks) claimed.add(checks.line);

  return {
    sha,
    branch,
    remote,
    subject: subject?.subject ?? null,
    checks: checks?.checks ?? null,
    pushed: failed === null,
    note: collectNote(lines, claimed),
  };
}
