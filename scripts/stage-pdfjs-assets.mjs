#!/usr/bin/env node

import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(projectRoot, "node_modules", "pdfjs-dist");
const pdfjsVersion = "6.2.108";
const publicAssetRoot = resolve(projectRoot, "public", "pdfjs");
const outputRoot = resolve(publicAssetRoot, pdfjsVersion);
const relativeAssetRoot = relative(projectRoot, publicAssetRoot).replaceAll("\\", "/");
const relativeOutput = relative(projectRoot, outputRoot);

if (relativeAssetRoot !== "public/pdfjs" || relativeOutput.startsWith("..") || relativeOutput === "") {
  throw new Error("Refusing to stage PDF.js assets outside the project public directory.");
}

const packageMetadata = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
if (packageMetadata.version !== pdfjsVersion) {
  throw new Error(`Expected pdfjs-dist ${pdfjsVersion}, found ${String(packageMetadata.version)}.`);
}

const sources = [
  ["build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
  ["cmaps", "cmaps"],
  ["standard_fonts", "standard_fonts"],
  ["wasm", "wasm"],
];

for (const [source] of sources) {
  await stat(resolve(packageRoot, source));
}

await rm(publicAssetRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
for (const [source, destination] of sources) {
  await cp(resolve(packageRoot, source), resolve(outputRoot, destination), { recursive: true });
}
