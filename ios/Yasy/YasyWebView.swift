import SwiftUI
import WebKit
import UIKit

@MainActor final class YasyTabBarController: UITabBarController {
    var layoutChanged: (() -> Void)?
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); layoutChanged?() }
    override func viewSafeAreaInsetsDidChange() { super.viewSafeAreaInsetsDidChange(); layoutChanged?() }
}

struct YasyWebView: UIViewControllerRepresentable {
    @ObservedObject var model: ConnectionModel
    func makeCoordinator() -> Coordinator { Coordinator(model: model) }
    func makeUIViewController(context: Context) -> UITabBarController {
        let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = model.dataStore
        configuration.setURLSchemeHandler(LocalWebSchemeHandler(), forURLScheme: "yasy-local")
        configuration.userContentController.add(context.coordinator, name: "yasyNative")
        configuration.userContentController.add(context.coordinator, name: "yasyExport")
        configuration.userContentController.add(context.coordinator, name: "yasyNavigation")
        configuration.userContentController.addUserScript(WKUserScript(source: "window.__YASY_NATIVE_APPEARANCE__ = \(Coordinator.appearanceJSON());", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator; view.uiDelegate = context.coordinator
        view.isOpaque = false; view.backgroundColor = .systemBackground
        view.allowsBackForwardNavigationGestures = false
        view.scrollView.contentInsetAdjustmentBehavior = .automatic
        let controller = YasyTabBarController()
        controller.delegate = context.coordinator
        controller.viewControllers = MobileView.tabs.enumerated().map { index, section in
            let child = UIViewController()
            child.view.backgroundColor = .systemBackground
            child.tabBarItem = UITabBarItem(title: section.title, image: UIImage(systemName: section.symbol), tag: index)
            return child
        }
        context.coordinator.webView = view
        context.coordinator.tabController = controller
        context.coordinator.attachBrowser()
        let coordinator = context.coordinator
        controller.layoutChanged = { [weak coordinator] in coordinator?.emitOverlayInset() }
        model.bindBrowser(owner: coordinator.owner,
                          reconnect: { [weak coordinator] in coordinator?.connectionRestored() },
                          navigate: { [weak coordinator] section in coordinator?.requestNavigation(section) },
                          backgroundTasks: { [weak coordinator] in coordinator?.showBackgroundTasks() })
        model.syncProgress = { [weak coordinator] direction, run in coordinator?.dispatch("yasy:sync", detail: ["direction": direction, "confirmed": true, "runId": run]) }
        coordinator.observeAppearance()
        context.coordinator.load()
        return controller
    }
    func updateUIViewController(_ view: UITabBarController, context: Context) {}
    static func dismantleUIViewController(_ view: UITabBarController, coordinator: Coordinator) {
        (view as? YasyTabBarController)?.layoutChanged = nil
        coordinator.cancelLoading()
        coordinator.webView?.configuration.userContentController.removeScriptMessageHandler(forName: "yasyNative")
        coordinator.webView?.configuration.userContentController.removeScriptMessageHandler(forName: "yasyExport")
        coordinator.webView?.configuration.userContentController.removeScriptMessageHandler(forName: "yasyNavigation")
        coordinator.webView?.stopLoading(); coordinator.webView?.navigationDelegate = nil; coordinator.webView?.uiDelegate = nil
    }
    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UITabBarControllerDelegate {
        let owner = UUID()
        // Strong ownership keeps one DOM alive when it moves between tab containers.
        var webView: WKWebView?
        weak var tabController: UITabBarController?
        private let model: ConnectionModel
        private var loadTask: Task<Void, Never>?
        private var hasLoadedPage = false
        private var reactReady = false
        private var navigationSequence = 0
        private var awaitingTicket: Int?
        private var pendingNavigation: (view: MobileView, ticket: Int)?
        private var pendingBackgroundTasks = false
        private var browserConstraints: [NSLayoutConstraint] = []
        private var observers: [NSObjectProtocol] = []
        private var lastOverlayGeometry: String?
        lazy var services = NativeServices(model: model, reload: { [weak self] in self?.load() })
        init(model: ConnectionModel) { self.model = model }
        func attachBrowser() {
            guard let browser = webView, let container = tabController?.selectedViewController else { return }
            guard browser.superview !== container.view else { return }
            NSLayoutConstraint.deactivate(browserConstraints)
            browser.removeFromSuperview(); browser.translatesAutoresizingMaskIntoConstraints = false
            container.view.addSubview(browser)
            browserConstraints = [browser.topAnchor.constraint(equalTo: container.view.topAnchor), browser.leadingAnchor.constraint(equalTo: container.view.leadingAnchor), browser.trailingAnchor.constraint(equalTo: container.view.trailingAnchor), browser.bottomAnchor.constraint(equalTo: container.view.bottomAnchor)]
            NSLayoutConstraint.activate(browserConstraints)
            container.view.setNeedsLayout()
        }
        func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
            guard MobileView.tabs.indices.contains(tabBarController.selectedIndex) else { return }
            attachBrowser(); requestNavigation(MobileView.tabs[tabBarController.selectedIndex])
        }
        func requestNavigation(_ section: MobileView) {
            navigationSequence += 1
            let ticket = navigationSequence
            pendingNavigation = (section, ticket); awaitingTicket = ticket
            model.navigationView = section; model.navigationTitle = section.title; model.canGoBack = false
            if let index = MobileView.tabs.firstIndex(of: section) { tabController?.selectedIndex = index; attachBrowser() }
            deliverPendingNavigation()
        }
        private func deliverPendingNavigation() {
            guard reactReady, let pending = pendingNavigation else { return }
            pendingNavigation = nil
            dispatch("yasy:navigate", detail: ["view": pending.view.rawValue, "ticket": pending.ticket])
        }
        func showBackgroundTasks() {
            if reactReady { dispatch("yasy:background-tasks", detail: [:]) }
            else { pendingBackgroundTasks = true }
        }
        func dispatch(_ event: String, detail: [String: Any]) {
            guard let data = try? JSONSerialization.data(withJSONObject: detail), let json = String(data: data, encoding: .utf8) else { return }
            webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(event)', {detail: \(json)}));", completionHandler: nil)
        }
        func load() {
            loadTask?.cancel()
            model.localPageWillReload()
            hasLoadedPage = false; reactReady = false; awaitingTicket = nil; navigationSequence = 0
            lastOverlayGeometry = nil
            if let pending = pendingNavigation {
                navigationSequence = 1; awaitingTicket = 1; pendingNavigation = (pending.view, 1)
            }
            webView?.load(URLRequest(url: LocalAppOrigin.home, cachePolicy: .reloadIgnoringLocalCacheData))
        }

        func cancelLoading() {
            loadTask?.cancel(); loadTask = nil
            observers.forEach(NotificationCenter.default.removeObserver); observers.removeAll()
            model.unbindBrowser(owner: owner)
        }
        func connectionRestored() {
            guard let webView else { return }
            if hasLoadedPage {
                dispatch("yasy:connection-restored", detail: [:])
            } else if !webView.isLoading { load() }
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            hasLoadedPage = true; emitAppearance(); emitOverlayInset(force: true)
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            // Reopen the committed local snapshot. Interrupted model requests
            // are marked failed by startup recovery and are never resent.
            load()
        }
        func emitOverlayInset(force: Bool = false) {
            guard let browser = webView, let controller = tabController, browser.window != nil,
                  browser.bounds.width > 0, browser.bounds.height > 0 else { return }
            let bar = controller.tabBar
            let frame = browser.convert(bar.bounds, from: bar)
            let overlap = browser.bounds.intersection(frame)
            let bottomEdge = browser.bounds.maxY - max(browser.safeAreaInsets.bottom, controller.view.safeAreaInsets.bottom)
            let active = !bar.isHidden && bar.alpha > 0 && !overlap.isNull && overlap.height > 0
                && frame.maxY >= bottomEdge
            let geometry: [String: Any] = ["width": browser.bounds.width, "height": browser.bounds.height,
                "top": active ? overlap.minY - browser.bounds.minY : browser.bounds.height,
                "bottom": active ? overlap.maxY - browser.bounds.minY : browser.bounds.height, "active": active]
            guard let data = try? JSONSerialization.data(withJSONObject: geometry, options: .sortedKeys),
                  let json = String(data: data, encoding: .utf8), force || json != lastOverlayGeometry else { return }
            lastOverlayGeometry = json
            // Fixed web overlays don't follow UIScrollView.adjustedContentInset. Keep this
            // separate from document padding, and let visualViewport exclude the keyboard.
            browser.evaluateJavaScript("""
                (() => {
                  window.__YASY_OVERLAY_GEOMETRY__ = \(json);
                  if (!window.__YASY_SYNC_OVERLAY_INSET__) {
                    window.__YASY_SYNC_OVERLAY_INSET__ = () => {
                      const g = window.__YASY_OVERLAY_GEOMETRY__;
                      const viewport = window.visualViewport;
                      const width = viewport ? viewport.width : window.innerWidth;
                      const height = viewport ? viewport.height : window.innerHeight;
                      const scale = g && g.width > 0 ? width / g.width : 1;
                      const top = g ? g.top * scale : height;
                      const bottom = g ? g.bottom * scale : height;
                      const inset = g && g.active && top < height && bottom > 0
                        ? Math.max(0, Math.min(height, height - top)) : 0;
                      const value = `${inset}px`;
                      if (document.documentElement.style.getPropertyValue('--ios-overlay-bottom-inset') !== value) {
                        document.documentElement.style.setProperty('--ios-overlay-bottom-inset', value);
                        window.dispatchEvent(new CustomEvent('yasy:overlay-inset', {detail: {bottom: inset}}));
                      }
                    };
                    window.addEventListener('resize', window.__YASY_SYNC_OVERLAY_INSET__);
                    window.visualViewport?.addEventListener('resize', window.__YASY_SYNC_OVERLAY_INSET__);
                    window.visualViewport?.addEventListener('scroll', window.__YASY_SYNC_OVERLAY_INSET__);
                  }
                  window.__YASY_SYNC_OVERLAY_INSET__();
                })();
                """, completionHandler: nil)
        }
        static func appearanceJSON() -> String {
            let values: [String: Any] = ["fontScale": UIFont.preferredFont(forTextStyle: .body).pointSize / 17,
                "reduceMotion": UIAccessibility.isReduceMotionEnabled, "reduceTransparency": UIAccessibility.isReduceTransparencyEnabled,
                "increaseContrast": UIAccessibility.isDarkerSystemColorsEnabled, "boldText": UIAccessibility.isBoldTextEnabled]
            return (try? JSONSerialization.data(withJSONObject: values)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        }
        func emitAppearance() {
            webView?.evaluateJavaScript("window.__YASY_NATIVE_APPEARANCE__ = \(Self.appearanceJSON()); window.dispatchEvent(new CustomEvent('yasy:appearance', {detail: window.__YASY_NATIVE_APPEARANCE__}));", completionHandler: nil)
        }
        func observeAppearance() {
            for name in [UIContentSizeCategory.didChangeNotification, UIAccessibility.reduceMotionStatusDidChangeNotification,
                         UIAccessibility.reduceTransparencyStatusDidChangeNotification, UIAccessibility.darkerSystemColorsStatusDidChangeNotification,
                         UIAccessibility.boldTextStatusDidChangeNotification, UIApplication.didBecomeActiveNotification] {
                observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                    Task { @MainActor in self?.emitAppearance() }
                })
            }
        }
        private func navigate(_ url: URL) -> Bool {
            if LocalAppOrigin.matches(url) { return true }
            if url.scheme == "https", url.user == nil, url.password == nil { UIApplication.shared.open(url) }
            return false
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            decisionHandler(navigate(url) ? .allow : .cancel)
        }
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url, navigate(url) { webView.load(URLRequest(url: url)) }; return nil
        }
        private func presenter(_ view: WKWebView) -> UIViewController? {
            var controller = view.window?.rootViewController
            while let next = controller?.presentedViewController { controller = next }
            return controller
        }
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            guard let presenter = presenter(webView) else { completionHandler(); return }
            let alert = UIAlertController(title: "Yasy", message: String(message.prefix(600)), preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
            presenter.present(alert, animated: true)
        }
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard let url = frame.request.url, LocalAppOrigin.matches(url), let presenter = presenter(webView) else { completionHandler(false); return }
            let alert = UIAlertController(title: "Yasy", message: String(message.prefix(600)), preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "确认", style: .default) { _ in completionHandler(true) })
            presenter.present(alert, animated: true)
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { if (error as NSError).code != NSURLErrorCancelled { model.webFailed(error) } }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { if (error as NSError).code != NSURLErrorCancelled { model.webFailed(error) } }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, let frameURL = message.frameInfo.request.url,
                  LocalAppOrigin.matches(frameURL) else { return }
            if message.name == "yasyNative", let request = message.body as? [String: Any], let id = request["id"] as? String, id.count <= 160, let action = request["action"] as? String {
                let body = request["body"] as? [String: Any] ?? [:]
                Task { [weak self] in
                    guard let self else { return }
                    let reply: [String: Any]
                    do { reply = ["result": try await services.handle(action, body: body)] }
                    catch { reply = ["error": ["message": (error as? LocalizedError)?.errorDescription ?? "手机操作失败，原有数据已保留。", "status": (error as? NativeFailure)?.status ?? 500]] }
                    if let data = try? JSONSerialization.data(withJSONObject: [id, reply], options: [.fragmentsAllowed]), let json = String(data: data, encoding: .utf8) {
                        webView?.evaluateJavaScript("window.__yasyNativeReply?.(...\(json));", completionHandler: nil)
                    }
                }
                return
            }
            if message.name == "yasyExport", let data = message.body as? [String: String],
               let base64 = data["base64"], let filename = data["filename"] { model.saveBlob(base64: base64, filename: filename) }
            if message.name == "yasyNavigation", let data = message.body as? [String: Any],
               let rawView = data["view"] as? String, let section = MobileView(rawValue: rawView) {
                reactReady = true
                model.learningReady = true
                if pendingBackgroundTasks { pendingBackgroundTasks = false; showBackgroundTasks() }
                if pendingNavigation != nil { deliverPendingNavigation(); return }
                let ticket = data["ticket"] as? Int
                if let awaitingTicket {
                    guard ticket == awaitingTicket else { return }
                    self.awaitingTicket = nil
                } else if let ticket, ticket < navigationSequence { return }
                model.navigationView = section
                model.navigationTitle = (data["title"] as? String).map { String($0.prefix(80)) } ?? section.title
                model.canGoBack = data["canGoBack"] as? Bool ?? false
                model.backgroundCount = min(999, max(0, data["backgroundCount"] as? Int ?? 0))
                if let index = MobileView.tabs.firstIndex(of: section) { tabController?.selectedIndex = index; attachBrowser() }
                emitAppearance()
            }
        }
    }

}
struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
