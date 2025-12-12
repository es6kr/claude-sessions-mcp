import { Schema } from 'effect'

// Claude session message schema
export const MessageSchema = Schema.Struct({
  uuid: Schema.String,
  parentUuid: Schema.optional(Schema.NullOr(Schema.String)),
  type: Schema.String,
  message: Schema.optional(Schema.Unknown),
  timestamp: Schema.optional(Schema.String),
})

export type Message = Schema.Schema.Type<typeof MessageSchema>

// Session metadata
export const SessionMetaSchema = Schema.Struct({
  id: Schema.String,
  projectName: Schema.String,
  title: Schema.optional(Schema.String),
  messageCount: Schema.Number,
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
})

export type SessionMeta = Schema.Schema.Type<typeof SessionMetaSchema>

// Project with sessions
export const ProjectSchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  sessionCount: Schema.Number,
})

export type Project = Schema.Schema.Type<typeof ProjectSchema>
