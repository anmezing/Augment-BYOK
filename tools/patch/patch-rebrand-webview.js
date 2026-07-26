"use strict";

const fs = require("fs");
const path = require("path");

const { resolveWebviewAssetsDir } = require("./webview-assets");

const WEBVIEW_REBRAND_MARKER = "__augment_byok_webview_rebrand_v1";

// 用户可见文案（Svelte 模板/字符串字面量）。只替换完整短语，避免碰到
// 代码标识符（augmentDeps、St.augmentLink、c-augment-* class、.augment/ 路径等）。
const JS_REPLACEMENTS = [
  // Sign-in 界面 logo 下的字标
  ['"augment code"', '"LCE"'],

  // Chat 输入框占位符
  ["Instruct Augment, @ for context, / for commands", "Instruct LCE, @ for context, / for commands"],
  ["Ask or Instruct Augment", "Ask or Instruct LCE"],

  // Onboarding / 目录选择 / 索引授权界面
  ["Welcome to Augment!", "Welcome to LCE!"],
  ["Augment Features", "LCE Features"],
  ["Indexing allows Augment to make", "Indexing allows LCE to make"],
  ["questions you can ask Augment:", "questions you can ask LCE:"],
  ["Tell us what you think of Augment...", "Tell us what you think of LCE..."],
  ["exceeds Augment's", "exceeds LCE's"],

  // 杂项可见文案
  ["Open in Augment Images", "Open in LCE Images"],
  ["Show Augment Extensions", "Show LCE Extensions"],
  ["Augment Context Engine", "LCE Context Engine"],
  ["Augment host not available", "LCE host not available"],
  ["Augment IntelliJ host not available", "LCE IntelliJ host not available"],

  // Extension retired 界面（正常不应出现，但不保留 Augment 字样）
  ["Augment's agents now run in", "LCE's agents now run in"],
  ["The Augment Code IDE extensions are no longer available.", "The LCE IDE extensions are no longer available."]
];

// 打包 HTML 的 <title>（不影响 VS Code 面板标题，仅去除 Augment 字样）
const HTML_REPLACEMENTS = [
  ["<title>Augment</title>", "<title>LCE</title>"],
  ["<title>Augment ", "<title>LCE "]
];

// 必须命中的 needle：缺失说明上游 sign-in 界面结构漂移，需要人工确认
const REQUIRED_JS_NEEDLES = ['"augment code"'];

function applyReplacements(src, replacements) {
  let out = src;
  let applied = 0;
  for (const [from, to] of replacements) {
    if (out.includes(from)) {
      out = out.split(from).join(to);
      applied++;
    }
  }
  return { out, applied };
}

function patchRebrandWebview(extensionDir) {
  const assetsDir = resolveWebviewAssetsDir(extensionDir, "patchRebrandWebview");
  const commonWebviewsDir = path.dirname(assetsDir);

  const jsFiles = fs
    .readdirSync(assetsDir)
    .filter((name) => name.endsWith(".js") && !name.endsWith(".js.map"))
    .map((name) => path.join(assetsDir, name));

  const contents = new Map(jsFiles.map((filePath) => [filePath, fs.readFileSync(filePath, "utf8")]));
  const alreadyPatched = Array.from(contents.values()).some((src) => src.includes(WEBVIEW_REBRAND_MARKER));

  if (!alreadyPatched) {
    const missingNeedles = REQUIRED_JS_NEEDLES.filter(
      (needle) => !Array.from(contents.values()).some((src) => src.includes(needle))
    );
    if (missingNeedles.length) {
      throw new Error(`patchRebrandWebview: required needle(s) not found: ${missingNeedles.join(", ")}`);
    }
  }

  const patched = [];
  for (const [filePath, src] of contents) {
    if (src.includes(WEBVIEW_REBRAND_MARKER)) continue;
    const { out, applied } = applyReplacements(src, JS_REPLACEMENTS);
    if (!applied) continue;
    fs.writeFileSync(filePath, `${out}\n;/*${WEBVIEW_REBRAND_MARKER}*/\n`, "utf8");
    patched.push(path.basename(filePath));
  }

  const htmlFiles = fs
    .readdirSync(commonWebviewsDir)
    .filter((name) => name.endsWith(".html"))
    .map((name) => path.join(commonWebviewsDir, name));
  for (const filePath of htmlFiles) {
    const src = fs.readFileSync(filePath, "utf8");
    const { out, applied } = applyReplacements(src, HTML_REPLACEMENTS);
    if (applied) fs.writeFileSync(filePath, out, "utf8");
  }

  return { changed: patched.length > 0, patched };
}

module.exports = { patchRebrandWebview, WEBVIEW_REBRAND_MARKER };

if (require.main === module) {
  const extensionDir = process.argv[2];
  if (!extensionDir) {
    console.error(`usage: ${path.basename(process.argv[1])} <extensionDir>`);
    process.exit(2);
  }
  patchRebrandWebview(extensionDir);
}
