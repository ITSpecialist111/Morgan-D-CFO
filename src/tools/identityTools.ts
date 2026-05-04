// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatCompletionTool } from 'openai/resources/chat';
import { TurnContext } from '@microsoft/agents-hosting';
import { getMcpTools } from './mcpToolSetup';

// ---------------------------------------------------------------------------
// Morgan's Microsoft 365 identity (mailbox, calendar, meeting invitation)
// ---------------------------------------------------------------------------

export interface MorganIdentity {
  displayName: string;
  agentRole: string;
  mailboxUpn: string | undefined;
  meetingInviteAddress: string | undefined;
  calendarOwner: string | undefined;
  agentBlueprintId: string | undefined;
  tenantId: string | undefined;
  authConnection: string;
  capabilities: {
    canSendInternalEmail: boolean;
    canSendExternalEmail: boolean;
    canBeInvitedToMeetings: boolean;
    canReadMeetingTranscripts: boolean;
    canReadCalendar: boolean;
    canPostToTeamsChannels: boolean;
  };
  invitationGuidance: string[];
  source: 'env' | 'derived' | 'partial';
}

function tenantPrimaryDomainHint(): string | undefined {
  const cfo = process.env.CFO_EMAIL || process.env.MANAGER_EMAIL || '';
  const at = cfo.indexOf('@');
  if (at >= 0) return cfo.slice(at + 1).trim() || undefined;
  return undefined;
}

function deriveMailboxUpn(): { upn: string | undefined; source: MorganIdentity['source'] } {
  const explicit = process.env.MORGAN_MAILBOX_UPN
    || process.env.AGENT_MAILBOX_UPN
    || process.env.AGENTIC_USER_UPN;
  if (explicit) return { upn: explicit, source: 'env' };
  const domain = tenantPrimaryDomainHint();
  const localPart = (process.env.AGENT_NAME || 'morgan').toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (!domain || !localPart) return { upn: undefined, source: 'partial' };
  return { upn: `${localPart}@${domain}`, source: 'derived' };
}

export function getMorganIdentity(): MorganIdentity {
  const { upn, source } = deriveMailboxUpn();
  const meetingInviteAddress = process.env.MORGAN_MEETING_INVITE_EMAIL || upn;
  const displayName = process.env.AGENT_NAME || 'Morgan';
  const agentRole = process.env.AGENT_ROLE || 'Digital CFO';
  const mcpAvailable = Boolean(process.env.MCP_PLATFORM_ENDPOINT);

  return {
    displayName,
    agentRole,
    mailboxUpn: upn,
    meetingInviteAddress,
    calendarOwner: upn,
    agentBlueprintId: process.env.MicrosoftAppId || process.env.agent_id,
    tenantId: process.env.MicrosoftAppTenantId,
    authConnection: process.env.agentic_connectionName || 'AgenticAuthConnection',
    capabilities: {
      canSendInternalEmail: mcpAvailable,
      canSendExternalEmail: mcpAvailable,
      canBeInvitedToMeetings: Boolean(meetingInviteAddress),
      canReadMeetingTranscripts: mcpAvailable,
      canReadCalendar: mcpAvailable,
      canPostToTeamsChannels: mcpAvailable,
    },
    invitationGuidance: meetingInviteAddress
      ? [
          `Add ${meetingInviteAddress} to a Microsoft Teams meeting or Outlook calendar invite to bring ${displayName} into the room.`,
          `${displayName} reads the calendar event, the meeting chat, and the post-meeting transcript through Agent 365 Calendar and Teams MCP servers.`,
          `Email ${displayName} directly at ${meetingInviteAddress}; replies are sent from ${displayName}'s own Microsoft 365 mailbox via the WorkIQ Mail MCP server.`,
          `Ask ${displayName} for a follow-up by saying "Morgan, summarise yesterday's pricing review" — she will pull the calendar entry, transcript, and chat to respond.`,
        ]
      : [
          `Set MORGAN_MAILBOX_UPN (or AGENT_MAILBOX_UPN) in app settings so users know which address to invite ${displayName} on.`,
          `Without MORGAN_MAILBOX_UPN, ${displayName} still uses the Agent 365 mailbox of the signed-in agentic user, but the address is not advertised to users.`,
        ],
    source,
  };
}

// ---------------------------------------------------------------------------
// WorkIQ MCP coverage — categorize discovered Agent 365 servers and tools so
// the CFO can verify Morgan has the same WorkIQ access as Cassidy.
// ---------------------------------------------------------------------------

export type WorkIQPillar =
  | 'Mail'
  | 'Calendar'
  | 'Teams'
  | 'SharePoint'
  | 'OneDrive'
  | 'Planner'
  | 'Word'
  | 'Excel'
  | 'PowerPoint'
  | 'OneNote'
  | 'People'
  | 'Loop'
  | 'Other';

interface WorkIQPillarStatus {
  pillar: WorkIQPillar;
  servers: string[];
  toolCount: number;
  cassidyParity: 'matched' | 'missing' | 'optional';
  examples: string[];
}

const PILLAR_PATTERNS: Array<{ pillar: WorkIQPillar; expected: boolean; pattern: RegExp }> = [
  { pillar: 'Mail',       expected: true,  pattern: /mail|outlook|message|email/i },
  { pillar: 'Calendar',   expected: true,  pattern: /calendar|event|meeting|booking/i },
  { pillar: 'Teams',      expected: true,  pattern: /teams|chat|channel/i },
  { pillar: 'SharePoint', expected: true,  pattern: /sharepoint|spo\b|sites?\b/i },
  { pillar: 'OneDrive',   expected: true,  pattern: /onedrive|drive\b/i },
  { pillar: 'Planner',    expected: true,  pattern: /planner|task/i },
  { pillar: 'Word',       expected: true,  pattern: /word\b|docx|document/i },
  { pillar: 'Excel',      expected: false, pattern: /excel|workbook|xlsx|spreadsheet/i },
  { pillar: 'PowerPoint', expected: false, pattern: /powerpoint|pptx|slides?/i },
  { pillar: 'OneNote',    expected: false, pattern: /onenote|notebook/i },
  { pillar: 'People',     expected: true,  pattern: /people|directory|users?\b|graph|person/i },
  { pillar: 'Loop',       expected: false, pattern: /loop\b/i },
];

function classifyByPillar(name: string): WorkIQPillar {
  for (const entry of PILLAR_PATTERNS) {
    if (entry.pattern.test(name)) return entry.pillar;
  }
  return 'Other';
}

export interface WorkIQStatus {
  available: boolean;
  endpoint: string;
  authConnection: string;
  serverCount: number;
  toolCount: number;
  servers: string[];
  pillars: WorkIQPillarStatus[];
  cassidyParity: {
    matched: WorkIQPillar[];
    missing: WorkIQPillar[];
    optional: WorkIQPillar[];
  };
  notes: string[];
}

export async function getWorkIQStatus(_params: Record<string, unknown> = {}, context?: TurnContext): Promise<WorkIQStatus> {
  const info = await getMcpTools(context);
  const pillarMap = new Map<WorkIQPillar, { servers: Set<string>; tools: Set<string> }>();

  for (const tool of info.tools) {
    const pillar = classifyByPillar(tool);
    const entry = pillarMap.get(pillar) || { servers: new Set<string>(), tools: new Set<string>() };
    entry.tools.add(tool);
    pillarMap.set(pillar, entry);
  }
  for (const server of info.servers) {
    const pillar = classifyByPillar(server);
    const entry = pillarMap.get(pillar) || { servers: new Set<string>(), tools: new Set<string>() };
    entry.servers.add(server);
    pillarMap.set(pillar, entry);
  }

  const pillars: WorkIQPillarStatus[] = PILLAR_PATTERNS.map((entry) => {
    const found = pillarMap.get(entry.pillar);
    const tools = found ? Array.from(found.tools) : [];
    const servers = found ? Array.from(found.servers) : [];
    const present = tools.length > 0 || servers.length > 0;
    return {
      pillar: entry.pillar,
      servers,
      toolCount: tools.length,
      cassidyParity: present ? 'matched' : (entry.expected ? 'missing' : 'optional'),
      examples: tools.slice(0, 4),
    };
  });

  const matched: WorkIQPillar[] = [];
  const missing: WorkIQPillar[] = [];
  const optional: WorkIQPillar[] = [];
  for (const pillar of pillars) {
    if (pillar.cassidyParity === 'matched') matched.push(pillar.pillar);
    else if (pillar.cassidyParity === 'missing') missing.push(pillar.pillar);
    else optional.push(pillar.pillar);
  }

  const notes: string[] = [];
  if (!info.available) {
    notes.push('MCP_PLATFORM_ENDPOINT is not configured. Set it to https://agent365.svc.cloud.microsoft to enable Cassidy-parity WorkIQ tools.');
  } else if (info.serverCount === 0) {
    notes.push('Agent 365 MCP discovery returned zero servers. Verify the agentic connection (agentic_connectionName) is granted access to the WorkIQ MCP catalog in Microsoft Foundry.');
  } else {
    notes.push(`Morgan and Cassidy share the same Entra app blueprint (${process.env.MicrosoftAppId || 'unknown'}). Any WorkIQ MCP server granted to that blueprint is available to both agents.`);
    if (missing.length > 0) {
      notes.push(`Missing pillars (${missing.join(', ')}) usually indicate the WorkIQ MCP servers are not yet provisioned for this tenant in Microsoft Foundry / Agent 365.`);
    }
  }

  return {
    available: info.available,
    endpoint: info.endpoint,
    authConnection: process.env.agentic_connectionName || 'AgenticAuthConnection',
    serverCount: info.serverCount,
    toolCount: info.toolCount,
    servers: info.servers,
    pillars,
    cassidyParity: { matched, missing, optional },
    notes,
  };
}

// ---------------------------------------------------------------------------
// OpenAI tool definitions
// ---------------------------------------------------------------------------

export const IDENTITY_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'getMorganIdentity',
      description: 'Return Morgan own Microsoft 365 identity: mailbox UPN, calendar owner, meeting invitation address, agent blueprint, tenant, and the WorkIQ-backed mailbox/calendar/Teams capabilities Morgan owns. Call this when the user asks for Morgan email address, how to invite Morgan to a meeting, or what Microsoft 365 identity Morgan uses.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getWorkIQStatus',
      description: 'Return Morgan live WorkIQ MCP coverage grouped by pillar (Mail, Calendar, Teams, SharePoint, OneDrive, Planner, Word, Excel, People) and compare to the expected Cassidy WorkIQ baseline. Use when the user asks which WorkIQ MCP servers Morgan can use, whether Morgan has parity with Cassidy, or to prove Morgan owns the same mailbox/calendar/Teams tools.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];
