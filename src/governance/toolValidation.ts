import { z } from 'zod';

const shortText = z.string().trim().min(1).max(500);
const bodyText = z.string().max(100_000);
const identifier = z.string().trim().min(1).max(500);

const schemas: Record<string, z.ZodType<Record<string, unknown>>> = {
  sendEmail: z.object({
    to: identifier,
    subject: z.string().trim().min(1).max(500),
    body: bodyText,
    importance: z.enum(['normal', 'high']).optional(),
    bodyContentType: z.enum(['text', 'html']).optional(),
  }).strict(),
  sendTeamsMessage: z.object({
    channel_id: identifier,
    message: bodyText,
    subject: z.string().max(500).optional(),
  }).strict(),
  createWordDocument: z.object({
    title: shortText,
    content: bodyText,
    save_to_sharepoint: z.boolean().optional(),
  }).strict(),
  createPlannerTask: z.object({
    title: shortText,
    assigned_to: identifier.optional(),
    due_date: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
    bucket_name: z.string().max(500).optional(),
    notes: z.string().max(20_000).optional(),
    priority: z.number().int().min(0).max(10).optional(),
  }).strict(),
  updatePlannerTask: z.object({
    task_id: identifier,
    title: shortText.optional(),
    percent_complete: z.number().min(0).max(100).optional(),
    due_date: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
    notes: z.string().max(20_000).optional(),
  }).strict(),
  scheduleCalendarEvent: z.object({
    title: shortText,
    attendees: z.array(identifier).min(1).max(100),
    start_datetime: z.string().datetime({ offset: true }),
    end_datetime: z.string().datetime({ offset: true }),
    body: z.string().max(20_000).optional(),
    is_online_meeting: z.boolean().optional(),
  }).strict().refine((value) => new Date(value.end_datetime).getTime() > new Date(value.start_datetime).getTime(), 'Calendar event end must follow start.'),
  callSubAgent: z.object({
    agent_id: z.enum(['cassidy', 'avatar', 'ai-kanban']),
    message: z.string().trim().min(1).max(12_000),
    path: z.string().regex(/^\/(?!\/)(?!.*\.\.)[A-Za-z0-9/_-]*$/).optional(),
    timeout_ms: z.number().int().min(1_000).max(60_000).optional(),
  }).strict(),
  initiateTeamsCallToCfo: z.object({
    reason: shortText,
    teams_user_aad_oid: identifier.optional(),
    requested_by: shortText.optional(),
    instructions: z.string().max(20_000).optional(),
  }).strict(),
  initiateTeamsFederatedCall: z.object({
    reason: shortText,
    teams_user_aad_oid: identifier,
    target_display_name: shortText.optional(),
    requested_by: shortText.optional(),
    instructions: z.string().max(20_000).optional(),
    voice: z.string().max(100).optional(),
  }).strict(),
  scheduleAutonomousCallback: z.object({
    reason: shortText,
    delaySeconds: z.number().int().min(5).max(3_600),
    teams_user_aad_oid: identifier.optional(),
    target_display_name: shortText.optional(),
    requested_by: shortText.optional(),
    instructions: z.string().max(20_000).optional(),
  }).strict(),
  cancelAutonomousCallback: z.object({ scheduledId: identifier }).strict(),
  sendHitlApprovalCardToModAdministrator: z.object({ requestId: identifier.optional(), level: z.enum(['L2', 'L3']).optional() }).strict(),
  listHitlApprovalRequests: z.object({
    status: z.enum(['open', 'all', 'pending', 'approved', 'approved_with_edits', 'declined', 'cancelled', 'expired', 'executing', 'executed', 'failed']).optional(),
    level: z.enum(['L2', 'L3']).optional(),
  }).strict(),
  getHitlApprovalSurface: z.object({ requestId: identifier.optional() }).strict(),
  recordMissionTaskCompletion: z.object({
    task_id: z.enum([
      'finance-health-check',
      'corpgen-planning-loop',
      'anomaly-surveillance',
      'microsoft-iq-synthesis',
      'memory-reflection',
      'executive-briefing',
      'working-day-audit',
      'customer-showcase',
    ]),
    summary: z.string().trim().min(10).max(5_000),
    evidence: z.array(z.string().trim().min(1).max(2_000)).max(50).optional(),
    status: z.enum(['pending', 'in_progress', 'blocked', 'completed', 'failed']).optional(),
  }).strict().refine((value) => (value.status || 'completed') !== 'completed' || Boolean(value.evidence?.length), 'Completed mission work requires at least one evidence item.'),
};

function containsUnsafeObject(value: unknown, depth = 0): boolean {
  if (depth > 8) return true;
  if (Array.isArray(value)) return value.some((item) => containsUnsafeObject(item, depth + 1));
  if (!value || typeof value !== 'object') return false;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))) return true;
  return Object.values(value as Record<string, unknown>).some((item) => containsUnsafeObject(item, depth + 1));
}

export function validateToolInput(tool: string, params: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return { ok: false, error: 'Tool parameters must be a JSON object.' };
  if (containsUnsafeObject(params)) return { ok: false, error: 'Tool parameters contain unsafe keys or excessive nesting.' };
  let bytes = 0;
  try { bytes = Buffer.byteLength(JSON.stringify(params), 'utf8'); } catch { return { ok: false, error: 'Tool parameters are not serializable.' }; }
  if (bytes > 200_000) return { ok: false, error: 'Tool parameters exceed the 200 KB limit.' };
  const schema = schemas[tool];
  if (!schema) return { ok: true };
  const parsed = schema.safeParse(params);
  if (parsed.success) return { ok: true };
  const issue = parsed.error.issues[0];
  return { ok: false, error: `${issue.path.join('.') || 'parameters'}: ${issue.message}` };
}
