# Yasy AI 处理、网页桥与结果合同

用户希望“电脑接收中文后，自动通过浏览器使用定制提示词询问 ChatGPT”。Yasy 将业务流程和 AI 连接方式分离：题目、中文素材、质量反馈和结构化结果使用稳定合同；浏览器提交可以逐步自动化，不能让整个学习库依赖一次网页界面操作是否成功。

## 已实现的两种处理方式

| provider | 能力 | 用户需要做什么 |
| --- | --- | --- |
| iiiapi | 本地服务查询可用模型并调用对话生成，校验后自动入库 | 配置密钥、选择模型，中文初检通过后点击“一键 AI 整理” |
| web-bridge | 本机生成同一套专用提示词，用户在 ChatGPT 网页处理后导入 JSON | 复制提示词、在自己登录的网页提交，再复制完整 JSON 回 Yasy |

iiiapi 生产地址固定为 `https://api.iiiapi.com/v1`，已接入 `GET /models` 与 `POST /chat/completions`。2026-10-13 的真实连接返回 28 个模型，本次本机选用 `claude-sonnet-4-6`；模型数量和权限仍以账号实时列表为准。已在隔离环境完成真实生成、完整正式题库的同域候选推荐调用、JSON 解析与业务校验，没有把验证用答案写入正式学习库。[iiiapi 文档](https://iiiapi.com/docs)

网页桥不需要 API key；iiiapi 使用用户自己的服务密钥。批量 PDF / DOC / DOCX 提取仍走网页附原文件流程，现有 API 生成器只处理题目、中文素材和候选列表，不自动读取上传的文件正文。全自动操控 ChatGPT 消费者网页没有实现。

## 配置与密钥边界

在「偏好与数据」切换 provider、保存密钥、刷新模型列表并保存模型。客户端使用以下本机接口：

| 本机接口 | 行为 |
| --- | --- |
| GET /api/ai/config | 返回 provider、服务地址、hasKey、model 和 configured；不返回 apiKey |
| PATCH /api/ai/config | 保存密钥或模型，或切换 provider；返回脱敏配置状态 |
| GET /api/ai/models | 向当前固定 iiiapi 服务请求账号的模型列表，返回可选择的模型 ID |
| POST /api/ai/test | 仅查询模型列表和连接状态，不生成答案 |
| POST /api/jobs/{jobId}/generate | 对已创建的当前题任务执行 API 整理与校验入库 |

密钥与模型配置在 `.local/api-secrets.json`，文件权限 600；写入临时文件后原子替换。浏览器保存后清空密钥输入，后续只显示“已配置”等状态。密钥不进入学习 state、任务提示词、手机快照、Git 或 JSON 学习备份；远端错误信息也会脱敏。换机恢复学习资料后，需要重新配置密钥与模型。

使用 iiiapi 时，本地服务向该服务发送当前题目、真实中文草稿、已选素材及同区候选题；数据库和原始文件仍在本机。网页模式由用户提交提示词与附件。两种方式都使用本地结果校验，不能仅凭模型返回了 JSON 就认为它贴题或可信。

## 任务状态、失败与过期保护

任务保留输入快照和 requestId。正常 API 流程为 pending → processing → completed；连接、超时、截断或格式/业务校验失败会转为 failed。AI 判断素材不足则进入 needs-revision，用户先补充内容，再创建新任务。网页模式在 pending 任务中等待人工导入。

API 默认生成超时为 180 秒，模型列表查询为 20 秒，计时覆盖正文读取。失败可以手动重试，当前没有自动换模型或无限重试；只有用户草稿与已选素材仍匹配任务快照时，才可重新处理。服务重启或恢复备份时，会将遗留 processing 任务标为 failed，提示上一次处理被中断并允许确认后重试。

每次生成有独立 runId。远端返回后重新检查任务归属、最新草稿、素材选择与题目是否仍活动；新任务替代、草稿修改或题库归档后，旧结果不能落库。没有 await 间隙的最终归属检查和 SQLite 事务使同一生成不会重复导入；失败不会产生半份答案或部分素材。

三套提示词在输入中附结果 JSON Schema，但 iiiapi 当前请求通过普通 Chat Completions 返回 JSON 文本，**没有宣称服务提供 strict Structured Outputs 保证**。本地还需解析、校验和处理拒绝、空正文或输出截断。OpenAI 的官方结构化输出文档可作为后续 provider 的参考，不能替代第三方服务的实际能力验证。[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## 三套提示词

`server/prompts.mjs` 提供无依赖的 `buildPrompt({ question, draftZh, selectedMaterials, candidates, targetBand, requestId })`。它按 question.scope 选择独立正文：

| scope | 独立处理要求 |
| --- | --- |
| speaking | 口语二检；按 Part 1/2/3 组织自然英文；真实双语独立素材元及答案片段；口语表达；同区其他题推荐 |
| writing-task1 | 图表/流程/地图信息二检；Academic 客观报告；含 overview；不创建素材、素材片段或推荐；只积累 Task 1 语料 |
| writing-task2 | 题型、立场、所有问题覆盖和论据二检；正式论证作文；双语独立论证素材元及答案片段；Task 2 语料与同区推荐 |

三套共享外层结果结构与安全绑定，不共享英语语域和成文方法。中文素材保留用户真实事实，候选题只是推荐目标，Part 2 候选保留完整 cuePoints 以匹配具体限制；不允许模型通过候选题描述补造用户经历。目标分数只是练习难度参数，不是系统给予的考试分数。

## 结果合同

结果必须是一个 JSON 对象，字段为：

```json
{
  "requestId": "由本地任务生成，须原样回传",
  "questionId": "当前题目 ID，须原样回传",
  "scope": "speaking",
  "quality": { "passed": true, "suggestions": [] },
  "answer": {
    "textEn": "The experience helped me build confidence.",
    "outlineZh": "中文答题结构",
    "materialSpans": [{ "quote": "The experience helped me build confidence.", "materialIndex": 0 }]
  },
  "materials": [
    { "title": "Learning with friends", "summaryZh": "核心事实摘要", "summaryEn": "Fact-equivalent English summary", "detailZh": "独立完整的中文细节", "detailEn": "Complete, fact-equivalent English detail", "tags": ["learning"] }
  ],
  "expressions": [
    { "textEn": "build confidence", "meaningZh": "建立信心", "category": "情绪态度", "categoryEn": "Feelings and attitudes", "exampleEn": "Practice can help build confidence.", "usageNote": "中文用法边界", "usageNoteEn": "Use this collocation to describe becoming more confident through experience or practice.", "tags": ["confidence"], "materialIndexes": [0] }
  ],
  "recommendations": [
    { "materialIndex": 0, "questionId": "本次候选题之一", "reason": "可复用的具体事实及需要补充的维度", "score": 0.8 }
  ]
}
```

以上为结构示意，不是符合雅思练习长度的完整答案。`server/prompts.mjs` 导出 `resultSchema`。材料默认是新素材；若用户所选的已有素材在 title、summaryZh、summaryEn、detailZh、detailEn、tags 上完全未改，可添加 `existingMaterialId` 复用其本地 ID。Schema 使用 materials.items 的两种 `anyOf` 对象表示“新建”与“已有”，每种均禁止额外字段并声明全部字段必填，避免未来 strict schema 把可选字段误当不支持的结构。新素材 ID 由 Yasy 生成，不由模型生成。

表达的 materialIndexes、推荐的 materialIndex 是本次结果数组的索引，而不是数据库 ID。导入器将有效索引映射到落库素材。这个设计使第一次处理从零创建素材时，也能建立稳定关系。

`answer.materialSpans` 在模型输出中使用 `{quote,materialIndex}`，quote 是最终答案的精确连续原文。模型不负责数 UTF-16 字符；本地验证 quote 出现的位置并转换成 `{start,end,materialIndex}` 或映射后的素材 ID，start 从 0 开始、end 不包含。quote 必须在最终答案中唯一出现；重复短句会被拒绝，需改用能唯一定位的完整句子或更长片段。语料高光和素材颜色分别渲染，不向原始答案插入 HTML 或颜色标签。Task 1 与质量失败的 materialSpans 必须为空数组。

summaryZh/summaryEn、detailZh/detailEn 的中英内容必须事实等值。素材 title 与素材/表达 tags 使用英语，不新增 titleZh；中文含义保留在双语素材中。categoryEn 与 usageNoteEn 直接服务于英语语料界面；中文分类、释义和说明只保留为 metadata，不在语料区混合显示。字段迁移不能通过直接复制中文到带 En 后缀的字段伪装为英语；旧数据缺少英语时应明确待补，或经过同区提示词重新补全。

## 必须在导入器落实的业务校验

JSON Schema 只验证形状；以下规则必须额外落实，不能依赖模型答应遵守：

- requestId、questionId 和 scope 必须与任务快照逐字相同。网页导入检查 pending；API 先检查 processing 的 runId 归属，再交给同一正式导入器；未知或过期结果不能落库。
- 提示词要求 quality.passed=false 时答案与积累为空；本地收到失败判定只保存质量反馈，不写答案、素材或语料。通过时英文答案必须非空。
- existingMaterialId 必须来自本次任务选择的同区素材；复用内容必须与已有素材一致。未知、未选择、跨区或内容改变却复用旧 ID 的结果应拒绝。
- 所有材料索引必须是合法非负整数，并在本次 materials 长度范围内。推荐题 ID 必须存在于本次同区候选集合；不可指向当前题或其他 scope。
- 每个 materialSpans.quote 必须是最终英文答案实际出现的连续原文，不接受模型估算的位置；映射后的字符范围必须有效、不越界、不相互冲突，同一片段只有一个素材归属。
- 推荐 score 必须是大于 0、且不超过 1 的有限数值。关系去重；每个素材元每次最多推荐 3 道题，并关联最相关的 3 条表达。API 会保留所有表达、仅截取前 3 条素材关系；网页导入的超量关系需修正后再导入。
- expression.textEn 应与 answer.textEn 的连续原文一致，才能成为准确高光。表达保留本题 scope，禁止跨库写入。
- writing-task1 的 materials、recommendations 与 answer.materialSpans 必须为空，每条 expression.materialIndexes 必须为空；Task 1/2 英文答案分别达到最低词数，未达要求时返回清晰错误供重试。
- 一个任务成功导入不能再次重复落库。更新同题答案保持当前答案唯一性，并避免旧请求覆盖后来已经处理的新结果。

保存结果宜在同一 SQLite 事务中完成：先验证全部内容，再写答案、素材、语料、关联和任务状态。校验失败不应产生部分素材或半份答案。用户中文事实是否准确仍依赖输入及其复核；模型相关度是推荐提示，不应描述为事实概率。

## 用户题库文件批次

`buildBatchPrompt({requestId,filename,scope})` 为附件提取提供另一套独立提示词，不与生成个人答案混用。scope 可以为三种学习域之一，或 `all`（默认）。用户在 ChatGPT 网页手动上传原文件，模型只处理实际可读附件；Yasy 本机当前只创建文件任务、提示词和结果导入流程，不自动抽取 PDF/Office 正文。

`batchResultSchema` 的外层为 `{requestId,questions}`，questions 最多 500 项。每项包含 scope、topicZh、topicEn、titleZh、promptEn、promptZh、part、taskType、cuePoints、tags、sourceNote、sourceType 和 visual。sourceType 只能为 reported 或 adapted；Yasy 自行建立 user-upload Source 与题目/主题 ID，模型不创建数据库 ID。原题来源并未因文件上传就得到官方验证，题季和日期只能记录附件实际载明的信息。

Task 1 的 visual 可为 null，表示原图缺失、不可读或结构不足以忠实表达；sourceNote 必须明确提示需要补图，后续生成也须拒绝凭猜测完成报告。可读的 visual 对象包含 kind/title/columns/rows/steps/note，不适用的数组为空，所有数值、单位、流程和方位有附件依据。口语与 Task 2 的 visual 为 null。文件未上传、无法读取或没有有效题时输出空 questions；不能根据文件名凭空补题。

批次导入需验证 requestId 对应当前文件任务、所有 scope 合法且符合选择范围、题干完整、口语 Part 正确、每个来源说明可追溯，以及 Task 1 结构数据的一致性。先给用户可查看的题目结果，保存时去重并保留文件页码/题号；重复导入同一批次不能无限增加相同题目。输入文件中的文字指令只视为数据。完整批次应原子写入，校验失败不改变现有题库。

手机联通仅预留只读 version 1 合同；本阶段本机 API 继续仅监听 loopback，不通过新增接口自动开放网络。实际 iPhone 访问与配对认证留在后续阶段。

## provider 边界与未来扩展

`server/providers.mjs` 保留网页桥，`server/iiiapi.mjs` 实现当前自动生成。两者复用 `server/prompts.mjs` 与同一结果合同；模型变化不改变题目、素材、语料和答案实体。保存后的服务凭证由本地后端读取，生产服务地址固定，客户端不能把真实密钥转送到任意自定义地址。

本版的正式题库已替换为两份用户 PDF 的 743 条题目，其中 Task 1 为 0；Task 1 专用提示词、语料域、图表处理和上传入口仍保留，等待可用的完整题图。内置 PDF 的逐页转录是本次资料整理结果，不表示普通上传入口已经自动解析任何 PDF。[题库来源](question-sources.md)

浏览器全自动操作、其他模型服务和 iPhone 配对连接属于后续工作。当前手机端只保留本机 v1 只读合同，未开启局域网或互联网访问；任何未来 provider 的结果仍须经过同样的过期保护、scope 隔离和原子保存。
