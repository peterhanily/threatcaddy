import { pgTable, text, integer, boolean, timestamp, jsonb, unique, index } from 'drizzle-orm/pg-core';

// ─── Users & Sessions ───────────────────────────────────────────

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'analyst', 'viewer'] }).notNull().default('analyst'),
  active: boolean('active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenFamily: text('token_family'),
  rotationCounter: integer('rotation_counter').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxSessionsUserId: index('idx_sessions_user_id').on(t.userId),
  idxSessionsExpiresAt: index('idx_sessions_expires_at').on(t.expiresAt),
  idxSessionsTokenFamily: index('idx_sessions_token_family').on(t.tokenFamily),
}));

// ─── Investigation Membership ───────────────────────────────────

export const investigationMembers = pgTable('investigation_members', {
  id: text('id').primaryKey(),
  folderId: text('folder_id').notNull().references(() => folders.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull().default('editor'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqFolderUser: unique('uq_folder_user').on(t.folderId, t.userId),
  idxMembersFolderId: index('idx_members_folder_id').on(t.folderId),
  idxMembersUserId: index('idx_members_user_id').on(t.userId),
}));

// ─── Entity Tables ──────────────────────────────────────────────

export const notes = pgTable('notes', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull().default(''),
  folderId: text('folder_id'),
  tags: jsonb('tags').notNull().default([]),
  pinned: boolean('pinned').notNull().default(false),
  archived: boolean('archived').notNull().default(false),
  trashed: boolean('trashed').notNull().default(false),
  trashedAt: timestamp('trashed_at', { withTimezone: true }),
  sourceUrl: text('source_url'),
  sourceTitle: text('source_title'),
  color: text('color'),
  clsLevel: text('cls_level'),
  iocAnalysis: jsonb('ioc_analysis'),
  iocTypes: jsonb('ioc_types').default([]),
  linkedNoteIds: jsonb('linked_note_ids').default([]),
  linkedTaskIds: jsonb('linked_task_ids').default([]),
  linkedTimelineEventIds: jsonb('linked_timeline_event_ids').default([]),
  annotations: jsonb('annotations').default([]),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => ({
  idxNotesFolderId: index('idx_notes_folder_id').on(t.folderId),
  idxNotesUpdatedAt: index('idx_notes_updated_at').on(t.updatedAt),
  idxNotesCreatedBy: index('idx_notes_created_by').on(t.createdBy),
  idxNotesArchived: index('idx_notes_archived').on(t.archived),
  idxNotesPinned: index('idx_notes_pinned').on(t.pinned),
  idxNotesFolderIdUpdatedAt: index('idx_notes_folder_id_updated_at').on(t.folderId, t.updatedAt),
  idxNotesTrashedArchived: index('idx_notes_trashed_archived').on(t.trashed, t.archived),
}));

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  completed: boolean('completed').notNull().default(false),
  priority: text('priority', { enum: ['none', 'low', 'medium', 'high'] }).notNull().default('none'),
  dueDate: text('due_date'),
  folderId: text('folder_id'),
  tags: jsonb('tags').notNull().default([]),
  status: text('status', { enum: ['todo', 'in-progress', 'done'] }).notNull().default('todo'),
  order: integer('order').notNull().default(0),
  clsLevel: text('cls_level'),
  iocAnalysis: jsonb('ioc_analysis'),
  iocTypes: jsonb('ioc_types').default([]),
  comments: jsonb('comments').default([]),
  linkedNoteIds: jsonb('linked_note_ids').default([]),
  linkedTaskIds: jsonb('linked_task_ids').default([]),
  linkedTimelineEventIds: jsonb('linked_timeline_event_ids').default([]),
  trashed: boolean('trashed').notNull().default(false),
  trashedAt: timestamp('trashed_at', { withTimezone: true }),
  archived: boolean('archived').notNull().default(false),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => ({
  idxTasksFolderId: index('idx_tasks_folder_id').on(t.folderId),
  idxTasksUpdatedAt: index('idx_tasks_updated_at').on(t.updatedAt),
  idxTasksAssigneeId: index('idx_tasks_assignee_id').on(t.assigneeId),
  idxTasksCreatedBy: index('idx_tasks_created_by').on(t.createdBy),
  idxTasksStatus: index('idx_tasks_status').on(t.status),
  idxTasksFolderIdUpdatedAt: index('idx_tasks_folder_id_updated_at').on(t.folderId, t.updatedAt),
  idxTasksFolderIdStatus: index('idx_tasks_folder_id_status').on(t.folderId, t.status),
  idxTasksTrashedArchived: index('idx_tasks_trashed_archived').on(t.trashed, t.archived),
}));

export const folders = pgTable('folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon'),
  color: text('color'),
  order: integer('order').notNull().default(0),
  description: text('description'),
  status: text('status', { enum: ['active', 'closed', 'archived'] }).default('active'),
  clsLevel: text('cls_level'),
  papLevel: text('pap_level'),
  tags: jsonb('tags').default([]),
  timelineId: text('timeline_id'),
  closureResolution: text('closure_resolution'),
  closedReason: text('closed_reason'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => ({
  idxFoldersUpdatedAt: index('idx_folders_updated_at').on(t.updatedAt),
  idxFoldersCreatedBy: index('idx_folders_created_by').on(t.createdBy),
}));

export const tags = pgTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => ({
  idxTagsUpdatedAt: index('idx_tags_updated_at').on(t.updatedAt),
  idxTagsCreatedBy: index('idx_tags_created_by').on(t.createdBy),
}));

export const timelineEvents = pgTable('timeline_events', {
  id: text('id').primaryKey(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  timestampEnd: timestamp('timestamp_end', { withTimezone: true }),
  title: text('title').notNull(),
  description: text('description'),
  eventType: text('event_type').notNull(),
  source: text('source').notNull().default(''),
  confidence: text('confidence', { enum: ['low', 'medium', 'high', 'confirmed'] }).notNull().default('medium'),
  linkedIOCIds: jsonb('linked_ioc_ids').notNull().default([]),
  linkedNoteIds: jsonb('linked_note_ids').notNull().default([]),
  linkedTaskIds: jsonb('linked_task_ids').notNull().default([]),
  mitreAttackIds: jsonb('mitre_attack_ids').notNull().default([]),
  actor: text('actor'),
  assets: jsonb('assets').notNull().default([]),
  tags: jsonb('tags').notNull().default([]),
  rawData: text('raw_data'),
  starred: boolean('starred').notNull().default(false),
  folderId: text('folder_id'),
  timelineId: text('timeline_id').notNull(),
  clsLevel: text('cls_level'),
  iocAnalysis: jsonb('ioc_analysis'),
  iocTypes: jsonb('ioc_types').default([]),
  latitude: text('latitude'),
  longitude: text('longitude'),
  comments: jsonb('comments').default([]),
  trashed: boolean('trashed').notNull().default(false),
  trashedAt: timestamp('trashed_at', { withTimezone: true }),
  archived: boolean('archived').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => ({
  idxTimelineEventsFolderId: index('idx_timeline_events_folder_id').on(t.folderId),
  idxTimelineEventsUpdatedAt: index('idx_timeline_events_updated_at').on(t.updatedAt),
  idxTimelineEventsTimelineId: index('idx_timeline_events_timeline_id').on(t.timelineId),
  idxTimelineEventsCreatedBy: index('idx_timeline_events_created_by').on(t.createdBy),
  idxTimelineEventsFolderIdUpdatedAt: index('idx_timeline_events_folder_id_updated_at').on(t.folderId, t.updatedAt),
  idxTimelineEventsTrashedArchived: index('idx_timeline_events_trashed_archived').on(t.trashed, t.archived),
}));

export const timelines = pgTable('timelines', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'),
  order: integer('order').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => ({
  idxTimelinesUpdatedAt: index('idx_timelines_updated_at').on(t.updatedAt),
  idxTimelinesCreatedBy: index('idx_timelines_created_by').on(t.createdBy),
}));

export const whiteboards = pgTable('whiteboards', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  elements: text('elements').notNull().default('[]'),
  appState: text('app_state'),
  folderId: text('folder_id'),
  tags: jsonb('tags').notNull().default([]),
  order: integer('order').notNull().default(0),
  clsLevel: text('cls_level'),
  trashed: boolean('trashed').notNull().default(false),
  trashedAt: timestamp('trashed_at', { withTimezone: true }),
  archived: boolean('archived').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => ({
  idxWhiteboardsFolderId: index('idx_whiteboards_folder_id').on(t.folderId),
  idxWhiteboardsUpdatedAt: index('idx_whiteboards_updated_at').on(t.updatedAt),
  idxWhiteboardsCreatedBy: index('idx_whiteboards_created_by').on(t.createdBy),
  idxWhiteboardsFolderIdUpdatedAt: index('idx_whiteboards_folder_id_updated_at').on(t.folderId, t.updatedAt),
}));

export const standaloneIOCs = pgTable('standalone_iocs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  value: text('value').notNull(),
  confidence: text('confidence', { enum: ['low', 'medium', 'high', 'confirmed'] }).notNull().default('medium'),
  analystNotes: text('analyst_notes'),
  attribution: text('attribution'),
  iocSubtype: text('ioc_subtype'),
  iocStatus: text('ioc_status'),
  clsLevel: text('cls_level'),
  folderId: text('folder_id'),
  tags: jsonb('tags').notNull().default([]),
  relationships: jsonb('relationships').default([]),
  linkedNoteIds: jsonb('linked_note_ids').default([]),
  linkedTaskIds: jsonb('linked_task_ids').default([]),
  linkedTimelineEventIds: jsonb('linked_timeline_event_ids').default([]),
  comments: jsonb('comments').default([]),
  assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  assigneeName: text('assignee_name'),
  trashed: boolean('trashed').notNull().default(false),
  trashedAt: timestamp('trashed_at', { withTimezone: true }),
  archived: boolean('archived').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => ({
  idxStandaloneIOCsFolderId: index('idx_standalone_iocs_folder_id').on(t.folderId),
  idxStandaloneIOCsUpdatedAt: index('idx_standalone_iocs_updated_at').on(t.updatedAt),
  idxStandaloneIOCsCreatedBy: index('idx_standalone_iocs_created_by').on(t.createdBy),
  idxStandaloneIOCsAssigneeId: index('idx_standalone_iocs_assignee_id').on(t.assigneeId),
  idxStandaloneIOCsFolderIdUpdatedAt: index('idx_standalone_iocs_folder_id_updated_at').on(t.folderId, t.updatedAt),
}));

export const chatThreads = pgTable('chat_threads', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  messages: jsonb('messages').notNull().default([]),
  model: text('model').notNull(),
  provider: text('provider').notNull(),
  folderId: text('folder_id'),
  tags: jsonb('tags').notNull().default([]),
  clsLevel: text('cls_level'),
  trashed: boolean('trashed').notNull().default(false),
  trashedAt: timestamp('trashed_at', { withTimezone: true }),
  archived: boolean('archived').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => ({
  idxChatThreadsFolderId: index('idx_chat_threads_folder_id').on(t.folderId),
  idxChatThreadsUpdatedAt: index('idx_chat_threads_updated_at').on(t.updatedAt),
  idxChatThreadsCreatedBy: index('idx_chat_threads_created_by').on(t.createdBy),
  idxChatThreadsFolderIdUpdatedAt: index('idx_chat_threads_folder_id_updated_at').on(t.folderId, t.updatedAt),
}));

// ─── Server Settings ────────────────────────────────────────────

export const serverSettings = pgTable('server_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const allowedEmails = pgTable('allowed_emails', {
  email: text('email').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Bot System ────────────────────────────────────────────────

export const botConfigs = pgTable('bot_configs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),    // enrichment, feed, monitor, triage, report, correlation, ai-agent, custom
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  enabled: boolean('enabled').notNull().default(false),
  triggers: jsonb('triggers').notNull().default({}),
  config: jsonb('config').notNull().default({}),    // bot-specific settings (secrets encrypted within)
  capabilities: jsonb('capabilities').notNull().default([]),
  allowedDomains: jsonb('allowed_domains').notNull().default([]),
  scopeType: text('scope_type', { enum: ['global', 'investigation'] }).notNull().default('investigation'),
  scopeFolderIds: jsonb('scope_folder_ids').notNull().default([]),
  rateLimitPerHour: integer('rate_limit_per_hour').notNull().default(100),
  rateLimitPerDay: integer('rate_limit_per_day').notNull().default(1000),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastError: text('last_error'),
  runCount: integer('run_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  /** Source type: 'manual' (admin-created) or 'caddy-agent' (auto-created from client AgentProfile) */
  sourceType: text('source_type').notNull().default('manual'),
  /** Client-side AgentDeployment ID this bot was created from (null for manual bots) */
  sourceDeploymentId: text('source_deployment_id'),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxBotConfigsUserId: index('idx_bot_configs_user_id').on(t.userId),
  idxBotConfigsEnabled: index('idx_bot_configs_enabled').on(t.enabled),
  idxBotConfigsType: index('idx_bot_configs_type').on(t.type),
  idxBotConfigsSourceType: index('idx_bot_configs_source_type').on(t.sourceType),
}));

export const botRuns = pgTable('bot_runs', {
  id: text('id').primaryKey(),
  botConfigId: text('bot_config_id').notNull().references(() => botConfigs.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['running', 'success', 'error', 'timeout', 'cancelled'] }).notNull(),
  trigger: text('trigger').notNull(),   // event, schedule, webhook, manual
  inputSummary: text('input_summary').notNull().default(''),
  outputSummary: text('output_summary').notNull().default(''),
  durationMs: integer('duration_ms').notNull().default(0),
  error: text('error'),
  entitiesCreated: integer('entities_created').notNull().default(0),
  entitiesUpdated: integer('entities_updated').notNull().default(0),
  apiCallsMade: integer('api_calls_made').notNull().default(0),
  log: jsonb('log').$type<Array<{ ts: number; type: string; name?: string; input?: unknown; output?: unknown; error?: string; durationMs?: number; text?: string }>>().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxBotRunsBotConfigId: index('idx_bot_runs_bot_config_id').on(t.botConfigId),
  idxBotRunsStatus: index('idx_bot_runs_status').on(t.status),
  idxBotRunsCreatedAt: index('idx_bot_runs_created_at').on(t.createdAt),
  idxBotRunsConfigCreated: index('idx_bot_runs_config_created').on(t.botConfigId, t.createdAt),
}));

// ─── Admin Users (separate from investigation users) ────────────

export const adminUsers = pgTable('admin_users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

// ─── Activity Log ───────────────────────────────────────────────

export const activityLog = pgTable('activity_log', {
  id: text('id').primaryKey(),
  userId: text('user_id'),  // No FK — can reference users or admin_users
  category: text('category').notNull(),
  action: text('action').notNull(),
  detail: text('detail').notNull(),
  itemId: text('item_id'),
  itemTitle: text('item_title'),
  folderId: text('folder_id'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxActivityLogUserId: index('idx_activity_log_user_id').on(t.userId),
  idxActivityLogTimestamp: index('idx_activity_log_timestamp').on(t.timestamp),
  idxActivityLogFolderId: index('idx_activity_log_folder_id').on(t.folderId),
  idxActivityLogCategory: index('idx_activity_log_category').on(t.category),
  idxActivityLogAction: index('idx_activity_log_action').on(t.action),
}));

// ─── Social Feed ────────────────────────────────────────────────

export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  attachments: jsonb('attachments').notNull().default([]),
  folderId: text('folder_id'),
  parentId: text('parent_id'),
  replyToId: text('reply_to_id'),
  mentions: jsonb('mentions').notNull().default([]),
  clsLevel: text('cls_level'),
  pinned: boolean('pinned').notNull().default(false),
  deleted: boolean('deleted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxPostsAuthorId: index('idx_posts_author_id').on(t.authorId),
  idxPostsFolderId: index('idx_posts_folder_id').on(t.folderId),
  idxPostsCreatedAt: index('idx_posts_created_at').on(t.createdAt),
  idxPostsParentId: index('idx_posts_parent_id').on(t.parentId),
  idxPostsDeletedCreatedAt: index('idx_posts_deleted_created_at').on(t.deleted, t.createdAt),
  idxPostsParentIdDeleted: index('idx_posts_parent_id_deleted').on(t.parentId, t.deleted),
}));

export const reactions = pgTable('reactions', {
  id: text('id').primaryKey(),
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqPostUserEmoji: unique('uq_post_user_emoji').on(t.postId, t.userId, t.emoji),
  idxReactionsPostId: index('idx_reactions_post_id').on(t.postId),
  idxReactionsUserId: index('idx_reactions_user_id').on(t.userId),
}));

// ─── Notifications ──────────────────────────────────────────────

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  sourceUserId: text('source_user_id').references(() => users.id, { onDelete: 'set null' }),
  postId: text('post_id').references(() => posts.id, { onDelete: 'cascade' }),
  folderId: text('folder_id'),
  message: text('message').notNull(),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxNotificationsUserId: index('idx_notifications_user_id').on(t.userId),
  idxNotificationsCreatedAt: index('idx_notifications_created_at').on(t.createdAt),
}));

// ─── File Storage ───────────────────────────────────────────────

export const files = pgTable('files', {
  id: text('id').primaryKey(),
  uploadedBy: text('uploaded_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storagePath: text('storage_path').notNull(),
  thumbnailPath: text('thumbnail_path'),
  folderId: text('folder_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxFilesFolderId: index('idx_files_folder_id').on(t.folderId),
}));

// ─── Saved Searches ─────────────────────────────────────────────

export const savedSearches = pgTable('saved_searches', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  query: text('query').notNull(),
  filters: jsonb('filters').notNull().default({}),
  isShared: boolean('is_shared').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxSavedSearchesUserId: index('idx_saved_searches_user_id').on(t.userId),
  idxSavedSearchesIsShared: index('idx_saved_searches_is_shared').on(t.isShared),
  idxSavedSearchesCreatedAt: index('idx_saved_searches_created_at').on(t.createdAt),
}));

// ─── Integration Templates ──────────────────────────────────────

export const integrationTemplates = pgTable('integration_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  template: jsonb('template').notNull(),
  sharedBy: text('shared_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxIntegrationTemplatesName: index('idx_integration_templates_name').on(t.name),
  idxIntegrationTemplatesSharedBy: index('idx_integration_templates_shared_by').on(t.sharedBy),
  idxIntegrationTemplatesCreatedAt: index('idx_integration_templates_created_at').on(t.createdAt),
}));

// ─── Encrypted Backups ──────────────────────────────────────────

export const backups = pgTable('backups', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type', { enum: ['full', 'differential'] }).notNull().default('full'),
  scope: text('scope', { enum: ['all', 'investigation', 'entity'] }).notNull().default('all'),
  scopeId: text('scope_id'),
  entityCount: integer('entity_count').notNull().default(0),
  sizeBytes: integer('size_bytes').notNull().default(0),
  storagePath: text('storage_path').notNull(),
  parentBackupId: text('parent_backup_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxBackupsUserId: index('idx_backups_user_id').on(t.userId),
  idxBackupsCreatedAt: index('idx_backups_created_at').on(t.createdAt),
}));

// ─── LLM Usage Tracking ─────────────────────────────────────────

export const llmUsage = pgTable('llm_usage', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  estimatedCost: integer('estimated_cost_micros').notNull().default(0), // cost in microdollars (1/1,000,000)
  latencyMs: integer('latency_ms'),
  threadId: text('thread_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxLlmUsageUserId: index('idx_llm_usage_user_id').on(t.userId),
  idxLlmUsageCreatedAt: index('idx_llm_usage_created_at').on(t.createdAt),
  idxLlmUsageProvider: index('idx_llm_usage_provider').on(t.provider),
}));

export const userLlmKeys = pgTable('user_llm_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  /** Encrypted API key */
  encryptedKey: text('encrypted_key').notNull(),
  label: text('label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueUserProvider: unique('unique_user_provider').on(t.userId, t.provider),
}));

// ─── AgentCaddy Server-Side Handoff ─────────────────────────────

/** Heartbeat tracking for client→server agent handoff */
export const agentHeartbeats = pgTable('agent_heartbeats', {
  folderId: text('folder_id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastBeat: timestamp('last_beat', { withTimezone: true }).notNull().defaultNow(),
  serverTakeoverAt: timestamp('server_takeover_at', { withTimezone: true }).notNull(),
});

/** Server-side agent actions (approval queue) — mirrors client's agentActions Dexie table */
export const agentActions = pgTable('agent_actions', {
  id: text('id').primaryKey(),
  investigationId: text('investigation_id').notNull(),
  botConfigId: text('bot_config_id').references(() => botConfigs.id, { onDelete: 'set null' }),
  deploymentSourceId: text('deployment_source_id'),
  threadId: text('thread_id'),
  toolName: text('tool_name').notNull(),
  toolInput: jsonb('tool_input').notNull().default({}),
  rationale: text('rationale').notNull().default(''),
  status: text('status', { enum: ['pending', 'approved', 'rejected', 'executed', 'failed'] }).notNull().default('pending'),
  resultSummary: text('result_summary'),
  severity: text('severity', { enum: ['info', 'warning', 'critical'] }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedBy: text('reviewed_by'),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxAgentActionsInvestigation: index('idx_agent_actions_investigation').on(t.investigationId),
  idxAgentActionsStatus: index('idx_agent_actions_status').on(t.status),
  idxAgentActionsInvestigationStatus: index('idx_agent_actions_inv_status').on(t.investigationId, t.status),
}));
