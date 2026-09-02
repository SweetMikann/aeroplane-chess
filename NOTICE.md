# NOTICE · 第三方与署名

本仓库整体以 [CC BY 4.0](LICENSE) 发布。署名：**Mikann & 澄 & Damien**。

## 底盘：29-Cu/bisca

飞行棋最初长在 [29-Cu/bisca](https://github.com/29-Cu/bisca)（Cu & Lunedì，CC BY 4.0）这套「家庭牌窝」的底盘上：
开房 / 邀请链接 / 座位 token / 大厅的做法都是照它的形状来的。本仓库直接带走并改动了它的这几个文件：

| 文件 | 来源 | 改动 |
| --- | --- | --- |
| `vendor/assets-theme/base.css` | bisca `assets/base.css` | 加了约 140 行：手机端排版、深色玻璃卡片、大厅状态标签等 |
| `vendor/assets-theme/boot.js` | bisca `assets/boot.js` | 加了约 50 行：主题初始化、iOS 安全区处理 |
| `vendor/assets-theme/icons.js` | bisca `assets/icons.js` | 未改 |
| `vendor/fonts/*.woff2` | bisca `fonts/` | 未改（字体本身按 SIL OFL 1.1，见 `vendor/fonts/README.md`） |

`server.cjs` / `lib/gate.cjs` / `lib/store.cjs` / `lib/live.cjs` 是 2026-08 重写的版本，结构和接口延续 bisca 的形状，代码是本仓库自己的。
`engine.cjs`（规则引擎）、`public/`（棋盘、房间页、大厅、音效）、`vendor/assets-theme/swp2.*`（左滑删除）均为本仓库原创。

## 棋盘与角色

棋盘底图与四家角色（海绵小方、小螃蟹、章鱼仔、独眼仔）由 **Damien** 绘制。

## 规则

棋规由 **Mikann** 设计（见 [docs/RULES.md](docs/RULES.md)）。这不是标准飞行棋，请按她的版本理解。
