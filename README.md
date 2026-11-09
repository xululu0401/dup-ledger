# 雷同度对账台（dup-ledger）

把 2–20 份代码或文字材料放在一起，算两两**净雷同度**（先摘掉出现在全部材料里的公共样板，再算重合）、**表面重合度**与**双向包含度**，按阈值连边成「可疑组」，并给出**最长公共连续段**作为证据。只做文本字面重合对账，不判定抄袭。

- 在线体验：https://xululu0401.github.io/dup-ledger/
- 单文件交付：`index.html`（内联 `core.js` 与 `ui.js`，无外部依赖、不联网）
- 测试：`node --test tests/core.test.cjs`
- 构建：`node build.cjs`（由 `template.html` + `core.js` + `ui.js` 生成 `index.html`）

口径见页面内「算法与使用边界」，与 `../需求与调研.md` 一致。默认样例为虚构的 8 份作业，不来自任何真实考生、赛事或平台。
