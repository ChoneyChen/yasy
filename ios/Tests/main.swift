import Foundation
import Security

var checks = 0
func expect(_ value: @autoclosure () -> Bool, _ label: String) {
    checks += 1
    guard value() else { fatalError("Failed: \(label)") }
}
func rejects(_ link: String) { checks += 1; do { _ = try PairingPayload(link: link); fatalError("Invalid pairing link accepted") } catch {} }
let fingerprint = String(repeating: "a", count: 64)
func link(_ url: String = "https://192.168.1.2:4319", fingerprint: String = fingerprint, code: String = "123456") -> String {
    var result = URLComponents(string: "yasy://pair")!
    result.queryItems = [.init(name: "url", value: url), .init(name: "fingerprint", value: fingerprint), .init(name: "code", value: code)]
    return result.url!.absoluteString
}
let payload = try PairingPayload(link: link())
expect(payload.baseURL.host == "192.168.1.2", "private endpoint")
expect(payload.code == "123456", "exact code")
for url in ["http://192.168.1.2:4319", "https://8.8.8.8:4319", "https://example.com:4319", "https://192.168.1.2:443", "https://user:pass@192.168.1.2:4319", "https://192.168.1.2:4319/other", "https://192.168.1.2:4319?token=x", "https://192.168.001.2:4319", "https://127.0.0.1:4319", "https://169.254.1.2:4319", "https://[fd00::1]:4319", "https://[fe80::1]:4319", "https://[::1]:4319"] { rejects(link(url)) }
rejects(link(fingerprint: "bad")); rejects(link(code: "12345")); rejects(link() + "&code=000000")
expect(ServerOrigin.matches(URL(string: "https://192.168.1.2:4319/api/state")!, base: payload.baseURL), "same origin")
expect(!ServerOrigin.matches(URL(string: "https://192.168.1.3:4319/api/state")!, base: payload.baseURL), "other host")
expect(!ServerOrigin.matches(URL(string: "https://user@192.168.1.2:4319/api/state")!, base: payload.baseURL), "URL credentials")
let credential = DeviceCredential(baseURL: payload.baseURL, fingerprint: fingerprint, token: String(repeating: "a", count: 43), deviceId: "device-test", expiresAt: "2099-01-01T00:00:00.000Z")
expect(credential.isValid, "credential contract")
expect(!DeviceCredential(baseURL: payload.baseURL, fingerprint: fingerprint, token: "short", deviceId: "device-test", expiresAt: credential.expiresAt).isValid, "invalid token")

final class TestSpace: URLProtectionSpace, @unchecked Sendable {
    let trust: SecTrust
    init(host: String, trust: SecTrust) { self.trust = trust; super.init(host: host, port: 4319, protocol: "https", realm: nil, authenticationMethod: NSURLAuthenticationMethodServerTrust) }
    required init?(coder: NSCoder) { fatalError("not used") }
    override var serverTrust: SecTrust? { trust }
}
final class Sender: NSObject, URLAuthenticationChallengeSender {
    func use(_ credential: URLCredential, for challenge: URLAuthenticationChallenge) {}
    func continueWithoutCredential(for challenge: URLAuthenticationChallenge) {}
    func cancel(_ challenge: URLAuthenticationChallenge) {}
    func performDefaultHandling(for challenge: URLAuthenticationChallenge) {}
    func rejectProtectionSpaceAndContinue(with challenge: URLAuthenticationChallenge) {}
}
let root = CommandLine.arguments[1]
let der = try Data(contentsOf: URL(fileURLWithPath: root + "/cert.der"))
let pin = try String(contentsOfFile: root + "/fingerprint.txt", encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
let certificate = SecCertificateCreateWithData(nil, der as CFData)!
func challenge(_ host: String) -> URLAuthenticationChallenge {
    var trust: SecTrust?
    SecTrustCreateWithCertificates(certificate, SecPolicyCreateSSL(true, host as CFString), &trust)
    return URLAuthenticationChallenge(protectionSpace: TestSpace(host: host, trust: trust!), proposedCredential: nil, previousFailureCount: 0, failureResponse: nil, error: nil, sender: Sender())
}
let base = URL(string: "https://192.168.99.1:4319")!
expect(CertificatePin.accept(challenge("192.168.99.1"), baseURL: base, fingerprint: pin), "paired certificate with matching hostname and validity")
expect(!CertificatePin.accept(challenge("192.168.99.1"), baseURL: base, fingerprint: fingerprint), "wrong fingerprint")
let wrongHost = URL(string: "https://192.168.99.2:4319")!
expect(!CertificatePin.accept(challenge("192.168.99.2"), baseURL: wrongHost, fingerprint: pin), "correct pin cannot override invalid hostname")
expect(!CertificatePin.accept(challenge("192.168.99.1"), baseURL: wrongHost, fingerprint: pin), "challenge must target paired host")
let cookies = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": "yasy_device=\(credential.token); Path=/; HttpOnly; Secure; SameSite=Strict; Expires=Thu, 01 Jan 2099 00:00:00 GMT"], for: payload.baseURL)
expect(cookies.first?.isHTTPOnly == true && cookies.first?.isSecure == true, "WebKit session cookie is secure and HTTP-only")
print("Native pairing and TLS pin checks passed: \(checks)")
