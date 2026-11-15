import AppKit
import ApplicationServices
import AVFoundation
import Speech
import CryptoKit

func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) { print(text); fflush(stdout) }
}
func error(_ message: String) -> Never { emit(["error": message]); exit(1) }
let data = FileHandle.standardInput.readDataToEndOfFile()
guard let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let operation = request["operation"] as? String else { error("Invalid native request.") }

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?; return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func text(_ element: AXUIElement, _ name: String) -> String { String((attribute(element, name) as? String ?? "").prefix(4000)) }
func valueHash(_ element: AXUIElement) -> String { SHA256.hash(data: Data((attribute(element, kAXValueAttribute) as? String ?? "").utf8)).map { String(format: "%02x", $0) }.joined() }
func children(_ element: AXUIElement) -> [AXUIElement] { (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }
func interactiveSession() -> Bool {
    guard let session = CGSessionCopyCurrentDictionary() as? [String:Any] else { return false }
    return session["kCGSSessionOnConsoleKey"] as? Bool == true && session["kCGSessionLoginDoneKey"] as? Bool == true && session["CGSSessionScreenIsLocked"] as? Bool != true
}
func requireUnlocked() { guard interactiveSession() else { error("Unlock and activate this Mac before using native controls or dictation.") } }
func appElement() -> AXUIElement {
    requireUnlocked()
    guard AXIsProcessTrusted() else { error("Allow Frondose Accessibility access in System Settings first.") }
    guard let pid = request["pid"] as? Int32, let app = NSRunningApplication(processIdentifier: pid), app.bundleIdentifier == request["bundleId"] as? String else { error("The selected app identity changed.") }
    guard app.bundleIdentifier != Bundle.main.bundleIdentifier, pid != ProcessInfo.processInfo.processIdentifier else { error("Choose another application.") }
    let element = AXUIElementCreateApplication(pid); AXUIElementSetMessagingTimeout(element, 2); return element
}
switch operation {
case "permissions":
    emit(["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess(), "interactiveSession":interactiveSession(), "screenLocked":!interactiveSession()])
case "requestAccessibility":
    requireUnlocked()
    emit(["accessibility": AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)])
case "apps":
    emit(["apps": NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular && $0.bundleIdentifier != nil }.prefix(100).map { ["pid": $0.processIdentifier, "bundleId": $0.bundleIdentifier!, "name": $0.localizedName ?? $0.bundleIdentifier!] as [String: Any] }])
case "snapshot":
    let app = appElement(); var rows = [[String: Any]](), visited = [AXUIElement]()
    func walk(_ element: AXUIElement, _ path: [Int], _ depth: Int, _ parentWindow: String) {
        if rows.count >= 300 || depth > 12 { return }
        // Accessibility is a graph, not necessarily a tree. Menus can point
        // back to the application; never spend the bounded snapshot on cycles.
        if visited.contains(where: { CFEqual($0, element) }) { return }
        visited.append(element)
        let role = text(element, kAXRoleAttribute), subrole = text(element, kAXSubroleAttribute)
        let sensitive = subrole == kAXSecureTextFieldSubrole || role == "AXSecureTextField"
        let window = role == kAXWindowRole ? text(element, kAXTitleAttribute) : parentWindow
        var actions: CFArray?; AXUIElementCopyActionNames(element, &actions)
        var settable: DarwinBoolean = false; AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
        rows.append(["path": path, "role": role, "title": text(element, kAXTitleAttribute), "windowTitle":window, "valueHash":sensitive ? "" : valueHash(element), "value": sensitive ? "[Private input]" : text(element, kAXValueAttribute), "press": (actions as? [String] ?? []).contains(kAXPressAction), "editable": settable.boolValue && !sensitive, "scroll": (actions as? [String] ?? []).filter { ["AXScrollUpByPage", "AXScrollDownByPage"].contains($0) }])
        if !sensitive {
            let nodes = Array(children(element).prefix(100).enumerated()).sorted {
                let left = text($0.element, kAXRoleAttribute) == kAXWindowRole
                let right = text($1.element, kAXRoleAttribute) == kAXWindowRole
                return left == right ? $0.offset < $1.offset : left
            }
            for (i, child) in nodes { walk(child, path + [i], depth + 1, window) }
        }
    }
    // App windows are a separate AXWindows collection on some applications;
    // they are not guaranteed to appear in AXChildren. The private -1 prefix
    // identifies this root while retaining each original child index.
    let appWindows = attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
    for (index, window) in appWindows.prefix(20).enumerated() { walk(window, [-1,index], 2, "") }
    walk(app, [], 0, "")
    let windows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []).filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == request["pid"] as? Int32 && ($0[kCGWindowLayer as String] as? Int) == 0 }.map { ["id": $0[kCGWindowNumber as String] ?? 0, "title": $0[kCGWindowName as String] ?? "Window"] }
    emit(["elements": rows, "windows": windows])
case "screenshot":
    _ = appElement()
    guard CGPreflightScreenCaptureAccess() else { error("Allow Frondose Screen Recording access in System Settings before capturing a window.") }
    guard let window = request["windowId"] as? Int else { error("Choose a window from a fresh snapshot.") }
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    guard windows.contains(where: { ($0[kCGWindowNumber as String] as? Int) == window && ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == request["pid"] as? Int32 }) else { error("The selected window changed.") }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("frondose-capture-" + UUID().uuidString)
    do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]) } catch { emit(["error": "Private capture storage could not be created."]); exit(1) }
    defer { try? FileManager.default.removeItem(at: directory) }
    let path = directory.appendingPathComponent("window.png"), process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture"); process.arguments = ["-x", "-l", String(window), path.path]; process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
    do { try process.run(); process.waitUntilExit(); guard process.terminationStatus == 0, let bytes = try? Data(contentsOf: path), bytes.count <= 12000000 else { error("The selected window could not be captured.") }; emit(["base64": bytes.base64EncodedString(), "mime": "image/png"]) } catch { emit(["error": "Window capture could not start."]); exit(1) }
case "press", "setValue", "scroll":
    var element = appElement()
    guard var path = request["path"] as? [Int], path.count <= 12 else { error("Invalid element path.") }
    var window = ""
    if path.first == -1 {
        let windows = attribute(element, kAXWindowsAttribute) as? [AXUIElement] ?? []
        guard path.count >= 2, path[1] >= 0, path[1] < windows.count else { error("The selected window changed. Refresh the snapshot.") }
        element = windows[path[1]]; window = text(element,kAXTitleAttribute); path = Array(path.dropFirst(2))
    }
    for index in path { let values = children(element); guard index >= 0 && index < values.count else { error("The element changed. Refresh the snapshot.") }; element = values[index]; if text(element,kAXRoleAttribute) == kAXWindowRole { window = text(element,kAXTitleAttribute) } }
    guard window == request["expectedWindow"] as? String else { error("The selected window changed. Refresh the snapshot.") }
    guard text(element, kAXRoleAttribute) == request["role"] as? String, text(element, kAXTitleAttribute) == request["title"] as? String else { error("The element changed. Refresh the snapshot.") }
    var result: AXError
    if operation == "press" { result = AXUIElementPerformAction(element, kAXPressAction as CFString) }
    else if operation == "scroll" {
        let action = request["direction"] as? String == "up" ? "AXScrollUpByPage" : "AXScrollDownByPage"
        result = AXUIElementPerformAction(element, action as CFString)
    }
    else {
        guard text(element, kAXSubroleAttribute) != kAXSecureTextFieldSubrole, let value = request["text"] as? String, value.count <= 20000 else { error("Private or invalid input cannot be changed.") }
        guard valueHash(element) == request["expectedValueHash"] as? String else { error("The field changed after review. Refresh its snapshot.") }
        result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFString)
    }
    guard result == .success else { error("The selected control does not support this action.") }; emit(["acted": true])
case "dictate":
    requireUnlocked()
    let locale = request["locale"] as? String ?? "en-US"
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)), recognizer.supportsOnDeviceRecognition else { error("On-device speech recognition is not available for this language. Install the language in macOS or choose another language.") }
    let engine = AVAudioEngine(), recognition = SFSpeechAudioBufferRecognitionRequest()
    recognition.requiresOnDeviceRecognition = true; recognition.shouldReportPartialResults = true
    var task: SFSpeechRecognitionTask?
    SFSpeechRecognizer.requestAuthorization { status in
        guard status == .authorized else { error("Speech recognition permission was denied.") }
        AVCaptureDevice.requestAccess(for: .audio) { allowed in
            guard allowed else { error("Microphone permission was denied.") }
            DispatchQueue.main.async {
                let input = engine.inputNode, format = input.outputFormat(forBus: 0)
                guard format.sampleRate > 0, format.channelCount > 0 else { error("No usable microphone is available.") }
                input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in recognition.append(buffer) }
                engine.prepare()
                do { try engine.start() } catch let failure { emit(["error": failure.localizedDescription]); exit(1) }
                emit(["ready": true])
                task = recognizer.recognitionTask(with: recognition) { result, failure in
                    if let result = result { emit(["text": result.bestTranscription.formattedString, "final": result.isFinal]); if result.isFinal { engine.stop(); exit(0) } }
                    if let failure = failure { engine.stop(); error(failure.localizedDescription) }
                }
            }
        }
    }
    let lockWatch = Timer.scheduledTimer(withTimeInterval:1,repeats:true) { _ in
        if !interactiveSession() { engine.stop(); recognition.endAudio(); task?.cancel(); error("Dictation stopped because this Mac locked or its interactive session ended.") }
    }
    RunLoop.main.run(); _ = task; _ = lockWatch
default: error("Unsupported native operation.")
}
