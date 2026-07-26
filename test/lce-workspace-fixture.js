// 供 LCE 索引相关测试共享的最小 vscode workspace 桩：
// primary/fallback 控制两轮 findFiles 的返回，statFailures/readFailures 控制
// 单文件失败注入，directories 供 probeWorkspaceRoots 的目录遍历使用。
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

module.exports = { createWorkspaceFixture };
