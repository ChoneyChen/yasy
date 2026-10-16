# Yasy iPhone 开发与真机测试

工程：[ios/Yasy.xcodeproj](../ios/Yasy.xcodeproj)。最低 iOS 17，支持 iPhone / iPad；当前工程使用 Xcode 27 和 iOS 27 SDK。App 内置学习界面与题库，**安装后直接使用，不需要 Mac 在线或先配对**。题库、中文草稿、答案、素材与语料、单词、背诵记录均保存在此 iPhone，手机用自己的 Keychain API 配置直接请求模型服务。

Mac 只在构建安装 App 或用户主动进行两端进度同步时需要。已安装 App 的普通阅读、书写、收藏和复习无需连接 Mac；中文助写、答案整理、语料复核与 API 导题需要互联网连接。手机仅提供 API 通道，Mac 另保留手动网页桥。

## 环境检查与资源准备

```sh
npm ci
npm run ios:check
npm run ios:prepare
```

`ios:check` 检查 Xcode 首次启动、SDK、模拟器运行环境、签名和已连接设备。签名、设备 ID 和凭据不写进文档；本机详细日志留在被 Git 忽略的 `.local/qa/`。Xcode 提示许可未同意时，由本人打开 Xcode 阅读并接受协议、完成首次组件安装。工程不依赖 CocoaPods 或第三方 Swift 包；网页业务依赖由 npm 安装并打包。

`ios:prepare` 构建内置网页和 JSON 题库，并把 Mac `.local/source-pdfs/` 中可用的来源 PDF 附入这份自用 App。学习记录、上传原件和 API 密钥不会打包。手机构建输出到 `.local/ios-web/dist/`，Xcode 将其作为 `dist` 资源附入 App，不替换 Mac 正在使用的根目录 `dist/`；修改前端或题库后需要重新准备资源，再构建安装。没有来源 PDF 仍可使用题库与译文，对应原件下载会提示缺失。

## 安装到自己的 iPhone

1. 用数据线连接并解锁 iPhone，在手机选择信任这台 Mac。
2. 按系统指引，在手机「设置 → 隐私与安全性 → 开发者模式」开启并完成重启确认。
3. 打开工程，选择 Yasy target → Signing & Capabilities，开启 Automatically manage signing，在 Team 选择自己的开发团队。没有账号时，在 Xcode Settings → Apple Accounts 由本人登录。Personal Team 的适用方式以 Xcode 实际提示为准。
4. 运行 `npm run ios:prepare` 后，选择已连接的 iPhone，点击 Run。若出现签名、设备支持或信任提示，按 Xcode 和 iPhone 指引处理。
5. 打开 App，直接进入今日积累。首次使用在手机「偏好与数据」填写自己的 iiiapi API key，获取模型列表并保存模型；手机不会继承 Mac 的 API 配置。
6. 写中文、读答案、收藏和复习均使用本机学习库。无需先运行 `npm start`、扫码或授予局域网权限；只有主动同步时才需要后面的配对步骤。

账号密码、验证码、设备解锁及开发者模式确认由本人完成。不要把 Apple 账号、API key、证书私钥、provisioning profile 或手机配对 token 提交到仓库。

参考：[Apple 真机运行](https://help.apple.com/xcode/mac/current/en.lproj/dev5a825a1ca.html) · [开发者模式](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device) · [签名工作流](https://help.apple.com/xcode/mac/current/en.lproj/dev60b6fbbc7.html)。

## 编译与模拟器

`npm run ios:test` 使用临时证书检查原生配对与证书相关规则，不读取私人学习数据。它不验证独立学习库的全部业务、屏幕布局或真机后台行为。`npm run ios:build` 先准备内置资源，再执行不签名的模拟器目标构建：

```sh
npm run ios:build
```

这是模拟器目标构建，不能直接安装到真机；真机需要上面的个人签名。检查真实设备可用运行目标后再进行签名构建，不把模拟器编译成功称为真机测试成功。

如果没有模拟器 runtime，可通过 Xcode Settings → Components 安装 iOS，或运行：

```sh
xcodebuild -downloadPlatform iOS -exportPath .local/ios-runtimes
```

运行环境体积较大，安装完成后通过 `xcrun simctl list runtimes` 核对。模拟器与真机的相机、文件选择、局域网权限和触屏行为须分别验证。

## 可选：手动覆盖同步

两端各自独立保存，配对不意味着共用数据库或自动同步。

1. 需要同步时才在 Mac 运行 `npm start`，进入「偏好与数据 → 连接 iPhone」启用同步连接，两端接入同一局域网。
2. 在 iPhone 工具栏打开「可选进度同步」，扫描二维码，或粘贴完整 `yasy://pair?...` 链接，点击「确认配对（暂不同步）」。配对成功不修改任何一端的数据。
3. 读取并对照两端进度，选择明确方向：**用此 iPhone 进度覆盖 Mac**，或**用 Mac 进度覆盖此 iPhone**。
4. 再次确认后，接收端先保留旧进度快照，再用来源端的完整题库与学习记录替换。没有自动合并；只希望合并几个新答案时，不应把完整覆盖当作局部合并。
5. 恢复前快照可在接收端「偏好与数据」下载。同步完成后可关闭 Mac 连接；iPhone 继续独立使用。解除配对只移除连接凭据，不清空任一端的进度。

**API 密钥、Keychain 配置和原始 PDF / DOC / DOCX 文件不随学习备份同步**。来源端有原件，不代表接收端也能下载；题目、中文译文和已有学习内容仍保留。新环境分别配置 API，原件按需另行保存。

连接边界：

- Mac 平时只监听 `127.0.0.1:4318`；启用同步连接后另开 **HTTPS 4319**，仅接受本地/私有 IPv4 网络来源。
- 配对链接包含 Mac 地址、证书 SHA-256 指纹和5分钟一次性配对码；成功即失效，5次错误后须在 Mac 刷新。每台设备获得独立的30天凭据，可在 Mac 撤销。
- 原生 HTTPS 客户端校验证书指纹、主机名与有效期；不安装系统根证书、不接受任意证书，也不关闭全局 ATS。无需在 Safari 手动跳过证书警告。
- 配对凭据存在 iPhone Keychain，与手机自己的 AI 密钥分开；Mac API 密钥不会被下发到手机。
- 只有读取 Mac 进度或执行覆盖时要求 Mac 在线。Mac 休眠、停服、IP/证书变化会影响同步，不影响手机本地学习；地址或证书变化需重新配对。
- 当前没有自动合并、公网中继或独立 iCloud 同步。同步二维码用于个人设备，不作为公共分享链接。

## 本地数据与使用边界

iPhone 在自身 `Application Support/Yasy/` 原子保存完整学习快照，覆盖前保留恢复快照；API 密钥与模型存于本机 Keychain。定期在「偏好与数据」导出 JSON 到“文件”等独立位置，避免将卸载 App 当作重置或排错方法。本地学习快照与系统分享导出的上限均为 50 MB；局域网覆盖同步采用同一 50 MB 学习快照上限。JSON 备份采用与 Mac 相同的 `yasy-backup` v1 格式，不含密钥或文件原件。

手机可从系统“文件”选择 PDF / DOCX，读取文字后由所选 API 生成题目预览，需勾选确认才入库。旧版二进制 DOC 需先转为 DOCX 或可复制文字的 PDF；扫描 PDF 须先 OCR，纯文字提取不识别题图。文件原件留在本机，不随进度同步。

中文助写与正式答案整理各自独立点击触发，每道答案只进行一次模型生成。App 内切题和切页可继续处理；锁屏、切到其他 App 或系统终止进程后，iOS 可能暂停执行，不保证系统后台持续生成。重新打开时遗留处理任务会标为失败，确认后手动重试，不自动重发付费请求。

## 需要真机核对的流程

本轮已通过 218 项网页/业务测试、28 项原生配对与证书检查，以及模拟器和真机目标构建。iOS 27 模拟器已验证未配对冷启动、743 题本地读取、草稿原子写入和进程重启保留；真机已更新安装并成功启动，已看到 iOS 27.0.1 深色模式下无需配对的独立首页。以下流程仍需按实际设备与网络条件继续核对，其中付费模型生成未在本轮发起：

- 未配对、Mac 关机时冷启动，离线题库阅读、中文草稿、收藏和复习的保存与重开。
- 手机独立 Keychain 配置、模型列表、中文助写与一次 API 整理；Mac 不应参与请求。
- 口语/作文入口、换题及随机下一未积累题，快速切标签与中文键盘。
- 素材/语料单击、单词长按、极大字号、底部按钮及键盘遮挡。
- PDF/DOCX 提取、旧 DOC 转换提示、原件与 JSON 备份导出。
- 双向同步前确认与目标快照，失败后保留目标数据，两端 API 配置和文件原件不随进度改变。
- 撤销配对、Mac 休眠和局域网中断后仍可使用本地学习库。
