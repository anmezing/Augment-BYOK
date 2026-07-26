"use strict";

const fs = require("fs");

function patchRebrandExtension(extJsPath) {
  const p = String(extJsPath || "");
  if (!p) throw new Error("patchRebrandExtension: missing extJsPath");

  let src = fs.readFileSync(p, "utf8");

  const marker = "__byok_rebranded_v1";
  if (src.includes(marker)) return;

  const replacements = [
    // Output channel name
    ['createOutputChannel("Augment"', 'createOutputChannel("LCE"'],

    // Terminal names
    ['this._createTerminal("Augment"', 'this._createTerminal("LCE"'],
    ['this._createTerminal(`Augment', 'this._createTerminal(`LCE'],
    ['{name:"Augment Terminal Capability Check"', '{name:"LCE Terminal Capability Check"'],

    // Status bar
    ['this._statusBarItem.name="Augment"', 'this._statusBarItem.name="LCE"'],
    ['Zzr="Augment"', 'Zzr="LCE"'],

    // Status bar tooltips
    ['tooltip:"Augment"', 'tooltip:"LCE"'],
    ['tooltip:"Open Augment"', 'tooltip:"Open LCE"'],
    ['tooltip:"Sign in to start using Augment"', 'tooltip:"Sign in to start using LCE"'],
    ['tooltip:"Augment is indexing your codebase"', 'tooltip:"LCE is indexing your codebase"'],
    ['tooltip:"The Augment Code IDE extension is no longer available"', 'tooltip:"The LCE IDE extension is no longer available"'],
    ['tooltip:"Initializing Augment"', 'tooltip:"Initializing LCE"'],

    // User-facing messages
    ['Augment is only available to signed in users', 'LCE is only available to signed in users'],
    ['Augment works best when it has access', 'LCE works best when it has access'],
    ['Augment is generating...', 'LCE is generating...'],
    ['Augment is not yet fully synced', 'LCE is not yet fully synced'],
    ['Augment is synchronizing with your codebase', 'LCE is synchronizing with your codebase'],
    ['Augment is not enabled in this workspace', 'LCE is not enabled in this workspace'],
    ['A new version of Augment is available', 'A new version of LCE is available'],
    ['Ship faster with Augment Code Review', 'Ship faster with LCE Code Review'],
    ['Your Augment extension is no longer supported', 'Your LCE extension is no longer supported'],
    ['Augment Agent orientation is already in progress', 'LCE Agent orientation is already in progress'],
    ['Augment extension is initializing', 'LCE extension is initializing'],
    ['Augment extension status', 'LCE extension status'],
    ['Cannot get Augment extension status', 'Cannot get LCE extension status'],

    // Error messages
    ['Please configure Augment API URL', 'Please configure LCE API URL'],
    ['Augment API URL is invalid', 'LCE API URL is invalid'],
    ["Augment API URL must start with", "LCE API URL must start with"],
    ['Cannot connect to Augment', 'Cannot connect to LCE'],
    ['connections to the Augment API', 'connections to the LCE API'],
    ['Augment API domains', 'LCE API domains'],
    ['Augment API request to', 'LCE API request to'],
    ['Sorry, Augment ', 'Sorry, LCE '],
    ['Augment user assets directory does not exist', 'LCE user assets directory does not exist'],
    ['Augment user assets zipfile saved', 'LCE user assets zipfile saved'],

    // Completion item
    ['g.detail="Augment"', 'g.detail="LCE"'],
    ['does not match an Augment suggestion', 'does not match an LCE suggestion'],

    // Agent/tool descriptions
    ['general-purpose agent for Augment Code', 'general-purpose agent for LCE'],
    ["This tool is Augment's context engine", "This tool is LCE's context engine"],
    ['previously recorded Augment agent session', 'previously recorded LCE agent session'],
    ["past conversations with Augment", "past conversations with LCE"],
    ['(you) is Augment, a coding agent', '(you) is LCE, a coding agent'],

    // Git author
    ['{name:"Augment Agent",email:"agent@augmentcode.com"}', '{name:"LCE Agent",email:"agent@lce.dev"}'],

    // Commands and chat
    ['super("Add File to Augment Chat"', 'super("Add File to LCE Chat"'],
    ['super("Add Folder to Augment Chat"', 'super("Add Folder to LCE Chat"'],
    ['super("Add to Augment Chat"', 'super("Add to LCE Chat"'],
    ['Add Folder to Augment Chat")', 'Add Folder to LCE Chat")'],
    ['super("Open Augment Images"', 'super("Open LCE Images"'],
    ['super("Zip Augment User Assets"', 'super("Zip LCE User Assets"'],
    ['"Fix using Augment"', '"Fix using LCE"'],
    ['"Explain using Augment"', '"Explain using LCE"'],
    ['"Write test using Augment"', '"Write test using LCE"'],
    ['"Fix using Augment",', '"Fix using LCE",'],
    ['good or bad suggestions in Augment chat', 'good or bad suggestions in LCE chat'],

    // Panel/view titles
    ['title:"Augment Commands"', 'title:"LCE Commands"'],
    ['title:"Augment Settings"', 'title:"LCE Settings"'],
    ['title:"Exporting Augment logs"', 'title:"Exporting LCE logs"'],
    ['Augment logs exported to', 'LCE logs exported to'],

    // Webview panels
    ['"Augment Settings"', '"LCE Settings"'],
    ['"Augment Settings (ACP)"', '"LCE Settings (ACP)"'],
    ['<title>Augment Rules</title>', '<title>LCE Rules</title>'],
    ['Loading Augment Rules', 'Loading LCE Rules'],
    ['Augment Rules Viewer', 'LCE Rules Viewer'],

    // Image gallery
    ['`Augment Images - ${', '`LCE Images - ${'],
    ['`Augment Images ${', '`LCE Images ${'],

    // Empty file hint
    ['to open Augment.', 'to open LCE.'],
    ['to open Augment"', 'to open LCE"'],
    ['Click the robot icon in the side bar to open Augment.', 'Click the robot icon in the side bar to open LCE.'],

    // Diagnostic panel links
    ['title="Open Augment Chat"', 'title="Open LCE Chat"'],
    ['title="Fix with Augment Chat"', 'title="Fix with LCE Chat"'],
    ['title="Explain with Augment Chat"', 'title="Explain with LCE Chat"'],
    ['title="Write a test with Augment Chat"', 'title="Write a test with LCE Chat"'],
    ['title="Document with Augment Chat"', 'title="Document with LCE Chat"'],

    // Output channel instructions
    ['Select "Augment" from the dropdown', 'Select "LCE" from the dropdown'],
    ['The "Augment" Output Channel logs', 'The "LCE" Output Channel logs'],

    // Client identity
    ['this.CLIENT_NAME="Augment Code"', 'this.CLIENT_NAME="LCE"'],

    // URI display name
    ['path:"Augment Extension Status"', 'path:"LCE Extension Status"'],

    // Terminal strategy setting
    ['t==="Augment")return"script_capture"', 't==="LCE")return"script_capture"'],

    // Settings integration message
    ["for the Augment agent to be able to use terminals", "for the LCE agent to be able to use terminals"],

    // Rules provider
    ['return"default Augment rules"', 'return"default LCE rules"'],

    // Workspace context
    ['textDocumentName="Augment Workspace Context.txt"', 'textDocumentName="LCE Workspace Context.txt"'],
    ['Augment workspace context\\n', 'LCE workspace context\\n'],

    // CLI install terminal
    ['const r="Augment CLI Install"', 'const r="LCE CLI Install"'],

    // Supported languages header
    ['Supported languages (Augment name', 'Supported languages (LCE name'],

    // Figma integration
    ['Enable the Figma integration in Augment Services', 'Enable the Figma integration in LCE Services'],

    // Config variable names (for M0r.Augment enum)
    ['Augment:null', 'LCE:null'],

    // Log prefix format
    ['.includes("augment")?`${o}: `:`Augment ${o}`', '.includes("augment")?`${o}: `:`LCE ${o}`'],

    // Terminal reuse check (must match renamed creation name)
    ['if(n.name==="Augment"', 'if(n.name==="LCE"'],

    // Exporting logs notification
    ['title:"Exporting Augment logs..."', 'title:"Exporting LCE logs..."'],

    // Workspace context header (actual newline in template literal)
    ['`Augment workspace context\n`', '`LCE workspace context\n`'],

    // .zshrc comment
    ['file created by Augment', 'file created by LCE'],

    // Sentry DSN 焊死：flags 默认关，但 getInstance 的 fallback 实例带 enableSentry:true，
    // 清空 DSN 后即使 flag 翻转也不可能上报到 Augment 的 Sentry 项目
    ['"https://65b77c01171371d3328fc9a6d5941e00@o4509262619082752.ingest.us.sentry.io/4510047084478464"', '""'],
    ['"https://82f85941b4acf562dfb6bb4d69f2d842@o4509262619082752.ingest.us.sentry.io/4509753348718592"', '""'],

    // Help / Account & Billing 菜单跳转到自己的控制台，不再指向 Augment 官网
    ['run(){await ff("https://docs.augmentcode.com")}', 'run(){await ff("https://513689.xyz")}'],
    ['run(){await ff("https://app.augmentcode.com/account")}', 'run(){await ff("https://513689.xyz/console")}'],

    // Export Logs 的 zip 文件名
    ["return`vscode-augment-${this._getExtensionVersion()}-logs-${t}.zip`", "return`lce-${this._getExtensionVersion()}-logs-${t}.zip`"],

    // Logger/internal names visible in Output channel
    ['Xt("AugmentExtension")', 'Xt("LCE")'],
    ['Xt("AugmentConfigListener")', 'Xt("LCEConfig")'],
    ['Xt("AugmentCommand")', 'Xt("LCECommand")'],
    ['Vt("AugmentExtensionSidecar")', 'Vt("LCESidecar")'],
    ['`AugmentCompletion: ${', '`LCECompletion: ${'],
  ];

  let applied = 0;
  for (const [from, to] of replacements) {
    if (src.includes(from)) {
      src = src.split(from).join(to);
      applied++;
    }
  }

  src = patchExtensionIdentity(src);

  src = `/* ${marker} */` + src;
  fs.writeFileSync(p, src, "utf8");
}

const BYOK_EXTENSION_ID = "lce.lce-coding-agent";

// 扩展 ID 自引用必须跟随 package.json 的 publisher/name（patch-rebrand.js）：
// - getExtension 自查（版本上报、环境信息）落空会退化为 "unknown"
// - `@ext:` 设置/快捷键深链会过滤不到自己
// - webview 图标字体按 `<publisher.name>/<font>` 解析，不改直接挂
// 保留不动的：User-Agent 里的 "Augment.vscode-augment/999.999.999"（上游自己就
// 发假版本，改了反而可能触发后端 UA 启发）和更新检测器查询市场用的常量
// "Augment.vscode-augment"（版本 9x 方案下比较恒为旧，永不弹窗）。
function patchExtensionIdentity(src) {
  let out = src;
  // 顺序敏感：-nightly 包含基础串，必须先替换
  out = out.split("augment.vscode-augment-nightly").join(BYOK_EXTENSION_ID);
  out = out.split("augment.vscode-augment").join(BYOK_EXTENSION_ID);
  out = out
    .split("Augment.vscode-augment/augment-kb-icon-font.woff")
    .join(`${BYOK_EXTENSION_ID}/augment-kb-icon-font.woff`);

  if (out.includes("augment.vscode-augment")) {
    throw new Error("patchRebrandExtension: lowercase extension id self-reference survived identity patch");
  }
  if (!out.includes(`${BYOK_EXTENSION_ID}/augment-kb-icon-font.woff`)) {
    throw new Error("patchRebrandExtension: kb icon font reference not rebound to new extension id");
  }
  return out;
}

module.exports = { patchRebrandExtension };
