"use strict";

const { normalizeString } = require("../../infra/util");
const { safeFetch, joinBaseUrl } = require("../../providers/http");
const { applyClientIdHeader } = require("../device-identity");

async function relayJSON(connection, method, endpoint, body, options) {
  const url = joinBaseUrl(normalizeString(connection && connection.completionURL), endpoint);
  if (!url) throw new Error(`LCE relay URL is invalid for ${endpoint}`);
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (connection.apiToken) headers.authorization = `Bearer ${connection.apiToken}`;
  applyClientIdHeader(headers);
  const response = await safeFetch(
    url,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    },
    {
      timeoutMs: options && options.timeoutMs || 30000,
      abortSignal: options && options.abortSignal,
      label: `lce/${endpoint}`
    }
  );
  const text = await response.text().catch(() => "");
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {}
  if (!response.ok) {
    const detail = parsed && parsed.error ? parsed.error : text.slice(0, 300);
    throw new Error(`${endpoint} ${response.status}: ${detail || response.statusText}`);
  }
  return parsed || {};
}

function createIndexJob(connection, manifest, abortSignal) {
  return relayJSON(connection, "POST", "index-jobs", {
    workspaceId: manifest.workspaceId,
    workspaceName: manifest.workspaceName,
    branch: manifest.branch,
    revision: manifest.revision,
    files: manifest.files.map(({ path, hash, size, estimatedChunks }) => ({ path, hash, size, estimatedChunks })),
    // 读不了的文件单独上报：relay 会保留它们的旧索引，而不是当成已删除
    unreadableFiles: Array.isArray(manifest.unreadableFiles) ? manifest.unreadableFiles : []
  }, { timeoutMs: 60000, abortSignal });
}

function uploadIndexBatch(connection, jobId, files, abortSignal) {
  return relayJSON(connection, "POST", "remote-index", {
    jobId,
    files: files.map(({ path, hash, content, estimatedChunks }) => ({ path, hash, content, estimatedChunks }))
  }, { timeoutMs: 180000, abortSignal });
}

function completeIndexJob(connection, jobId, abortSignal) {
  return relayJSON(connection, "POST", `index-jobs/${encodeURIComponent(jobId)}/complete`, {}, {
    timeoutMs: 30000,
    abortSignal
  });
}

function failIndexJob(connection, jobId, error) {
  return relayJSON(connection, "POST", `index-jobs/${encodeURIComponent(jobId)}/fail`, {
    error: String(error || "indexing failed").slice(0, 2000)
  }, { timeoutMs: 15000 });
}

function getIndexJob(connection, jobId, abortSignal) {
  return relayJSON(connection, "GET", `index-jobs/${encodeURIComponent(jobId)}`, undefined, {
    timeoutMs: 15000,
    abortSignal
  });
}

module.exports = { completeIndexJob, createIndexJob, failIndexJob, getIndexJob, relayJSON, uploadIndexBatch };
