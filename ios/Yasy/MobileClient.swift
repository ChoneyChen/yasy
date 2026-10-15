import Foundation
import UIKit

struct PairResponse: Decodable { let token: String; let deviceId: String; let expiresAt: String }
struct SessionResponse: Decodable { let ok: Bool; let expiresAt: String }

final class MobileClient {
    let baseURL: URL
    private let session: URLSession
    private let token: String?

    init(baseURL: URL, fingerprint: String, token: String? = nil) {
        self.baseURL = baseURL
        self.token = token
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.timeoutIntervalForRequest = 18
        configuration.timeoutIntervalForResource = 60
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration,
                             delegate: PinnedSessionDelegate(baseURL: baseURL, fingerprint: fingerprint), delegateQueue: nil)
    }

    deinit { session.invalidateAndCancel() }

    private func request(url: URL, method: String = "GET", body: Data? = nil) async throws -> (Data, HTTPURLResponse) {
        guard ServerOrigin.matches(url, base: baseURL) else { throw MobileError.publicAddress }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, response.url.map({ ServerOrigin.matches($0, base: baseURL) }) == true else { throw MobileError.invalidResponse }
        if response.statusCode == 401 && token != nil { throw MobileError.authenticationExpired }
        guard (200...299).contains(response.statusCode) else {
            if method == "POST", let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let message = object["error"] as? String {
                throw NSError(domain: "YasyPairing", code: response.statusCode, userInfo: [NSLocalizedDescriptionKey: String(message.prefix(300))])
            }
            throw MobileError.disconnected
        }
        return (data, response)
    }

    func pair(code: String, deviceName: String) async throws -> PairResponse {
        let body = try JSONEncoder().encode(["code": code, "deviceName": deviceName])
        let (data, _) = try await request(url: baseURL.appendingPathComponent("api/mobile/pair"), method: "POST", body: body)
        return try JSONDecoder().decode(PairResponse.self, from: data)
    }

    func checkSession() async throws -> SessionResponse {
        let (data, _) = try await request(url: baseURL.appendingPathComponent("api/mobile/session"))
        let result = try JSONDecoder().decode(SessionResponse.self, from: data)
        guard result.ok else { throw MobileError.authenticationExpired }
        return result
    }

    func backup() async throws -> [String: Any] {
        let (data, _) = try await request(url: baseURL.appendingPathComponent("api/backup"))
        guard data.count <= 50 * 1024 * 1024 else { throw NativeFailure("学习备份超过 50 MB，请先拆分资料。", status: 413) }
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any], value["format"] as? String == "yasy-backup" else { throw MobileError.invalidResponse }
        return value
    }
    func replaceBackup(_ value: [String: Any]) async throws -> [String: Any] {
        let body = try JSONSerialization.data(withJSONObject: ["backup": value])
        guard body.count <= 51 * 1024 * 1024 else { throw NativeFailure("学习备份超过 50 MB，请先拆分资料。", status: 413) }
        _ = try await request(url: baseURL.appendingPathComponent("api/backup"), method: "POST", body: body)
        return ["ok": true]
    }
    func download(_ url: URL) async throws -> URL {
        guard Self.isDownloadURL(url, baseURL: baseURL) else { throw MobileError.publicAddress }
        let (data, response) = try await request(url: url)
        guard data.count <= 20 * 1024 * 1024 else { throw MobileError.downloadTooLarge }
        return try ExportFile.write(data, filename: response.suggestedFilename ?? "yasy-export")
    }

    static func isDownloadURL(_ url: URL, baseURL: URL) -> Bool {
        guard ServerOrigin.matches(url, base: baseURL), url.query == nil, url.fragment == nil else { return false }
        let parts = url.path.split(separator: "/").map(String.init)
        if parts == ["api", "backup"] || parts == ["api", "backup", "previous"] { return true }
        return parts.count == 4 && parts[0] == "api" && ["sources", "batches"].contains(parts[1])
            && parts[2].range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil && parts[3] == "file"
    }
}

enum ExportFile {
    static func write(_ data: Data, filename: String) throws -> URL {
        guard data.count <= 50 * 1024 * 1024 else { throw NativeFailure("本机导出文件超过 50 MB，请拆分资料后导出。", status: 413) }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("yasy-exports", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.protectionKey: FileProtectionType.complete])
        let basename = URL(fileURLWithPath: filename).lastPathComponent
        let safeName = basename.replacingOccurrences(of: "[\\x00-\\x1F/:\\\\]", with: "_", options: .regularExpression)
        let url = directory.appendingPathComponent(safeName.isEmpty ? "yasy-export" : String(safeName.prefix(180)))
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }
}
