import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..");
export const INDEX_FILE = path.join(ROOT_DIR, "index.html");
export const BACKUP_DIR = path.join(ROOT_DIR, "page-backups");
export const BACKUP_FILE = path.join(BACKUP_DIR, "text-edits.json");

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export function normalizeEdits(edits) {
  if (!edits || typeof edits !== "object") return {};

  return Object.fromEntries(
    Object.entries(edits)
      .filter(([pathKey, value]) => pathKey && typeof value === "string")
      .map(([pathKey, value]) => [pathKey, normalizeEditableText(value)]),
  );
}

function normalizeEditableText(value) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

export function readBackupPayload(rawValue) {
  const payload = JSON.parse(rawValue);
  const edits = payload?.edits && typeof payload.edits === "object" ? payload.edits : payload;

  return {
    version: payload?.version || 1,
    updatedAt: payload?.updatedAt || null,
    edits: normalizeEdits(edits),
  };
}

export async function readTextEditBackup(filePath = BACKUP_FILE) {
  try {
    return readBackupPayload(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, updatedAt: null, edits: {} };
    }

    throw error;
  }
}

export async function writeTextEditBackup(edits) {
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    edits: normalizeEdits(edits),
  };

  await mkdir(BACKUP_DIR, { recursive: true });
  await writeFile(BACKUP_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

export async function syncIndexFromBackup(filePath = BACKUP_FILE) {
  const backup = await readTextEditBackup(filePath);

  if (path.resolve(filePath) !== path.resolve(BACKUP_FILE)) {
    await mkdir(BACKUP_DIR, { recursive: true });
    await writeFile(BACKUP_FILE, `${JSON.stringify(backup, null, 2)}\n`);
  }

  const html = await readFile(INDEX_FILE, "utf8");
  const result = applyTextEditsToHtml(html, backup.edits);

  if (result.html !== html) {
    await writeFile(INDEX_FILE, result.html);
  }

  return {
    ...result,
    updatedAt: backup.updatedAt,
    editCount: Object.keys(backup.edits).length,
  };
}

export function applyTextEditsToHtml(html, editsInput) {
  const edits = normalizeEdits(editsInput);
  const wantedPaths = new Set(Object.keys(edits));
  const replacements = [];
  const seenPaths = new Set();
  const stack = [{ tag: "#document", path: "", childCounts: new Map() }];
  const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[^>]+?>/g;
  let tokenMatch;

  while ((tokenMatch = tokenPattern.exec(html))) {
    const token = tokenMatch[0];
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;

    const closeMatch = token.match(/^<\s*\/\s*([a-zA-Z][\w:-]*)/);
    if (closeMatch) {
      const closingTag = closeMatch[1].toLowerCase();
      let frameIndex = stack.length - 1;

      while (frameIndex > 0 && stack[frameIndex].tag !== closingTag) {
        frameIndex -= 1;
      }

      if (frameIndex <= 0) continue;

      const frame = stack.splice(frameIndex)[0];

      if (wantedPaths.has(frame.path)) {
        replacements.push({
          start: frame.contentStart,
          end: tokenMatch.index,
          value: escapeTextForHtml(edits[frame.path]),
        });
        seenPaths.add(frame.path);
      }

      continue;
    }

    const openMatch = token.match(/^<\s*([a-zA-Z][\w:-]*)\b/);
    if (!openMatch) continue;

    const tag = openMatch[1].toLowerCase();
    const parent = stack[stack.length - 1];
    const nextIndex = (parent.childCounts.get(tag) || 0) + 1;
    parent.childCounts.set(tag, nextIndex);

    const childPath =
      parent.tag === "body"
        ? `${tag}:nth-of-type(${nextIndex})`
        : parent.path
          ? `${parent.path}>${tag}:nth-of-type(${nextIndex})`
          : "";

    const isSelfClosing = token.endsWith("/>") || VOID_TAGS.has(tag);
    if (isSelfClosing) continue;

    stack.push({
      tag,
      path: childPath,
      childCounts: new Map(),
      contentStart: tokenMatch.index + token.length,
    });
  }

  let nextHtml = html;
  replacements
    .sort((a, b) => b.start - a.start)
    .forEach((replacement) => {
      nextHtml =
        nextHtml.slice(0, replacement.start) +
        replacement.value +
        nextHtml.slice(replacement.end);
    });

  return {
    html: nextHtml,
    changedCount: replacements.length,
    missingPaths: [...wantedPaths].filter((pathKey) => !seenPaths.has(pathKey)),
  };
}

function escapeTextForHtml(value) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");
}
