// Keep the existing channel so pending reminders and the user's system settings survive upgrades.
export const REMINDER_CHANNEL_ID = 'default';

export function withReminderChannel(notifications) {
  return notifications.map(({ sound, ...notification }) => ({
    ...notification, channelId: REMINDER_CHANNEL_ID,
  }));
}
