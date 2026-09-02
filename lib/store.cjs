"use strict";
/* 房间仓库 —— 飞行棋自己的一份，2026-08-29 重写。
 *
 * 为什么重写：这套服务原本长在 29-Cu/bisca 的底盘上（CC BY 4.0）。棋盘、规则、
 * 界面早就全是我们自己写的了，只剩这层管道还是人家的，一打包发布就得挂他的署名。
 * 她说「那你重写吧」，于是有了这个文件。
 *
 * 盘上那份 JSON 才是真相，内存只是缓存 —— 进程随时可以重启，房间不能丢。
 * 写盘一律先落到同目录的临时文件再 rename：rename 在同一个文件系统上是原子的，
 * 断电也不会留下半截 JSON 把房间读坏。
 */
const fs = require("fs");
const path = require("path");
const { randomBytes, randomInt } = require("crypto");

/* 房号字母表去掉了 I L O 0 1 —— 她要把房号念给人听，这几个听起来一模一样 */
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;
const CODE_RE = /^[A-Z0-9]{6}$/;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
}

/* 原子写：tmp 名字里带 pid 和随机串，两个进程同时写也不会撞到同一个临时文件 */
function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

class RoomStore {
  /* dataDir 下面：config.json（本服务的设置）+ rooms/<房号>.json（一间一个文件） */
  constructor(dataDir, limits) {
    this.dataDir = dataDir;
    this.roomsDir = path.join(dataDir, "rooms");
    this.cache = new Map();
    const l = limits || {};
    this.maxFiles = l.maxFiles || 200;
    this.staleMs = l.staleMs || 7 * 24 * 3600 * 1000;
    fs.mkdirSync(this.roomsDir, { recursive: true });
  }

  static isCode(code) { return typeof code === "string" && CODE_RE.test(code); }

  fileOf(code) { return path.join(this.roomsDir, code + ".json"); }

  /* 生成一个盘上还没被占的房号；真撞满 30 次就认输，让调用方报错而不是覆盖别人的房 */
  newCode() {
    for (let i = 0; i < 30; i++) {
      let code = "";
      for (let j = 0; j < CODE_LEN; j++) code += CODE_CHARS[randomInt(0, CODE_CHARS.length)];
      if (!fs.existsSync(this.fileOf(code))) return code;
    }
    return null;
  }

  get(code) {
    if (!RoomStore.isCode(code)) return null;
    const hit = this.cache.get(code);
    if (hit) return hit;
    const room = readJson(this.fileOf(code), null);
    if (!room || room.code !== code) return null;
    this.cache.set(code, room);
    return room;
  }

  save(room) {
    room.updatedAt = Date.now();
    writeJson(this.fileOf(room.code), room);
    this.cache.set(room.code, room);
    return room;
  }

  drop(code) {
    this.cache.delete(code);
    try { fs.rmSync(this.fileOf(code), { force: true }); } catch (e) { /* 已经没了 */ }
  }

  codes() {
    let names = [];
    try { names = fs.readdirSync(this.roomsDir); } catch (e) { return []; }
    const out = [];
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const code = n.slice(0, -5);
      if (RoomStore.isCode(code)) out.push(code);
    }
    return out;
  }

  /* 大厅列表：最近动过的排前面 */
  recent(limit) {
    const rooms = this.codes().map((c) => this.get(c)).filter(Boolean);
    rooms.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return limit ? rooms.slice(0, limit) : rooms;
  }

  byInvite(token) {
    if (!token || typeof token !== "string") return null;
    for (const code of this.codes()) {
      const room = this.get(code);
      if (room && room.inviteToken && room.inviteToken === token) return room;
    }
    return null;
  }

  /* 回收：房间文件超上限时，从"已经玩完的"和"开了很久没人坐的"里挑最旧的删。
     正在玩的一间都不动 —— 宁可超上限，也不能把她还在下的棋删了。 */
  sweep() {
    const codes = this.codes();
    if (codes.length <= this.maxFiles) return 0;
    const now = Date.now();
    const disposable = [];
    for (const code of codes) {
      const file = this.fileOf(code);
      let mtime = 0;
      try { mtime = fs.statSync(file).mtimeMs; } catch (e) { continue; }
      const room = readJson(file, null);
      if (!room) continue;
      const done = !!(room.state && room.state.winner) || !!room.finished;
      const abandoned = !room.started && now - (room.createdAt || mtime) > this.staleMs;
      if (done || abandoned) disposable.push({ code, mtime });
    }
    disposable.sort((a, b) => a.mtime - b.mtime);
    let left = codes.length;
    let gone = 0;
    for (const d of disposable) {
      if (left <= this.maxFiles) break;
      this.drop(d.code);
      left--; gone++;
    }
    return gone;
  }
}

module.exports = { RoomStore, readJson, writeJson, CODE_CHARS };
