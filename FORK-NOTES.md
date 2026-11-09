# MarkLayer 派生版本说明

- 上游：[thevrus/MarkLayer](https://github.com/thevrus/MarkLayer)，基线提交 `905a671973c4451fb480761b61eeab35e90a2be5`。
- 上游许可证为 Apache-2.0，原许可证及作者署名保留。
- 本项目在上游基础上开发视觉教学演示、执行模式和批注答疑能力。
- 原 VCP 网页原型归档于本机 `_vcp-archive-2026-11-09`；`MarkLayer-zh-CN` 仅作界面和交互参考，不纳入本仓库。
- 本机基线修复包括 Windows 路径规范化、Preact 测试预加载与工作区类型路径。
- 根工作区使用 TypeScript 6 供 Astro/Volar 检查，其他声明 TypeScript 7 的工作区继续使用各自的版本；Windows 上使用 Bun 1.4.3 运行测试，以避开 1.3.14 的 WebSocket 关闭测试超时。
