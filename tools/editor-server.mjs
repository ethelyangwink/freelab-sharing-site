#!/usr/bin/env node
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  ROOT_DIR,
  readTextEditBackup,
  syncIndexFromBackup,
  writeTextEditBackup,
} from "./text-edit-shared.mjs";

const DEFAULT_PORT = 8080;
const PORT = Number(process.env.PORT || process.argv[2] || DEFAULT_PORT);
const MAX_BODY_SIZE = 1024 * 1024;

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

const server = createServer(async (request, response) => {
  try {
    if (request.url === "/api/text-edits" && request.method === "GET") {
      await sendJson(response, await readTextEditBackup());
      return;
    }

    if (request.url === "/api/text-edits" && request.method === "POST") {
      const payload = await readJsonBody(request);
      const backup = await writeTextEditBackup(payload.edits);
      const syncResult = await syncIndexFromBackup();

      await sendJson(response, {
        ok: true,
        updatedAt: backup.updatedAt,
        editCount: Object.keys(backup.edits).length,
        syncedCount: syncResult.changedCount,
        missingPaths: syncResult.missingPaths,
      });
      return;
    }

    if (request.url === "/api/text-edits" && request.method === "DELETE") {
      const backup = await writeTextEditBackup({});

      await sendJson(response, {
        ok: true,
        updatedAt: backup.updatedAt,
        editCount: 0,
      });
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    console.error(error);
    await sendJson(response, { ok: false, error: error.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`Freelab editor server running at http://localhost:${PORT}`);
});

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT_DIR, relativePath);

  if (!filePath.startsWith(ROOT_DIR + path.sep) && filePath !== ROOT_DIR) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  if (!fileStat.isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}
