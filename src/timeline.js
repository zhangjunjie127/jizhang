export function mergeMessages(current, incoming) {
  const byId = new Map(current.filter(message => !message.id.startsWith('sending-')).map(message => [message.id, message]));
  for (const message of incoming) {
    const previous = byId.get(message.id);
    if (!previous || (message.revision || 0) >= (previous.revision || 0)) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
}
