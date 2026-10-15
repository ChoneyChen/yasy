# Yasy 原生 App 图标

正式资源为 [`ios/Yasy/AppIcon.icon`](../ios/Yasy/AppIcon.icon)，使用 Apple Icon Composer 原生分层格式。原创意象是展开的书页和向上生长的新芽，分别代表表达积累与持续学习；森林绿背景为 **#234B38**，没有保留默认蓝底。

三层均为透明背景、1024×1024 的纯 SVG：浅奶白左书页、柔和草绿右书页、嫩绿新芽。源码和生成脚本位于 [`ios/IconSource`](../ios/IconSource/generate-icon.mjs)。运行 `node ios/IconSource/generate-icon.mjs` 会重建源 SVG，并同步已有 `.icon/Assets` 中的形状，不覆盖 Icon Composer 的材质与外观设置。

图标已在 Xcode 27 随附的 Icon Composer 中通过 CUA 导入、保存并重新打开，显示 Design Generation 27 和草木绿背景。阴影、透光、外框遮罩及默认/深色/单色外观由系统与 Icon Composer 渲染；SVG 不预烘焙玻璃高光、阴影、背景或圆角。不要将预览截图代替分层源资源。

本机已用 Xcode 27 的 `actool` 独立编译成功，生成 `Assets.car`、iPhone/iPad 图标和正确的 `CFBundleIcons` 信息。工程已把 `AppIcon.icon` 加入 Yasy target 的 Resources，并将 Debug/Release 的 `ASSETCATALOG_COMPILER_APPICON_NAME` 设为 `AppIcon`。最终安装和主屏幕检查以完整 App 构建为准。

Apple 官方说明：[Icon Composer](https://developer.apple.com/icon-composer/) · [创建与接入分层图标](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer) · [App icons 指南](https://developer.apple.com/design/human-interface-guidelines/app-icons)。
