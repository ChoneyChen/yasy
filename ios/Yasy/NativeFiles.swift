import Foundation
import PDFKit
import UIKit
import WebKit
import UniformTypeIdentifiers

enum LocalAppOrigin {
    static let home = URL(string: "yasy-local://app/?client=ios&local=1")!
    static func matches(_ url: URL) -> Bool {
        url.scheme == "yasy-local" && url.host == "app" && url.port == nil && url.user == nil && url.password == nil
    }
}

@MainActor final class LocalWebSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL
    init(root: URL? = nil) {
        self.root = root ?? Bundle.main.resourceURL!.appendingPathComponent("dist", isDirectory: true)
    }
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, LocalAppOrigin.matches(url),
              urlSchemeTask.request.httpMethod == "GET" || urlSchemeTask.request.httpMethod == "HEAD" else {
            urlSchemeTask.didFailWithError(NativeFailure("本地资源请求无效。", status: 403)); return
        }
        let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path + "/"), !path.split(separator: "/").contains(".."),
              !path.hasPrefix("api/") else {
            urlSchemeTask.didFailWithError(NativeFailure("不允许访问此本地路径。", status: 403)); return
        }
        do {
            let data = try Data(contentsOf: file)
            let ext = file.pathExtension.lowercased()
            let mime = ["html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css", "json": "application/json", "wasm": "application/wasm", "svg": "image/svg+xml"] [ext]
                ?? UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
            urlSchemeTask.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: mime.hasPrefix("text/") || ext == "json" ? "utf-8" : nil))
            if urlSchemeTask.request.httpMethod != "HEAD" { urlSchemeTask.didReceive(data) }
            urlSchemeTask.didFinish()
        } catch { urlSchemeTask.didFailWithError(NativeFailure("本地学习资源缺失，请重新构建并安装 Yasy。", status: 404)) }
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

enum NativeFileExtractor {
    static func extract(_ body: [String: Any]) throws -> [String: Any] {
        guard let filename = body["filename"] as? String, filename.count <= 300,
              let encoded = (body["fileBase64"] ?? body["base64"]) as? String,
              encoded.utf8.count <= 14 * 1024 * 1024, let data = Data(base64Encoded: encoded),
              !data.isEmpty, data.count <= 10 * 1024 * 1024 else { throw NativeFailure("导入文件无效或超过 10 MB。", status: 413) }
        let ext = URL(fileURLWithPath: filename).pathExtension.lowercased()
        if ext == "pdf" {
            guard data.starts(with: Data("%PDF-".utf8)), let document = PDFDocument(data: data), !document.isLocked else {
                throw NativeFailure("PDF 无法读取或有密码保护，请导出可读取的版本。", status: 422)
            }
            guard document.pageCount <= 1000 else { throw NativeFailure("PDF 超过 1000 页，请先拆分文件。", status: 413) }
            var pages: [[String: Any]] = []; var warnings: [String] = []
            for index in 0..<document.pageCount {
                let text = document.page(at: index)?.string ?? ""
                pages.append(["page": index + 1, "sourcePage": index + 1, "text": text])
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { warnings.append("第 \(index + 1) 页没有可提取文本，可能为扫描图或图表，请补充可读资料。") }
            }
            let text = pages.compactMap { $0["text"] as? String }.joined(separator: "\n\n")
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw NativeFailure("此 PDF 没有可提取文字。请先进行 OCR，或导入可复制文字的 PDF/DOCX；系统不会虚造题目或图表。", status: 422)
            }
            return ["format": "pdf", "pages": pages, "pageCount": document.pageCount, "text": text, "warnings": warnings]
        }
        guard ["docx", "doc"].contains(ext) else { throw NativeFailure("仅支持 PDF、DOCX、DOC 文件。", status: 415) }
        // UIKit does not expose macOS's Word readers. DOCX is extracted locally by
        // the bundled Mammoth reader; legacy binary DOC needs explicit conversion.
        throw NativeFailure("请在 Word/Pages 中将旧版 DOC 另存为 DOCX 或可复制文字的 PDF 后导入。", status: 422)
    }
}
