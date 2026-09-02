#!/usr/bin/env node
"use strict";
/* 飞行棋服务端 —— 2026-08-29 整层重写。
 *
 * 缘起：这套服务原本长在 29-Cu/bisca 的底盘上（CC BY 4.0）。规则、棋盘、界面、
 * 皇冠早就全是我们自己做的了，只有这层管道还是人家的；一旦要开源，就得替它挂
 * 别人的署名。她说「那你重写吧」——落盘、门禁、推送三样拆进了 lib/，
 * 这个文件只剩飞行棋自己的事：谁能开局、谁能走棋、卡住了怎么办。
 *
 * 对外的接口、cookie 格式、房间 JSON 的结构一概没动：
 * 线上正跑着，她随时可能开一局，重写不该让任何人掉线或丢棋。
 *
 * 规则全在 engine.cjs，都是她定的：1 小门 6 正门、外围本色跳 4、飞机场直飞 12、
 * 到家要精确、撞子回机库、叠机一摞走、剩最后一人即收局。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const express = require("express");
const { randomBytes, randomInt } = require("crypto");

const { RoomStore, readJson, writeJson } = require("./lib/store.cjs");
const { Gate, COOKIE_NAME } = require("./lib/gate.cjs");
const { Channels, redact } = require("./lib/live.cjs");

const BASE = "/aeroplane";
const DEFAULT_PORT = 8082;
const DEFAULT_HOST = "127.0.0.1";
const MAX_SEATS = 4;
const CHAT_KEEP = 5000;            // 一局里的闲聊全留着，收摊时一次清空（她 8/24 定的）
const SKIP_AFTER_MS = 60 * 1000;   // 卡住多久才允许房主替人过回合
/* 座位色就是棋色，只有这四家（海绵宝宝/蟹老板/章鱼哥/痞老板） */
const SEAT_COLORS = ["red", "yellow", "blue", "green"];
/* 主题和字体：独立仓库里随 vendor/ 带着（底盘 29-Cu/bisca 的 base.css/boot.js/icons.js + Manrope 等字体，见 NOTICE.md）；
   放回 bisca 底盘目录里跑时用 ../assets ../fonts；也可用环境变量指定。 */
function firstDir(...cands) { return cands.find((d) => d && fs.existsSync(d)) || cands[cands.length - 1]; }
const THEME_DIR = firstDir(process.env.BISCA_THEME_DIR, path.join(__dirname, "vendor", "assets-theme"), path.join(__dirname, "..", "assets"));
const FONT_DIR = firstDir(process.env.BISCA_FONT_DIR, path.join(__dirname, "vendor", "fonts"), path.join(__dirname, "..", "fonts"));
const SEED_FILES = ["board.json", "cards.json", "config.json"];
const STATIC_MAX_AGE = "1d";

function createServer(options) {
  const opts = options || {};
  const dataDir = opts.dataDir || process.env.BISCA_DATA_DIR || path.join(__dirname, "data");
  const publicDir = opts.publicDir || path.join(__dirname, "public");
  const engine = opts.engine || require(opts.enginePath || "./engine.cjs");
  const password = opts.password !== undefined ? opts.password : (process.env.BISCA_PASSWORD || "");

  const store = new RoomStore(dataDir, {});
  seedDefaults();

  const gate = new Gate({
    dataDir, name: "aeroplane", base: BASE, password,
    secret: opts.cookieSecret,
    guestsAllowed: () => settings().allow_guests === true
  });
  const live = new Channels();

  /* 首次启动把随仓库发布的默认设置复制进 data/，用户改的永远是自己那份副本 */
  function seedDefaults() {
    for (const f of SEED_FILES) {
      const dst = path.join(dataDir, f);
      if (fs.existsSync(dst)) continue;
      const seed = readJson(path.join(__dirname, "defaults", f), null);
      if (!seed) continue;
      try { writeJson(dst, seed); } catch (e) {
        console.warn(`[aeroplane] 默认 ${f} 复制失败：${e && e.message}`);
      }
    }
  }

  function settings() {
    const cfg = readJson(path.join(dataDir, "config.json"), {});
    return cfg && typeof cfg === "object" ? cfg : {};
  }

  /* 交给引擎的那份设置要先摘掉密钥：引擎的产物会整份广播出去 */
  function gameConfig() {
    const out = {};
    for (const [k, v] of Object.entries(settings())) {
      if (k === "cookie_secret" || k === "_readme") continue;
      out[k] = v;
    }
    return out;
  }

  // ── 房间视图 ───────────────────────────────────────────────────────────────

  function seatsForPublic(room) {
    return (room.seats || []).map((s) => ({
      playerId: s.playerId, name: s.name, color: s.color, isHost: !!s.isHost
    }));
  }

  function seatName(room, playerId) {
    const seat = (room.seats || []).find((s) => s.playerId === playerId);
    return seat ? seat.name : null;
  }

  /* 大厅那一行：够画卡片就行，棋面一概不给 */
  function summary(room) {
    const st = room.state || null;
    return {
      code: room.code,
      name: room.name,
      createdAt: room.createdAt,
      started: !!room.started,
      finished: !!(st && st.winner) || !!room.finished,
      paused: !!(room.paused && room.started),
      winner: (st && st.winner) || null,
      playerCount: (room.seats || []).length,
      players: seatsForPublic(room),
      seq: st && typeof st.seq === "number" ? st.seq : 0
    };
  }

  /* 房里那一帧：棋面 + 座位 + 聊天。这是要发给所有人的，必须过 redact。 */
  function snapshot(room) {
    return {
      code: room.code,
      name: room.name,
      started: !!room.started,
      seats: seatsForPublic(room),
      seq: room.state && typeof room.state.seq === "number" ? room.state.seq : 0,
      state: room.state ? redact(room.state) : null,
      chat: Array.isArray(room.chat) ? room.chat.slice(-CHAT_KEEP) : [],
      closed: !!room.closed,
      paused: !!(room.paused && room.started)
    };
  }

  const push = (room) => live.send(room.code, snapshot(room));

  function appendChat(room, text, name) {
    if (!Array.isArray(room.chat)) room.chat = [];
    room.chat.push({ ts: Date.now(), by: null, name: name || "系统", text });
    if (room.chat.length > CHAT_KEEP) room.chat = room.chat.slice(-CHAT_KEEP);
  }

  /* 房主＝第一个坐下的人。owner cookie 也算数（她自己开的房，从大厅点也得能管）。 */
  function isHost(req, room) {
    if (req.authLevel === "owner" || req.authLevel === "agent") return true;
    const host = (room.seats || room.players || [])[0];
    const token = (req.body && req.body.playerToken) || "";
    return !!host && token === host.playerToken;
  }

  // ── express ───────────────────────────────────────────────────────────────

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));

  /* 主题和字体挂在门禁**前面**：登录页自己也要用它们。
     两套挂载点是给两种接法准备的——直连本端口，或反代按路径分流。 */
  for (const prefix of ["", BASE]) {
    app.use(prefix + "/assets-theme", express.static(THEME_DIR, { maxAge: STATIC_MAX_AGE }));
    app.use(prefix + "/fonts", express.static(FONT_DIR, { maxAge: STATIC_MAX_AGE }));
  }

  function loginPage(back, failed) {
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    return `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>飞行棋 · 登录</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
background:#0a0a0f;color:#e8e8f0;font:16px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
form{width:100%;max-width:320px;padding:28px 24px;background:#15151f;border:1px solid #2a2a38;border-radius:18px}
h1{margin:0 0 4px;font-size:19px}p{margin:0 0 18px;font-size:13px;color:#8a8a9c}
input{width:100%;padding:11px 12px;font:inherit;color:#fff;background:#0f0f16;border:1px solid #33334a;
border-radius:12px;outline:none}input:focus{border-color:#7b7bff}
button{width:100%;margin-top:14px;min-height:44px;font:inherit;font-weight:600;color:#fff;cursor:pointer;
background:#4b4bd8;border:none;border-radius:12px}.err{margin:12px 0 0;font-size:13px;color:#ff7b93}
</style></head><body><form method="post" action="${BASE}/api/login">
<h1>飞行棋</h1><p>输入房主设的密码进门</p>
<input type="hidden" name="r" value="${esc(back)}">
<input type="password" name="password" placeholder="密码" autofocus autocomplete="current-password">
<button type="submit">进门</button>
${failed ? '<p class="err">密码不对，再试一次</p>' : ""}
</form></body></html>`;
  }

  app.get([BASE + "/login", "/login"], (req, res) => {
    if (!gate.required) return res.redirect(BASE + "/");
    res.type("html").send(loginPage(gate.safeReturn(req.query.r), req.query.e === "1"));
  });

  app.post([BASE + "/api/login", "/api/login"],
    express.urlencoded({ extended: false, limit: "8kb" }), (req, res) => {
      const wantsJson = String(req.headers.accept || "").includes("application/json");
      const back = gate.safeReturn(req.body && req.body.r);
      if (!gate.required) return wantsJson ? res.json({ ok: true, redirect: back }) : res.redirect(back);
      if (!gate.passwordOk((req.body && req.body.password) || "")) {
        if (wantsJson) return res.status(401).json({ error: "密码不对" });
        return res.redirect(`${BASE}/login?e=1&r=` + encodeURIComponent(back));
      }
      res.cookie(COOKIE_NAME, gate.issue(), gate.cookieOptions(req));
      return wantsJson ? res.json({ ok: true, redirect: back }) : res.redirect(back);
    });

  app.use(gate.middleware((token) => store.byInvite(token)));

  const scope = gate.scope();
  const api = express.Router();

  function mustRoom(req, res) {
    const room = store.get(req.params.code);
    if (!room) { res.status(404).json({ error: "没有这间房" }); return null; }
    return room;
  }

  // POST /rooms — 开一间新房
  api.post("/rooms", (req, res) => {
    if (req.authLevel !== "owner") return gate.refuse(req, res);
    const code = store.newCode();
    if (!code) return res.status(500).json({ error: "房号没排出来，再试一次" });
    const room = store.save({
      code,
      name: String((req.body && req.body.name) || "").trim().slice(0, 24) || "未命名房间",
      createdAt: Date.now(),
      inviteToken: randomBytes(16).toString("hex"),
      seats: [],
      started: false,
      state: null
    });
    res.json({ ok: true, code: room.code, name: room.name, inviteToken: room.inviteToken });
  });

  // GET /rooms — 大厅，最近 20 间
  api.get("/rooms", (req, res) => {
    if (req.authLevel !== "owner") return gate.refuse(req, res);
    res.json({ ok: true, rooms: store.recent(20).map(summary) });
  });

  /* POST /rooms/:code/close — 默认是**收摊**，purge:true 才是拆房。
     她 8/23：「我刚刚开过的房间，这里也没有了，理论上不是我删掉才没有吗」。
     按钮写着「结束」却把房间档删了，那是两回事：**她删掉才该没有**。 */
  api.post("/rooms/:code/close", scope, (req, res) => {
    const room = mustRoom(req, res);
    if (!room) return;
    if (!isHost(req, room)) return res.status(403).json({ error: "这间房只有房主能关" });

    if (!req.body || !req.body.purge) {
      room.started = false;
      room.state = null;
      room.closed = false;
      room.finished = true;        // 大厅显示「已结束」，房主进来还能再开
      room.chat = [];              // 这一局的闲聊清空，下一局干干净净
      appendChat(room, "这一局结束了。房主可以直接再开一局，座位都还在。");
      store.save(room);
      push(room);
      return res.json({ ok: true, purged: false });
    }

    room.closed = true;
    store.save(room);
    push(room);                    // 先把「关了」这一帧送出去
    const code = room.code;
    /* 等 2.5 秒再拆：广播还没送到就删房，别人下一个请求会撞 403，
       屏幕上跳红字「未授权」——她在 iPad 上见过一次。 */
    setTimeout(() => { live.closeRoom(code); store.drop(code); }, 2500);
    res.json({ ok: true, purged: true });
  });

  // POST /rooms/:code/join — 坐下；带旧 token 回来＝复座
  api.post("/rooms/:code/join", scope, (req, res) => {
    const room = mustRoom(req, res);
    if (!room) return;
    const body = req.body || {};

    if (body.playerToken) {
      const seat = (room.seats || []).find((s) => s.playerToken === body.playerToken);
      if (seat) {
        return res.json({
          ok: true, code: room.code, playerId: seat.playerId, playerToken: seat.playerToken,
          name: seat.name, color: seat.color, isHost: !!seat.isHost, rejoined: true
        });
      }
    }

    if (room.started) return res.status(400).json({ error: "这局已经开了，坐不进来了" });
    if ((room.seats || []).length >= MAX_SEATS) return res.status(400).json({ error: "四个位子都坐满了" });

    const taken = room.seats.map((s) => String(s.color || "").toLowerCase());
    const asked = String(body.color || "").toLowerCase();
    const color = (SEAT_COLORS.includes(asked) && !taken.includes(asked))
      ? asked
      : (SEAT_COLORS.find((c) => !taken.includes(c)) || SEAT_COLORS[0]);

    const seat = {
      playerId: "p" + (room.seats.length + 1),
      playerToken: randomBytes(16).toString("hex"),
      name: String(body.name || "").trim().slice(0, 16) || ("玩家" + (room.seats.length + 1)),
      color,
      isHost: room.seats.length === 0
    };
    room.seats.push(seat);
    store.save(room);
    push(room);
    res.json({
      ok: true, code: room.code, playerId: seat.playerId, playerToken: seat.playerToken,
      name: seat.name, color: seat.color, isHost: seat.isHost, rejoined: false
    });
  });

  // POST /rooms/:code/start — 只有房主，至少 2 人
  api.post("/rooms/:code/start", scope, (req, res) => {
    const room = mustRoom(req, res);
    if (!room) return;
    const host = (room.seats || [])[0];
    const token = (req.body && req.body.playerToken) || "";
    if (!host || token !== host.playerToken) return res.status(403).json({ error: "开局是房主的事" });
    if (room.started) return res.status(400).json({ error: "这局已经在走了" });
    if (room.seats.length < 2) return res.status(400).json({ error: "至少要两个人才开得了局" });

    let state;
    try {
      state = engine.createGame({
        players: room.seats.map((s) => ({ id: s.playerId, name: s.name, color: s.color })),
        config: gameConfig(),
        seed: randomInt(1, 2147483647)
      });
    } catch (e) {
      return res.status(400).json({ error: (e && e.message) || "开不了局" });
    }
    Object.assign(room, { started: true, finished: false, paused: false, startedAt: Date.now(), state });
    store.save(room);
    push(room);
    res.json({ ok: true, code: room.code, seq: state && state.seq });
  });

  // GET /rooms/:code/state — 脱敏棋面；只有 owner 拿得到邀请码
  api.get("/rooms/:code/state", scope, (req, res) => {
    const room = mustRoom(req, res);
    if (!room) return;
    const payload = snapshot(room);
    payload.ok = true;
    if (req.authLevel === "owner") payload.inviteToken = room.inviteToken;
    res.json(payload);
  });

  // GET /rooms/:code/events — SSE，连上先补一帧
  api.get("/rooms/:code/events", scope, (req, res) => {
    const room = mustRoom(req, res);
    if (!room) return;
    const detach = live.attach(room.code, res, snapshot(room));
    req.on("close", detach);
    res.on("close", detach);
  });

  // POST /rooms/:code/chat — 牌桌闲聊，观战的人也能说
  api.post("/rooms/:code/chat", scope, (req, res) => {
    const room = mustRoom(req, res);
    if (!room) return;
    const body = req.body || {};
    const text = String(body.text == null ? "" : body.text).trim();
    if (!text) return res.status(400).json({ error: "空的发不出去，说点什么" });
    if (text.length > 500) return res.status(400).json({ error: "一条最多 500 字，太长了" });
    const seat = (room.seats || []).find((s) => s.playerToken === body.playerToken);
    if (!Array.isArray(room.chat)) room.chat = [];
    room.chat.push({
      ts: Date.now(),
      by: seat ? seat.playerId : null,
      name: seat ? seat.name : (String(body.name || "").trim().slice(0, 16) || "观战"),
      text
    });
    if (room.chat.length > CHAT_KEEP) room.chat = room.chat.slice(-CHAT_KEEP);
    store.save(room);
    push(room);
    res.json({ ok: true });
  });

  /* POST /rooms/:code/revoke_invite — 房主收回分享链接。
     她 8/22：「我做完房主应该可以手动结束链接分享」。已经坐在桌上的人不受影响，
     他们靠的是座位 token，不是邀请码。 */
  api.post("/rooms/:code/revoke_invite", scope, (req, res) => {
    const room = mustRoom(req, res);
    if (!room) return;
    if (!isHost(req, room)) return res.status(403).json({ error: "收回链接是房主的事" });
    room.inviteToken = (req.body && req.body.reissue) ? randomBytes(16).toString("hex") : "";
    store.save(room);
    push(room);
    res.json({ ok: true, inviteToken: room.inviteToken });
  });

  /* POST /rooms/:code/pause — 她 8/24：「突然有事，就可以留着下次玩」。
     棋面原样锁着，谁回来走一步就自动解除。 */
  api.post("/rooms/:code/pause", scope, (req, res) => {
    const room = mustRoom(req, res);
    if (!room) return;
    if (!isHost(req, room)) return res.status(403).json({ error: "暂停是房主的事" });
    if (!room.started || !room.state) return res.status(400).json({ error: "还没开局，没什么好暂停的" });
    room.paused = true;
    appendChat(room, "这局暂停了，棋面留着，下次回来接着走。");
    store.save(room);
    push(room);
    res.json({ ok: true, paused: true });
  });

  // POST /rooms/:code/action — 走棋。只认自己的座位 token。
  api.post("/rooms/:code/action", scope, (req, res) => {
    const room = mustRoom(req, res);
    if (!room) return;
    if (!room.started || !room.state) return res.status(400).json({ error: "还没开局呢" });
    const body = req.body || {};
    const seat = (room.seats || []).find((s) => s.playerToken === body.playerToken);
    if (!seat) return res.status(403).json({ error: "你没坐下，现在是在观战" });
    if (!body.type) return res.status(400).json({ error: "没说要做什么" });

    const action = {};
    for (const [k, v] of Object.entries(body)) if (k !== "playerToken") action[k] = v;
    room.paused = false;      // 有人走棋＝接着玩了

    let out;
    try {
      out = engine.apply(room.state, seat.playerId, action);
    } catch (e) {
      return res.status(400).json({ error: (e && e.message) || "这一步走不了" });
    }
    room.state = out && out.state ? out.state : out;
    room.lastActionAt = Date.now();
    store.save(room);
    push(room);
    res.json({
      ok: true,
      seq: room.state && typeof room.state.seq === "number" ? room.state.seq : 0,
      events: (out && out.events) || []
    });
  });

  /* POST /rooms/:code/skip — 房主把卡住的人推过这一回合。
     8/23 晚打出来的需求：有人挂机，四个人干等，而 action 必须带本人 token，房主也代打不了。
     做法是**不绕过引擎**，替他按最小合法路径走：awaiting_roll→roll、awaiting_move→挑第一架能动的。
     两条红线：卡满一分钟才准跳（免得房主抢别人回合）；每一轮都重新读 room.state
     ——engine.apply 返回的是新对象，拿进函数时的旧引用当循环条件会永远停在第一帧。 */
  api.post("/rooms/:code/skip", scope, (req, res) => {
    const room = mustRoom(req, res);
    if (!room) return;
    if (!room.started || !room.state) return res.status(400).json({ error: "还没开局呢" });
    if (room.state.phase === "game_over") return res.status(400).json({ error: "这局已经走完了" });
    if (!isHost(req, room)) return res.status(403).json({ error: "跳过卡住的人只有房主能点" });

    const privileged = req.authLevel === "owner" || req.authLevel === "agent";
    const waited = Date.now() - (room.lastActionAt || 0);
    if (!privileged && waited < SKIP_AFTER_MS) {
      const left = Math.ceil((SKIP_AFTER_MS - waited) / 1000);
      return res.status(400).json({ error: `他才停了 ${Math.floor(waited / 1000)} 秒，再等 ${left} 秒才能跳` });
    }

    const stuck = room.state.currentPlayer;
    const who = seatName(room, stuck) || stuck;
    const events = [];
    let steps = 0;
    let failed = null;

    while (steps < 12) {
      const cur = room.state;
      if (!cur || cur.phase === "game_over") break;
      if (cur.currentPlayer !== stuck) break;         // 换人了，收工
      let type;
      if (cur.phase === "awaiting_roll") type = "roll";
      else if (cur.phase === "awaiting_move") type = "move";
      else break;
      steps++;
      try {
        const arg = { type };
        if (type === "move") {
          const movable = engine.movable(room.state, engine.cur(room.state), room.state.dice);
          if (!movable.length) break;
          arg.plane = movable[0];                     // 跳过时挑第一架，不替他做优选
        }
        const out = engine.apply(room.state, stuck, arg);
        room.state = out && out.state ? out.state : out;
        if (out && out.events) events.push(...out.events);
      } catch (e) {
        failed = (e && e.message) || "未知";
        break;                                        // 别 return：前几步的结果要留住
      }
    }
    if (failed && steps <= 1) return res.status(400).json({ error: "一步都没走动：" + failed });

    room.lastActionAt = Date.now();
    appendChat(room, `房主把 ${who} 这一回合跳过去了。`);
    store.save(room);
    push(room);
    res.json({ ok: true, skipped: who, steps, events });
  });

  app.use(BASE + "/api", api);
  /* ★2026-08-29 17:03 她一下午说了四次「没区别」「一样是一样了」——每次都是**她手机拿着缓存**。
     我改完只会说「你刷新一下」，她杀了两次 App 才看到，这不该是她的活。
     页面和它的 css/js 一律 no-cache：浏览器每次都回来问一句「变了吗」，
     没变就用缓存（省流量），变了立刻拿新的。她重进房间就是最新的，不用再杀 App。 */
  app.use(BASE, express.static(publicDir, {
    extensions: ["html"], index: "index.html",
    setHeaders(res, filePath) {
      if (/\.(html|css|js)$/i.test(filePath)) res.setHeader("Cache-Control", "no-cache");
    }
  }));
  app.get("/", (req, res) => res.redirect(BASE + "/"));
  app.use((req, res) => res.status(404).json({ error: "没有这个地址" }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("[aeroplane] error", err && err.stack ? err.stack : err);
    if (res.headersSent) return res.end();
    res.status(500).json({ error: (err && err.message) || "服务器这边出岔子了" });
  });

  const server = http.createServer(app);

  return {
    app, server, engine, dataDir,
    roomsDir: store.roomsDir,
    cleanupRooms: () => store.sweep(),
    signCookie: (v) => gate.sign(v),
    get loginRequired() { return gate.required; },
    get port() {
      const a = server.address();
      return a && typeof a === "object" ? a.port : null;
    },
    start(port, host) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port == null ? DEFAULT_PORT : port, host || DEFAULT_HOST, () => {
          server.removeListener("error", reject);
          resolve(server.address().port);
        });
      });
    },
    stop() {
      return new Promise((resolve) => {
        live.closeAll();
        server.close(() => resolve());
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      });
    }
  };
}

module.exports = { createServer };

if (require.main === module) {
  const inst = createServer({});
  const swept = inst.cleanupRooms();
  if (swept) console.log(`[aeroplane] 回收了 ${swept} 间玩完的房`);
  const port = parseInt(process.env.PORT, 10) || DEFAULT_PORT;
  inst.start(port, process.env.HOST || DEFAULT_HOST).then((p) => {
    console.log(`[aeroplane] listening on ${process.env.HOST || DEFAULT_HOST}:${p} (data: ${inst.dataDir}, host: ${os.hostname()})`);
    if (!inst.loginRequired) {
      console.log("[aeroplane] open mode：没设 BISCA_PASSWORD，能连到这个端口的人都是房主。要暴露到公网请先设密码。");
    }
  }).catch((e) => {
    console.error("[aeroplane] failed to listen:", e && e.message);
    process.exit(1);
  });
}
