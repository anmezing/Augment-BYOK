"use strict";

const { loadPatchJson, savePatchJson } = require("./patch-target");
const { computeByokPackageVersion } = require("../lib/byok-version");

const BRAND = "LCE";

const TITLE_MAP = {
  "Fix using Augment": "Fix using LCE",
  "Explain using Augment": "Explain using LCE",
  "Write test using Augment": "Write test using LCE",
  "Document using Augment": "Document using LCE",
  "Augment: Open Image Canvas": "LCE: Open Image Canvas",
  "Generate Commit Message with Augment": "Generate Commit Message with LCE",
  "Show Augment Commands": "Show LCE Commands",
  "$(layout-sidebar-left) Open Augment": "$(layout-sidebar-left) Open LCE",
  "Augment: Add File to Chat": "LCE: Add File to Chat",
  "Augment: Add Folder to Chat": "LCE: Add Folder to Chat",
  "Add Selection to Augment Chat": "Add Selection to LCE Chat",
  "Zip Augment User Assets": "Zip LCE User Assets"
};

function patchRebrand(pkgPath) {
  const pkg = loadPatchJson(pkgPath);
  if (!pkg || typeof pkg !== "object") throw new Error("patchRebrand: package.json not object");

  // 脱离 Augment 的市场身份：ID 变为 lce.lce-coding-agent 后，VS Code 不再把本
  // 扩展与市场上的 Augment.vscode-augment 关联，也就不存在"更新"提示/覆盖安装。
  // 注意：扩展 ID 变化意味着 globalState/secrets 全部换仓，老安装需要重新登录并
  // 通过配置面板导出/导入迁移配置（聊天记录无法迁移）。
  pkg.name = "lce-coding-agent";
  pkg.publisher = "lce";
  pkg.version = computeByokPackageVersion(pkg.version);
  pkg.displayName = "LCE Coding Agent";
  pkg.description = "LCE is an AI coding agent for VS Code, powered by your own API keys.";

  const c = pkg.contributes;
  if (!c || typeof c !== "object") {
    savePatchJson(pkgPath, pkg);
    return;
  }

  // commands: category + title
  const cmds = Array.isArray(c.commands) ? c.commands : [];
  for (const cmd of cmds) {
    if (!cmd || typeof cmd !== "object") continue;
    if (cmd.category === "Augment") cmd.category = BRAND;
    if (typeof cmd.title === "string" && TITLE_MAP[cmd.title]) {
      cmd.title = TITLE_MAP[cmd.title];
    }
  }

  // viewsContainers
  const vc = c.viewsContainers;
  if (vc && typeof vc === "object") {
    for (const arr of Object.values(vc)) {
      if (!Array.isArray(arr)) continue;
      for (const v of arr) {
        if (v && v.title === "Augment") v.title = BRAND;
      }
    }
  }

  // views
  const views = c.views;
  if (views && typeof views === "object") {
    for (const arr of Object.values(views)) {
      if (!Array.isArray(arr)) continue;
      for (const v of arr) {
        if (v && v.name === "Augment") v.name = BRAND;
      }
    }
  }

  // configuration：递归重写设置树的 description / enumDescriptions / enum 值。
  // enum 值 "Augment" 必须跟随（patch-rebrand-extension 已把 terminal strategy
  // 的代码判断改为 "LCE"，enum 不同步会让该策略永远匹配不上）。
  const rebrandSettingNode = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.description === "string") {
      node.description = node.description.replace(/\bAugment\b/g, BRAND);
    }
    if (Array.isArray(node.enumDescriptions)) {
      node.enumDescriptions = node.enumDescriptions.map((d) =>
        typeof d === "string" ? d.replace(/\bAugment\b/g, BRAND) : d
      );
    }
    if (Array.isArray(node.enum)) {
      node.enum = node.enum.map((d) => (d === "Augment" ? BRAND : d));
    }
    if (node.properties && typeof node.properties === "object") {
      for (const sub of Object.values(node.properties)) rebrandSettingNode(sub);
    }
  };
  const conf = c.configuration;
  const blocks = Array.isArray(conf) ? conf : conf && typeof conf === "object" ? [conf] : [];
  for (const b of blocks) {
    if (b && b.title === "Augment") b.title = BRAND;
    rebrandSettingNode(b);
  }

  // icons：图标描述（icon picker 中可见）
  if (c.icons && typeof c.icons === "object") {
    for (const icon of Object.values(c.icons)) {
      if (icon && typeof icon === "object" && typeof icon.description === "string") {
        icon.description = icon.description.replace(/\bAugment\b/g, BRAND);
      }
    }
  }

  // submenus
  const submenus = Array.isArray(c.submenus) ? c.submenus : [];
  for (const s of submenus) {
    if (!s || typeof s !== "object" || typeof s.label !== "string") continue;
    s.label = s.label.replace(/\bAugment\b/g, BRAND);
  }

  // customEditors
  const ce = Array.isArray(c.customEditors) ? c.customEditors : [];
  for (const e of ce) {
    if (!e || typeof e !== "object") continue;
    if (typeof e.displayName === "string") {
      e.displayName = e.displayName.replace(/\bAugment\b/g, BRAND);
    }
  }

  savePatchJson(pkgPath, pkg);
}

module.exports = { patchRebrand };
