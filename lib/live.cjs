"use strict";
/* 实时推送 —— 飞行棋自己的一份，2026-08-29 重写。
 *
 * 用 SSE 不用 WebSocket：单向就够了（棋面往下推，动作走普通 POST），
 * 而且它就是一条 HTTP 长连接，反代不用额外配置，断了浏览器自己重连。
 *
 * 每间房一条频道。连上先补一帧全量棋面 —— 客户端不需要"追历史"，
 * 拿到的永远是此刻的真相。
 */
const PING_MS = 25000;

/* 座位 token、邀请码、cookie 密钥绝不能顺着广播漏出去：
   这里是整份棋面发给房里所有人，漏一个 playerToken 别人就能替你走棋。 */
const SECRET_KEYS = new Set(["playerToken", "inviteToken", "token", "cookie_secret"]);
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      if (SECRET_KEYS.has(k)) continue;
      out[k] = redact(value[k]);
    }
    return out;
  }
  return value;
}

class Channels {
  constructor() {
    this.byRoom = new Map();   // 房号 -> Set<res>
    this.all = new Set();      // 全部连接，进程退出时一次性关干净
  }

  /* 把一条响应挂成这间房的听众，返回退订函数 */
  attach(code, res, firstFrame) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"       // 让 nginx 别缓冲，否则消息会卡在代理里
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    res.write("retry: 3000\n\n");
    if (firstFrame !== undefined) res.write(this.frame(firstFrame));

    if (!this.byRoom.has(code)) this.byRoom.set(code, new Set());
    this.byRoom.get(code).add(res);
    this.all.add(res);

    /* 空闲久了中间的代理会掐连接，25 秒一个注释行当心跳 */
    const ping = setInterval(() => {
      try { res.write(":ping\n\n"); } catch (e) { /* 断了下面会清理 */ }
    }, PING_MS);
    if (typeof ping.unref === "function") ping.unref();

    let done = false;
    const detach = () => {
      if (done) return;
      done = true;
      clearInterval(ping);
      const set = this.byRoom.get(code);
      if (set) { set.delete(res); if (!set.size) this.byRoom.delete(code); }
      this.all.delete(res);
    };
    return detach;
  }

  frame(payload) { return "event: state\ndata: " + JSON.stringify(payload) + "\n\n"; }

  send(code, payload) {
    const set = this.byRoom.get(code);
    if (!set || !set.size) return 0;
    const data = this.frame(payload);
    let n = 0;
    for (const res of set) {
      try { res.write(data); n++; } catch (e) { /* 断开的由 detach 清理 */ }
    }
    return n;
  }

  /* 关房时先让在场的人收到最后一帧，再掐线 —— 直接掐的话对方屏幕会僵着 */
  closeRoom(code) {
    const set = this.byRoom.get(code);
    if (!set) return;
    for (const res of set) { try { res.end(); } catch (e) { /* 已断 */ } }
    this.byRoom.delete(code);
  }

  closeAll() {
    for (const res of this.all) { try { res.end(); } catch (e) { /* 已断 */ } }
    this.all.clear();
    this.byRoom.clear();
  }
}

module.exports = { Channels, redact, PING_MS };
