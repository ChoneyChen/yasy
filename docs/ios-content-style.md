# iOS 内容层样式与无障碍边界

适用文件：`src/ios.css`。该样式在 `styles.css` 后导入，全部以 `body.native-ios` 为作用域；普通 Mac 网页不受影响。原生壳负责系统导航栏、标签栏和 Liquid Glass，网页负责题目、中文编辑、答案、素材、语料、词本与数据操作。iPhone 的学习内容来自本机学习库，打开不依赖 Mac 或配对；可选同步页由原生单独呈现，不占据日常学习入口。

## Apple 官方依据

- [HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)：Liquid Glass 用于浮在内容上方的导航和控件层，内容层应有清晰的视觉层级。这里采用实色表面，没有用 CSS 模拟玻璃材质。
- [WWDC26 Platforms State of the Union](https://developer.apple.com/videos/play/wwdc2026/102/)：iOS 27 延续并调整系统 Liquid Glass；使用原生系统组件会获得相应更新及系统偏好适配。
- [HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)、[Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)：正文采用 17 点基准，主要交互控件至少 44×44 点，字体放大后仍需可读、可操作。
- [HIG Color](https://developer.apple.com/design/human-interface-guidelines/color)、[Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)：浅色、暗色与增强对比应分别适配，颜色不作为唯一的状态信号。
- [HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)：动画用于必要反馈，并响应减少动态效果的系统设置。

## 原生桥接合同

根元素或 `body` 可以提供 `--yasy-text-scale`，数值为 `UIFont.preferredFont(forTextStyle: .body).pointSize / 17`。正文、题干、答案、表单、标题与元信息使用 `calc(基础像素 * scale)`；较小元信息额外设有 11px 下限。页面允许换行，不以固定高度裁切放大后的文字。

`body` 使用以下属性，值为字符串 `true` 时生效：

| 属性 | 内容层响应 |
| --- | --- |
| `data-reduce-motion` | 关闭自定义动画、过渡与平滑滚动 |
| `data-reduce-transparency` | 弹层遮罩改为实色；内容与菜单保持不透明 |
| `data-increase-contrast` | 次级文字提高对比，主要表面与表单加强边框，素材标记增加实线边界 |
| `data-bold-text` | 正文及强调文字提升字重 |

CSS 同时响应 `prefers-color-scheme`、`prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast`。未知媒体查询由浏览器忽略时，原生桥接属性仍有效。

自然文档流的底部安全区交由原生 `WKWebView.scrollView.contentInsetAdjustmentBehavior = .automatic` 处理，CSS 不再添加标签栏高度，避免重复补偿。`--ios-native-top-inset` 默认为 `0px`，仅为未来壳需要提供额外顶部遮挡时预留。

原生在根元素写入 `--ios-overlay-bottom-inset`（CSS px），表示当前 WK 区域与标签栏的实际交集；变化时派发 `yasy:overlay-inset`。它仅用于单词菜单、Toast 等固定浮层。键盘使标签栏移出可见区时，原生将其设为 `0px`，键盘边界由 `visualViewport` 决定，不把键盘高度再加一次。

`EnglishContext` 根据 `visualViewport` 更新 `--ios-visual-bottom-offset`，仅供 Toast 避开键盘与可见视口偏移。单词菜单直接使用当前可见视口、原生浮层遮挡与实际 DOM 尺寸计算位置；菜单打开后仍会响应旋转、字号、视口及原生遮挡变化，超出高度时内部滚动。菜单定位计算见 `src/menuPosition.ts`，几何边界回归检查见 `tests/menu-position.test.mjs`。

## 组件对照

- `.material-highlight.material-color-0/1/2` 对应黄、蓝、绿三类素材标记，浅暗色均有独立配色。
- `.expression-underline` 保留基础样式中的红色波浪线，并调整两种主题下的颜色、线宽与偏移。素材背景与波浪线可以同时显示。
- `.word-context-menu`、`.word-menu-add`、`.word-menu-backdrop` 对应触屏收藏菜单。菜单是实色高层表面；收藏与关闭按钮均保留 44px 最小点击区域。
- `.editor-actions`、`.api-generation-actions`、`.answer-footer`、`.modal-actions` 和背诵页页尾都使用自然文档流和可换行布局，没有固定在屏幕底部的网页操作栏。
- `.sidebar`、`.sidebar-scrim`、`.topbar`、`.page-footer` 仅在原生模式隐藏，功能由原生导航、标签与工具栏入口承接。
- 原生「可选进度同步」只在用户主动打开时呈现；Mac 连接失败不能让本机题目、编辑器或复习页被遮罩。覆盖需选择方向并再次确认，接收端保留旧快照，不自动合并；密钥和原件不随学习备份同步。
- 图表和表格的横向滚动限制在自身容器内；放大字体时地图仍保留方位排布，数值图表不因固定最大高度被压缩。

## 对比度附录

以下数值由当前 CSS 回退调色板计算，使用 sRGB 相对亮度公式 `(较亮亮度 + 0.05) / (较暗亮度 + 0.05)`。这是指定配色组合的测量，不代替设备上对全部状态的验收。

| 组合 | 前景 | 背景 | 对比度 |
| --- | --- | --- | ---: |
| 浅色正文 | `#1c1c1e` | `#ffffff` | 17.01:1 |
| 浅色次级文字 | `#626267` | `#f2f2f7` | 5.44:1 |
| 浅色强调文字 | `#1d614d` | `#ffffff` | 7.32:1 |
| 浅色主要按钮 | `#ffffff` | `#1d614d` | 7.32:1 |
| 暗色正文 | `#f5f5f7` | `#1c1c1e` | 15.63:1 |
| 暗色次级文字 | `#b9b9c1` | `#2c2c2e` | 7.15:1 |
| 暗色主要按钮 | `#0b3021` | `#9fd9be` | 9.01:1 |
| 浅色补充提示 | `#84500e` | `#fff1db` | 6.02:1 |
| 暗色补充提示 | `#f4c07b` | `#3b2d1a` | 8.04:1 |

## 设备验收边界

1. 在默认与至少 200% 字号下，检查最下方的保存、下一道题、背诵按钮是否都能滚动到标签栏上方；横屏与弹出键盘后也应检查。
2. 原生 `WKWebView.scrollView.contentInsetAdjustmentBehavior = .automatic` 应为自然滚动内容处理系统栏安全区；这需要在真实 `UITabBarController` 布局中验证。固定浮层不能仅据此推断不会被遮挡。
3. 单词菜单已改为按实际渲染尺寸与可见视口夹取位置，不依赖固定宽高；仍需在设备上检查放大字号、靠近右下角、键盘出现及屏幕旋转。尺寸超过可见区域时，菜单内部应能滚动。
4. 长按收藏应阻止随后的注释点击误触；移动与取消触摸应停止长按计时。CSS 的 `-webkit-touch-callout: none` 只处理系统呼出表现，不能代替事件层的手势处理。
5. 未配对或 Mac 关机时可直接打开本地工作台；网络失败只影响需要网络的 AI 与可选同步，不遮挡离线阅读、书写和复习。以上为设备验收要求，样式检查和几何单元测试不能代替真机验证。
