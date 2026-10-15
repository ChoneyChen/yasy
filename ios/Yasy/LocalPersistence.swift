import Foundation

struct NativeFailure: LocalizedError {
    let message: String
    let status: Int
    init(_ message: String, status: Int = 400) { self.message = message; self.status = status }
    var errorDescription: String? { message }
}

actor LocalPersistence {
    private let directory: URL
    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Yasy", isDirectory: true)
    }
    private func file(_ name: String) -> URL { directory.appendingPathComponent(name) }
    private func prepare() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.protectionKey: FileProtectionType.complete])
    }
    private func read(_ url: URL) throws -> Any? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do { return try JSONSerialization.jsonObject(with: Data(contentsOf: url)) }
        catch { throw NativeFailure("手机学习数据无法读取。请保留当前数据并从备份恢复。", status: 500) }
    }
    func read() throws -> Any? { try read(file("learning.json")) }
    func previous() throws -> Any? {
        try read(file("before-restore.json")) ?? read(file("previous.json"))
    }
    func write(_ value: Any, restoring: Bool = false) throws {
        guard value is [String: Any], JSONSerialization.isValidJSONObject(value) else {
            throw NativeFailure("学习备份必须为完整 JSON 对象。")
        }
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        guard data.count <= 50 * 1024 * 1024 else { throw NativeFailure("本机学习备份超过 50 MB，请先导出并整理资料。", status: 413) }
        try prepare()
        let current = file("learning.json")
        do {
            if FileManager.default.fileExists(atPath: current.path) {
                let old = try Data(contentsOf: current)
                // Save a usable previous copy before touching the current snapshot.
                _ = try JSONSerialization.jsonObject(with: old)
                try old.write(to: file(restoring ? "before-restore.json" : "previous.json"), options: [.atomic, .completeFileProtection])
            }
            try data.write(to: current, options: [.atomic, .completeFileProtection])
        } catch {
            throw NativeFailure("手机存储写入失败，原有学习数据已保留。请检查可用空间或解锁后重试。", status: 507)
        }
    }
}
