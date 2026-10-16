import Foundation
import Combine
import WebKit
import Network
import UIKit

enum ConnectionState { case unpaired, connecting, connected, offline }
struct SharedExport: Identifiable { let id = UUID(); let url: URL }
enum MobileView: String, CaseIterable {
    case today, recall, speaking, writing, words, settings
    static let tabs: [MobileView] = [.today, .recall, .speaking, .writing, .words]
    var title: String {
        switch self {
        case .today: return "今日积累"
        case .recall: return "背书"
        case .speaking: return "口语"
        case .writing: return "作文"
        case .words: return "单词本"
        case .settings: return "偏好与数据"
        }
    }
    var symbol: String {
        switch self {
        case .today: return "sun.max"
        case .recall: return "repeat"
        case .speaking: return "waveform"
        case .writing: return "square.and.pencil"
        case .words: return "book"
        case .settings: return "gearshape"
        }
    }
}

@MainActor final class ConnectionModel: ObservableObject {
    @Published var credential: DeviceCredential?
    @Published var state: ConnectionState = .unpaired
    @Published var pairingText = ""
    @Published var notice = ""
    @Published var busy = false
    @Published var showsPairing = false
    @Published var export: SharedExport?
    @Published var navigationView: MobileView = .today
    @Published var navigationTitle = MobileView.today.title
    @Published var canGoBack = false
    @Published var backTitle = "返回"
    @Published var backgroundCount = 0
    let dataStore = WKWebsiteDataStore.default()
    private var client: MobileClient?
    private var checkingRun: UUID?
    private var generation = 0
    private var foreground = true
    private let monitor = NWPathMonitor()
    private var periodicCheck: Task<Void, Never>?
    var reconnected: (() -> Void)?
    var navigate: ((MobileView) -> Void)?
    var goBack: (() -> Void)?
    var openBackgroundTasks: (() -> Void)?
    var syncProgress: ((String, String) -> Void)?
    @Published var learningReady = false
    private(set) var syncRun: String?
    @Published var localSummary = "正在读取手机进度…"
    @Published var remoteSummary = "尚未读取 Mac 进度"
    private var browserOwner: UUID?

    func bindBrowser(owner: UUID, reconnect: @escaping () -> Void,
                     navigate: @escaping (MobileView) -> Void, back: @escaping () -> Void, backgroundTasks: @escaping () -> Void) {
        browserOwner = owner; reconnected = reconnect; self.navigate = navigate; goBack = back; openBackgroundTasks = backgroundTasks
    }

    func unbindBrowser(owner: UUID) {
        guard browserOwner == owner else { return }
        browserOwner = nil; reconnected = nil; navigate = nil; goBack = nil; openBackgroundTasks = nil; syncProgress = nil
    }

    init() {
        if let saved = DeviceKeychain.load(), saved.isValid {
            credential = saved
            client = MobileClient(baseURL: saved.baseURL, fingerprint: saved.fingerprint, token: saved.token)
            state = .connecting
        } else { showsPairing = false }
        monitor.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            Task { @MainActor in
                guard let self, self.credential != nil, self.showsPairing else { return }
                if !available { self.state = .offline; self.notice = "网络已断开，请保留当前页面，恢复后重新读取状态。" }
                else { await self.checkConnection() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "yasy.network-status"))
        scheduleConnectionChecks()
    }

    func receive(link: String) {
        do { _ = try PairingPayload(link: link); generation += 1; busy = false; checkingRun = nil; pairingText = link; notice = ""; showsPairing = true }
        catch { notice = message(error); showsPairing = true }
    }

    func pair() async {
        guard !busy else { return }
        generation += 1; let ticket = generation; checkingRun = nil
        busy = true; notice = ""
        defer { if ticket == generation { busy = false } }
        do {
            let payload = try PairingPayload(link: pairingText)
            let pairingClient = MobileClient(baseURL: payload.baseURL, fingerprint: payload.fingerprint)
            let response = try await pairingClient.pair(code: payload.code, deviceName: UIDevice.current.name)
            guard ticket == generation else { return }
            let saved = DeviceCredential(baseURL: payload.baseURL, fingerprint: payload.fingerprint,
                                         token: response.token, deviceId: response.deviceId, expiresAt: response.expiresAt)
            guard saved.isValid else { throw MobileError.invalidResponse }
            guard try await installCookie(saved, generation: ticket) else { return }
            guard ticket == generation else { await removeStaleCookie(saved); return }
            do { try DeviceKeychain.save(saved) }
            catch {
                await removeStaleCookie(saved)
                if ticket == generation, let current = credential { _ = try? await installCookie(current, generation: ticket) }
                throw error
            }
            credential = saved
            client = MobileClient(baseURL: saved.baseURL, fingerprint: saved.fingerprint, token: saved.token)
            pairingText = ""; showsPairing = true; state = .connected; notice = "已配对，尚未覆盖任何进度。请选择同步方向。"
            await refreshRemoteSummary()
        } catch { if ticket == generation { notice = message(error) } }
    }

    func checkConnection() async {
        guard foreground, showsPairing, checkingRun == nil, let client, let credential else { return }
        let ticket = generation
        let run = UUID(); checkingRun = run
        defer { if checkingRun == run { checkingRun = nil } }
        do {
            let response = try await client.checkSession()
            guard ticket == generation else { return }
            let updated = DeviceCredential(baseURL: credential.baseURL, fingerprint: credential.fingerprint,
                                           token: credential.token, deviceId: credential.deviceId, expiresAt: response.expiresAt)
            guard updated.isValid else { throw MobileError.authenticationExpired }
            let restored = state != .connected
            guard try await installCookie(updated, generation: ticket) else { return }
            guard ticket == generation else { await removeStaleCookie(updated); return }
            try DeviceKeychain.save(updated)
            self.credential = updated
            state = .connected; notice = ""
            if restored { reconnected?() }
        } catch {
            guard ticket == generation else { return }
            if let error = error as? MobileError, error == .authenticationExpired { await forget(); notice = message(error) }
            else { state = .offline; notice = message(error) }
        }
    }

    func setForeground(_ value: Bool) {
        foreground = value
        scheduleConnectionChecks()
        if value && showsPairing { Task { await checkConnection() } }
    }

    private func scheduleConnectionChecks() {
        periodicCheck?.cancel(); periodicCheck = nil
        guard foreground && showsPairing else { return }
        // A sleeping/restarting Mac doesn't change the iPhone's Wi-Fi path.
        // Check only the local session; reconnecting never retries an AI request.
        periodicCheck = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(20)) }
                catch { return }
                guard let self, self.foreground else { return }
                await self.checkConnection()
            }
        }
    }

    // WebKit must have its credential before even the first protected HTML request.
    func prepareWebSession(for expected: DeviceCredential) async -> Bool {
        let ticket = generation
        guard owns(expected) else { return false }
        do {
            guard try await installCookie(expected, generation: ticket) else { return false }
            return ticket == generation && owns(expected)
        } catch {
            if ticket == generation { notice = message(error); state = .offline }
            return false
        }
    }

    private func owns(_ expected: DeviceCredential) -> Bool {
        credential?.deviceId == expected.deviceId && credential?.token == expected.token
            && credential?.baseURL == expected.baseURL && credential?.fingerprint == expected.fingerprint
    }

    private func installCookie(_ credential: DeviceCredential, generation ticket: Int) async throws -> Bool {
        guard ticket == generation else { return false }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
        let expires = formatter.string(from: credential.expiration ?? .distantPast)
        let header = "yasy_device=\(credential.token); Path=/; Secure; HttpOnly; SameSite=Strict; Expires=\(expires)"
        guard let cookie = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: credential.baseURL).first,
              cookie.isSecure, cookie.isHTTPOnly else { throw MobileError.invalidResponse }
        await withCheckedContinuation { continuation in
            dataStore.httpCookieStore.setCookie(cookie) { continuation.resume() }
        }
        guard ticket == generation else { await removeStaleCookie(credential); return false }
        return true
    }

    func forget() async {
        let previous = credential
        generation += 1; busy = false; checkingRun = nil; syncRun = nil
        DeviceKeychain.delete(); client = nil; credential = nil; state = .unpaired; showsPairing = false
        export = nil
        if let previous { await removeStaleCookie(previous) }
    }

    private func removeStaleCookie(_ previous: DeviceCredential) async {
        // A cancelled old check may still refer to the active session's token.
        // Do not delete that token, or a replacement session installed while awaiting WebKit.
        guard !owns(previous) else { return }
        let cookies: [HTTPCookie] = await withCheckedContinuation { continuation in
            dataStore.httpCookieStore.getAllCookies { continuation.resume(returning: $0) }
        }
        for cookie in cookies where cookie.name == "yasy_device" && cookie.value == previous.token {
            guard !owns(previous) else { return }
            await withCheckedContinuation { continuation in dataStore.httpCookieStore.delete(cookie) { continuation.resume() } }
        }
    }

    private func summary(_ value: [String: Any]) -> String {
        let bank = value["bank"] as? [String: Any] ?? [:], learning = value["learning"] as? [String: Any] ?? [:]
        let count: (String) -> Int = { (learning[$0] as? [Any])?.count ?? 0 }
        let records = ["drafts", "answers", "materials", "expressions", "words", "review_events"].flatMap { learning[$0] as? [[String: Any]] ?? [] }
        let dates = records.flatMap { record in ["updatedAt", "createdAt", "reviewedAt"].compactMap { record[$0] as? String } }.sorted()
        let latest = dates.last.map { String($0.prefix(16)).replacingOccurrences(of: "T", with: " ") + " UTC" } ?? "尚无积累"
        return "\((bank["questions"] as? [Any])?.count ?? 0) 题 · \(count("drafts")) 草稿 · \(count("answers")) 答案 · \(count("materials")) 素材 · \(count("expressions")) 语料 · \(count("words")) 单词 · \(count("review_events")) 次背诵\n最近积累：\(latest)"
    }
    func refreshLocalSummary() async {
        do { localSummary = summary(try await LocalPersistence().read() as? [String: Any] ?? [:]) }
        catch { localSummary = "无法读取手机进度，请保留数据后重试。" }
    }
    func refreshRemoteSummary() async {
        guard credential != nil else { return }
        do { remoteSummary = summary(try await pullBackup()) }
        catch { remoteSummary = message(error) }
    }
    func pullBackup() async throws -> [String: Any] {
        guard let client else { throw NativeFailure("请先配对 Mac；配对仅用于可选同步。", status: 401) }
        return try await client.backup()
    }
    func pushBackup(_ value: [String: Any]) async throws -> [String: Any] {
        guard let client else { throw NativeFailure("请先配对 Mac。", status: 401) }
        return try await client.replaceBackup(value)
    }
    func requestSync(_ direction: String) {
        guard !busy, let syncProgress else { return }
        guard learningReady else { notice = "本地学习库仍在准备，请稍后再同步。"; return }
        let run = UUID().uuidString; syncRun = run
        busy = true; notice = "正在保存草稿并同步进度…"; syncProgress(direction, run)
    }
    func localPageWillReload() {
        learningReady = false
        if syncRun != nil { syncRun = nil; busy = false; notice = "本地页面已重载。请重新读取两端进度，再确认是否需要同步；系统不会自动重发。" }
    }
    func finishSync(_ run: String?, message: String) -> Bool {
        guard let run, run == syncRun else { return false }
        syncRun = nil; busy = false; notice = String(message.prefix(800)); return true
    }
    func download(_ url: URL) async {
        guard let client else { return }
        let ticket = generation
        do { let file = try await client.download(url); if ticket == generation { export = SharedExport(url: file) } }
        catch { if ticket == generation { notice = message(error) } }
    }

    func saveBlob(base64: String, filename: String) {
        guard base64.utf8.count <= 70 * 1024 * 1024, let data = Data(base64Encoded: base64) else {
            notice = "下载内容无效或过大，未保存。"; return
        }
        do { export = SharedExport(url: try ExportFile.write(data, filename: filename)) }
        catch { notice = message(error) }
    }

    func webFailed(_ error: Error) { state = .offline; notice = message(error) }
    func message(_ error: Error) -> String {
        if let error = error as? NativeFailure { return error.message }
        if let error = error as? MobileError { return error.localizedDescription }
        if (error as NSError).domain == "YasyPairing" { return error.localizedDescription }
        if let urlError = error as? URLError,
           [.serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot,
            .serverCertificateNotYetValid, .secureConnectionFailed, .cancelled].contains(urlError.code) {
            return MobileError.certificateMismatch.localizedDescription
        }
        return MobileError.disconnected.localizedDescription
    }
}
