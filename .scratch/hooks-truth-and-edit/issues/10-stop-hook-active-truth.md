# 10: `stop_hook_active` 说真话

**What to build:** 按官方语义写的 Stop hook 能真正靠 `stop_hook_active` 防死循环。协议的 payload 里这个字段的含义是"这一轮已经被 Stop hook 续跑过"，hook 自己用它避免重复阻断；而现在它恒为 false——我们手里明明有按会话计数的强制续跑次数，却永远告诉 hook"你没续跑过"。本票让该字段反映真实状态（第二次及以后的强制续跑为 true），并保持 SubagentStop 的 false（harness 的 subagent 接缝没有否决/续跑概念），在实现处写明两者为什么不同。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Stop hook 在第一次强制续跑时收到 `stop_hook_active: false`，第二次及以后收到 `true`
- [ ] 既有的"连续强制续跑 3 次后放行并告警"行为不变
- [ ] SubagentStop 保持 false，实现处注明与 Stop 的语义差异原因
- [ ] 断言用真子进程 + 哨兵法：hook 把实际收到的 stdin 落盘，断言该字段的真实取值（不许只在代码里读常量）
