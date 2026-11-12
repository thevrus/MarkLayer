# 界面语义注册表与规格编译协议

本文档定义 MarkLayer 界面语义注册表（UI Semantics Registry）的规范、校验机制、受控编译流程与安全权限边界。

---

## 1. 架构目标与设计原则

xxc 提出的核心架构要求：
> 以后新增控件（包括 AI 按规格组合出的批注、回复等组件）必须通过可扩展的组件规格 + 注册机制被识别，不能在识别器里为每个控件写死分支。

注册表与编译层遵循以下设计准则：
- **纯数据声明驱动**：控件元数据与组件属性规格以纯数据声明，不与 DOM 或具体渲染实现耦合。
- **严格白名单校验**：未知组件拒绝、未声明属性拒绝、类型与枚举严格匹配，杜绝意外或恶意输入。
- **纯函数受控编译**：编译过程为纯函数（无副作用、不修改全局状态），合法规格编译为纯数据受控渲染描述，绝对不产出 HTML 字符串、不执行脚本、不执行 `eval`。
- **输出顺序确定性**：属性键名规范化排序、列表保持原始输入拓扑，确保比对、序列化与渲染行为稳定可复现。

---

## 2. 谁能往注册表写（注册权限与信任边界）

### 2.1 写入权限主体
- **宿主环境与核心模块**：系统内置工具栏（Toolbar）、基础标注控件在启动阶段静态注册。
- **受信任插件与扩展加载器**：通过声明式机制在初始化阶段向注册表注入扩展控件规格。

### 2.2 信任边界与禁止事项
- **AI 与外部不受信输入绝对不可写**：AI 模型、网络推送数据、页面注入脚本**严禁**直接向注册表注册或修改组件规格。AI 的角色仅限于**消费者与规格组合者**——根据已注册的规格生成组件实例（`RawComponentSpec`），由系统校验层审核。
- **防篡改与不可重复注册**：同一个 `id` 或组件 `kind` 注册后不可被覆盖；尝试重复注册同名控件将抛出 `Duplicate` 异常，防止运行时原型劫持或规约污染。

---

## 3. 规格形态与数据结构

### 3.1 组件元定义规格（`ComponentSchema`）
宿主注册控件时需定义其属性模式：

```typescript
export type ComponentPropType = 'string' | 'number' | 'boolean' | 'enum' | 'string[]';

export interface ComponentPropDef {
  type: ComponentPropType;
  required?: boolean;
  enumValues?: readonly (string | number)[];
  description?: string;
}

export interface ComponentSchema {
  kind: string;                         // 格式：^[a-zA-Z][a-zA-Z0-9._-]{0,127}$
  description?: string;
  props: Record<string, ComponentPropDef>;
}
```

### 3.2 界面语义项与组件规格关联（`UiSemantic`）
语义项用于标识控件在界面中的稳定身份、区域与关联，可直接内嵌或关联其属性规格：

```typescript
export interface UiSemantic {
  id: string;                           // 如 "annotation.card"
  label: string;                        // 显示名称，如 "批注卡片"
  purpose: string;                      // 语义用途
  region: string;                       // 所属界面区域，如 "canvas", "toolbar", "annotation"
  related: readonly string[];           // 同组或关联控件 ID
  schema?: ComponentSchema;             // 可选关联组件完整规格
  props?: Record<string, ComponentPropDef>; // 可选简写属性声明（自动以 id 作为 kind 注册组件规格）
}
```

### 3.3 AI 生成的原始组件规格（`RawComponentSpec`）
AI 或外部输入提供的待校验数据结构：

```typescript
export interface RawComponentSpec {
  kind: string;                         // 目标组件类型
  props?: Record<string, unknown>;      // 传参属性包
}
```

### 3.4 示例：批注卡片规格
```json
{
  "kind": "annotation.card",
  "description": "批注卡片展示组件",
  "props": {
    "author": { "type": "string", "required": true },
    "content": { "type": "string", "required": true },
    "pinned": { "type": "boolean" },
    "status": { "type": "enum", "enumValues": ["open", "resolved"] },
    "tags": { "type": "string[]" }
  }
}
```

---

## 4. 校验规则与安全防御

校验层（`validateComponentSpec` / `validateComponentSpecs`）按顺序执行下列防御性检查：

1. **输入结构合法性**：规格必须为非 null 的纯对象；批量输入必须为数组。
2. **未知组件拒绝（Unknown Kind）**：
   - 提取 `spec.kind`；
   - 若 `kind` 未在注册表中登记，立即拦截，返回 `code: 'UNKNOWN_KIND'`；
   - **拒绝原因**：未注册的组件属于不受信或未知元素，禁止进入后续管线。
3. **属性白名单校验（Undeclared Prop）**：
   - 遍历 `spec.props` 中的所有键；
   - 任何未在 `ComponentSchema.props` 声明的属性一律拒绝，返回 `code: 'UNDECLARED_PROP'`；
   - 杜绝通过私自添加额外字段（如 `onClick`, `evalPayload`, `innerHtml`）进行数据走私或属性注入。
4. **原型污染防御（Prototype Pollution Defense）**：
   - 拦截包含 `__proto__`、`constructor`、`prototype` 键名的属性；
   - 检查 `props` 原型，非普通对象或被篡改原型的对象直接拒绝。
5. **必填属性检查（Missing Required Prop）**：
   - 检查所有声明为 `required: true` 的属性是否存在且非 null/undefined；
   - 缺少任一必填字段返回 `code: 'MISSING_REQUIRED_PROP'`。
6. **类型与枚举严格匹配（Type & Enum Enforcement）**：
   - `string`：必须为严格 JavaScript `typeof === 'string'`；
   - `number`：必须为 `typeof === 'number'` 且 `Number.isFinite(val)`（剔除 `NaN` 与 `Infinity`）；
   - `boolean`：必须为严格布尔值（不接受隐式转换，如 `"true"` 或 `1` 均被拒）；
   - `enum`：必须严格属于 `enumValues` 白名单列表，超出范围返回 `code: 'ENUM_MISMATCH'`；
   - `string[]`：必须为数组，且数组内所有子元素均为字符串；
   - 任何函数、闭包、BigInt、Symbol、DOM 节点均视作非法类型直接拒绝。

---

## 5. 错误形态（稳定可读）

校验失败时，返回统一的结构化错误项 `UiSemanticsValidationErrorItem`：

```typescript
export interface UiSemanticsValidationErrorItem {
  readonly path: string;       // 错误发生路径，例如 "props.author" 或 "[1].props.status"
  readonly field: string;      // 出错的字段名称，例如 "author"
  readonly code:               // 错误枚举分类
    | 'UNKNOWN_KIND'
    | 'UNDECLARED_PROP'
    | 'TYPE_MISMATCH'
    | 'ENUM_MISMATCH'
    | 'MISSING_REQUIRED_PROP'
    | 'INVALID_SPEC';
  readonly message: string;    // 人类可读且确定性的错误原因
}
```

- **批量校验路径追踪**：在对组件列表进行批量校验时，`path` 会带上索引前缀（如 `[0].props.title`、`[1].kind`），方便调用方精确诊断。
- **编译时异常**：调用 `compileComponentSpec` 或 `compileControlledRender` 遇到非法规格时，统一抛出 `UiSemanticsCompileError`，其 `errors` 属性完整保留上述所有错误项。

---

## 6. 执行权限边界（核心安全准则）

> **重要声明：注册表只描述“这是什么控件”，不授予任何动作权限。**

1. **零权限赋予（Capability-Free Registry）**：
   - 注册表中登记的任何元数据（语义 ID、标签、用途、属性规格）仅用于描述组件的静态数据结构与界面归属；
   - 注册表本身不包含任何函数句柄、回调指针、系统 API 凭证或 DOM 操作入口；
   - 任何组件规格的识别与存在，都不代表其具备执行页面动作或系统变更的权力。
2. **动作必须走显式用户批准流程（User-in-the-Loop Approval）**：
   - 涉及页面操作、批注提交/修改/删除、元素框选、页面导航、远程数据同步等任何产生副作用的动作，**必须**走宿主独立的动作调度器（Action Dispatcher）；
   - 所有高风险或写操作必须向用户呈现明确的二次确认与批准界面，经用户主动交互（如点击确认弹窗）后方可由宿主受信任代码执行；
   - AI 生成或组装的组件规格绝对不能越过用户确认通道隐式触发执行。

---

## 7. 受控渲染的边界（Controlled Rendering & Anti-Injection）

编译函数（`compileComponentSpec` / `compileComponentSpecs` / `compileControlledRender`）负责将通过校验的规格转化为受控渲染描述（`ControlledRenderNode`）：

```typescript
export interface ControlledRenderNode {
  readonly kind: string;
  readonly props: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}
```

### 7.1 安全边界与硬性约束
- **白名单组件**：节点类型只能是已在注册表登记的 `kind`。
- **白名单属性**：仅包含在 `ComponentSchema.props` 中声明过的合法属性，非声明属性在校验阶段已被彻底拦截。
- **禁止产出任何 HTML 字符串**：
  - 编译器不拼接、不输出任何 HTML 片段字符串（禁止返回类似 `<div class="...">` 的文本）；
  - 宿主受控渲染层严禁将受控节点的属性送入 `innerHTML`、`outerHTML` 或 `dangerouslySetInnerHTML`。
- **禁止执行脚本与 eval**：
  - 编译器代码中严禁调用 `eval()`、`new Function()` 或动态脚本引入；
  - 所有属性值仅保留纯数据基元（string、number、boolean、string[]），不包含可执行对象；
  - 渲染节点整体及其 `props` 字典均通过 `Object.freeze` 深度冻结，杜绝运行时篡改。
- **输出顺序确定性（Deterministic Ordering）**：
  - 编译后的 `props` 字典键名强制按英文字母升序排列，消除因输入字典键序差异带来的比对抖动；
  - 组件列表编译保持输入的先后顺序不变，确保渲染树拓扑稳定。
