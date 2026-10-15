import SwiftUI

@main struct YasyApp: App {
    @StateObject private var model = ConnectionModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                Group {
                    YasyWebView(model: model).ignoresSafeArea(edges: .bottom)
                        .toolbar {
                            if model.canGoBack {
                                ToolbarItem(placement: .topBarLeading) {
                                    Button { model.navigate?(model.navigationView) } label: { Label("返回", systemImage: "chevron.left") }
                                }
                            }
                            ToolbarItem(placement: .topBarTrailing) {
                                Button { model.showsPairing = true } label: { Image(systemName: "arrow.triangle.2.circlepath") }
                                    .accessibilityLabel("可选：与 Mac 同步进度")
                            }
                            ToolbarItem(placement: .topBarTrailing) {
                                Button { model.navigate?(.settings) } label: { Label("设置", systemImage: "gearshape") }
                            }
                            ToolbarItem(placement: .topBarTrailing) {
                                Button { model.openBackgroundTasks?() } label: {
                                    HStack(spacing: 3) { Image(systemName: "tray"); if model.backgroundCount > 0 { Text("\(model.backgroundCount)").font(.caption).monospacedDigit() } }
                                }.accessibilityLabel("后台任务").accessibilityValue("\(model.backgroundCount) 个处理中任务")
                            }
                        }
                        .navigationTitle(model.navigationTitle)

                }
                .background(Color(uiColor: .systemBackground))
                .navigationBarTitleDisplayMode(.inline)
                .sheet(isPresented: $model.showsPairing) {
                    NavigationStack { ConnectionView(model: model).toolbar { ToolbarItem(placement: .topBarTrailing) { Button("完成") { model.showsPairing = false }.disabled(model.busy) } } }.interactiveDismissDisabled(model.busy)
                }
                .sheet(item: $model.export) { item in ShareSheet(url: item.url) }
                .onOpenURL { model.receive(link: $0.absoluteString) }

                .onChange(of: scenePhase) { _, phase in model.setForeground(phase == .active) }
            }
        }
    }
}
