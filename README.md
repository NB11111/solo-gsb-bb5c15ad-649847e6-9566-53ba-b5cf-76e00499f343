# JSON 契约工坊（JSON Contract Studio）

把零散的 JSON 样本整理成接口契约：粘贴多份 JSON，系统递归归纳出 **JSON Schema 2020-12**，
自动处理字段缺失、`null`、异构数组与类型冲突，并在树形视图中标注每条规则对应的样本路径；
支持一键复制 Schema、校验新样本并按 **JSON Pointer** 展示错误；
用**样本贡献度**分析逐条评估样本对契约的影响（关键/冗余，附受影响的规则 Pointer）；
还可把归纳结果设为基线，对比新旧两版 Schema 的**契约演进**（破坏性/兼容判定），
为每条破坏性变更加载**反例样本**（递归构造最小 JSON 并用 Ajv 双侧校验），
用**样本影响扫描**把历史样本集按基线/当前 Schema 逐条校验并归类（两版均通过、仅基线通过、
仅当前通过、两版均失败），
通过**发布门禁**结合基线/目标 SemVer 给出允许或阻止发布的结论与可复制报告，
并可按**判别字段**把样本分组生成**事件变体契约**（每组复用归纳引擎生成一个 `oneOf` 分支，
分支内判别字段固定为对应 `const`）；
还可配置多条 **JSON Pointer 规则**对样本做**匿名化导出**——命中标量被替换为跨样本稳定、
保留 JSON 类型的假名，先预览各规则命中情况再一键复制；
也可在 Schema 树勾选 1～20 个节点生成**契约切片**——仅保留所选节点及必要祖先结构的独立
Schema，并同步投影当前样本（后端用 Ajv 逐条校验投影，任一失败则不产出）。

技术栈：Node.js · Express · React（Vite）· Ajv（draft 2020-12）

## 快速开始（Docker，单条命令）

```bash
docker compose up --build
```

启动后访问：**http://localhost:8080**

> 依赖安装、前端构建、后端运行全部包含在该命令内，无需任何本地环境（除 Docker）。
> 不使用 Compose 时亦可：`docker build -t json-contract-studio . && docker run -p 8080:8080 json-contract-studio`

停止：`docker compose down`。

## 功能与归纳规则

| 场景 | 归纳结果 |
| --- | --- |
| 字段在部分样本中缺失 | 该字段不进入 `required`（即可选） |
| 字段出现 `null` | `type` 变为联合类型，如 `["null", "string"]` |
| 整数与浮点混排 | 放宽为 `"number"` |
| 异构数组（如 `["a", 1, null]`） | 所有元素折叠为单个 `items`，类型取并集 |
| 对象与标量冲突 | `type` 并集，如 `["string", "object"]`，`properties` 仅约束对象实例 |
| 全为空数组 | 不生成 `items` 约束（任何元素均可） |

- **树形视图**：每个节点显示类型徽章、必填/可选/可空/多类型标记；点击「n 处样本」展开
  贡献该规则的样本路径（`#/<样本序号>/<路径>`，RFC 6901 转义）。
- **复制 Schema**：一键复制完整 Schema JSON 到剪贴板。
- **校验新样本**：基于 Ajv（`allErrors`），错误按 JSON Pointer（如 `/tags/0`）展示，
  并附带关键字、信息与对应规则路径。
- **样本贡献度**：在「① 样本输入」区一键做留一法分析——逐条移除样本并重新归纳 Schema，
  与完整样本集的归纳结果按规范化后的规则对比，判定每条样本为**关键**（移除后规则变化）
  或**冗余**（移除后规则完全一致），并列出受影响的 JSON Pointer；结果区展示关键/冗余数量，
  可按类型筛选、展开受影响规则，并一键定位到原始样本。单次最多 50 条。
- **契约演进对比**：把当前归纳结果设为基线，修改样本后归纳新版 Schema，比较器递归处理
  对象属性、`required`、类型联合与数组 `items`，在结果区按 JSON Pointer 分组展示变更清单；
  每条变更给出旧/新规则与判定原因，可一键筛选破坏性项。
- **破坏性反例生成**：每条**破坏性**变更可展开「生成反例」。后端依据新旧 Schema、当前视角与
  变更 JSON Pointer 递归构造**最小 JSON**——请求体视角须「旧版通过、新版拒绝」，响应体视角须
  「新版通过、旧版拒绝」；沿途的必填兄弟字段自动填入可通过校验的占位值。覆盖新增/取消必填、
  类型收窄/放宽、数组 `items` 新增/移除。构造后用 Ajv 同时校验两侧，仅在方向确实成立时返回
  样本与双侧错误；若变更被 `enum` 等其他约束抵消而无法构造，则返回明确的不可构造原因。
  展开后可查看格式化样本、双侧校验结论与 Ajv 错误（Pointer/关键字/规则路径/参数），并一键复制样本。
- **样本影响扫描**：在演进页粘贴一个 JSON 数组作为历史样本集，后端用 Ajv 把每条样本分别按
  **基线**与**当前** Schema 校验，归类为「两版均通过 / 仅基线通过 / 仅当前通过 / 两版均失败」；
  结果区按类展示数量与样本索引（`#0`、`#1`…），展开单条可查看两侧错误的 JSON Pointer、关键字与信息。
  单次最多 200 条，超限或输入非数组时前后端都会给出明确错误。
- **发布门禁**：在演进页填写基线版本（当前 SemVer）与目标版本（新版 SemVer），门禁复用当前
  `/api/diff` 差异汇总即时给出「允许/阻止发布」结论，展示实际升级类型、触发结论的变更数量与
  原因，并可复制包含版本、视角、汇总与结论的 JSON 报告；切换视角或修改版本号都会即时重算。
- **事件变体契约**：在「⑤ 事件变体」页填写判别字段的 JSON Pointer（如 `/type`），系统读取每条
  样本该位置的字符串/数字/布尔值并按值分组，每组复用归纳引擎生成一个分支，最终合并为带 `oneOf`
  的 JSON Schema；每个分支把判别字段约束为对应 `const`，且仅组内共同存在的字段进入 `required`。
  判别字段缺失、值为对象/数组/null 或 Pointer 转义非法的样本不参与生成，并按样本序号列出原因；
  有效分组不足 2 个时拒绝产出。结果区展示分组数量、样本数与各分支 Schema，可一键复制完整契约，
  并可一键接入「③ 校验新样本」验证新样本。
- **匿名化导出**：在「① 样本输入」区配置多条 JSON Pointer 规则（支持 RFC 6901 转义与单段 `*`
  通配对象键或数组下标），后端递归匹配最多 200 条样本，把命中的标量替换为跨样本稳定、保留
  JSON 类型的假名（同一规则下相同原值映射一致、不同原值不合并、整数不变小数）；界面先展示
  各规则命中数、未命中项与错误，确认后再一键复制匿名化样本。非法 Pointer、命中对象/数组，
  或不同规则命中同一路径时拒绝生成。
- **契约切片**：在「⑥ 契约切片」页的 Schema 树勾选 1～20 个节点，生成仅保留所选节点及必要
  祖先结构的独立 Schema，并同步投影当前样本；祖先已选时其子项自动包含（重复/被覆盖的勾选
  会被忽略并标注）。界面预览字段数与样本数，可分别复制切片 Schema 与投影样本；后端用 Ajv
  逐条校验投影样本，任一失败则不产出并返回样本索引与错误。

## 契约演进：操作说明

1. 粘贴样本并点击「归纳 Schema」，在「② 契约 Schema」页点「设为基线」（或到「④ 契约演进」页设置）。
2. 修改左侧样本，再次点击「归纳 Schema」，结果区自动切到「④ 契约演进」并展示与基线的差异。
3. 选择视角、按需勾选「仅显示破坏性变更」；可随时「将当前结果设为基线」或「清除基线」。
4. 在每条**破坏性**变更下点击「生成反例」：展开后查看最小反例样本（可一键复制）与旧/新两版
   Ajv 校验结果；无法构造时会展示具体原因（如该节点的唯一区分取值被 `enum` 等约束禁止）。
5. 在「样本影响扫描」卡片粘贴历史样本的 JSON 数组并点击「开始扫描」：结果按四类分组展示
   数量与样本索引，点击单条样本可展开基线/当前两侧的 Ajv 校验详情（Pointer、关键字、信息）。
6. 在「发布门禁」卡片填写基线版本与目标版本（SemVer），即时得到放行结论，需要时可复制门禁报告。

基线仅保存在当前浏览器会话（`sessionStorage`）：刷新页面仍在，关闭标签页即失效，不会上传到服务器持久化。
门禁填写的两个版本号同样仅保存在当前浏览器会话。

判定规则（其余变更标为「兼容」或「提示」）：

| 视角 | 破坏性变更 | 示例 |
| --- | --- | --- |
| 请求体（客户端 → 服务端） | 新版新增必填字段；收窄可接受类型 | 可选变必填、`["null","string"]` → `"string"` |
| 响应体（服务端 → 客户端） | 新版删除必填输出；放宽输出类型 | 必填字段被移除、`"integer"` → `"number"` |

## 样本贡献度：判定规则

分析在 **http://localhost:8080** 页面的「① 样本输入 → 样本贡献度分析」区进行（点击
「分析样本贡献度」），也可直接调用 `POST /api/contribution`。后端先对完整样本集归纳
Schema，再**逐条移除一条样本**重新归纳，比较两份 Schema 的规则差异：

| 判定 | 含义 |
| --- | --- |
| 关键（`critical`） | 移除该样本后，至少一条规则发生变化（类型联合、必填集合、字段有无、数组 `items` 约束） |
| 冗余（`redundant`） | 移除该样本后，归纳出的规则与完整样本集完全一致 |

- **规范化比较，无伪差异**：比较前会把 Schema 规范化——`properties` 键排序、`required`
  数组排序、`type` 统一为有序联合。因此样本的**数组元素顺序**与**对象键顺序**不会产生
  伪差异；受影响的规则按 Schema JSON Pointer 列出（根节点显示为 `(root)`），同一节点的
  多处变化只计一次。
- **结果展示**：汇总关键/冗余数量，可按「全部 / 仅关键 / 仅冗余」筛选；展开单条样本可查看
  受影响的规则 Pointer 列表，点击「定位样本」滚动并高亮对应的原始样本编辑器。
- **失效**：任何样本内容修改都会使上一次分析结果立即失效（结果区清空并提示重新分析）。
- **限制**：单次最多分析 **50** 条样本；超限时前端在提交前拦截提示，接口也返回 `400`
  及明确错误信息。样本存在无效 JSON 时分析按钮不可用。

## 反例构造：规则与判定方向

反例针对单条破坏性变更，目标是「只被这一处差异绊倒」的最小文档：

| 变更类型 | 构造动作 |
| --- | --- |
| 新增必填 / 新增必填字段（请求视角） | 父对象省略该字段，其余必填兄弟字段填占位值 |
| 取消必填 / 删除必填字段（响应视角） | 新版文档省略该字段（旧版必填校验据此失败） |
| 类型收窄（请求）/ 放宽（响应） | 在目标节点取一个「一侧接受、另一侧拒绝」的类型占位值 |
| 数组 `items` 新增约束（请求）/ 移除约束（响应） | 数组放恰好一个具有区分类型的元素 |

- 必填兄弟字段的占位值取满足**接受侧**约束的最小值（优先同时满足另一侧）：
  标量为 `null`/`false`/`0`/`0.5`/`""`，对象递归补齐必填键，数组从空开始。
- 构造完成后用 Ajv 对同一份文档校验两侧；只有方向成立
  （请求：旧✓新✗；响应：新✓旧✗）才返回 `sample` 与 `oldResult/newResult`，
  否则返回 `{ "constructible": false, "reason" }`，说明是接受侧未通过还是两侧都接受。

## 样本影响扫描：归类规则

扫描在 **http://localhost:8080** 页面的「④ 契约演进 → 样本影响扫描」卡片进行（需先设置基线并归纳出
当前 Schema），也可直接调用 `POST /api/scan`。每条历史样本都会用 Ajv 分别对基线与当前 Schema
校验一次，然后归入恰好一类：

| 分类 | 含义 | 关注点 |
| --- | --- | --- |
| 两版均通过（`both`） | 基线 ✓ 且当前 ✓ | 演进对这些样本无影响 |
| 仅基线通过（`baselineOnly`） | 基线 ✓ 但当前 ✗ | **升级后将被拒绝的历史流量，需重点核对** |
| 仅当前通过（`currentOnly`） | 基线 ✗ 但当前 ✓ | 此前不合规、当前 Schema 起被接受 |
| 两版均失败（`neither`） | 基线 ✗ 且当前 ✗ | 本就不符合基线契约 |

- 输入必须是一个 JSON 数组（每个元素为一条历史样本）；单次最多 **200** 条。
  输入非数组或超限时，接口返回 `400` 及明确错误信息，前端也会在提交前拦截并提示。
- 结果按类分组展示数量与样本索引（`#` 前缀为样本在数组中的下标）；展开单条样本可查看
  基线/当前两侧的校验结论，失败侧列出全部 Ajv 错误（JSON Pointer、关键字、信息、规则路径）。
- 重新归纳或更换基线后，旧扫描结果会自动失效清空，需重新扫描。

## 发布门禁：判定规则

门禁完全在浏览器内基于当前 `/api/diff` 结果计算，不发起额外请求：

| 契约差异（当前视角） | 放行条件 |
| --- | --- |
| 存在破坏性变更 | 仅**主版本**提升可放行（如 `1.2.3` → `2.0.0`，含 `2.0.0-alpha.1`） |
| 仅有兼容/提示级变更 | 至少**次版本**提升（如 `1.2.3` → `1.3.0`） |
| 无契约变化 | **补丁级**发布即可（含同数值版本的预发布递进，如 `1.2.3-alpha` → `1.2.3`） |
| 目标版本 ≤ 基线版本 | 降级或同版本**一律阻止** |

版本解析遵循 SemVer 2.0.0：支持可选 `v` 前缀（`v1.2.3`）与预发布标识（`1.0.0-alpha.1`），
比较时先比主/次/补丁数值，再按预发布优先级（预发布 < 正式版，数字标识符按数值、字母标识符按
ASCII 比较）；构建元数据（`+build`）可解析但不参与比较。结论区展示实际升级类型、门禁要求、
触发结论的变更数量与原因；「复制门禁报告」生成包含版本、视角、差异汇总与结论的 JSON。

## 事件变体契约：规则与入口

入口：**http://localhost:8080** 页面的「⑤ 事件变体」页签，或直接调用 `POST /api/variant`。
适合同一接口下有多种事件形态的场景（如 `{"type": "created", ...}` 与 `{"type": "deleted", ...}`）：
填写判别字段的 JSON Pointer 后点击「生成事件变体契约」，系统按该字段的取值把样本分组，
每组复用归纳引擎生成一个分支 Schema，最终合并为一份带 `oneOf` 的契约。

**判别 Pointer（RFC 6901）**：

- 须以 `/` 开头，逐段按**对象属性**查找（如 `/type`、`/meta/event`）；`~` 转义仅支持
  `~0`（表示 `~`）与 `~1`（表示 `/`），可定位含特殊字符的键名。
- 转义非法（如 `/a~2b`、未以 `/` 开头）时，所有样本均不参与生成并逐条标注原因，请求被拒绝（422）。
- 空字符串 `""` 表示根节点（仅对标量样本有意义）；界面留空时不发起生成。

**分组规则**：

- 仅字符串、数字、布尔值参与分组；取值按类型区分——`1`、`"1"`、`true` 是三个不同分组。
- 判别字段**缺失**，或该位置的值为**对象 / 数组 / null** 的样本不参与生成，
  结果区按样本序号逐条列出原因。
- 分组（及 oneOf 分支）按判别值在样本中首次出现的顺序排列。

**分支 Schema 规则**：

- 每个分支由该组样本经归纳引擎生成：仅**组内共同存在**的字段进入 `required`。
- 判别字段在分支内被约束为对应 `const`（嵌套路径上的每一级都会确保进入 `required`），
  因此各分支互斥，恰好匹配一个分支的 `oneOf` 语义成立。
- 树形视图中判别字段节点带 `const` 徽章，样本路径标注已换算回全局样本序号。

**产出与拒绝**：

- 有效分组不足 2 个时拒绝产出（HTTP 422），响应仍携带分组概要与跳过明细，界面同步展示。
- 成功时界面展示分组数量、有效样本数与各分支 Schema，可一键复制完整契约；
  点击「在校验页验证 →」跳转到「③ 校验新样本」并以该变体契约为校验目标
  （校验页也可随时在「归纳 Schema / 事件变体契约」之间切换校验目标）。
- 单次最多 200 条样本；任何样本或判别字段修改都会使上次生成结果失效。

## 匿名化导出：规则与替换

入口：**http://localhost:8080** 页面的「① 样本输入 → 匿名化导出」区，或直接调用
`POST /api/anonymize`。每条规则是一个 JSON Pointer 模式，后端递归匹配全部样本（最多 200 条），
把命中位置的标量替换为假名后返回整组匿名化样本。

**规则语法（RFC 6901 + 通配）**：

- 须以 `/` 开头（空串 `""` 表示样本根）；`~` 转义仅支持 `~0`（表示 `~`）与 `~1`（表示 `/`）。
- 单段 `*` 通配该层的任意对象键或数组下标（如 `/tags/*`、`/address/*`、`/*`）；
  字面数字段按 RFC 6901 作为数组下标匹配（如 `/tags/0`）。
- 匹配在标量、缺失键与越界下标处安静停止——未命中不是错误，结果区以「未命中」标记该规则。

**替换规则**：

| 原值类型 | 假名形式 |
| --- | --- |
| 字符串 | `anon_<12 位哈希>`（由规则模式与原值确定性生成） |
| 整数 | 确定性 9 位整数（**不会变成小数**） |
| 浮点 | 确定性非整数（不会变成整数） |
| 布尔 | 取反（布尔域上唯一同时满足单射与隐藏原值的映射） |
| null | `null`（唯一可能取值） |

- **跨样本稳定**：同一规则下，相同原值在任何样本中都映射为同一假名；不同原值绝不合并
  （哈希碰撞时自动重播种）。相同输入重复导出结果完全一致。
- **拒绝生成（HTTP 422）**：规则不是合法 JSON Pointer；任一命中落在对象或数组上；
  两条不同规则在同一样本命中同一路径（如 `/a/*` 与 `/a/b` 同时命中 `#/0/a/b`）。
  拒绝时响应仍携带各规则的命中数、命中路径与错误原因，界面同步展示。
- **界面流程**：点击「预览匿名化」先展示各规则命中数、未命中项与错误，生成成功后才出现
  「复制匿名化样本」与 JSON 预览；规则或原样本有任何修改，上次预览立即失效。

## 契约切片：规则与入口

入口：**http://localhost:8080** 页面的「⑥ 契约切片」页签（需先在「① 样本输入」归纳出
Schema），或直接调用 `POST /api/slice`。在 Schema 树勾选 1～20 个节点后点击「生成契约切片」，
后端生成仅保留所选节点及必要祖先结构的独立 Schema，并把每条样本沿相同路径投影。

**勾选与 Pointer（Schema 树指针，RFC 6901）**：

- 勾选对象属性对应 `/properties/<键>`、数组元素对应 `/items`，根节点为空串 `""`；
  `~` 转义仅支持 `~0`（表示 `~`）与 `~1`（表示 `/`）。
- **祖先已选时忽略其子项**：被其他已选 Pointer 覆盖的子项、以及完全重复的 Pointer 会被忽略，
  结果区的 `ignored` 列表逐条标注原因（与勾选顺序无关）。
- Pointer 非法或指向 Schema 中不存在的节点时拒绝生成（HTTP 422），并逐条列出原因。

**切片 Schema 规则**：

- 对象只保留通向（或位于）所选节点的 `properties`；`required` 仅保留**原本必填且仍存在**
  的字段；数组沿 `items` 递归；`type` 联合、`const` 及其余非结构性关键字保持不变。
- 被完整选中的子树原样保留；根节点自动携带 `$schema`（2020-12）标记。

**样本投影规则**：

- 选中的子树整体克隆；祖先对象只保留选择路径上的键；祖先数组把每个元素沿 `items` 选择
  递归投影；样本值在祖先链上无法继续细分时（标量，或形状与所选路径不符的数组/对象），
  该终端值按原样保留。
- 后端用 Ajv 把每条投影样本对切片 Schema 校验一次：**任一失败则不产出**（HTTP 422），
  响应携带失败样本索引（`failures[].index`，从 0 开始）与完整 Ajv 错误（Pointer、关键字、
  信息、规则路径），界面按样本分组展示。

**产出与失效**：

- 成功时界面预览**字段数**（切片 Schema 中递归统计的 `properties` 字段总数）与**样本数**，
  可分别「复制切片 Schema」与「复制投影样本」，也可展开查看对应 JSON。
- 选择或样本有任何变化，上次切片结果立即失效，需重新生成。
- 单次最多 200 条样本、20 个 Pointer；超限时接口返回 `400` 及明确错误信息。

## 本地开发

```bash
npm run setup        # 安装 server 与 client 依赖
npm run dev:server   # 后端 http://localhost:8080（--watch 热重载）
npm run dev:client   # 前端 http://localhost:5173（/api 代理到 8080）
```

生产模式本地运行：`npm run build && npm start`，访问 http://localhost:8080。

## 测试

```bash
npm test             # node:test，覆盖归纳引擎、契约比较器、反例生成器、样本影响扫描、样本贡献度、事件变体契约、匿名化导出、契约切片、HTTP API 与发布门禁（163 项）
```

## API

| 方法 | 路径 | 请求体 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ "status": "ok" }` |
| POST | `/api/infer` | `{ "samples": [<any>, ...] }` | `{ schema, paths, sampleCount }` |
| POST | `/api/validate` | `{ "schema": {...}, "sample": <any> }` | `{ valid, errors: [{ path, pointer, schemaPath, keyword, message, params }] }` |
| POST | `/api/diff` | `{ "oldSchema": {...}, "newSchema": {...}, "perspective": "request" \| "response" }` | `{ perspective, changes: [{ pointer, kind, field?, severity, oldRule, newRule, reason }], summary: { breaking, compatible, info } }` |
| POST | `/api/counterexample` | `{ oldSchema, newSchema, perspective, kind, pointer }` | `{ constructible, sample?, oldResult: { valid, errors }, newResult: { valid, errors }, reason? }` |
| POST | `/api/scan` | `{ oldSchema, newSchema, samples: [<any>, ...] }`（≤ 200 条） | `{ total, summary: { both, baselineOnly, currentOnly, neither }, samples: [{ index, category, baseline: { valid, errors }, current: { valid, errors } }] }` |
| POST | `/api/contribution` | `{ samples: [<any>, ...] }`（1–50 条） | `{ total, summary: { critical, redundant }, samples: [{ index, verdict, affectedPointers }] }` |
| POST | `/api/variant` | `{ samples: [<any>, ...], pointer: "/type" }`（≤ 200 条） | `{ pointer, totalSamples, validSamples, groupCount, groups: [{ value, count, sampleIndexes, schema, paths }], skipped: [{ index, reason }], schema: { $schema, oneOf } }`；有效分组不足 2 个或 Pointer 非法时返回 422，响应体仍携带分组概要与跳过明细 |
| POST | `/api/anonymize` | `{ samples: [<any>, ...], rules: ["/email", "/tags/*"] }`（≤ 200 条） | `{ totalSamples, rules: [{ index, pattern, status, hits, paths, pathsTruncated, error }], samples: [<匿名化样本>] }`；非法 Pointer、命中对象/数组或规则间路径冲突时返回 422，响应体仍携带各规则统计 |
| POST | `/api/slice` | `{ schema: {...}, samples: [<any>, ...], pointers: ["/properties/a", "/properties/tags/items"] }`（样本 ≤ 200 条，Pointer 1–20 个，`""` 表示根） | `{ schema, samples, fieldCount, sampleCount, pointers, ignored: [{ pointer, reason }] }`；Pointer 非法/未命中返回 422 并携带 `invalidPointers`，任一投影样本未通过 Ajv 校验返回 422 并携带 `failures: [{ index, errors }]`，均不产出切片 |

示例：

```bash
curl -X POST http://localhost:8080/api/infer \
  -H 'Content-Type: application/json' \
  -d '{"samples":[{"id":1,"phone":null},{"id":2,"phone":"123"}]}'
```

为破坏性变更生成反例（请求体视角：样本须通过旧版、被新版拒绝）：

```bash
curl -X POST http://localhost:8080/api/counterexample \
  -H 'Content-Type: application/json' \
  -d '{"oldSchema":{"type":"object","properties":{"phone":{"type":["null","string"]}},"required":["phone"]},"newSchema":{"type":"object","properties":{"phone":{"type":"string"}},"required":["phone"]},"perspective":"request","kind":"type","pointer":"/properties/phone"}'
# -> { "constructible": true, "sample": { "phone": null },
#      "oldResult": { "valid": true, "errors": [] },
#      "newResult": { "valid": false, "errors": [...] } }
```

扫描历史样本集（逐条按基线与当前 Schema 双侧校验并归类）：

```bash
curl -X POST http://localhost:8080/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"oldSchema":{"type":["string","null"]},"newSchema":{"type":["string","integer"]},"samples":["s",null,5,false]}'
# -> { "total": 4,
#      "summary": { "both": 1, "baselineOnly": 1, "currentOnly": 1, "neither": 1 },
#      "samples": [
#        { "index": 0, "category": "both", "baseline": {...}, "current": {...} },
#        { "index": 1, "category": "baselineOnly", ... }, ... ] }
```

留一法分析样本贡献度（逐条移除样本重新归纳，判定关键/冗余）：

```bash
curl -X POST http://localhost:8080/api/contribution \
  -H 'Content-Type: application/json' \
  -d '{"samples":[{"id":1,"tag":"x"},{"id":2,"tag":"y"},{"id":3}]}'
# -> { "total": 3,
#      "summary": { "critical": 1, "redundant": 2 },
#      "samples": [
#        { "index": 0, "verdict": "redundant", "affectedPointers": [] },
#        { "index": 1, "verdict": "redundant", "affectedPointers": [] },
#        { "index": 2, "verdict": "critical",  "affectedPointers": ["/properties/tag"] } ] }
```

按判别字段分组取值生成事件变体契约（oneOf 分支 + const 判别值）：

```bash
curl -X POST http://localhost:8080/api/variant \
  -H 'Content-Type: application/json' \
  -d '{"pointer":"/type","samples":[
        {"type":"created","id":1,"payload":{"a":1}},
        {"type":"created","id":2},
        {"type":"deleted","id":3,"reason":"x"},
        {"id":4}]}'
# -> { "groupCount": 2, "validSamples": 3, "totalSamples": 4,
#      "skipped": [{ "index": 3, "reason": "判别字段缺失" }],
#      "groups": [
#        { "value": "created", "count": 2, "sampleIndexes": [0, 1],
#          "schema": { ..., "properties": { "type": { "type": "string", "const": "created" }, ... },
#                      "required": ["type", "id"] } },
#        { "value": "deleted", "count": 1, "sampleIndexes": [2],
#          "schema": { ..., "required": ["type", "id", "reason"] } } ],
#      "schema": { "$schema": ".../2020-12/schema", "oneOf": [<两个分支>] } }
```

按 JSON Pointer 规则匿名化导出样本（跨样本稳定、类型保留的假名替换）：

```bash
curl -X POST http://localhost:8080/api/anonymize \
  -H 'Content-Type: application/json' \
  -d '{"samples":[
        {"id":1,"email":"alice@example.com","tags":["admin","owner"]},
        {"id":2,"email":"alice@example.com","tags":["user"]}],
       "rules":["/email","/tags/*"]}'
# -> { "totalSamples": 2,
#      "rules": [
#        { "index": 0, "pattern": "/email", "status": "ok", "hits": 2,
#          "paths": ["#/0/email", "#/1/email"], "pathsTruncated": false, "error": null },
#        { "index": 1, "pattern": "/tags/*", "status": "ok", "hits": 3,
#          "paths": ["#/0/tags/0", "#/0/tags/1", "#/1/tags/0"], ... } ],
#      "samples": [
#        { "id": 1, "email": "anon_1e56769b6009", "tags": ["anon_...", "anon_..."] },
#        { "id": 2, "email": "anon_1e56769b6009", "tags": ["anon_..."] } ] }
#      —— 相同原值（alice@example.com）跨样本映射一致，id 未命中规则保持原样
```

勾选 Schema 树节点生成契约切片（仅保留所选结构，同步投影样本）：

```bash
# 先归纳出 Schema，再按需切片
SCHEMA=$(curl -s -X POST http://localhost:8080/api/infer \
  -H 'Content-Type: application/json' \
  -d '{"samples":[{"id":1,"address":{"city":"Shanghai","zip":"200000"}},{"id":2,"address":{"city":"Beijing","zip":"100000"}}]}' \
  | jq '.schema')

curl -X POST http://localhost:8080/api/slice \
  -H 'Content-Type: application/json' \
  -d "{\"schema\":$SCHEMA,\"samples\":[{\"id\":1,\"address\":{\"city\":\"Shanghai\",\"zip\":\"200000\"}},{\"id\":2,\"address\":{\"city\":\"Beijing\",\"zip\":\"100000\"}}],\"pointers\":[\"/properties/address/properties/city\"]}"
# -> { "schema": { "type": "object", "$schema": ".../2020-12/schema",
#                   "properties": { "address": { "type": "object",
#                      "properties": { "city": { "type": "string" } },
#                      "required": ["city"] } },
#                   "required": ["address"] },
#      "samples": [{ "address": { "city": "Shanghai" } },
#                  { "address": { "city": "Beijing" } }],
#      "fieldCount": 2, "sampleCount": 2,
#      "pointers": ["/properties/address/properties/city"], "ignored": [] }
# —— id 未命中被裁掉；若某条投影样本未通过切片 Schema 的 Ajv 校验，
#    则整体返回 422 并在 failures 中给出样本索引与错误
```

## 目录结构

```
├── Dockerfile              # 多阶段：构建前端 → 安装后端依赖 → 精简运行时（非 root）
├── docker-compose.yml      # 单服务，映射 8080
├── package.json            # 根编排脚本（setup/dev/build/start/test）
├── server/
│   ├── infer.js            # 递归归纳引擎（类型并集、required、items 折叠、路径映射）
│   ├── diff.js             # 契约演进比较器（递归对比属性/required/类型联合/items，按视角定级）
│   ├── counterexample.js   # 破坏性反例生成器（递归构造最小 JSON + Ajv 双侧校验）
│   ├── scan.js             # 样本影响扫描器（Ajv 双侧逐条校验 + 四分类，单次上限 200 条）
│   ├── contribution.js     # 样本贡献度分析（留一法重新归纳 + 规范化规则差异判定，单次上限 50 条）
│   ├── variant.js          # 事件变体契约（判别字段分组 + 逐组归纳 + const 注入，合并 oneOf，单次上限 200 条）
│   ├── anonymize.js        # 匿名化导出（JSON Pointer + 单段 * 通配递归匹配，跨样本稳定、类型保留的假名替换，单次上限 200 条）
│   ├── slice.js            # 契约切片（按勾选的 Schema 树 Pointer 裁剪结构 + 投影样本 + Ajv 逐条校验，样本上限 200 条、Pointer 上限 20 个）
│   ├── app.js              # Express（/api/infer、/api/validate、/api/diff、/api/counterexample、/api/scan、/api/contribution、/api/variant、/api/anonymize、/api/slice、静态托管）
│   ├── index.js            # 入口：监听 PORT（默认 8080）
│   └── test/               # node:test 单元与 API 测试
└── client/
    ├── test/               # 发布门禁（SemVer 解析/比较/判定）单元测试
    └── src/
        ├── App.jsx                 # 双栏布局、样本管理、归纳/校验/演进/变体流程、基线（sessionStorage）
        ├── gate.js                 # 发布门禁：SemVer 2.0.0 解析/比较 + 放行判定（纯函数）
        ├── components/SchemaTree.jsx   # 树形视图 + 样本路径标注 + const 徽章 + 契约切片可勾选模式
        ├── components/ValidatePanel.jsx # 校验面板：归纳 Schema / 事件变体契约双目标，JSON Pointer 错误列表
        ├── components/DiffPanel.jsx     # 契约演进面板：视角切换、破坏性筛选、按 Pointer 分组
        ├── components/CounterexamplePanel.jsx # 反例：样本格式化展示、双侧校验结果、复制按钮
        ├── components/SampleScanPanel.jsx  # 样本影响扫描：数组输入、四分类汇总、单条双侧错误展开
        ├── components/ContributionPanel.jsx # 样本贡献度：留一法分析入口、关键/冗余汇总筛选、定位原样本
        ├── components/AnonymizePanel.jsx    # 匿名化导出：规则编辑、命中/未命中/错误预览、复制匿名化样本
        ├── components/SlicePanel.jsx        # 契约切片：可勾选 Schema 树、字段数/样本数预览、分别复制切片 Schema 与投影样本
        ├── components/VariantPanel.jsx    # 事件变体：判别 Pointer 输入、分组/跳过明细、分支 Schema、复制与接入校验
        ├── components/ReleaseGate.jsx   # 发布门禁卡片：版本输入、放行结论、报告复制
        └── components/SampleEditor.jsx  # 样本编辑器（实时 JSON 校验）
```

环境变量：`PORT`（默认 `8080`）。
