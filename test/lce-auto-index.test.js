const test = require("node:test");
const assert = require("node:assert/strict");

const { formatProgress, isGitPath, startWatching, stopWatching } = require("../payload/extension/out/byok/runtime/lce/auto-index");
const { createIndexJob, uploadIndexBatch } = require("../payload/extension/out/byok/runtime/lce/index-relay");
const {
  estimateChunks,
  fileHash,
  isLikelyText,
  normalizePath,
  readFileForIndex,
  shouldExclude,
  workspaceIdentity
} = require("../payload/extension/out/byok/runtime/lce/index-workspace");

test("LCE workspace manifest helpers normalize, hash and estimate files", () => {
  assert.equal(normalizePath(String.raw`src\feature\index.js`), "src/feature/index.js");
  assert.equal(shouldExclude("src/index.js"), false);
  assert.equal(shouldExclude("node_modules/pkg/index.js"), true);
  assert.equal(shouldExclude("dist/app.js"), true);
  assert.equal(isLikelyText(Buffer.from("const value = 1;\n")), true);
  assert.equal(isLikelyText(Buffer.from([1, 0, 2])), false);
  assert.equal(fileHash(Buffer.from("same")), fileHash(Buffer.from("same")));
  assert.notEqual(fileHash(Buffer.from("same")), fileHash(Buffer.from("changed")));
  assert.equal(estimateChunks(Buffer.alloc(1)), 1);
  assert.equal(estimateChunks(Buffer.alloc(1501)), 2);
});

test("LCE workspace identity is stable across folder ordering", () => {
  const folder = (name, uri) => ({ name, uri: { toString: () => uri } });
  const first = workspaceIdentity([
    folder("b", "file:///workspace/b"),
    folder("a", "file:///workspace/a")
  ]);
  const second = workspaceIdentity([
    folder("a", "file:///workspace/a"),
    folder("b", "file:///workspace/b")
  ]);
  assert.equal(first.workspaceId, second.workspaceId);
  assert.equal(first.workspaceName, "a, b");
});

test("LCE pending files are read lazily and verified against the manifest hash", async () => {
  const uri = { fsPath: "src/index.js" };
  const raw = Buffer.from("const value = 1;\n");
  const vscode = {
    workspace: {
      fs: {
        readFile: async (actualUri) => {
          assert.equal(actualUri, uri);
          return raw;
        }
      }
    }
  };
  const file = {
    uri,
    path: "src/index.js",
    hash: fileHash(raw),
    size: raw.length,
    estimatedChunks: 1
  };

  const loaded = await readFileForIndex(vscode, file);
  assert.equal(loaded.content, raw.toString("utf8"));
  await assert.rejects(
    () => readFileForIndex(vscode, { ...file, hash: "stale" }),
    /changed during scan/
  );
});

test("LCE status progress includes file and chunk counts", () => {
  assert.equal(formatProgress({
    totalFiles: 8,
    indexedFiles: 2,
    totalChunks: 40,
    indexedChunks: 10,
    chunkCountEstimated: true
  }), "25% 2/8 files | ~10/~40 chunks");
});

test("LCE general watcher ignores git internals", () => {
  assert.equal(isGitPath({ fsPath: String.raw`C:\repo\.git\index` }), true);
  assert.equal(isGitPath({ path: "/repo/.git/refs/heads/main" }), true);
  assert.equal(isGitPath({ path: "/repo/src/git-client.js" }), false);
});

test("LCE index relay sends manifests and pending content to the new protocol", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ job: { id: "job-1" }, pendingFiles: ["src/index.js"] })
    };
  };

  try {
    const connection = { completionURL: "https://relay.example/relay/", apiToken: "token-1" };
    const file = {
      path: "src/index.js",
      hash: "hash-1",
      size: 12,
      estimatedChunks: 1,
      content: "const x = 1;"
    };
    await createIndexJob(connection, {
      workspaceId: "workspace-1",
      workspaceName: "workspace",
      branch: "main",
      revision: "abc",
      files: [file]
    });
    await uploadIndexBatch(connection, "job-1", [file]);
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://relay.example/relay/index-jobs");
  assert.equal(calls[1].url, "https://relay.example/relay/remote-index");
  assert.equal(calls[0].init.headers.authorization, "Bearer token-1");
  assert.deepEqual(JSON.parse(calls[0].init.body).files, [{
    path: "src/index.js",
    hash: "hash-1",
    size: 12,
    estimatedChunks: 1
  }]);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    jobId: "job-1",
    files: [{
      path: "src/index.js",
      hash: "hash-1",
      content: "const x = 1;",
      estimatedChunks: 1
    }]
  });
});

test("LCE watchers dispose every listener and watcher", () => {
  const disposed = [];
  const disposable = (name) => ({ dispose: () => disposed.push(name) });
  let watcherNumber = 0;
  const vscode = {
    StatusBarAlignment: { Left: 1 },
    window: {
      createStatusBarItem: () => ({ show() {}, dispose() {} })
    },
    workspace: {
      workspaceFolders: [],
      onDidSaveTextDocument: () => disposable("save"),
      createFileSystemWatcher: () => {
        watcherNumber += 1;
        const id = watcherNumber;
        return {
          dispose: () => disposed.push(`watcher-${id}`),
          onDidCreate: () => disposable(`create-${id}`),
          onDidChange: () => disposable(`change-${id}`),
          onDidDelete: () => disposable(`delete-${id}`)
        };
      }
    }
  };

  const watcher = startWatching(vscode, {
    getConnection: () => ({ completionURL: "https://relay.example/relay/", apiToken: "session-token" })
  });
  watcher.dispose();
  assert.equal(disposed.length, 17);
  assert.equal(disposed.includes("save"), true);
  assert.equal(disposed.includes("watcher-4"), true);
  stopWatching();
});
