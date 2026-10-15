import SwiftUI
import AVFoundation
import UIKit

struct QRScanner: UIViewControllerRepresentable {
    let receive: (String) -> Void
    func makeUIViewController(context: Context) -> ScannerController { ScannerController(receive: receive) }
    func updateUIViewController(_ controller: ScannerController, context: Context) {}
}
final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "yasy.camera")
    private let receive: (String) -> Void
    private var preview: AVCaptureVideoPreviewLayer?
    private var delivered = false
    init(receive: @escaping (String) -> Void) { self.receive = receive; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("Use init(receive:)") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .black
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: prepare()
        case .notDetermined: AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in DispatchQueue.main.async { allowed ? self?.prepare() : self?.explain() } }
        default: explain()
        }
    }
    private func explain() {
        let label = UILabel(); label.text = "未获得相机权限。可以返回并粘贴 Mac 的配对链接。"; label.textColor = .white; label.numberOfLines = 0; label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(label)
        NSLayoutConstraint.activate([label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 30), label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -30), label.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
    }
    private func prepare() {
        guard let camera = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: camera), session.canAddInput(input) else { explain(); return }
        session.addInput(input)
        let output = AVCaptureMetadataOutput(); guard session.canAddOutput(output) else { explain(); return }
        session.addOutput(output); output.setMetadataObjectsDelegate(self, queue: .main); output.metadataObjectTypes = [.qr]
        let layer = AVCaptureVideoPreviewLayer(session: session); layer.videoGravity = .resizeAspectFill; view.layer.addSublayer(layer); preview = layer
        queue.async { [session] in session.startRunning() }
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); preview?.frame = view.bounds }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); queue.async { [session] in session.stopRunning() } }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !delivered, let code = metadataObjects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first(where: { $0.hasPrefix("yasy://pair?") }) else { return }
        delivered = true; receive(code)
    }
}
