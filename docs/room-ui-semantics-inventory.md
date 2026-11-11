# 房间界面语义识别清单

本清单记录实际实现状态，不代表 AI 已经能够读取这些元素。语义标识独立于视觉样式，可供未来设计映射使用。

扩展方向：控件语义以数据规格注册，识别器按稳定 ID 查询，不能为每个新控件增加专用分支。注册语义只是描述，不代表执行权限；AI 生成的批注、回复和其他组件仍需要独立的协议校验与受控渲染。当前注册表是基础代码，尚未接入房间或持久化，也不支持直接执行 AI 生成的组件规格。

## 工具栏工具

下列工具已定义稳定标识、名称、用途和同组关联；名称复用 `TOOL_CATALOG`。工具按钮已附带对应标识。

| 标识 | 功能 |
| --- | --- |
| `toolbar.tool.navigate` | 移动 |
| `toolbar.tool.pen` | 画笔 |
| `toolbar.tool.highlight` | 高亮 |
| `toolbar.tool.line` | 直线 |
| `toolbar.tool.arrow` | 箭头 |
| `toolbar.tool.rectangle` | 矩形 |
| `toolbar.tool.circle` | 圆形 |
| `toolbar.tool.text` | 文本 |
| `toolbar.tool.comment` | 评论 |
| `toolbar.tool.selection` | 选择 |
| `toolbar.tool.area` | 区域 |
| `toolbar.tool.eraser` | 橡皮 |
| `toolbar.tool.inspect` | 元素检查 |
| `toolbar.tool.multiInspect` | 多选检查 |
| `toolbar.tool.measure` | 测量 |
| `toolbar.tool.guide` | 引导 |

## 尚未实现

- 房间其他控件、设置、评论、协作面板和菜单的语义目录。
- 悬停目标的采集、过期处理及安全状态识别。
- 以认领关系为边界的服务端授权和 AI 主动读取接口。
- 多人、隐私和端到端验证；Figma 映射和 UI 编译解码器不属于本阶段。
