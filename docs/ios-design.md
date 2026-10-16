# Yasy iOS 界面规范与实现

更新：2026-10-16。客户端最低支持 iOS 17，使用 Xcode 27 SDK 构建；Liquid Glass 由运行系统及标准控件呈现。App 默认独立运行，内置题库与学习界面，学习资料保存在手机、API 配置保存在本机 Keychain；普通使用无需 Mac 或配对。本文描述当前代码结构，并单列仍需设备确认的体验。

## 系统界面与学习内容

导航与工具属于系统操作层，题目、中文素材、答案和积累属于学习内容层。采用系统导航栏、标签栏与工具栏；学习正文使用实色背景、清晰层次和有限的状态色。Apple 明确将 Liquid Glass 用于操作与导航，避免铺在内容层。依据：[HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)。

| 规范 | Yasy 实现 |
| --- | --- |
| 稳定、带文字的主分区入口 | `UITabBarController` 提供今日、背书、口语、作文、单词五项；空题库仍保留入口并说明状态 |
| 当前页标题与操作分开表达 | 根 `NavigationStack` 显示标题；原生工具栏提供返回、可选进度同步、设置、后台任务 |
| 保留系统交互和材料自适应 | 不设置自定义导航栏背景、玻璃滤镜或兼容旧设计开关；同步页按钮在 iOS 26+ 使用 `.glass` / `.glassProminent`，旧系统使用标准按钮样式 |
| 导航与内容相互独立 | 五个标签共用一个持续存在的 `WKWebView`，切换时移动同一实例；React 负责每个分区的题目、刷题和草稿状态 |
| 品牌表达放在内容中 | 学习内容保留语料红线、素材三色和少量强调色；系统栏沿用平台外观 |

标签用于切换分区，导入、生成、同步等动作用按钮表达；标签图标采用 SF Symbols 并附中文文字。首次打开不以连接页阻挡学习，工具栏的同步按钮只打开可选操作。工具栏操作提供可读的辅助功能名称，后台数量用文字说明。依据：[HIG Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)、[HIG Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)。

iOS 27 允许用户调整 Liquid Glass 从清晰到着色的外观；应用跟随系统选择，不固定玻璃强度。WWDC26 建议保留熟悉的系统操作层，在内容、颜色与排版中表达品牌。依据：[WWDC26 设计指南](https://developer.apple.com/wwdc26/guides/design/)、[Communicate your brand identity on iOS](https://developer.apple.com/videos/play/wwdc2026/251/)、[What’s new in SwiftUI](https://developer.apple.com/videos/play/wwdc2026/269/)、[Apple iOS 27 发布介绍](https://www.apple.com/newsroom/2026/06/apple-unveils-next-generation-of-apple-intelligence-siri-ai-and-more/)。

## 阅读、输入与辅助功能

原生界面使用系统语义色和文本样式。网页内容采用系统字体、浅色与深色配色、至少 44pt 级触控目标，答案与中文输入优先保证阅读大小。素材高亮、语料下划线和文字标签共同表达关系，避免仅凭颜色理解。依据：[HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography)、[HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)。

原生在文档开始时注入 `window.__YASY_NATIVE_APPEARANCE__`，加载完成和系统设置变化时派发 `yasy:appearance`，包含 `fontScale`、`reduceMotion`、`reduceTransparency`、`increaseContrast`、`boldText`。字体倍率来自系统正文大小相对 17pt 的比例；React 将其映射为 `--yasy-text-scale` 与状态属性。原生系统材料自动适配，网页内容则明确调整字号、字重、对比度、动效和实色表面。极大字号、VoiceOver 顺序和中文输入法仍须设备验证。

## 单一网页实例与原生桥

| 方向 | 合同与行为 |
| --- | --- |
| 原生 → 网页 | `yasy:navigate`，`{view, ticket}`；`view` 为今日、背书、口语、作文、单词或设置的内部标识，`ticket` 从 1 递增 |
| 网页 → 原生 | `yasyNavigation` handler 仅回传 `{view, canGoBack, backTitle, backgroundCount, title, ticket}`；不携带素材、答案或密钥 |
| 原生 → 网页 | `yasy:background-tasks` 打开本机任务列表；`yasy:sync` 仅在用户确认覆盖方向后执行一次同步 |
| 网页 → 原生 | `yasyNative` 处理本机存储、Keychain API、文件与明确选择的同步；带请求 ID 返回结果或错误 |
| 网页 → 原生 | `yasyExport` 仅处理受信任主文档的受限大小文件导出，通过系统分享界面保存 |

App 从 `yasy-local://app/?client=ios&local=1` 加载内置资源，原生只接受受信任本地主文档的桥接消息。同源学习 API 由手机本地运行层处理，采用相同 Store 规则并原子保存完整 JSON 学习快照，不请求 Mac 才能读写。API 密钥由 Keychain 保管，原生直接向 iiiapi 发送网络请求；正常配置查询不返回原密钥。

导航序号避免迟到回执覆盖新标签，同标签再次选择可回到该分区根页。外部 HTTPS 链接交给系统打开，不向外站提供原生桥、配对凭据或 API 密钥。文件选择沿用 WebKit 系统输入面板，原件保存到当前设备，导出使用系统分享界面。

## 可选同步的交互边界

同步页先呈现「两端独立，按需同步」，明确平时无需连接；配对确认按钮注明「暂不同步」。用户对照两端进度后，必须在「用此 iPhone 进度覆盖 Mac」与「用 Mac 进度覆盖此 iPhone」中选择方向，再确认完整覆盖。接收端先保留恢复前快照，不自动合并。API 密钥、Keychain 配置和原始 PDF/DOC/DOCX 不随学习备份传送。

Mac 连接、一次性配对码与证书固定只服务于可选的局域网 HTTPS 操作。配对凭据在 Keychain 与手机自己的 API 配置分开保存；Mac 不在线时应说明同步不可用，不能遮挡本地学习。解除配对保留两端学习内容和各自 API 配置。

App 内切标签、切题不取消本机 API 任务；系统挂起或终止 App 后不保证持续运行，重新打开不会自动重发付费请求。遗留处理中任务会转为失败，供用户检查后重试。这里的「后台任务」指脱离当前题目的处理状态，不承诺 iOS 系统后台执行时长。

## 本轮手机体验修复（Build 3）

练习步骤缩为“素材 / 整理 / 答案”，保留清晰的题目与英文原题，将中文译文、来源折叠。编辑器只保留中文输入、助写和生成主操作；字数与保存状态放在固定空间内，手机保存只更新当前草稿，不为每次输入重载整份状态。中文输入法组词期间暂停防抖保存，组词结束后提交；原生滚动视图支持拖动收起键盘，不通过强制滚动纠正输入位置。

手机弹层使用独立的标题、滚动正文和固定操作区。可视视口变量只约束弹层，不改变正文或编辑器高度；打开只读助写预览时收起背景编辑器键盘，采纳后不重新唤起键盘。外接键盘焦点留在最上层弹层，关闭后恢复非输入触发控件。

原生返回使用 `yasy:back` 与单调递增 ticket，优先关闭单词菜单、再关闭最上层内容弹层，最后返回页面。设置记录来源题目、练习步骤与滚动位置，返回恢复来源；原生导航已提供返回时，不重复显示网页返回按钮。迟到的滚动恢复不能影响已换到的新题。

手机答案提示词独立版本化，中文仅作为内容基础，按题型审题、发展和组织完整答案。中文助写与正式整理各为独立一次调用，不增加自动审核调用；详见 [手机提示词](ios-prompts.md)。本轮没有运行付费模型生成，不能据提示词测试推断真实考试成绩。

手机构建输出改为 `.local/ios-web/dist`，Xcode 仅打包此目录；`ios:prepare` 不再替换运行中的 Mac `dist`。本轮 Mac 服务、题库、记录与网页产物保持原样。

已通过：259 项业务/提示词/导航/弹层等自动化测试、28 项原生配对与 TLS 检查、TypeScript 检查、模拟器及签名真机构建。隔离内存题库中验证 1807 字助写预览在 393×700 与 320×400 视口的确认按钮均可点击；中文连续编辑与保存前后，编辑器位置和页面滚动值未变。模拟器已呈现新版步骤与编辑器。

仍需设备实际使用验证：真实中文输入法长时间组词、系统软件键盘组合、VoiceOver 与极大字号；模拟器输入自动化未完成这些交互验收。未把静态界面、单元测试或构建成功视为这些项目通过。

## 验证边界

| 项目 | 当前状态 |
| --- | --- |
| 最新独立架构的构建与业务测试 | 需针对当前代码执行并记录；此前连接版结果不能代替本次验证 |
| 地址、配对、证书等原生安全测试 | `npm run ios:test` 可检查对应规则，不验证屏幕布局、全部本地业务或 WebView 生命周期 |
| 独立冷启动、本机保存与 Keychain API | 代码已接入；需核对未配对和 Mac 关机时的设备行为 |
| 原生导航协议、辅助功能桥、同源限制 | 需结合本地资源模式验证，外站不得获得桥接权限 |
| 系统标签栏安全区、滚动边缘、键盘与长按 | 待模拟器及真机逐项验收 |
| 极大字号、深色、降低动态效果/透明度、提高对比度、VoiceOver | 代码已接入；待设备组合验收 |
| Mac 停服/休眠与快速切标签 | 核对手机本地学习不受同步连接影响、草稿仍可保存 |
| 双向覆盖与恢复前快照 | 核对明确方向、接收端备份、失败保留旧数据，密钥与原件不随进度改变 |
| 真机证书固定、扫码、PDF/DOCX 导入、DOC 转换提示、导出到“文件” | 待已签名真机验证 |

构建通过只证明当前 SDK 能编译、链接这些代码。本文不将其视为真机测试通过，也不承诺尚未检查的系统外观细节。
