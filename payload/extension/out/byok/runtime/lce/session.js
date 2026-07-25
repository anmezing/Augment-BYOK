"use strict";

const { DEFAULT_OFFICIAL_COMPLETION_URL, getOfficialConnection } = require("../../config/official");
const { normalizeRawToken, normalizeString } = require("../../infra/util");

const UPSTREAM_SESSION_SECRET_KEY = "augment.sessions";
const UPSTREAM_SESSION_SCOPES = ["email"];

function normalizeRelayUrl(value) {
  const raw = normalizeString(value) || DEFAULT_OFFICIAL_COMPLETION_URL;
  try {
    const url = new URL(raw);
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.toString();
  } catch {
    return "";
  }
}

function parseUpstreamSession(raw) {
  if (!normalizeString(raw)) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const accessToken = normalizeRawToken(parsed && parsed.accessToken);
  if (!accessToken) return null;
  return {
    accessToken,
    tenantURL: normalizeRelayUrl(parsed && parsed.tenantURL),
    scopes: Array.isArray(parsed && parsed.scopes) ? parsed.scopes.filter((scope) => typeof scope === "string") : []
  };
}

async function readUpstreamSession(ctx) {
  const secrets = ctx && ctx.secrets;
  if (!secrets || typeof secrets.get !== "function") return null;
  try {
    return parseUpstreamSession(await secrets.get(UPSTREAM_SESSION_SECRET_KEY));
  } catch {
    return null;
  }
}

function connectionFromSession(session) {
  if (!session || !session.accessToken) return null;
  const configured = getOfficialConnection();
  const completionURL = normalizeRelayUrl(configured.completionURL || session.tenantURL);
  if (!completionURL) return null;
  return { completionURL, apiToken: session.accessToken };
}

async function writeUpstreamSession(ctx, apiToken) {
  const secrets = ctx && ctx.secrets;
  if (!secrets || typeof secrets.store !== "function") {
    throw new Error("extension context secrets unavailable");
  }
  await secrets.store(
    UPSTREAM_SESSION_SECRET_KEY,
    JSON.stringify({
      accessToken: apiToken,
      tenantURL: DEFAULT_OFFICIAL_COMPLETION_URL,
      scopes: UPSTREAM_SESSION_SCOPES
    })
  );
}

module.exports = {
  UPSTREAM_SESSION_SCOPES,
  UPSTREAM_SESSION_SECRET_KEY,
  connectionFromSession,
  parseUpstreamSession,
  readUpstreamSession,
  writeUpstreamSession
};
