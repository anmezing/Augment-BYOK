"use strict";

const DEFAULT_OFFICIAL_COMPLETION_URL = "https://513689.xyz/relay/";

// 已下线的历史 relay 域名：normalize 时丢弃已保存的这些端点，回落到当前默认，
// 否则升级后的用户仍会带着旧 globalState 请求死域名。
const LEGACY_OFFICIAL_COMPLETION_HOSTS = ["acemcp.heroman.wtf"];

module.exports = { DEFAULT_OFFICIAL_COMPLETION_URL, LEGACY_OFFICIAL_COMPLETION_HOSTS };
