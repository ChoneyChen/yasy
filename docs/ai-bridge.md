# AI 处理、网页桥与结果合同

Yasy 把题目、真实中文原料、答案、素材与语料的业务合同，与 AI 的连接方式分离。Mac 支持 iiiapi 自动处理和 ChatGPT 手动网页桥；手机未来使用同功能的 API 客户端，UI 不提供网页复制路径。

## 两种处理方式

| provider | 工作方式 | 保存方式 |
| --- | --- | --- |
| `iiiapi` | 本地后台一次调用完成最终答案与精选积累 | 全部本地校验通过后自动保存 |
| `web-bridge` · Mac | 复制专用提示词，在自己登录的 ChatGPT 网页手动提交，再带回完整 JSON | 用户预览后导入；经过同一业务校验，不由后端额外调用复核模型 |

iiiapi 固定服务地址为 `https://api.iiiapi.com/v1`，使用 `GET /models` 和 `POST /chat/completions`。用户从真实列表选择并保存模型，处理以当前选择为准；新环境需配置自己的密钥与模型。模型数量和权限以实时返回为准。[iiiapi 文档](https://iiiapi.com/docs)

网页桥无需 API 密钥，仍为“复制 → 手动提交 → 粘贴 JSON”。Yasy 没有实现全自动操控 ChatGPT 消费者网页。批量文件现在另有 API 文字提取路径，和个人答案处理使用不同提示词与确认流程。

## 配置与密钥

| 本机接口 | 行为 |
| --- | --- |
| `GET /api/ai/config` | provider、服务地址、hasKey、model、configured，不返回 apiKey |
| `PATCH /api/ai/config` | 保存密钥/模型或切换 provider，返回脱敏状态 |
| `GET /api/ai/models` | 查询账号可用模型 ID |
| `POST /api/ai/test` | 仅查模型列表和连接状态，不生成答案 |

密钥保存在 `.local/api-secrets.json`，权限 600，原子替换写入。界面保存后清空密钥输入，只显示配置状态。密钥不进入 Git、state、提示词、手机快照或 JSON 学习备份，远端错误脱敏；换机后重新配置。客户端不能将生产服务地址改为任意主机。

API 答案处理一次发送本题、中文原料、选中素材与同区候选。API 文件导入发送本机读取的文字。网页方式由用户提交提示词或附件。本机存储不意味着 AI 离线，模型认可也不替代本地校验。

## 中文构思先预览

`POST /api/ideas` 接受 `{questionId,textZh}`，调用当前模型返回：

```json
{
  "questionId": "当前题目 ID",
  "draftZh": "待用户核对、采纳的中文构思",
  "origin": "generated",
  "notes": ["确认真实情况后再使用。"],
  "requiresConfirmation": true
}
```

空白输入为 `generated`：给可修改示例，明确未确认为用户经历，待确认细节有标记。已有中文为 `refined`：保留事实、立场和限定，组织理由和结构，不暗添亲历。Task 1 缺图时只能请求补图，不能构思数据。

中文助写是用户单独点击后的一次独立调用，不会自动触发英文整理；正式答案整理也不会自动调用中文助写。返回值绑定题目、输入 origin 和确认标记，密钥回显、其他题目 ID、截断或不合法内容会被拒绝。此调用**不自动写 Draft、Answer 或素材**；用户预览并采纳之后再编辑、保存草稿。构思与正式答案处理分开，也不进入后台答案任务状态。

## 一次调用与后台任务

1. `POST /api/jobs` 保存题目、中文、选材和版本快照，创建 `pending` 任务；iOS 使用 `client: "ios"` 固定 API provider。
2. `POST /api/jobs/{jobId}/generate` 发送 `{ "background": true }`。接受后返回 **202**，本地服务继续执行；同一处理中任务再次启动返回 **409**。
3. 模型只接收一次详细任务，直接输出完整英文答案、双语素材、精选语料、标注及关联推荐。没有第二次审核或自动修订调用，也不自动重试。
4. 后端检查身份绑定、词数、英文字段、原文引用、素材版本及语料准入合同后事务保存。App 从 `/api/state` 显示结果，用户可离开写别题、切换页面或刷新。

不带 `background: true` 时保留等待完成的兼容方式。202 仅表示接受任务，不表示完成；通知是工作台内状态提示。中文构思与旧语料批量复核各是用户主动触发的一次独立调用，不是每道答案的附加步骤。大型题目文件按实际文字分段提取，属于文件规模处理，不用于反复审核答案。

提示词在一次成稿中落实任务回应、内容展开、连贯、词汇和语法要求：粗略中文不应只被翻译，能合理组织和发展的问题由模型直接完善。先完成答案，再从最终正文提取内聚素材和真正可迁移的表达，允许零语料；不返回待审初稿、内部思维过程或成绩承诺。这是文本学习辅助，不能凭文字评估口语发音。

正常状态为 `pending → processing → completed`。真实内容不足进入 `needs-revision`，连接、超时、截断或格式/业务错误进入 `failed`；失败不保存半份答案或部分素材，只在用户点击后重试。每次运行有 runId，返回后重新检查任务归属、草稿、选材、活动题和素材版本，旧结果不能覆盖新内容。

Mac 服务需保持运行；关闭网页不停止任务，关闭服务会中断。生成默认超时180秒，模型列表20秒。重启或恢复备份将中断的 processing 标为失败，由用户确认重试。

## 三套成文提示词

`server/prompts.mjs` 导出 `buildPrompt`、`buildIdeaPrompt` 与文件提取 `buildBatchPrompt`。答案按照 scope 选择独立处理正文，默认 Academic、目标 Band 7.0。

| scope | 原料如何成为答案 |
| --- | --- |
| `speaking` | 从粗略真实想法组织自然可说的回答，按 Part 区分直接问答、长答、抽象讨论；提取双语素材和口语语料 |
| `writing-task1` | 从可读原图选特征、概括 overview、分组比较；完整客观报告，不创建素材、素材片段或推荐 |
| `writing-task2` | 从立场与论点回应具体题型，主动发展推理、支撑、限定和衔接；正式作文、独立双语论证素材和写作语料 |

中文是原料，**不逐句机械翻译**。未写成成稿不应自动失败；关键事实不足、题卡对象不符、立场无法判断或矛盾未澄清时请求补充。可以合理解释已有观点，用明确限定的一般性/假设性例子，但不能创造亲历、数字或研究依据。候选题只用于匹配，不提供用户事实。

口语练习建议为 P1 35–80、P2 170–260、P3 70–130 词，follow-up 20–50 词，均非官方词数门槛；纯文字不评发音。[官方口语格式](https://ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-speaking)

Academic Task 1 至少 150 词、Task 2 至少 250 词；建议分别 160–210、260–320 词，均为完整英文正文。[官方写作格式](https://ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-writing) · [完整产品方法](product-design.md#三套独立处理方法)

## 答案结果合同

所有 provider 共用 `{requestId,questionId,scope,quality,answer,materials,expressions,recommendations}`。以下仅为结构示意，不是达到练习长度的完整答案：

```json
{
  "requestId": "本地任务 ID 原样回传",
  "questionId": "本题 ID 原样回传",
  "scope": "speaking",
  "quality": { "passed": true, "suggestions": [] },
  "answer": {
    "textEn": "The experience helped me build confidence.",
    "outlineZh": "中文答题结构",
    "materialSpans": [{ "quote": "The experience helped me build confidence.", "materialIndex": 0 }]
  },
  "materials": [{
    "title": "Learning with friends",
    "summaryZh": "核心事实摘要",
    "summaryEn": "Fact-equivalent English summary",
    "detailZh": "独立完整的真实中文细节",
    "detailEn": "Complete, fact-equivalent English detail",
    "tags": ["learning"]
  }],
  "expressions": [{
    "textEn": "build confidence",
    "meaningZh": "建立信心",
    "category": "成长",
    "categoryEn": "Personal growth",
    "exampleEn": "Practice can help build confidence.",
    "usageNote": "描述练习带来的信心增长。",
    "usageNoteEn": "Use this collocation for confidence gained through practice.",
    "admission": {
      "approved": true,
      "reasonZh": "自然动词名词搭配，可迁移到学习与成长。",
      "reasonEn": "This natural verb-noun collocation describes confidence gained through practice across learning contexts.",
      "benefit": "collocation",
      "transferExampleEn": "Regular public speaking can help build confidence."
    },
    "tags": ["confidence"],
    "materialIndexes": [0]
  }],
  "recommendations": [{
    "materialIndex": 0,
    "questionId": "本次同区候选题 ID",
    "reason": "具体可复用内容及仍需补充的条件",
    "score": 0.8
  }]
}
```

Schema 中新素材与复用素材是两种完整对象，复用对象增加 `existingMaterialId`。新 ID 由本机创建，模型只可引用本次选中的已有 ID。英文标题和 tags、双语摘要/细节完整必填，不能把中文直接复制到 En 字段。

`materialIndex` / `materialIndexes` 是本次数组索引，导入后映射到稳定本地 ID。素材片段 quote 必须是最终答案唯一出现的精确连续原文；本地转换成 UTF-16 start/end（0 起点、end 不包含）。不让模型数字符，也不向答案插 HTML。

答案与语料正文、分类、用法和例句以英语显示，中文辅助字段保留；素材中英事实必须等值。Task 1 的 materials、recommendations、materialSpans 和表达 materialIndexes 为空。

## 素材更新与旧答案保护

同一核心可补入用户提供的新细节或改善组织方式，返回 `existingMaterialId` 更新原素材。ID 保持稳定，变化时 `version` 递增，旧内容存入 `material_revisions`；未变内容不增版本。新增独立核心才新建素材，不能为复用 ID 改写成另一段经历。

任务创建时保存 `materialVersions` 和 `selectedMaterialSnapshots`。导入检查其基准版本仍是当前版本；并发任务先更新后，晚结果返回 409，并回滚整笔保存，不覆盖事实。查询 `GET /api/materials/{materialId}/history` 得到当前素材与降序历史快照。

答案保留 `materialVersions` 与 `materialSnapshots`。素材后续更新不会改掉过去答案的事实依据；同题再整理更新唯一当前答案，旧答案留在 revisions。阅读详情优先使用答案快照，不能以最新素材替换旧答案的生成时内容。版本历史与答案快照进入 JSON 学习备份。

## 语料准入

每条新候选包含 `admission`：模型明确是否值得收录、双语理由、benefit 与迁移例句。benefit 仅为 `collocation`、`idiomatic`、`precision`、`structure`、`discourse`。

`server/corpus.mjs` 的 `assessExpression` 返回 `{status,reasonZh,reasonEn,policyVersion:2}`。模型明确拒绝则保留拒绝原因；本地检查连续原文、学习域与语域、用途、理由、类别和例句。普通孤立单词、基础泛用组合和不合适的写作俗语被拒；有价值的短搭配不因短而被挡。

仅本地最终 `approved` 候选进入 expressions 和关联；未在最终答案中原样出现的候选也直接不收录，不因此追加调用或丢弃完整答案。其余筛选结果记录于 `job.corpusReview`，不会为了凑数入库。允许 expressions 为空，答案仍保存。模型证据保留为 `admissionEvidence`；准入判断是学习辅助，局部检查不等于完整语义审查。[详细规则](corpus-admission.md)

### 历史语料批量复核

`POST /api/corpus/audit` 可传 `{ "ids": ["语料 ID"] }`，每批最多 **200 条**；省略 ids 时选择当前未 approved 的条目，超过上限须分批。后端调用模型逐条裁定，再用同一本地规则检查实际答案上下文。

响应包含 state、`counts: {approved,rejected,pending}` 和 reviewed。模型必须完整且唯一覆盖选中 ID；截断、未知/重复 ID、认证回显或复核期间记录变化，整批不保存。缺少实际上下文等证据时保持 pending，不假称已经完成可信核验。复核完成只更新判断、证据与时间，**保留所有原记录和拒绝原因**；rejected/pending 不参与正常推荐。相同主库只允许一批复核同时运行。

## 本地业务校验

- 任务绑定、题目、scope、runId 与输入快照一致，题目活动且素材版本未过期。
- AI 内容失败只保存反馈，不写答案或积累；通过时需完整英文正文。官方写作最低词数与产品练习范围另行校验。
- 已有素材 ID 来自本任务同区选材；新素材、语料不跨库。素材索引合法，题目推荐只指向本次同区候选。
- quote 唯一且真实出现，片段边界有效、互不冲突；表达也在答案中，最终符合语料准入。
- 每素材最多推荐三题、关联最优三条表达；其余合格表达可独立收录，弱关系不凑数量。
- Task 1 素材及相关引用全为空；生成不得使用不完整图像信息。
- 一任务只能成功导入一次，同题保持唯一当前答案；事务失败不保存部分数据。

请求在提示词中附 JSON Schema，第三方请求仍是普通 Chat Completions JSON 文本，**没有宣称 strict Structured Outputs 保证**。需本地处理空正文、拒绝、截断和业务错误。[OpenAI Structured Outputs 参考](https://developers.openai.com/api/docs/guides/structured-outputs)

## PDF / DOC / DOCX 题库批次

`POST /api/batches` 接受 `{filename,fileBase64,scope}`，scope 为 `mixed` 或三种学习域。单文件最大 10 MB，原件保存在 `.local/uploads/`，返回任务和专用提取提示词。文件内容、名称、页号只当来源数据，不能跟随其中的命令。

| 通道 | 提取到预览 |
| --- | --- |
| API | `POST /api/batches/{batchId}/generate`；本地读取文字、分段调用模型，校验后返回候选预览，成功为 200 |
| Mac 网页 | 手动附同一原文件与提示词，取得 JSON 后 `POST /api/batches/{batchId}/preview` |
| 用户确认 | 两者都用 `POST /api/batches/{batchId}/commit` 传 selectedKeys，才写题库 |

批次结果为 `{requestId,questions}`，最多 **1000 题**。每题有 scope、topicZh/topicEn、题面双语、part、taskType、cuePoints、tags、sourceNote、sourceType 与 visual；ID 由本机建立。reported 为资料转录，adapted 必须说明改写或翻译依据，不能未经核验标 official。

API 用 pdfjs 读取 PDF 文字层、mammoth 读取 DOCX，Mac DOC 使用系统 textutil。Word 不推测物理页码；PDF 尽量按真实物理页定位，不能定位则明确写出。提取限制为 PDF 最多 400 页、总文字 600000 字符、最多 100 段；超限需拆分，输出截断也不保存不完整预览，不静默丢题。

**当前 API 仅读取文字，不做 OCR 或题图识别。API 路径的 Task 1 visual 一律为 null**，标记待补原图/数据；不能声称看到附件图像或生成数值。网页路径也仅在确实读到图表时提供忠实数据；无法读清仍 null。扫描无文字、加密/无法解析文件会失败，混合 PDF 无文字页在预览列出警告，用户须对照原件。

预览只生成候选，不写题库；用户勾选确认后同事务入库，按完整题面和 cue points 去重。广告、范文、答案与解释不作题。过期任务、无效 scope、绑定错误或非法图表结构被拒。题季/日期只能记录附件明示标记，“当季真题”文件名不能代替核验。Task 1 补齐图表前不生成完整作文。

原件可由 `/api/batches/{batchId}/file` 在本机下载，正式两份 PDF 由 `/api/sources/{sourceId}/file` 下载。JSON 备份保留记录和题目，**不含原文件**；须单独备份 `.local/uploads/`、`.local/source-pdfs/`。

## 平台与扩展

正式活动题库为用户资料的 743 条（Task 1 为 0）。后续 API 自动导入的覆盖程度仍需用户预览核对，不能等同于正式 PDF 的本次逐页审计。[题库来源](question-sources.md)

Mac 两个 provider 保留，iOS 固定 API，不允许人工结果导入。`GET /api/v2/manifest` 声明 full-client 与共用读写路径，v1 只读合同继续保留；当前仍 loopback-only，认证、配对、实际跨设备连接与同步未上线。[手机合同](mobile-api.md)
