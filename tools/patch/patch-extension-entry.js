#!/usr/bin/env node
"use strict";

const path = require("path");

const { readText, writeText } = require("../lib/fs");
const { findExportedFactoryVar, insertBeforeSourceMappingURL } = require("../lib/patch");

const MARKER = "__augment_byok_bootstrap_injected_v2";

function patchExtensionEntry(filePath) {
  const original = readText(filePath);
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const activateVar = findExportedFactoryVar(original, "activate");
  // install() 通过 setActivate 重写局部变量；但当上游用 `exports.activate=VAR`
  // 直接赋值导出时（0.890.3 起），导出对象仍指向原函数——必须在 install 后把
  // wrapped 函数重新绑定回导出。getter 式导出下赋值会抛（无 setter），try 吞掉即可，
  // 此时 getter 本身就读活变量，无需重绑。
  const injection =
    `\n;require("./byok/runtime/bootstrap").install({vscode:require("vscode"),getActivate:()=>${activateVar},setActivate:e=>{${activateVar}=e}})\n` +
    `;try{exports.activate=${activateVar}}catch{}\n` +
    `;try{module.exports.activate=${activateVar}}catch{}\n` +
    `;/*${MARKER}*/\n`;
  const next = insertBeforeSourceMappingURL(original, injection);
  writeText(filePath, next);
  return { changed: true, reason: "patched", activateVar };
}

module.exports = { patchExtensionEntry };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchExtensionEntry(filePath);
}
