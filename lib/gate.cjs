"use strict";
/* 门禁 —— 飞行棋自己的一份，2026-08-29 重写（原来是 29-Cu/bisca 底盘那套）。
 *
 * 三种身份：
 *   owner  —— 输过密码、拿着签名 cookie 的人。她本人。能开房、能看大厅、能看邀请码。
 *   guest  —— 没密码，但手上有某间房的邀请链接。只能碰那一间。要 allow_guests 打开。
 *   asset  —— 静态文件请求（css/js/图/字体）。这些本来就是公开的，不设卡；
 *             不放行的话访客点开邀请链接只会拿到一个空壳页面，永远停在「连接中」。
 *
 * cookie 的**格式**保持跟以前一致（值 + "." + HMAC-base64url），实现是重写的。
 * 格式不动是故意的：她手机、iPad、Mac 上都登录着，换格式等于把她全部踢下线重输密码。
 */
const { createHmac, timingSafeEqual, randomBytes } = require("crypto");
const path = require("path");
const { readJson, writeJson } = require("./store.cjs");

const COOKIE = "bisca_auth";
const TTL_MS = 90 * 24 * 3600 * 1000;      // 登录态管 90 天
const ASSET_RE = /\.(css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)$/i;

/* 签名密钥放在 data/config.json，首次启动生成。它绝不能出现在任何返回给前端的东西里。 */
function loadSecret(dataDir, logName) {
  const file = path.join(dataDir, "config.json");
  const cfg = readJson(file, null) || {};
  if (typeof cfg.cookie_secret === "string" && cfg.cookie_secret.length >= 32) return cfg.cookie_secret;
  cfg.cookie_secret = randomBytes(32).toString("hex");
  if (cfg.allow_guests === undefined) cfg.allow_guests = false;
  try {
    writeJson(file, cfg);
    try { require("fs").chmodSync(file, 0o600); } catch (e) { /* 文件系统不支持权限位 */ }
  } catch (e) {
    console.warn(`[${logName}] config.json 写不进去（${e && e.message}），这次用临时密钥，重启后要重新登录`);
  }
  return cfg.cookie_secret;
}

function cookiesOf(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

class Gate {
  constructor(opts) {
    this.dataDir = opts.dataDir;
    this.name = opts.name || "aeroplane";
    this.base = opts.base || "/aeroplane";
    this.secret = opts.secret || loadSecret(opts.dataDir, this.name);
    this.password = opts.password || "";
    this.required = !!this.password;
    this.guestsAllowed = opts.guestsAllowed || (() => false);
  }

  sign(value) {
    return value + "." + createHmac("sha256", this.secret).update(value).digest("base64url");
  }

  /* 定长比较，别让攻击者靠响应快慢猜出签名 */
  unsign(signed) {
    if (typeof signed !== "string") return null;
    const cut = signed.lastIndexOf(".");
    if (cut < 1) return null;
    const value = signed.slice(0, cut);
    const mine = Buffer.from(this.sign(value));
    const theirs = Buffer.from(signed);
    if (mine.length !== theirs.length) return null;
    return timingSafeEqual(mine, theirs) ? value : null;
  }

  /* 密码两边都先过一次 HMAC 再比：摘要恒定 32 字节，连密码长度都不会从耗时里漏出去 */
  passwordOk(given) {
    const a = createHmac("sha256", this.secret).update(String(given)).digest();
    const b = createHmac("sha256", this.secret).update(String(this.password)).digest();
    return timingSafeEqual(a, b);
  }

  issue() { return this.sign("authenticated." + Date.now()); }

  loggedIn(req) {
    const value = this.unsign(cookiesOf(req)[COOKIE]);
    if (!value) return false;
    if (value === "authenticated") return true;            // 老格式，没有时间戳
    const dot = value.indexOf(".");
    if (dot === -1 || value.slice(0, dot) !== "authenticated") return false;
    const issued = parseInt(value.slice(dot + 1), 10);
    return !!issued && Date.now() - issued <= TTL_MS;
  }

  cookieOptions(req) {
    const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    return { httpOnly: true, sameSite: "lax", secure: req.secure || proto === "https", maxAge: TTL_MS, path: "/" };
  }

  /* 只准跳回本站的路径，`//evil.com` 这种开放重定向挡在这儿 */
  safeReturn(raw) {
    return typeof raw === "string" && /^\/[^/\\]/.test(raw) ? raw : this.base + "/";
  }

  /* 浏览器直接开页面 → 送去登录页；fetch/API → 干脆的 403 JSON */
  refuse(req, res) {
    if (req && req.method === "GET" && String(req.headers.accept || "").includes("text/html")) {
      return res.redirect(`${this.base}/login?r=` + encodeURIComponent(req.originalUrl || this.base + "/"));
    }
    return res.status(403).json({ error: "未授权：请先登录，或使用有效的房间邀请链接" });
  }

  /* 挂在所有房间接口前面的那道门 */
  middleware(findRoomByInvite) {
    return (req, res, next) => {
      if (!this.required) { req.authLevel = "owner"; return next(); }
      if (req.method === "GET" && ASSET_RE.test(req.path || "")) { req.authLevel = "asset"; return next(); }
      if (this.loggedIn(req)) { req.authLevel = "owner"; return next(); }
      if (this.guestsAllowed()) {
        const token = req.query.invite || req.headers["x-invite-token"];
        const room = findRoomByInvite(typeof token === "string" ? token : null);
        if (room) { req.authLevel = "guest"; req.inviteRoom = room.code; return next(); }
      }
      return this.refuse(req, res);
    };
  }

  /* 客人只能待在自己那间房里 */
  scope() {
    return (req, res, next) => {
      if (req.authLevel === "guest" && req.inviteRoom !== req.params.code) return this.refuse(req, res);
      next();
    };
  }
}

module.exports = { Gate, COOKIE_NAME: COOKIE, COOKIE_TTL_MS: TTL_MS };
