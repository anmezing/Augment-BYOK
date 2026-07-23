"use strict";

const { loadPatchJson, savePatchJson } = require("./patch-target");

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

  pkg.displayName = "LCE Coding Agent";
  pkg.description = "LCE is an AI coding agent for VS Code, powered by your own API keys.";

  const c = pkg.contributes;
  if (!c || typeof c !== "object") return;

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

  // configuration title
  const conf = c.configuration;
  const blocks = Array.isArray(conf) ? conf : conf && typeof conf === "object" ? [conf] : [];
  for (const b of blocks) {
    if (b && b.title === "Augment") b.title = BRAND;
    // Rebrand description strings in settings
    const props = b && typeof b === "object" ? b.properties : null;
    if (!props || typeof props !== "object") continue;
    for (const v of Object.values(props)) {
      if (!v || typeof v !== "object") continue;
      if (typeof v.description === "string") {
        v.description = v.description.replace(/\bAugment\b/g, BRAND);
      }
      // enum descriptions
      if (Array.isArray(v.enumDescriptions)) {
        v.enumDescriptions = v.enumDescriptions.map(d =>
          typeof d === "string" ? d.replace(/\bAugment\b/g, BRAND) : d
        );
      }
      // nested properties (e.g. augment.advanced)
      if (v.properties && typeof v.properties === "object") {
        for (const sub of Object.values(v.properties)) {
          if (sub && typeof sub === "object" && typeof sub.description === "string") {
            sub.description = sub.description.replace(/\bAugment\b/g, BRAND);
          }
        }
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
