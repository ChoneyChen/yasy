import Foundation
import Security

private struct NativeAISecret: Codable {
    var apiKey = ""
    var model = ""
}

private enum AIKeychain {
    static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: Bundle.main.bundleIdentifier ?? "com.choney.yasy.mobile",
         kSecAttrAccount as String: "independent-ai-configuration"]
    }
    static func load() throws -> NativeAISecret {
        var request = query; request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &value)
        if status == errSecItemNotFound { return NativeAISecret() }
        guard status == errSecSuccess, let data = value as? Data,
              let secret = try? JSONDecoder().decode(NativeAISecret.self, from: data) else {
            throw NativeFailure("无法读取 iPhone API 配置，请解锁设备后重试。", status: 503)
        }
        return secret
    }
    static func save(_ secret: NativeAISecret) throws {
        let values: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(secret),
                                    kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(query.merging(values, uniquingKeysWith: { _, new in new }) as CFDictionary, nil) == errSecSuccess else {
                throw NativeFailure("无法安全保存 API 配置，请解锁设备后重试。", status: 503)
            }
        } else if status != errSecSuccess { throw NativeFailure("无法安全保存 API 配置。", status: 503) }
    }
}

private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

actor NativeAI {
    static let baseURL = "https://api.iiiapi.com/v1"
    private let session: URLSession
    init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.urlCredentialStorage = nil; config.waitsForConnectivity = false
        config.timeoutIntervalForRequest = 180; config.timeoutIntervalForResource = 200
        session = URLSession(configuration: config, delegate: NoRedirectDelegate(), delegateQueue: nil)
    }
    func config() throws -> [String: Any] { publicConfig(try AIKeychain.load()) }
    private func publicConfig(_ secret: NativeAISecret) -> [String: Any] {
        ["provider": "iiiapi", "baseUrl": Self.baseURL, "hasKey": !secret.apiKey.isEmpty,
         "model": secret.model, "configured": !secret.apiKey.isEmpty && !secret.model.isEmpty]
    }
    func update(_ input: [String: Any]) throws -> [String: Any] {
        var secret = try AIKeychain.load()
        if let key = input["apiKey"] as? String, !key.isEmpty {
            guard key.range(of: "^[A-Za-z0-9_.-]{10,512}$", options: .regularExpression) != nil else {
                throw NativeFailure("API key 格式无效。")
            }
            secret.apiKey = key
        }
        if let model = input["model"] as? String {
            guard model.count <= 200, !model.contains("\n"), !model.contains("\r") else { throw NativeFailure("模型 ID 无效。") }
            secret.model = model.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard secret.apiKey.isEmpty || !secret.model.contains(secret.apiKey) else { throw NativeFailure("模型 ID 不能包含认证信息。") }
        try AIKeychain.save(secret)
        return publicConfig(secret)
    }
    private func redact(_ text: String, credential: String) -> String {
        var result = text
        let current = (try? AIKeychain.load())?.apiKey ?? ""
        for key in Set([credential, current]).filter({ !$0.isEmpty }) { result = result.replacingOccurrences(of: key, with: "[redacted]") }
        return String(result.replacingOccurrences(of: "sk-[A-Za-z0-9_.-]{8,}", with: "[redacted]", options: .regularExpression).prefix(1200))
    }
    private func request(_ path: String, body: [String: Any]? = nil, timeout: TimeInterval) async throws -> [String: Any] {
        let secret = try AIKeychain.load()
        guard !secret.apiKey.isEmpty else { throw NativeFailure("请先在 iPhone 偏好中配置自己的 iiiapi API key。", status: 503) }
        var request = URLRequest(url: URL(string: Self.baseURL + path)!)
        request.timeoutInterval = timeout; request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("Bearer \(secret.apiKey)", forHTTPHeaderField: "Authorization")
        if var body {
            guard !secret.model.isEmpty else { throw NativeFailure("请先选择处理模型。", status: 503) }
            if let requested = body["model"] as? String, requested != secret.model { throw NativeFailure("模型设置已改变，请刷新后重新生成。", status: 409) }
            body["model"] = secret.model; body["stream"] = false
            let data = try JSONSerialization.data(withJSONObject: body)
            guard data.count <= 5 * 1024 * 1024 else { throw NativeFailure("AI 请求内容过大，请分批处理。", status: 413) }
            request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = data
        }
        do {
            let (data, response) = try await session.data(for: request)
            guard data.count <= 8 * 1024 * 1024, let response = response as? HTTPURLResponse,
                  response.url?.scheme == "https", response.url?.host == "api.iiiapi.com" else {
                throw NativeFailure("API 返回内容过大或来源无效。", status: 502)
            }
            guard let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw NativeFailure("模型服务未返回完整 JSON，请重试或更换模型。", status: 502)
            }
            guard (200...299).contains(response.statusCode) else {
                let message = (result["error"] as? [String: Any])?["message"] as? String ?? result["message"] as? String ?? "HTTP \(response.statusCode)"
                throw NativeFailure("iiiapi 请求失败：\(redact(message, credential: secret.apiKey))", status: response.statusCode == 429 ? 429 : 502)
            }
            let serialized = String(data: try JSONSerialization.data(withJSONObject: result), encoding: .utf8) ?? ""
            let current = (try? AIKeychain.load())?.apiKey ?? ""
            guard ![secret.apiKey, current].filter({ !$0.isEmpty }).contains(where: serialized.contains) else {
                throw NativeFailure("API 返回了不应出现的认证信息，结果未保存。", status: 502)
            }
            return result
        } catch let failure as NativeFailure { throw failure }
        catch let error as URLError where error.code == .timedOut || error.code == .cancelled {
            throw NativeFailure("API 请求超时或已中断，未自动重试。请检查任务后手动重试。", status: 504)
        } catch { throw NativeFailure("无法连接 iiiapi。请检查互联网连接后重试，现有学习数据仍保存在 iPhone。", status: 502) }
    }
    func models() async throws -> [String: Any] {
        let result = try await request("/models", timeout: 20)
        guard let data = result["data"] as? [[String: Any]] else { throw NativeFailure("模型列表格式无效。", status: 502) }
        var seen = Set<String>()
        let models = data.compactMap { item -> [String: Any]? in
            guard let id = item["id"] as? String, !id.isEmpty, id.count <= 200, seen.insert(id).inserted else { return nil }
            var value: [String: Any] = ["id": id]
            if let owner = item["owned_by"] as? String { value["owned_by"] = String(owner.prefix(200)) }
            return value
        }.sorted { ($0["id"] as? String ?? "") < ($1["id"] as? String ?? "") }
        return ["models": models, "selectedModel": try AIKeychain.load().model]
    }
    func completions(_ body: [String: Any]) async throws -> [String: Any] {
        guard let messages = body["messages"] as? [[String: Any]], !messages.isEmpty, messages.count <= 64 else { throw NativeFailure("AI 对话请求无效。") }
        return try await request("/chat/completions", body: body, timeout: 180)
    }
}
