#!/usr/bin/env node
import path from "node:path";
import { syncIndexFromBackup } from "./text-edit-shared.mjs";

const backupFile = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const result = await syncIndexFromBackup(backupFile);

if (!result.editCount) {
  console.log("No text edit backup found. index.html was left unchanged.");
} else if (!result.changedCount) {
  console.log(
    `Text edit backup is already in sync. ${result.editCount} saved edits checked.`,
  );
} else {
  const source = backupFile || "page-backups/text-edits.json";
  console.log(
    `Synced ${result.changedCount} text edits into index.html from ${source}.`,
  );
}

if (result.missingPaths.length) {
  console.warn(
    `Warning: ${result.missingPaths.length} saved edit paths were not found in index.html.`,
  );
}
