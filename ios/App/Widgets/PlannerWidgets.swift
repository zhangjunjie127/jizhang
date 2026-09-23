import SwiftUI
import WidgetKit

struct WidgetRow: Decodable {
    let title: String
    let detail: String
    let start: Double
    let end: Double
}
struct WidgetContent: Decodable {
    let enabled: Bool
    let message: String
    let rows: [WidgetRow]
}
struct Snapshot: Decodable {
    let updated: Double
    let expires: Double
    let layout: String?
    let tasks: WidgetContent
    let courses: WidgetContent
    let hidden: Bool
    enum CodingKeys: String, CodingKey { case updated, expires, layout, tasks, courses; case hidden = "private" }
}
struct Entry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
}
struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: Date(), snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: Date(), snapshot: read()))
    }
    private func read() -> Snapshot? {
        guard let data = UserDefaults(suiteName: "group.cn.zaizai.companion")?.data(forKey: "snapshot") else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let snapshot = read()
        let now = Date()
        var dates = [now]
        // Precompute course transitions and expiry, even when the app is not running.
        if let snapshot {
            dates += snapshot.courses.rows.map { Date(timeIntervalSince1970: $0.end / 1000) }
                .filter { $0 > now && $0.timeIntervalSince1970 * 1000 <= snapshot.expires }
            let expiry = Date(timeIntervalSince1970: snapshot.expires / 1000)
            if expiry > now { dates.append(expiry) }
        }
        let entries = Array(Set(dates)).sorted().map { Entry(date: $0, snapshot: snapshot) }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(1800))))
    }
}
struct PlannerWidgetView: View {
    let entry: Entry
    let kind: String
    @Environment(\.widgetFamily) private var family
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label((kind == "tasks" ? "在在 · 待办" : "在在 · 课程提醒") + " · " + layoutLabel, systemImage: kind == "tasks" ? "checklist" : "calendar")
                .font(.headline).foregroundStyle(.blue)
            if let snapshot = entry.snapshot {
                let content = kind == "tasks" ? snapshot.tasks : snapshot.courses
                if !content.enabled { Text("请在应用中启用组件").font(.caption) }
                else if snapshot.expires <= entry.date.timeIntervalSince1970 * 1000 { Text("数据已过期，请打开应用刷新").font(.caption) }
                else if snapshot.hidden { Text("内容已隐藏，打开应用查看").font(.caption) }
                else {
                    let rows = content.rows.filter { $0.end == 0 || $0.end > entry.date.timeIntervalSince1970 * 1000 }
                    if rows.isEmpty { Text(content.message).font(.caption) }
                    ForEach(Array(rows.prefix(family == .systemSmall ? 1 : 3).enumerated()), id: \.offset) { _, row in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text(row.detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
                Spacer(minLength: 0)
                Text("同步于 \(Date(timeIntervalSince1970: snapshot.updated / 1000), style: .time)")
                    .font(.caption2).foregroundStyle(.secondary)
            } else {
                Text("打开在在，启用桌面小组件").font(.caption)
                Spacer()
            }
        }
        .containerBackground(.background, for: .widget)
        .widgetURL(URL(string: "zaizai://widget/\(kind)"))
        .privacySensitive()
    }
    private var layoutLabel: String {
        switch entry.snapshot?.layout ?? "list" {
        case "week": return "7天视图"
        case "month": return "月历和日程"
        default: return "日程列表"
        }
    }
}
struct TaskWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ZaizaiTasks", provider: Provider()) { PlannerWidgetView(entry: $0, kind: "tasks") }
            .configurationDisplayName("待办").description("查看未完成事项")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
struct CourseWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ZaizaiCourses", provider: Provider()) { PlannerWidgetView(entry: $0, kind: "courses") }
            .configurationDisplayName("课程提醒").description("查看我的授课安排")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
@main struct ZaizaiWidgetBundle: WidgetBundle {
    var body: some Widget { TaskWidget(); CourseWidget() }
}
