import SwiftUI

struct ConnectionView: View {
    @ObservedObject var model: ConnectionModel
    @State private var scanning = false
    @State private var confirmForget = false
    @State private var direction: String?
    @State private var confirmSync = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("两端独立，按需同步").font(.title.bold())
                Text("iPhone 与 Mac 各自保存题库与积累、各自调用 API。平时无需连接；配对后也不会自动覆盖进度。")
                    .foregroundStyle(.secondary)
                GroupBox("此 iPhone") { Text(model.localSummary).frame(maxWidth: .infinity, alignment: .leading) }
                if model.credential != nil {
                    GroupBox("已配对的 Mac") {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(model.remoteSummary)
                            Button("读取 Mac 进度") { Task { await model.refreshRemoteSummary() } }.disabled(model.busy)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                    VStack(spacing: 14) {
                        Button("用 Mac 进度覆盖此 iPhone") { direction = "pull"; confirmSync = true }.yasySecondaryAction()
                        Button("用此 iPhone 进度覆盖 Mac") { direction = "push"; confirmSync = true }.yasySecondaryAction()
                    }.disabled(model.busy || !model.learningReady)
                    Text("覆盖包含全部题库、草稿、答案、素材、语料、单词和背诵记录。覆盖前自动保留接收端的旧进度，可从「偏好与数据」下载恢复前快照。两端 API 密钥与文件原件分别保存，不随进度覆盖。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Divider()
                VStack(alignment: .leading, spacing: 14) {
                    Text(model.credential == nil ? "可选：配对你的 Mac" : "更换或重新配对 Mac").font(.title2.bold())
                    Text("同一 Wi-Fi 下，在 Mac「偏好与数据 → 连接 iPhone」启用同步连接并显示二维码。")
                    Button { scanning = true } label: { Label("扫描 Mac 配对二维码", systemImage: "qrcode.viewfinder").frame(maxWidth: .infinity) }.yasySecondaryAction().controlSize(.large)
                    TextEditor(text: $model.pairingText).font(.footnote.monospaced()).frame(minHeight: 100)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().padding(8)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.gray.opacity(0.3))).accessibilityLabel("Mac 配对链接")
                    Button { Task { await model.pair() } } label: {
                        HStack { if model.busy { ProgressView() }; Text(model.busy ? "正在处理…" : "确认配对（暂不同步）").frame(maxWidth: .infinity) }
                    }.yasyPrimaryAction().controlSize(.large).disabled(model.busy || model.pairingText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }.disabled(model.busy)
                if !model.notice.isEmpty { Text(model.notice).font(.callout).accessibilityLabel(model.notice) }
                if model.credential != nil {
                    Button("解除 Mac 配对", role: .destructive) { confirmForget = true }.disabled(model.busy)
                        .confirmationDialog("只移除连接凭据；两端学习进度都保留。", isPresented: $confirmForget, titleVisibility: .visible) {
                            Button("解除配对", role: .destructive) { Task { await model.forget() } }
                        }
                }
            }.padding(24)
        }.navigationTitle("可选进度同步")
        .task { await model.refreshLocalSummary(); await model.checkConnection(); await model.refreshRemoteSummary() }
        .confirmationDialog(direction == "pull" ? "以 Mac 为准，替换此 iPhone 的全部进度？" : "以此 iPhone 为准，替换 Mac 的全部进度？", isPresented: $confirmSync, titleVisibility: .visible) {
            Button("确认覆盖并保留旧进度备份", role: .destructive) { if let direction { model.requestSync(direction) } }
        } message: { Text("这是一次明确方向的完整覆盖，不自动合并；请先对照两端进度。") }
        .sheet(isPresented: $scanning) {
            NavigationStack { QRScanner { link in scanning = false; model.receive(link: link) }
                .ignoresSafeArea(edges: .bottom).navigationTitle("扫描 Mac 配对码")
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("取消") { scanning = false } } } }
        }
    }
}
extension View {
    @ViewBuilder func yasyPrimaryAction() -> some View { if #available(iOS 26.0, *) { buttonStyle(.glassProminent) } else { buttonStyle(.borderedProminent) } }
    @ViewBuilder func yasySecondaryAction() -> some View { if #available(iOS 26.0, *) { buttonStyle(.glass) } else { buttonStyle(.bordered) } }
}
