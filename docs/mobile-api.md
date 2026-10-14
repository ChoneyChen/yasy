# iPhone 完整客户端合同 · v2

iPhone 的未来定位是与 Mac 同功能的学习客户端：写中文原料、调用 API 整理、查看与复用素材、复核语料、导入题库、收藏单词和背书。Mac 仍保存主数据库并运行后端。手机只使用 API 处理方式；Mac 另保留 ChatGPT 手动网页桥。

当前已提供响应式界面、平台处理策略和本机 API 合同，**跨设备认证、配对、实际连接与同步尚未上线**。服务只监听 `127.0.0.1`；Mac 的 loopback 地址不能直接供 iPhone 访问。

## 能力声明与 v1 兼容

| 接口 | 合同 |
| --- | --- |
| `GET /api/v2/manifest` | `schemaVersion: 2`、`deviceRole: full-client`、`readOnly: false`；声明共用 `/api` 路径、Mac/iOS provider 策略，当前 `connectivity: loopback-only`、`pairing: reserved` |
| `GET /api/v1/manifest` | 保留旧 `full-reader`、`readOnly: true` 声明，供原有阅读客户端继续使用 |
| `GET /api/v1/snapshot` | 全量学习 state、历史答案、背书状态与事件、批量导入任务 |
| `GET /api/v1/content/{questionId}` | 一题的题面、当前答案、草稿、素材、语料及相关推荐 |

v1 的只读声明仍有效：这些路径不接受写入。v2 manifest 列出完整客户端使用的现有 `/api` 读写接口，没有另外复制一套 `/api/v2` 写入实现。新客户端可以继续使用 v1 snapshot/content 获取数据，再通过共用接口操作。

当前活动题库为 743 条、132 个主题、2 个用户 PDF 来源，Task 1 暂为空。快照另保留归档题和历史积累；数量与来源边界见 [题库来源](question-sources.md)。

## 共用的学习接口

| 工作 | 路径与方法 | 约束 |
| --- | --- | --- |
| 保存草稿 | `PUT /api/drafts/{questionId}` | 中文内容和所选素材保存至同一主库 |
| 检查原料 | `POST /api/quality` | 本地输入辅助，不是雅思评分 |
| 中文构思 | `POST /api/ideas` | 绑定题目与已有中文，返回待确认预览，不自动写草稿 |
| 创建整理任务 | `POST /api/jobs` | iOS 发送 `client: "ios"`，后端固定选用 iiiapi |
| API 后台整理 | `POST /api/jobs/{jobId}/generate` | `{ "background": true }` 接受后返回 202；从 state 获取后续状态 |
| 素材历史 | `GET /api/materials/{materialId}/history` | 当前版本与历史快照；答案另保留生成时的素材快照 |
| 历史语料复核 | `POST /api/corpus/audit` | AI 裁定与本地准入检查；保留拒绝原因和原记录 |
| 复习队列 | `GET /api/reviews/next?kind=…` | 口语、写作、单词按到期时间排序 |
| 记录背书 | `POST /api/reviews` | 持久化次数与下次复习时间 |
| 单词收藏 | `POST /api/words`、`DELETE /api/words/{wordId}` | 保留来源，支持跨区统一复习 |
| 批量文件提取 | `POST /api/batches`、`POST /api/batches/{batchId}/generate` | 上传原文件，API 读取文字后组织候选预览 |
| 确认题库入库 | `POST /api/batches/{batchId}/commit` | 用户勾选的 `selectedKeys`；预览不会直接入库 |
| 学习偏好与计划 | `PATCH /api/settings`、`PUT /api/plan` | 同一目标分数、每日题量与计划 |
| 学习备份 | `GET /api/backup`、`POST /api/backup` | 恢复替换数据，沿用界面确认及校验流程 |

任务随 `/api/state` 或 v1 snapshot 提供；App 层关注后台任务，切换题目后仍提示完成、失败或需补充。202 只表示接受任务，不表示已生成或入库。后台由 Mac 服务执行，关闭网页不停止任务；关闭服务或重启后不承诺自动续跑。

Mac 的 `web-bridge` provider 和人工粘贴结果接口继续保留。iOS 任务固定走 API，人工 `/api/jobs/{jobId}/result` 导入被拒绝；手机 UI 不展示复制提示词、打开 ChatGPT 或粘贴回答的流程。密钥不进入学习 state、快照或备份，保存后的配置只返回脱敏状态。

## 内容、版本与标注

- `scope` 为 `speaking`、`writing-task1` 或 `writing-task2`。单词可统一浏览，素材与语料严格分库。
- `Answer.textEn` 是一份完整英文答案。中文保留为输入、结构说明与素材对照；Task 1 不创建素材元。
- 同核心素材使用稳定 ID 与递增 `version`。任务捕获所选素材版本；另一任务先更新后，旧结果会遇到版本冲突，客户端须重新取最新素材处理。
- `Answer.materialVersions` 记录采用的版本，`Answer.materialSnapshots` 保留当时的素材内容。阅读旧答案优先使用答案快照，不能把今天补充的事实自动放入过去的答案。旧 v1 content 的顶层 materials 仍是当前素材对象，客户端应注意这一区别。
- `Answer.materialSpans` 的 `start` / `end` 为 **UTF-16 字符索引，0 起点、end 不包含在片段中**，`materialId` 是稳定素材 ID。缓存时同时保留答案、快照与标注，渲染前检查边界和引用。
- 按答案素材顺序使用黄、蓝、绿底色，超过三项循环颜色并保留各 ID。语料使用红色波浪线，重叠处优先打开语料；题目页与背书共用渲染。
- 素材保留 `summaryZh/summaryEn`、`detailZh/detailEn` 的事实等值二元组。答案、语料分类、用法与例句用英语；旧记录缺英文时显示待补。
- 仅 `approved` 语料进入正常收录和推荐。历史 `pending`、`rejected` 记录仍可查看状态与原因；答案可以没有合格语料。
- 单击素材或语料打开详情，长按英文单词的收藏入口用于触屏适配。桌面窄屏交互不是原生 iPhone 接入已完成的证据。

归档题可读已有答案、草稿与历史，但不能创建新整理任务。手机和 Mac 遵守同一规则。

## 原文件与连接阶段

| 原文件接口 | 存储 |
| --- | --- |
| `GET /api/sources/{sourceId}/file` | 正式来源 PDF，位于 `.local/source-pdfs/` |
| `GET /api/batches/{batchId}/file` | 后续 PDF / DOC / DOCX，位于 `.local/uploads/` |

文件内容不包含在 snapshot 或 JSON 学习备份中。当前 Mac 未保存原件时下载返回 404，题库和译文仍可查看。未来手机下载需要受认证的通道，快照里的来源链接并未携带原件。

接入阶段需完成配对、每个读写请求鉴权、令牌撤销、传输保护、Mac 休眠与断线提示、缓存刷新及冲突交互。版本号和 `updatedAt` 提供内容判断基础，当前没有宣称具备离线多端自动合并。连接层就绪后将开放同一功能合同，由后端继续检查任务绑定、素材版本、语料准入和原子保存。
