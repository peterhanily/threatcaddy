import { pgTable, text, integer, boolean, timestamp, jsonb, unique } from 'drizzle-orm/pg-core';

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
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Investigation Membership ───────────────────────────────────

export const investigationMembers = pgTable('investigation_members', {
  id: text('id').primaryKey(),
  folderId: text('folder_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull().default('editor'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqFolderUser: unique('uq_folder_user').on(t.folderId, t.userId),
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
  createdBy: text('created_by').notNull().references(() => users.id),
  updatedBy: text('updated_by').notNull().references(() => users.id),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

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
  createdBy: text('created_by').notNull().references(() => users.id),
  updatedBy: text('updated_by').notNull().references(() => users.id),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

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
  createdBy: text('created_by').notNull().references(() => users.id),
  updatedBy: text('updated_by').notNull().references(() => users.id),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const tags = pgTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  updatedBy: text('updated_by').notNull().references(() => users.id),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

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
  trashed: boolean('trashed').notNull().default(false),
  trashedAt: timestamp('trashed_at', { withTimezone: true }),
  archived: boolean('archived').notNull().default(false),
  createdBy: text('created_by').notNull().references(() => users.id),
  updatedBy: text('updated_by').notNull().references(() => users.id),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const timelines = pgTable('timelines', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'),
  order: integer('order').notNull().default(0),
  createdBy: text('created_by').notNull().references(() => users.id),
  updatedBy: text('updated_by').notNull().references(() => users.id),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const whiteboards = pgTable('whiteboards', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  elements: text('elements').notNull().default('[]'),
  appState: text('app_state'),
  folderId: text('folder_id'),
  tags: jsonb('tags').notNull().default([]),
  order: integer('order').notNull().default(0),
  trashed: boolean('trashed').notNull().default(false),
  trashedAt: timestamp('trashed_at', { withTimezone: true }),
  archived: boolean('archived').notNull().default(false),
  createdBy: text('created_by').notNull().references(() => users.id),
  updatedBy: text('updated_by').notNull().references(() => users.id),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

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
  trashed: boolean('trashed').notNull().default(false),
  trashedAt: timestamp('trashed_at', { withTimezone: true }),
  archived: boolean('archived').notNull().default(false),
  createdBy: text('created_by').notNull().references(() => users.id),
  updatedBy: text('updated_by').notNull().references(() => users.id),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const chatThreads = pgTable('chat_threads', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  messages: jsonb('messages').notNull().default([]),
  model: text('model').notNull(),
  provider: text('provider').notNull(),
  folderId: text('folder_id'),
  tags: jsonb('tags').notNull().default([]),
  trashed: boolean('trashed').notNull().default(false),
  trashedAt: timestamp('trashed_at', { withTimezone: true }),
  archived: boolean('archived').notNull().default(false),
  createdBy: text('created_by').notNull().references(() => users.id),
  updatedBy: text('updated_by').notNull().references(() => users.id),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

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

// ─── Activity Log ───────────────────────────────────────────────

export const activityLog = pgTable('activity_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  category: text('category').notNull(),
  action: text('action').notNull(),
  detail: text('detail').notNull(),
  itemId: text('item_id'),
  itemTitle: text('item_title'),
  folderId: text('folder_id'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Social Feed ────────────────────────────────────────────────

export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  authorId: text('author_id').notNull().references(() => users.id),
  content: text('content').notNull(),
  images: jsonb('images').notNull().default([]),
  folderId: text('folder_id'),
  parentId: text('parent_id'),
  mentions: jsonb('mentions').notNull().default([]),
  pinned: boolean('pinned').notNull().default(false),
  deleted: boolean('deleted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reactions = pgTable('reactions', {
  id: text('id').primaryKey(),
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqPostUserEmoji: unique('uq_post_user_emoji').on(t.postId, t.userId, t.emoji),
}));

// ─── Notifications ──────────────────────────────────────────────

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  sourceUserId: text('source_user_id').references(() => users.id),
  postId: text('post_id').references(() => posts.id),
  folderId: text('folder_id'),
  message: text('message').notNull(),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── File Storage ───────────────────────────────────────────────

export const files = pgTable('files', {
  id: text('id').primaryKey(),
  uploadedBy: text('uploaded_by').notNull().references(() => users.id),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storagePath: text('storage_path').notNull(),
  thumbnailPath: text('thumbnail_path'),
  folderId: text('folder_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
