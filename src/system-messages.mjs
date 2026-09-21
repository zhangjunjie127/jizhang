export function systemMessages(feedback, application) {
  const items = feedback.map(item => ({
    id: `feedback:${item.id}`,
    title: '意见反馈已提交',
    text: `已收到你提交的${item.category}：${item.content}`,
    created: item.created,
  }));
  if (application) {
    items.push({ id: `deletion:${application.id}:pending`, title: '注销申请已提交', text: '申请正在等待审核，账号尚未注销。', created: application.created });
    const statuses = {
      cancelled: ['注销申请已撤回', '你的账号将继续保留。'],
      rejected: ['注销申请未通过', application.reason || '请联系内测管理员了解详情。'],
    };
    if (statuses[application.status] && application.reviewed_at) {
      const [title, text] = statuses[application.status];
      items.push({ id: `deletion:${application.id}:${application.status}`, title, text, created: application.reviewed_at });
    }
  }
  return items.sort((a, b) => Date.parse(b.created) - Date.parse(a.created) || a.id.localeCompare(b.id));
}
