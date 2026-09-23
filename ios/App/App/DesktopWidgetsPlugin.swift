import Capacitor
import WidgetKit

@objc(DesktopWidgetsPlugin)
public class DesktopWidgetsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DesktopWidgetsPlugin"
    public let jsName = "DesktopWidgets"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLaunchTarget", returnType: CAPPluginReturnPromise)
    ]
    static var pendingTarget = ""
    private let group = "group.cn.zaizai.companion"
    @objc func sync(_ call: CAPPluginCall) {
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil,
              let preferences = UserDefaults(suiteName: group) else {
            call.reject("App Group is not configured"); return
        }
        guard let snapshot = call.getObject("snapshot"),
              let data = try? JSONSerialization.data(withJSONObject: snapshot),
              data.count < 100000 else { call.reject("Invalid widget data"); return }
        preferences.set(data, forKey: "snapshot")
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
        call.resolve()
    }
    @objc func clear(_ call: CAPPluginCall) {
        UserDefaults(suiteName: group)?.removeObject(forKey: "snapshot")
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
        call.resolve()
    }
    @objc func getLaunchTarget(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["target": Self.pendingTarget])
            Self.pendingTarget = ""
        }
    }
}

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DesktopWidgetsPlugin())
    }
}
