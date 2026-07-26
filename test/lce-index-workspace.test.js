const test = require("node:test");
const assert = require("node:assert/strict");

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
const { createWorkspaceFixture } = require("./lce-workspace-fixture");

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
  assert.deepEqual(manifest.unreadableFiles, ["read-failure.txt", "stat-failure.txt"]);
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
  assert.deepEqual(manifest.unreadableFiles, []);
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
