# iPhone 独立学习与可选同步合同

iPhone 是独立的完整学习客户端：App 内置工作台和题库，在本机保存中文草稿、答案、素材、语料、单词与复习记录；用本机 Keychain 中的 API 配置直接请求模型服务。**普通使用不要求 Mac 在线、不要求配对**。Mac 仍有自己的 SQLite 学习库和 API 配置，并保留 ChatGPT 手动网页桥；两端通过相同业务规则与备份格式保持兼容，而非实时共用一份数据库。

安装与签名步骤见 [iOS 开发](ios-setup.md)。阅读、书写、收藏和复习可离线进行；AI 请求需要互联网。配对只提供可选的局域网 HTTPS 手动覆盖同步，不自动合并或后台同步。

## 手机本地运行层

App 从 `yasy-local://app/?client=ios&local=1` 加载内置网页资源。前端的同源 `/api/` 请求交给手机本地路由；使用 SQLite 运行层复用 Mac 的 Store 规则，包括外键、分库、唯一当前答案、素材版本与备份校验。完整学习快照按 `yasy-backup` v1 格式，原子写入手机 `Application Support/Yasy/`。这不是从 Mac 下载页面后才能使用的离线缓存。

原生桥限于受信任的本地主文档。网络、文件与 Keychain 由原生层处理，学习业务通过本地路由校验和持久化；外部链接不获得桥接权限、API 密钥或 Mac 配对凭据。

| 原生动作 | 用途 |
| --- | --- |
| `storage.read`、`storage.write` | 读取或原子保存完整学习备份；写失败保留原有快照 |
| `storage.restore`、`storage.previous` | 覆盖前保留旧进度、读取恢复前快照 |
| `ai.config.get`、`ai.config.update` | 查询脱敏配置，保存本机 Keychain 密钥与模型 |
| `ai.models`、`ai.completions` | 本机原生 HTTPS 请求 iiiapi；密钥不返回学习 state |
| `file.put`、`file.get`、`file.extract` | 本机保存、读取原件和提取支持的文字层 |
| `sync.status`、`sync.pull`、`sync.push` | 查询配对状态、读取 Mac 备份或明确确认后覆盖 Mac |

网页通过带请求 ID 的 Promise 调用，原生以 `window.__yasyNativeReply(id, {result})` 或 `{error:{message,status}}` 返回。重连或桥接超时不自动重发内容生成请求。

手机的 API 密钥与模型保存于独立 Keychain 条目，配对凭据另存；Mac 配置不下发到手机。密钥不进入题库、学习 state、JSON 备份或覆盖同步。手机仅使用 API，不显示复制提示词、打开 ChatGPT 或粘贴网页答案的流程。

## 共用的学习接口

路径和主要结果沿用 Mac 业务合同。在手机本地模式，以下接口由本机处理，并非请求 Mac：

| 工作 | 路径与方法 | 约束 |
| --- | --- | --- |
| 读取学习库 | `GET /api/state` | 手机本地活动题、归档题与学习内容 |
| 刷题推送 | `GET /api/practice/next?kind=…&mode=…&currentId=…` | 首次和换题顺序、完成后随机，跳过已积累与处理中题 |
| 保存草稿 | `PUT /api/drafts/{questionId}` | 本机保存中文内容和所选素材 |
| 检查原料 | `POST /api/quality` | 本地输入辅助，不是雅思评分 |
| 中文构思 | `POST /api/ideas` | 返回待确认中文预览，不自动替换草稿 |
| 创建整理任务 | `POST /api/jobs` | 手机固定 `provider: iiiapi`、`client: ios`，捕获草稿与素材版本 |
| API 后台整理 | `POST /api/jobs/{jobId}/generate` | `{background:true}` 返回202；从本机 state 获取完成、失败或需补充状态 |
| 相关推荐 | `GET /api/questions/{questionId}/recommendations` | 同学习域素材与已批准语料，各取相关前3项 |
| 素材历史 | `GET /api/materials/{materialId}/history` | 当前版本与历史快照；答案另保留采用时的快照 |
| 历史语料复核 | `POST /api/corpus/audit` | AI 裁定与本地准入检查；保留拒绝原因和原记录 |
| 复习队列 | `GET /api/reviews/next?kind=…` | 口语、写作、单词按到期时间排序 |
| 记录背书 | `POST /api/reviews` | 本机持久化次数与下次复习时间 |
| 单词收藏 | `POST /api/words`、`DELETE /api/words/{wordId}` | 保留来源，支持跨区统一复习 |
| 批量文件提取 | `POST /api/batches`、`POST /api/batches/{batchId}/generate` | 本机保存原件、读取文字、调用本端 API，生成预览 |
| 确认题库入库 | `POST /api/batches/{batchId}/commit` | 用户勾选 `selectedKeys` 后入库；预览本身不写题库 |
| 学习偏好 | `PATCH /api/settings` | 目标分数与 Academic；旧 plan 接口仅兼容，不在界面提供计划 |
| API 设置 | `GET/PATCH /api/ai/config`、`GET /api/ai/models`、`POST /api/ai/test` | 手机本机配置；检查连接只查询模型，不调用生成 |
| 学习备份 | `GET /api/backup`、`GET /api/backup/previous`、`POST /api/backup` | 完整 JSON；恢复替换当前资料，接收端保留旧快照 |

202 只表示接受任务，不代表已完成或入库。App 内切题与切标签可继续生成；iOS 锁屏、挂起或终止 App 后不保证持续运行。重新打开后，遗留处理中任务改为失败，供用户手动重试，不自动续跑。Mac 后台任务依赖 Mac 服务进程；两端没有互相代跑任务。

当前内置活动题库为743条、132个主题、2个用户 PDF 来源，Task 1 暂为空。后续导入或恢复的题库由本端保存；数量与来源边界见 [题库来源](question-sources.md)。

## 内容、版本与标注

- `scope` 为 `speaking`、`writing-task1` 或 `writing-task2`。单词可统一浏览，素材与语料严格分库。
- `Answer.textEn` 是完整英文答案。中文保留为输入、结构说明与素材对照；Task 1 不创建素材元。
- 同核心素材使用稳定 ID 和递增 `version`。任务捕获所选素材版本；其他任务先更新后，旧结果遇到版本冲突，须取最新素材再处理。
- `Answer.materialVersions` 记录所用版本，`Answer.materialSnapshots` 保存当时内容。旧答案优先读自身快照，不把后来补充的事实自动放入过去的答案。
- `Answer.materialSpans.start/end` 为 **UTF-16 字符索引，0起点、end不包含在片段中**；`materialId` 是稳定素材 ID。备份保留答案、快照和标注，渲染时校验边界与引用。
- 按答案素材顺序使用黄、蓝、绿底色；语料用红色波浪线。重叠处优先打开语料，题目页与背书使用同一渲染。
- 素材保留事实等值的 `summaryZh/summaryEn`、`detailZh/detailEn`。答案、语料分类、用法与例句为英语；旧记录缺英文时显示待补。
- 仅 `approved` 语料进入正常收录与推荐；`pending/rejected` 保留原记录和原因。答案可以没有合格语料。
- 归档题保留已有答案、草稿与历史阅读，不能创建新整理任务。两端遵守同一规则。

单击素材或语料打开详情，长按英文词语收藏。设备验证、编译和自动化测试应分别记录，不仅凭桌面窄屏声称真机通过。

## 可选手动覆盖同步

配对成功只授权访问，不改任一端进度。用户在原生「可选进度同步」对照两端摘要后选择方向，再明确确认：

| 用户选择 | 行为 |
| --- | --- |
| **用此 iPhone 进度覆盖 Mac** | 手机导出当前完整学习备份，经配对 HTTPS 提交 Mac `POST /api/backup`；Mac 保存恢复前快照后替换本端资料 |
| **用 Mac 进度覆盖此 iPhone** | 原生读取 Mac `GET /api/backup`；手机校验备份、保存恢复前快照，再替换本机资料 |

本地协调入口为 `POST /api/sync`，body 为 `{direction:'push'|'pull',confirmed:true}`；它只执行用户明确选择的方向，不是周期同步。同步包含全部题库、草稿、答案、素材及版本、语料、单词、任务与复习记录，不按新旧时间戳自动合并。处理任务进行中应先等待结束，再进行恢复或覆盖。

覆盖前快照可从**接收端**「偏好与数据」下载，用于恢复。两端 API 密钥和原始 PDF/DOC/DOCX 不包含在学习备份中，不随覆盖传输；同步后来源链接存在不等于接收端保存着原件。解除或撤销配对只影响后续同步，不删除学习库或手机 API 配置。

## Mac 的 HTTPS 配对通道

默认 Mac 仅监听 `127.0.0.1:4318`；用户在「偏好与数据 → 连接 iPhone」启用同步连接后另开 HTTPS 4319，仅接受本地/私有 IPv4 网络。**只有读取 Mac 进度与覆盖同步需要 Mac 在线**；Mac 关机、休眠或局域网中断不会阻止手机本地学习。

配对码5分钟有效、一次性使用，5次错误后需在 Mac 刷新。设备 token 存在 iPhone Keychain，Mac 仅保存其 SHA-256；有效期30天，可在 Mac 撤销。原生 HTTPS 客户端检查证书 SHA-256 指纹、主机名与有效期，外部链接不携配对凭据；IP 或证书变化需重新配对。

| 接口 | 访问范围 |
| --- | --- |
| `GET /api/mobile/status` | 仅 Mac 本机，连接状态、配对链接与设备 |
| `POST /api/mobile/start`、`stop`、`pairing-code` | 仅 Mac 本机，启停同步连接或更新配对码 |
| `DELETE /api/mobile/devices/{id}` | 仅 Mac 本机，撤销设备 |
| `POST /api/mobile/pair` | HTTPS 通道，凭一次性配对码获取设备 token |
| `GET /api/mobile/session` | HTTPS 通道，校验 Bearer / 会话 Cookie |
| `GET/POST /api/backup` | 已鉴权的完整学习备份读取/恢复，用于明确方向的覆盖 |

Mac 仍支持带设备授权的既有读写 API；配对属于个人学习库的完整读写授权，不能把配对码当作公开分享链接。新 iPhone 学习界面从内置资源加载，正常学习不通过远程页面或会话 Cookie 取得数据；保留的 Mac 远程接口不改变本地默认模式。当前无公网中继、自动合并或 iCloud 同步。

## 原件与旧客户端兼容

`GET /api/sources/{sourceId}/file`、`GET /api/batches/{batchId}/file` 在手机读取本端已打包或已保存的文件。Mac 对应文件分别在 `.local/source-pdfs/` 与 `.local/uploads/`。文件内容不在 JSON 备份中，缺失时返回404，题库和译文仍可查看。

`ios:prepare` 可把 Mac 已保存的正式来源 PDF 放入自用 App；后续手机上传留在手机沙盒。手机读取 PDF 文字层和 DOCX；旧 DOC 要先转换，扫描 PDF 要先 OCR，纯文本提取不补造 Task 1 题图或数据。

以下为 **Mac 远程服务的兼容接口**，不作为手机本地启动或学习的前置条件：

| 接口 | 兼容合同 |
| --- | --- |
| `GET /api/v2/manifest` | 既有 `full-client/readOnly:false` 声明，列出远程 `/api` 能力和 provider 策略 |
| `GET /api/v1/manifest` | 保留旧 `full-reader/readOnly:true` 声明 |
| `GET /api/v1/snapshot` | 远程全量 state、答案历史、复习记录和批导任务 |
| `GET /api/v1/content/{questionId}` | 远程单题内容；顶层 materials 是当前版本，阅读旧答案应优先用答案快照 |

v1 snapshot/content 仍是只读路径，旧接口的存在不意味着新 iPhone 客户端必须连接 Mac。当前设备实际交互、文件分享和独立冷启动仍需按 [真机核对清单](ios-setup.md#需要真机核对的流程) 验证。

### 覆盖过程的一致性

Mac 为每份当前学习库保留独立数据版本，成功恢复后更新版本。已打开的页面在修改请求中发送原版本，旧页面的自动保存会返回409并刷新；慢上传也在写入前再次检查。手机在覆盖过程中冻结旧文档的修改请求，成功后重载本地库，失败时恢复操作；原生同步使用一次性运行标识，页面重载后不会等待丢失的旧反馈或自动重发。学习快照、本机分享与覆盖同步上限统一为50 MB；上传原文件仍为10 MB。
