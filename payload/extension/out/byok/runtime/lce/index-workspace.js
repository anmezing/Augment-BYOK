"use strict";

const crypto = require("crypto");
const { execFile } = require("child_process");

const MAX_FILE_SIZE = 512 * 1024;
const ESTIMATED_CHUNK_BYTES = 1500;
const EXCLUDE_GLOB = "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**,**/__pycache__/**}";
const EXCLUDE_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
  /(^|\/)(dist|build|\.next|__pycache__)\//,
  /\.(pyc|class|o|so|dll|exe|wasm|map)$/i,
  /\.min\.(js|css)$/i,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i,
  /(^|\/)\.env(?:\.|$)/i,
  /\.(pem|key|cert|png|jpe?g|gif|ico|svg|woff2?|ttf|eot|mp[34]|zip|tar|gz|rar|pdf)$/i
];

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

function shouldExclude(value) {
  const filePath = normalizePath(value);
  return !filePath || EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function fileHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function estimateChunks(content) {
  const bytes = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(String(content || ""), "utf8");
  return Math.max(1, Math.ceil(bytes / ESTIMATED_CHUNK_BYTES));
}

function isLikelyText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  for (const byte of sample) {
    if (byte === 0) return false;
  }
  return true;
}

function workspaceIdentity(folders) {
  const entries = (Array.isArray(folders) ? folders : [])
    .map((folder) => ({
      name: String(folder && folder.name || ""),
      uri: String(folder && folder.uri && typeof folder.uri.toString === "function" ? folder.uri.toString() : "")
    }))
    .filter((entry) => entry.uri)
    .sort((a, b) => a.uri.localeCompare(b.uri));
  const source = entries.map((entry) => entry.uri).join("\n");
  return {
    workspaceId: crypto.createHash("sha256").update(source).digest("hex").slice(0, 32),
    workspaceName: entries.map((entry) => entry.name).filter(Boolean).join(", ")
  };
}

function runGit(folderPath, args) {
  return new Promise((resolve) => {
    if (!folderPath) {
      resolve("");
      return;
    }
    execFile("git", ["-C", folderPath, ...args], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      resolve(err ? "" : String(stdout || "").trim());
    });
  });
}

async function getGitState(folders) {
  const list = Array.isArray(folders) ? folders : [];
  const states = await Promise.all(list.map(async (folder) => {
    const folderPath = folder && folder.uri ? folder.uri.fsPath : "";
    const [branch, revision] = await Promise.all([
      runGit(folderPath, ["rev-parse", "--abbrev-ref", "HEAD"]),
      runGit(folderPath, ["rev-parse", "HEAD"])
    ]);
    const name = String(folder && folder.name || "workspace");
    return { name, branch, revision };
  }));
  return {
    branch: states.map((item) => `${item.name}:${item.branch || "unknown"}`).join(","),
    revision: states.map((item) => `${item.name}:${item.revision || "unknown"}`).join(",")
  };
}

async function buildWorkspaceManifest(vscode, onProgress) {
  const folders = vscode && vscode.workspace ? vscode.workspace.workspaceFolders : null;
  if (!Array.isArray(folders) || !folders.length) return null;

  const identity = workspaceIdentity(folders);
  const git = await getGitState(folders);
  const uris = await vscode.workspace.findFiles("**/*", EXCLUDE_GLOB);
  const files = [];
  let visited = 0;

  for (const uri of uris) {
    visited += 1;
    if (typeof onProgress === "function") onProgress(visited, uris.length);
    const relativePath = normalizePath(vscode.workspace.asRelativePath(uri, false));
    if (shouldExclude(relativePath)) continue;

    let stat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      continue;
    }
    if (!stat || stat.size <= 0 || stat.size > MAX_FILE_SIZE) continue;

    let raw;
    try {
      raw = Buffer.from(await vscode.workspace.fs.readFile(uri));
    } catch {
      continue;
    }
    if (!raw.length || !isLikelyText(raw)) continue;
    files.push({
      path: relativePath,
      hash: fileHash(raw),
      size: raw.length,
      estimatedChunks: estimateChunks(raw),
      uri
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { ...identity, ...git, files };
}

async function readFileForIndex(vscode, file) {
  let raw;
  try {
    raw = Buffer.from(await vscode.workspace.fs.readFile(file.uri));
  } catch {
    throw new Error(`unable to read pending index file: ${file.path}`);
  }
  if (!raw.length || raw.length > MAX_FILE_SIZE || !isLikelyText(raw)) {
    throw new Error(`pending index file is no longer indexable: ${file.path}`);
  }
  if (fileHash(raw) !== file.hash) {
    throw new Error(`pending index file changed during scan: ${file.path}`);
  }
  return { ...file, content: raw.toString("utf8") };
}

module.exports = {
  MAX_FILE_SIZE,
  buildWorkspaceManifest,
  estimateChunks,
  fileHash,
  isLikelyText,
  normalizePath,
  readFileForIndex,
  shouldExclude,
  workspaceIdentity
};
