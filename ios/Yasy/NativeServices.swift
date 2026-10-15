import Foundation
import WebKit
import CryptoKit

actor LocalFiles {
    private let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Yasy/uploads", isDirectory: true)
    func put(_ body: [String: Any]) throws -> [String: Any] {
        guard let id = body["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{1,160}$", options: .regularExpression) != nil,
              let filename = body["filename"] as? String, filename.count <= 200,
              let encoded = body["base64"] as? String, encoded.count <= 14 * 1024 * 1024,
              let data = Data(base64Encoded: encoded), !data.isEmpty, data.count <= 10 * 1024 * 1024 else { throw NativeFailure("上传文件无效或超过10 MB。", status: 413) }
        let ext = URL(fileURLWithPath: filename).pathExtension.lowercased()
        guard ["pdf", "docx", "doc"].contains(ext), ext == "pdf" ? data.starts(with: Data("%PDF-".utf8)) : ext == "docx" ? data.starts(with: Data([0x50,0x4b])) : data.starts(with: Data([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])) else { throw NativeFailure("文件内容与扩展名不符。") }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        try data.write(to: directory.appendingPathComponent(id + "." + ext), options: [.atomic, .completeFileProtection])
        return ["size": data.count, "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()]
    }
    func get(_ body: [String: Any]) throws -> [String: Any] {
        guard let id = body["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{1,160}$", options: .regularExpression) != nil else { throw NativeFailure("文件记录无效。") }
        let source = body["source"] as? Bool == true
        let filename = (body["filename"] as? String) ?? "yasy-source.pdf"
        let ext = source ? "pdf" : URL(fileURLWithPath: filename).pathExtension.lowercased()
        guard ["pdf", "docx", "doc"].contains(ext) else { throw NativeFailure("文件类型无效。") }
        let file = source ? Bundle.main.resourceURL!.appendingPathComponent("dist/source-pdfs/\(id).pdf") : directory.appendingPathComponent(id + "." + ext)
        guard let data = try? Data(contentsOf: file) else { throw NativeFailure("此端没有原文件。题库与积累仍可查看；原件不随进度备份同步。", status: 404) }
        guard data.count <= 20 * 1024 * 1024 else { throw NativeFailure("文件超过20 MB，请从Mac导出。", status: 413) }
        return ["base64": data.base64EncodedString(), "filename": filename, "mime": ext == "pdf" ? "application/pdf" : "application/octet-stream"]
    }
}

@MainActor final class NativeServices {
    let storage = LocalPersistence()
    let ai = NativeAI()
    let files = LocalFiles()
    let model: ConnectionModel
    let reload: () -> Void
    init(model: ConnectionModel, reload: @escaping () -> Void) { self.model = model; self.reload = reload }
    func handle(_ action: String, body: [String: Any]) async throws -> Any {
        switch action {
        case "storage.read": return try await storage.read() ?? NSNull()
        case "storage.previous": return try await storage.previous() ?? NSNull()
        case "storage.write", "storage.restore":
            guard let value = body["value"] as? [String: Any], value["format"] as? String == "yasy-backup", value["version"] as? Int == 1,
                  value["bank"] is [String: Any], value["learning"] is [String: Any] else { throw NativeFailure("备份格式不受支持。") }
            try await storage.write(value, restoring: action == "storage.restore"); return ["ok": true]
        case "ai.config.get": return try await ai.config()
        case "ai.config.update": return try await ai.update(body)
        case "ai.models": return try await ai.models()
        case "ai.completions": return try await ai.completions(body)
        case "file.put": return try await files.put(body)
        case "file.get": return try await files.get(body)
        case "file.extract": return try NativeFileExtractor.extract(body)
        case "sync.status": return ["paired": model.credential != nil, "connected": model.state == .connected]
        case "file.export":
            guard let encoded = body["base64"] as? String, encoded.utf8.count <= 70 * 1024 * 1024,
                  let data = Data(base64Encoded: encoded), let filename = body["filename"] as? String else { throw NativeFailure("导出文件无效。") }
            model.export = SharedExport(url: try ExportFile.write(data, filename: filename)); return ["ok": true]
        case "sync.pull":
            guard body["runId"] as? String == model.syncRun, model.syncRun != nil else { throw NativeFailure("本次同步已中断，请重新确认。", status: 409) }
            return try await model.pullBackup()
        case "sync.push":
            guard body["runId"] as? String == model.syncRun, model.syncRun != nil else { throw NativeFailure("本次同步已中断，请重新确认。", status: 409) }
            guard body["confirmed"] as? Bool == true, let value = body["value"] as? [String: Any] else { throw NativeFailure("覆盖同步需要明确确认。", status: 409) }
            return try await model.pushBackup(value)
        case "sync.feedback":
            let accepted = model.finishSync(body["runId"] as? String, message: body["message"] as? String ?? "同步已完成")
            if accepted { await model.refreshLocalSummary() }
            return ["ok": accepted]
        case "ui.reload": reload(); return ["ok": true]
        default: throw NativeFailure("手机原生接口不存在。", status: 404)
        }
    }
}
