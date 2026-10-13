# Yasy AI 网页桥与 provider 接口

用户希望“电脑接收中文后，自动通过浏览器使用定制提示词询问 ChatGPT”。Yasy 将业务流程和 AI 连接方式分离：题目、中文素材、质量反馈和结构化结果使用稳定合同；浏览器提交可以逐步自动化，不能让整个学习库依赖一次网页界面操作是否成功。

## 当前落地方式

首版 `web-bridge` 是可用的半自动桥：本地初检通过后生成专用提示词，用户复制并打开 [ChatGPT 网页](https://chatgpt.com/)，在自己已登录的浏览器中提交；生成完成后，将 JSON 复制回 Yasy 的导入框。Yasy 校验后自动保存答案、素材、语料和题目关联。系统不会宣称已自动读取网页回复，不收集浏览器 cookie、session token 或用户密码，也不需要 API key。

网页提示词是普通聊天输入中的格式要求，不能保证模型每次都返回有效 JSON；因此导入器必须处理格式错误、拒绝、不完整输出以及任务绑定错误。可以明确展示错误并让用户从网页复制完整 JSON 重试，不能自动“补齐”模型漏掉的用户事实。

## 已查证的能力与未验证的边界

官方 OpenAI documentation 提供 API 的结构化输出能力，可将 JSON Schema 作为 Responses API 的 `text.format`；模型拒绝或输出截断仍须单独处理。其 strict 模式要求声明的字段均为必填、对象不允许额外属性，并只支持 JSON Schema 的子集。[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

官方还说明了通过 API 让模型控制界面的 computer use 流程，由应用执行界面操作并返回截图等结果。该能力是通用界面控制，不足以证明 ChatGPT 消费者网页具有对 Yasy 开放、稳定且可无人值守调用的专用接口。[Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use)

因此本项目的判断是：有依据支持未来接正式 API；“全自动操作用户的 ChatGPT 网页并可靠收回答案”尚未在本项目的用户浏览器、登录状态和真实页面中验证。不能把后者包装成已实现功能，也不能将未公开网页接口或抓取登录凭证作为依赖。后续若验证浏览器自动化，应使用用户可见的操作、检查提交和回复状态、允许手动接管，并继续经过同一导入校验。以上依据在 2026-10-13 查阅。

## 三套提示词

`server/prompts.mjs` 提供无依赖的 `buildPrompt({ question, draftZh, selectedMaterials, candidates, targetBand, requestId })`。它按 question.scope 选择独立正文：

| scope | 独立处理要求 |
| --- | --- |
| speaking | 口语二检；按 Part 1/2/3 组织自然英文；真实双语独立素材元及答案片段；口语表达；同区其他题推荐 |
| writing-task1 | 图表/流程/地图信息二检；Academic 客观报告；含 overview；不创建素材、素材片段或推荐；只积累 Task 1 语料 |
| writing-task2 | 题型、立场、所有问题覆盖和论据二检；正式论证作文；双语独立论证素材元及答案片段；Task 2 语料与同区推荐 |

三套共享外层结果结构与安全绑定，不共享英语语域和成文方法。中文素材保留用户真实事实，候选题只是推荐目标；不允许模型通过候选题描述补造用户经历。目标分数只是练习难度参数，不是系统给予的考试分数。

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

`answer.materialSpans` 在模型输出中使用 `{quote,materialIndex}`，quote 是最终答案的精确连续原文。模型不负责数 UTF-16 字符；本地验证 quote 出现的位置并转换成 `{start,end,materialIndex}` 或映射后的素材 ID，start 从 0 开始、end 不包含。若 quote 重复出现，本地要处理每个实际出现位置并检查素材归属和冲突；提示词要求优先使用可唯一定位的完整句子。语料高光和素材颜色分别渲染，不向原始答案插入 HTML 或颜色标签。Task 1 与质量失败的 materialSpans 必须为空数组。

summaryZh/summaryEn、detailZh/detailEn 的中英内容必须事实等值。素材 title 与素材/表达 tags 使用英语，不新增 titleZh；中文含义保留在双语素材中。categoryEn 与 usageNoteEn 直接服务于英语语料界面；中文分类、释义和说明只保留为 metadata，不在语料区混合显示。字段迁移不能通过直接复制中文到带 En 后缀的字段伪装为英语；旧数据缺少英语时应明确待补，或经过同区提示词重新补全。

## 必须在导入器落实的业务校验

JSON Schema 只验证形状；以下规则必须额外落实，不能依赖模型答应遵守：

- requestId 必须属于本次 pending 任务；questionId 和 scope 必须与该任务逐字相同，未知或不匹配的结果不能落库。
- quality.passed=false 时，answer 的 textEn/outlineZh 必须为空字符串、materialSpans 必须为空数组，其余三个数组必须为空，并保留具体补充建议。通过时英文答案必须非空。
- existingMaterialId 必须来自本次任务选择的同区素材；复用内容必须与已有素材一致。未知、未选择、跨区或内容改变却复用旧 ID 的结果应拒绝。
- 所有材料索引必须是合法非负整数，并在本次 materials 长度范围内。推荐题 ID 必须存在于本次同区候选集合；不可指向当前题或其他 scope。
- 每个 materialSpans.quote 必须是最终英文答案实际出现的连续原文，不接受模型估算的位置；映射后的字符范围必须有效、不越界、不相互冲突，同一片段只有一个素材归属。
- score 必须是 0—1 的有限数值。关系须去重；每次展示/链接只保留前 3 个真正相关的对象。
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

## provider 扩展方向

当前 provider 为 `web-bridge`，通过提示词生成和人工导入完成。未来 `openai-api` 或经过验证的 `browser-automation` 只负责传递输入与取得结果，随后仍走同一绑定、校验和落库流程。provider 应返回 pending、completed、needs-revision 或连接错误等明确状态，保留中文草稿并支持重试；切换 provider 不迁移或重建学习实体。

正式 API 接入可以使用现有 Schema 和 Responses structured outputs，另行验证所选模型的实际支持、处理拒绝/截断以及配置服务器端凭证。若所选模型不支持某个 Schema 约束，provider 可去掉该约束并在本地继续验证，不能因此放松业务规则。本阶段只有接口与结果合同预留，不配置凭证、不发送真实素材到 API，也不声称已实现该 provider。
