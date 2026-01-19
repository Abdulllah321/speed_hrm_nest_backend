export type NotificationStatus = 'unread' | 'read';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export type NotificationChannel = 'inApp' | 'email' | 'sms';

export interface NotificationPreferences {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  disabledCategories: Set<string>;
  minPriority: NotificationPriority;
}

export interface CreateNotificationInput {
  userId: string;
  title: string;
  message: string;
  category?: string;
  priority?: NotificationPriority;
  actionType?: string | null;
  actionPayload?: any;
  entityType?: string | null;
  entityId?: string | null;
  channels?: NotificationChannel[];
}
