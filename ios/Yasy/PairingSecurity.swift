import Foundation
import Security
import CryptoKit

enum MobileError: LocalizedError {
    case invalidLink, publicAddress, invalidFingerprint, invalidCode, invalidResponse
    case certificateMismatch, authenticationExpired, disconnected, downloadTooLarge, keychain

    var errorDescription: String? {
        switch self {
        case .invalidLink: return "请粘贴 Mac 显示的完整 yasy://pair 配对链接。"
        case .publicAddress: return "仅支持 HTTPS 私有局域网地址与 4319 端口；真机不能连接 localhost。"
        case .invalidFingerprint: return "配对链接中的证书指纹无效，请从 Mac 重新生成。"
        case .invalidCode: return "配对码应为 6 位数字，请从 Mac 重新生成。"
        case .invalidResponse: return "Mac 返回格式不符合配对约定，请更新或重新启动服务。"
        case .certificateMismatch: return "Mac 证书与配对指纹不一致。已阻止连接，请重新核对配对链接。"
        case .authenticationExpired: return "设备授权已到期或被 Mac 撤销，请重新配对。"
        case .disconnected: return "无法连接 Mac。请确认同一局域网、Mac 已唤醒且手机连接服务已启用。"
        case .downloadTooLarge: return "此文件超过手机客户端的 20 MB 下载限制。"
        case .keychain: return "无法安全保存设备凭据，请解锁 iPhone 后重试。"
        }
    }
}

struct PairingPayload {
    let baseURL: URL
    let fingerprint: String
    let code: String

    init(link: String) throws {
        guard let components = URLComponents(string: link.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme?.lowercased() == "yasy", components.host?.lowercased() == "pair",
              components.path.isEmpty, components.fragment == nil,
              let items = components.queryItems, items.count == 3,
              Set(items.map(\.name)) == Set(["url", "fingerprint", "code"]),
              let urlText = items.first(where: { $0.name == "url" })?.value,
              let url = URL(string: urlText),
              let fingerprint = items.first(where: { $0.name == "fingerprint" })?.value,
              let code = items.first(where: { $0.name == "code" })?.value else { throw MobileError.invalidLink }
        guard ServerOrigin.isAllowed(url) else { throw MobileError.publicAddress }
        guard fingerprint.range(of: "^[0-9a-fA-F]{64}$", options: .regularExpression) != nil else { throw MobileError.invalidFingerprint }
        guard code.range(of: "^[0-9]{6}$", options: .regularExpression) != nil else { throw MobileError.invalidCode }
        self.baseURL = url
        self.fingerprint = fingerprint.lowercased()
        self.code = code
    }
}

enum ServerOrigin {
    static func host(_ url: URL) -> String {
        (url.host ?? "").lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
    }

    static func matches(_ url: URL, base: URL) -> Bool {
        url.scheme?.lowercased() == "https" && host(url) == host(base) && url.port == base.port
            && url.user == nil && url.password == nil
    }

    static func isAllowed(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", url.port == 4319,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else { return false }
        let hostname = host(url)
        #if targetEnvironment(simulator)
        if hostname == "127.0.0.1" { return true }
        #endif
        let octets = hostname.split(separator: ".", omittingEmptySubsequences: false)
        if octets.count == 4 {
            let numbers = octets.compactMap { Int($0) }
            guard numbers.count == 4, numbers.allSatisfy({ (0...255).contains($0) }),
                  zip(octets, numbers).allSatisfy({ String($0.1) == String($0.0) }) else { return false }
            return numbers[0] == 10 || (numbers[0] == 172 && (16...31).contains(numbers[1]))
                || (numbers[0] == 192 && numbers[1] == 168)
        }
        return false
    }
}

struct DeviceCredential: Codable {
    let baseURL: URL
    let fingerprint: String
    let token: String
    let deviceId: String
    let expiresAt: String

    var expiration: Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: expiresAt) ?? ISO8601DateFormatter().date(from: expiresAt)
    }

    var isValid: Bool {
        ServerOrigin.isAllowed(baseURL)
            && fingerprint.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
            && token.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil
            && !deviceId.isEmpty && (expiration ?? .distantPast) > Date()
    }
}

enum DeviceKeychain {
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: Bundle.main.bundleIdentifier ?? "com.choney.yasy.mobile",
         kSecAttrAccount as String: "paired-mac-device"]
    }

    static func load() -> DeviceCredential? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(DeviceCredential.self, from: data)
    }

    static func save(_ credential: DeviceCredential) throws {
        let data = try JSONEncoder().encode(credential)
        let values: [String: Any] = [kSecValueData as String: data,
                                   kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(query.merging(values, uniquingKeysWith: { _, new in new }) as CFDictionary, nil) == errSecSuccess else { throw MobileError.keychain }
        } else if status != errSecSuccess { throw MobileError.keychain }
    }

    static func delete() { SecItemDelete(query as CFDictionary) }
}

enum CertificatePin {
    static func accept(_ challenge: URLAuthenticationChallenge, baseURL: URL, fingerprint: String) -> Bool {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]")) == ServerOrigin.host(baseURL),
              challenge.protectionSpace.port == baseURL.port,
              let trust = challenge.protectionSpace.serverTrust,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leaf = chain.first else { return false }
        let digest = SHA256.hash(data: SecCertificateCopyData(leaf) as Data).map { String(format: "%02x", $0) }.joined()
        guard digest == fingerprint else { return false }
        // Trust only this paired leaf, and still validate TLS hostname and validity.
        SecTrustSetAnchorCertificates(trust, [leaf] as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, ServerOrigin.host(baseURL) as CFString))
        return SecTrustEvaluateWithError(trust, nil)
    }
}

final class PinnedSessionDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
    let baseURL: URL
    let fingerprint: String
    init(baseURL: URL, fingerprint: String) { self.baseURL = baseURL; self.fingerprint = fingerprint }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if CertificatePin.accept(challenge, baseURL: baseURL, fingerprint: fingerprint), let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else { completionHandler(.cancelAuthenticationChallenge, nil) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.map { ServerOrigin.matches($0, base: baseURL) } == true ? request : nil)
    }
}
