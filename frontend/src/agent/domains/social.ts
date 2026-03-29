// PicoClaw — Social Domain Agent (coaching: clear the deck, not unread counts)

import dayjs from 'dayjs';
import type { AgentEvent } from '../eventBus';
import { eventBus } from '../eventBus';
import type { AgentInsight, PlanStep, ToolResult } from '../types';
import type { DomainAgent } from './index';
import { toolRegistry } from '../tools';
import { useStore } from '../../store/useStore';

export const socialAgent: DomainAgent = {
  name: 'social',
  domain: 'social',
  ownedTools: ['query_emails', 'triage_emails', 'extract_tasks_from_email'],

  async assess(): Promise<AgentInsight[]> {
    const insights: AgentInsight[] = [];
    const state = useStore.getState();
    const hour = dayjs().hour();

    const actionNeeded = state.emails.filter((e) => e.category === 'action_needed');
    const staleAction = actionNeeded.filter((e) => dayjs(e.date).isBefore(dayjs().subtract(2, 'day')));

    if (staleAction.length > 0) {
      insights.push({
        domain: 'social',
        priority: 'high',
        title: 'Clear your deck',
        body: `${staleAction.length} action item${staleAction.length > 1 ? 's' : ''} have been waiting — ${staleAction.slice(0, 2).map((e) => e.subject).join('; ')}`,
        coachingWhy: 'Letting actionable mail age raises stress more than unread count.',
        coachingTip: 'Block 20 minutes; reply or defer with a date.',
      });
    }

    if (hour >= 7 && hour <= 10 && actionNeeded.length > 3) {
      insights.push({
        domain: 'social',
        priority: 'low',
        title: 'Morning: inbox actions',
        body: `${actionNeeded.length} emails need replies — want to block 20 minutes today?`,
        coachingWhy: 'Knocking these down early protects focus for the rest of the day.',
        coachingTip: 'Don\'t auto-triage yet — just pick one thread to close.',
      });
    }

    const untriaged = state.emails.filter((e) => e.category === null);
    if (untriaged.length >= 5 && hour >= 12) {
      insights.push({
        domain: 'social',
        priority: 'low',
        title: 'Inbox clarity',
        body: `${untriaged.length} messages uncategorized — sorting helps you see what actually needs you.`,
        coachingWhy: 'Separation reduces decision fatigue when you open mail.',
        suggestedAction: { tool: 'triage_emails', params: {} },
      });
    }

    // ── Email response time ───────────────────────
    const actionEmails = state.emails.filter((e) => e.category === 'action_needed');
    const oldActionEmails = actionEmails.filter(
      (e) => e.received_at && dayjs().diff(dayjs(e.received_at), 'hour') > 48,
    );
    if (oldActionEmails.length >= 2) {
      insights.push({
        domain: 'social',
        priority: 'low',
        title: 'Aging action items',
        body: `${oldActionEmails.length} action-needed emails are 2+ days old. A 15-minute sweep could clear them.`,
        coachingWhy: 'Unresolved action items add background stress even when you\'re not looking at mail.',
      });
    }

    // ── Partner contact frequency ─────────────────
    const snippets = state.partnerSnippets || [];
    if (snippets.length > 0) {
      const lastSnippet = snippets[0];
      const daysSince = lastSnippet?.timestamp ? dayjs().diff(dayjs(lastSnippet.timestamp), 'day') : 0;
      if (daysSince >= 3) {
        insights.push({
          domain: 'social',
          priority: 'low',
          title: 'Stay connected',
          body: `It's been ${daysSince} days since your last partner message. A quick check-in goes a long way.`,
          coachingWhy: 'Regular small touchpoints strengthen relationships more than rare long conversations.',
        });
      }
    }

    return insights;
  },

  async execute(step: PlanStep): Promise<ToolResult> {
    const tool = toolRegistry.get(step.tool);
    if (!tool) return { success: false, message: `Unknown tool: ${step.tool}` };
    const result = await tool.execute(step.params);
    eventBus.emit({ type: 'tool_result', tool: step.tool, params: step.params, result, domain: 'social' });
    return result;
  },

  async onEvent(_event: AgentEvent): Promise<void> {
    // Watcher / sync handles triage prompts
  },

  async briefing(): Promise<string> {
    const state = useStore.getState();
    const parts: string[] = [];

    const actionNeeded = state.emails.filter((e) => e.category === 'action_needed').length;
    if (actionNeeded > 0) parts.push(`${actionNeeded} need action`);

    if (parts.length === 0) parts.push('Action queue quiet');

    return parts.join(' | ');
  },
};
