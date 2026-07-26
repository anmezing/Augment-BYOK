const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatProgress,
  isGitPath,
  startWatching,
  stopWatching,
  triggerIndexNow
} = require("../payload/extension/out/byok/runtime/lce/auto-index");
const { createIndexJob, uploadIndexBatch } = require("../payload/extension/out/byok/runtime/lce/index-relay");
const {
  MAX_FILE_SIZE,
  buildWorkspaceManifest,
  estimateChunks,
  fileHash,
  formatScanStats,
  isLikelyText,
  normalizePath,
  readFileForIndex,
  shouldExclude,
  workspaceIdentity
} = require("../payload/extension/out/byok/runtime/lce/index-workspace");

function createWorkspaceFixture({
  primary = [],
  fallback = [],
  directories = {},
  files = {},
  statFailures = [],
  readFailures = []
} = {}) {
  const statFailureSet = new Set(statFailures);
  const readFailureSet = new Set(readFailures);
  const uri = (relativePath = "") => ({
    key: relativePath,
    fsPath: "",
    toString: () => `file:///workspace${relativePath ? `/${relativePath}` : ""}`
  });
  const rootUri = uri();
  const fileUris = new Map(Object.keys(files).map((relativePath) => [relativePath, uri(relativePath)]));
  const findCalls = [];
  const vscode = {
    Uri: {
      joinPath(base, name) {
        return uri([base.key, name].filter(Boolean).join("/"));
      }
    },
    workspace: {
      workspaceFolders: [{ name: "workspace", uri: rootUri }],
      async findFiles(include, exclude) {
        findCalls.push({ include, exclude });
        const paths = findCalls.length === 1 ? primary : fallback;
        return paths.map((relativePath) => fileUris.get(relativePath) || uri(relativePath));
      },
      asRelativePath(actualUri) {
        return actualUri.key;
      },
      fs: {
        async readDirectory(actualUri) {
          return directories[actualUri.key] || [];
        },
        async stat(actualUri) {
          if (statFailureSet.has(actualUri.key)) throw new Error("fixture stat failure");
          const raw = files[actualUri.key];
          if (!raw) throw new Error("missing fixture file");
          return { size: raw.length };
        },
        async readFile(actualUri) {
          if (readFailureSet.has(actualUri.key)) throw new Error("fixture read failure");
          const raw = files[actualUri.key];
          if (!raw) throw new Error("missing fixture file");
          return raw;
        }
      }
    }
  };
  return { findCalls, rootUri, uri, vscode };
}

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

test("LCE scan stats use stable labels", () => {
  assert.equal(formatScanStats({
    primaryDiscovered: 1,
    fallbackDiscovered: 2,
    excluded: 3,
    empty: 4,
    oversized: 5,
    binary: 6,
    statFailures: 7,
    readFailures: 8,
    indexable: 9
  }), "primary=1 fallback=2 excluded=3 empty=4 oversized=5 binary=6 statFailures=7 readFailures=8 indexable=9");
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

test("LCE workspace discovery retries without excludes when root probing finds candidates", async () => {
  const raw = Buffer.from("const value = 1;\n");
  const fixture = createWorkspaceFixture({
    primary: [],
    fallback: ["src/index.js"],
    directories: {
      "": [["src", 2]],
      src: [["index.js", 1]]
    },
    files: {
      "src/index.js": raw
    }
  });

  const manifest = await buildWorkspaceManifest(fixture.vscode);
  assert.equal(fixture.findCalls.length, 2);
  assert.equal(fixture.findCalls[1].exclude, null);
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.files[0].path, "src/index.js");
  assert.equal(manifest.scanStats.primaryDiscovered, 0);
  assert.equal(manifest.scanStats.fallbackDiscovered, 1);
  assert.equal(manifest.scanStats.indexable, 1);
});

test("LCE workspace scan counts every filtering and inspection result", async () => {
  const paths = [
    "node_modules/pkg.js",
    "empty.txt",
    "oversized.txt",
    "binary.dat",
    "stat-failure.txt",
    "read-failure.txt",
    "src/index.js"
  ];
  const fixture = createWorkspaceFixture({
    primary: paths,
    files: {
      "node_modules/pkg.js": Buffer.from("excluded"),
      "empty.txt": Buffer.alloc(0),
      "oversized.txt": Buffer.alloc(MAX_FILE_SIZE + 1),
      "binary.dat": Buffer.from([1, 0, 2]),
      "read-failure.txt": Buffer.from("unreadable"),
      "src/index.js": Buffer.from("const value = 1;\n")
    },
    statFailures: ["stat-failure.txt"],
    readFailures: ["read-failure.txt"]
  });

  const manifest = await buildWorkspaceManifest(fixture.vscode);
  assert.deepEqual(manifest.scanStats, {
    primaryDiscovered: 7,
    fallbackDiscovered: 0,
    excluded: 1,
    empty: 1,
    oversized: 1,
    binary: 1,
    statFailures: 1,
    readFailures: 1,
    indexable: 1
  });
  assert.deepEqual(manifest.files.map((file) => file.path), ["src/index.js"]);
});

test("LCE workspace discovery fails explicitly when findFiles misses proven candidates", async () => {
  const fixture = createWorkspaceFixture({
    primary: [],
    fallback: [],
    directories: {
      "": [["src", 2]],
      src: [["index.js", 1]]
    }
  });

  await assert.rejects(
    () => buildWorkspaceManifest(fixture.vscode),
    /findFiles returned 0 files although workspace roots contain candidate files/
  );
  assert.equal(fixture.findCalls.length, 2);
});

test("LCE workspace discovery recognizes a truly empty workspace", async () => {
  const fixture = createWorkspaceFixture({
    primary: [],
    directories: { "": [] }
  });

  const manifest = await buildWorkspaceManifest(fixture.vscode);
  assert.equal(fixture.findCalls.length, 1);
  assert.equal(manifest.files.length, 0);
  assert.equal(manifest.scanStats.indexable, 0);
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

test("LCE true empty workspace does not create an index job", async () => {
  const fixture = createWorkspaceFixture({
    primary: [],
    directories: { "": [] }
  });
  let statusText = "";
  let fetchCalls = 0;
  const disposable = () => ({ dispose() {} });
  fixture.vscode.StatusBarAlignment = { Left: 1 };
  fixture.vscode.window = {
    createStatusBarItem: () => ({
      set text(value) { statusText = value; },
      get text() { return statusText; },
      show() {},
      dispose() {}
    })
  };
  fixture.vscode.workspace.onDidSaveTextDocument = disposable;
  fixture.vscode.workspace.createFileSystemWatcher = () => ({
    dispose() {},
    onDidCreate: disposable,
    onDidChange: disposable,
    onDidDelete: disposable
  });

  const originalFetch = global.fetch;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("index job must not be created");
  };
  try {
    startWatching(fixture.vscode, {
      getConnection: () => ({ completionURL: "https://relay.example/relay/", apiToken: "session-token" })
    });
    const result = await triggerIndexNow();
    assert.equal(result, null);
    assert.equal(fetchCalls, 0);
    assert.match(statusText, /LCE: no indexable files/);
  } finally {
    stopWatching();
    global.fetch = originalFetch;
  }
});
