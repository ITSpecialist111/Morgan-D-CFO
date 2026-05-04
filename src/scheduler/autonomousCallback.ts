// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Lightweight server-side timer that lets Morgan promise "I'll ring you back
// in N minutes" and then actually ring back. Wraps the existing ACS-to-Teams
// federation outbound call (initiateOutboundTeamsCall) with a setTimeout, so
// no extra Azure resources are required and the call uses the same governed
// path as Morgan's other escalation calls.

import { initiateOutboundTeamsCall, isAcsConfigured, getTeamsFederationCallingStatus } from '../voice/acsBridge';
import { recordAuditEvent } from '../observability/agentAudit';

interface ScheduledCallback {
  id: string;
  reason: string;
  teamsUserAadOid: string;
  targetDisplayName?: string;
  requestedBy?: string;
  instructions?: string;
  fireAt: number;
  timer: NodeJS.Timeout;
}

const scheduled = new Map<string, ScheduledCallback>();

function makeId(): string {
  return `cb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_DELAY_SECONDS = 60 * 60; // 1 hour cap for demo safety
const MIN_DELAY_SECONDS = 5;

export interface ScheduleAutonomousCallbackParams {
  delaySeconds: number;
  reason: string;
  teams_user_aad_oid?: string;
  target_display_name?: string;
  requested_by?: string;
  instructions?: string;
}

export interface ScheduleAutonomousCallbackResult {
  success: boolean;
  scheduledId?: string;
  fireAtIso?: string;
  delaySeconds?: number;
  reason?: string;
  target?: string;
  error?: string;
  federationCommand?: string;
}

export function scheduleAutonomousCallback(
  params: ScheduleAutonomousCallbackParams,
): ScheduleAutonomousCallbackResult {
  if (!isAcsConfigured()) {
    return {
      success: false,
      error: 'ACS calling is not configured. Set ACS_CONNECTION_STRING and Teams federation app settings.',
    };
  }

  const target = (params.teams_user_aad_oid || process.env.CFO_TEAMS_USER_AAD_OID || '').trim();
  if (!target) {
    return {
      success: false,
      error:
        'No Teams target configured. Pass teams_user_aad_oid or set CFO_TEAMS_USER_AAD_OID.',
      federationCommand: getTeamsFederationCallingStatus().federationAdminCommand,
    };
  }

  const requested = Number.isFinite(params.delaySeconds) ? Math.floor(params.delaySeconds) : NaN;
  if (!Number.isFinite(requested) || requested < MIN_DELAY_SECONDS || requested > MAX_DELAY_SECONDS) {
    return {
      success: false,
      error: `delaySeconds must be a number between ${MIN_DELAY_SECONDS} and ${MAX_DELAY_SECONDS}.`,
    };
  }

  const reason = (params.reason || 'Autonomous Morgan callback').trim();
  const id = makeId();
  const fireAt = Date.now() + requested * 1000;

  const timer = setTimeout(async () => {
    scheduled.delete(id);
    try {
      const call = await initiateOutboundTeamsCall({
        teamsUserAadOid: target,
        targetDisplayName: params.target_display_name,
        requestedBy: params.requested_by || 'Morgan',
        instructions:
          params.instructions ||
          `You are Morgan, the Digital CFO, calling back as you promised. Reason for the callback: ${reason}. ` +
            `Greet the user, give the headline finance update, walk through the 2-3 priority points and any discrepancies, ` +
            `ask for the human-in-the-loop decision you need, then close the call politely with a clear next step.`,
      });
      recordAuditEvent({
        kind: 'teams.call.callback.fired',
        label: 'Autonomous Morgan callback placed',
        correlationId: call.callConnectionId,
        data: { id, reason, target, callConnectionId: call.callConnectionId, serverCallId: call.serverCallId },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordAuditEvent({
        kind: 'teams.call.callback.failed',
        label: 'Autonomous Morgan callback failed',
        severity: 'error',
        data: { id, reason, target, error: message },
      });
    }
  }, requested * 1000);

  // Don't keep the Node event loop alive solely for a pending callback.
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  scheduled.set(id, {
    id,
    reason,
    teamsUserAadOid: target,
    targetDisplayName: params.target_display_name,
    requestedBy: params.requested_by,
    instructions: params.instructions,
    fireAt,
    timer,
  });

  recordAuditEvent({
    kind: 'teams.call.callback.scheduled',
    label: `Morgan scheduled an autonomous callback in ${requested}s`,
    correlationId: id,
    data: { id, reason, target, delaySeconds: requested, fireAtIso: new Date(fireAt).toISOString() },
  });

  return {
    success: true,
    scheduledId: id,
    fireAtIso: new Date(fireAt).toISOString(),
    delaySeconds: requested,
    reason,
    target,
  };
}

export interface ListAutonomousCallbacksResult {
  count: number;
  callbacks: Array<{
    id: string;
    reason: string;
    target: string;
    targetDisplayName?: string;
    fireAtIso: string;
    secondsUntilFire: number;
  }>;
}

export function listScheduledCallbacks(): ListAutonomousCallbacksResult {
  const now = Date.now();
  const callbacks = Array.from(scheduled.values()).map((c) => ({
    id: c.id,
    reason: c.reason,
    target: c.teamsUserAadOid,
    targetDisplayName: c.targetDisplayName,
    fireAtIso: new Date(c.fireAt).toISOString(),
    secondsUntilFire: Math.max(0, Math.round((c.fireAt - now) / 1000)),
  }));
  return { count: callbacks.length, callbacks };
}

export interface CancelAutonomousCallbackParams {
  scheduledId: string;
}

export function cancelAutonomousCallback(params: CancelAutonomousCallbackParams): {
  success: boolean;
  cancelled?: boolean;
  scheduledId?: string;
  error?: string;
} {
  const id = (params.scheduledId || '').trim();
  if (!id) return { success: false, error: 'scheduledId is required.' };
  const entry = scheduled.get(id);
  if (!entry) return { success: false, scheduledId: id, error: 'No scheduled callback with that id.' };
  clearTimeout(entry.timer);
  scheduled.delete(id);
  recordAuditEvent({
    kind: 'teams.call.callback.cancelled',
    label: 'Autonomous Morgan callback cancelled',
    correlationId: id,
    data: { id, reason: entry.reason, target: entry.teamsUserAadOid },
  });
  return { success: true, cancelled: true, scheduledId: id };
}

import type { ChatCompletionTool } from 'openai/resources/chat';

export const AUTONOMOUS_CALLBACK_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'scheduleAutonomousCallback',
      description:
        "Schedule Morgan to autonomously ring the user (or named Teams user) back over ACS-to-Teams federation after a delay. " +
        "Use this whenever the user asks Morgan to 'ring me back', 'call me in N minutes', 'call me when this is sorted', or " +
        "wants Morgan to give them a few minutes before re-engaging on a finance escalation. Morgan must commit to a clear " +
        "reason and a delay (5-3600 seconds). The actual call uses the existing governed Teams federation bridge.",
      parameters: {
        type: 'object',
        properties: {
          delaySeconds: {
            type: 'number',
            description: 'Seconds to wait before ringing the user back (minimum 5, maximum 3600).',
          },
          reason: {
            type: 'string',
            description: 'Short reason for the callback that Morgan will state on the call (e.g. "walk through the priority discrepancies once you are free").',
          },
          teams_user_aad_oid: {
            type: 'string',
            description: 'Optional Microsoft Entra object ID of the Teams user to ring. Defaults to CFO_TEAMS_USER_AAD_OID.',
          },
          target_display_name: {
            type: 'string',
            description: 'Optional display name for logs and call context.',
          },
          requested_by: {
            type: 'string',
            description: 'Optional display name of who requested the callback.',
          },
          instructions: {
            type: 'string',
            description: 'Optional override for the realtime voice instructions Morgan will use on the call.',
          },
        },
        required: ['delaySeconds', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listScheduledCallbacks',
      description: 'List the autonomous Teams callbacks Morgan has scheduled and not yet fired.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelAutonomousCallback',
      description: 'Cancel a previously scheduled autonomous Morgan callback by its id.',
      parameters: {
        type: 'object',
        properties: {
          scheduledId: { type: 'string', description: 'The scheduled callback id returned by scheduleAutonomousCallback.' },
        },
        required: ['scheduledId'],
      },
    },
  },
];
