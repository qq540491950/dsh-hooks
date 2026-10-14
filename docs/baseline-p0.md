# P0 基线冻结（2026-10-14）

> 目的：在动手之前把"行为等价"的判据钉死。之后每个阶段的验收都对照本文件。

## 记录值

| 项 | 值 |
|---|---|
| commit | `5ae20265819d1b249054d4a4e3e06cdd404ecad5` |
| 记录时间 | `2026-10-14T15:16:39+08:00` |
| 自检 | `node tools/verify.mjs` → `dsh-hooks verify: 61 passed, 0 failed` + `全绿 ✅` |
| 座位台账（`Slots.listSubTree` root=`settings.section`） | `account/-10`、`general/0`、`models/10`、`plugins/15`、`agent-presets/20`、`mcp/900`、`skills/910`（**尚无 `hooks`**） |
| 装载方式 | 路线 1「路径行」：`~/.dsh/profiles/desktop/cordis.patch.yml:402-404` → `file:///D:/project/dsh-plugins/dsh-hooks/lib/index.js` |
| `$DSH_HOME/hooks.json`（用户级配置） | **不存在**（本机未设置用户级 hooks） |

## sha256（改动前后对照用）

| 文件 | sha256 |
|---|---|
| `lib/index.js` | `a73381889cd2b33ac8b6b0ab6ad2c893e945e9fec417d499b955c0c3ddcc5aa2` |
| `.dsh/hooks.json` | `e0cdae3350ff2ec728f0184081379ef301ef23b8490ff4a05048999567d0e8a8` |
| `package.json` | `ae32bf906e8e63ff200ff7dd7927688cabf1be31ec19aef37eddc3171e998c79` |
| `tools/verify.mjs` | `fdfbb42aa03afa36a2fac1170e8a9e9f877a6af639f069a658813673a509bb98` |
| `README.md` | `b8bf37c1770beafe6e88c5382effd4a3df4033b198e365b903ba27638a1fae9c` |

## 行为等价判据（**不是**字节相等）

从 P3 起 `lib/index.js` 变成 esbuild 产物，字节必然不同。等价性只按下面三条判：

1. `node tools/verify.ts`（迁移前 `verify.mjs`）**PASS 且条数不减少**（基线 61）；
2. 宿主半边仍可被现有 profile 行加载：导出 `name` / `inject` / `apply` 不变，`lib/index.js` 里 `import` 与 `require` 计数均为 0；
3. 行为面差异清单：任何**有意**的行为变化都要写进阶段提交说明，并配一条断言（例：P1 让"解析失败"从"没有配置"变成"沿用上一份可用配置"）。

## 尚未实测（P0 不能宣称的）

- 把 `hooks.json` 写坏后 deny 守卫是否真的消失 —— **读过 `.tmp/hotreload-fix-plan.md` 的实测记录，本轮未亲自复现**（P1 会在线复现，见计划 §5 P1 验收⑥）。
- 客户端半边首次出现是否需要重启 —— 只有间接证据（计划 §7 未核实 #2）。
