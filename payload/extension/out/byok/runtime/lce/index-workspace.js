"use strict";

const crypto = require("crypto");
const { execFile } = require("child_process");

const MAX_FILE_SIZE = 512 * 1024;
const ESTIMATED_CHUNK_BYTES = 1500;
const EXCLUDE_GLOB = "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**,**/__pycache__/**}";
const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;
const FILE_TYPE_SYMBOLIC_LINK = 64;
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

function createScanStats() {
  return {
    primaryDiscovered: 0,
    fallbackDiscovered: 0,
    excluded: 0,
    empty: 0,
    oversized: 0,
    binary: 0,
    statFailures: 0,
    readFailures: 0,
    indexable: 0
  };
}

function formatScanStats(stats) {
  const value = stats && typeof stats === "object" ? stats : {};
  return [
    `primary=${Number(value.primaryDiscovered) || 0}`,
    `fallback=${Number(value.fallbackDiscovered) || 0}`,
    `excluded=${Number(value.excluded) || 0}`,
    `empty=${Number(value.empty) || 0}`,
    `oversized=${Number(value.oversized) || 0}`,
    `binary=${Number(value.binary) || 0}`,
    `statFailures=${Number(value.statFailures) || 0}`,
    `readFailures=${Number(value.readFailures) || 0}`,
    `indexable=${Number(value.indexable) || 0}`
  ].join(" ");
}

function joinUri(vscode, baseUri, name) {
  if (!vscode || !vscode.Uri || typeof vscode.Uri.joinPath !== "function") {
    throw new Error("LCE workspace scan requires vscode.Uri.joinPath");
  }
  return vscode.Uri.joinPath(baseUri, name);
}

async function probeWorkspaceRoots(vscode, folders) {
  const result = { candidateFiles: 0, readFailures: 0 };
  for (const folder of folders) {
    if (!folder || !folder.uri) continue;
    const pending = [{ uri: folder.uri, relativePath: "" }];
    while (pending.length) {
      const current = pending.pop();
      let entries;
      try {
        entries = await vscode.workspace.fs.readDirectory(current.uri);
      } catch {
        result.readFailures += 1;
        continue;
      }
      for (const entry of Array.isArray(entries) ? entries : []) {
        const name = String(entry && entry[0] || "");
        const type = Number(entry && entry[1]) || 0;
        if (!name) continue;
        const relativePath = normalizePath(current.relativePath ? `${current.relativePath}/${name}` : name);
        const isDirectory = (type & FILE_TYPE_DIRECTORY) !== 0;
        const isSymbolicLink = (type & FILE_TYPE_SYMBOLIC_LINK) !== 0;
        if (shouldExclude(isDirectory ? `${relativePath}/` : relativePath)) continue;
        if (isDirectory && !isSymbolicLink) {
          pending.push({ uri: joinUri(vscode, current.uri, name), relativePath });
          continue;
        }
        if ((type & FILE_TYPE_FILE) !== 0 || !isDirectory) {
          result.candidateFiles = 1;
          return result;
        }
      }
    }
  }
  return result;
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
  const stats = createScanStats();
  const primary = await vscode.workspace.findFiles("**/*", EXCLUDE_GLOB);
  stats.primaryDiscovered = Array.isArray(primary) ? primary.length : 0;
  let uris = Array.isArray(primary) ? primary : [];

  if (uris.length === 0) {
    const probe = await probeWorkspaceRoots(vscode, folders);
    stats.readFailures += probe.readFailures;
    if (probe.candidateFiles > 0 || probe.readFailures > 0) {
      const fallback = await vscode.workspace.findFiles("**/*", null);
      stats.fallbackDiscovered = Array.isArray(fallback) ? fallback.length : 0;
      uris = Array.isArray(fallback) ? fallback : [];
      if (uris.length === 0) {
        const reason = probe.candidateFiles > 0
          ? "workspace roots contain candidate files"
          : "workspace roots could not be fully inspected";
        throw new Error(`LCE workspace scan failed: findFiles returned 0 files although ${reason}`);
      }
    }
  }

  const files = [];
  let fileReadFailures = 0;
  let visited = 0;

  for (const uri of uris) {
    visited += 1;
    if (typeof onProgress === "function") onProgress(visited, uris.length);
    const relativePath = normalizePath(vscode.workspace.asRelativePath(uri, false));
    if (shouldExclude(relativePath)) {
      stats.excluded += 1;
      continue;
    }

    let stat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      stats.statFailures += 1;
      continue;
    }
    if (!stat || stat.size <= 0) {
      stats.empty += 1;
      continue;
    }
    if (stat.size > MAX_FILE_SIZE) {
      stats.oversized += 1;
      continue;
    }

    let raw;
    try {
      raw = Buffer.from(await vscode.workspace.fs.readFile(uri));
    } catch {
      stats.readFailures += 1;
      fileReadFailures += 1;
      continue;
    }
    if (!raw.length) {
      stats.empty += 1;
      continue;
    }
    if (!isLikelyText(raw)) {
      stats.binary += 1;
      continue;
    }
    files.push({
      path: relativePath,
      hash: fileHash(raw),
      size: raw.length,
      estimatedChunks: estimateChunks(raw),
      uri
    });
    stats.indexable += 1;
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  if (files.length === 0 && stats.statFailures + fileReadFailures > 0) {
    throw new Error(`LCE workspace scan failed: no files could be indexed (${formatScanStats(stats)})`);
  }
  return { ...identity, ...git, files, scanStats: stats };
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
  createScanStats,
  estimateChunks,
  fileHash,
  formatScanStats,
  isLikelyText,
  normalizePath,
  probeWorkspaceRoots,
  readFileForIndex,
  shouldExclude,
  workspaceIdentity
};
