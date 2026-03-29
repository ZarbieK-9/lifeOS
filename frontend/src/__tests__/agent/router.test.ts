// Tests for intent routing — verifies correct model/context/tool selection.
// Run with: npx jest src/__tests__/agent/router.test.ts

import { routeIntent } from '../../agent/router';

describe('routeIntent', () => {
  // Action intents → heavy model + tools
  it('routes action requests to heavy model with tools', () => {
    const r = routeIntent('log 250ml water');
    expect(r.intent).toBe('action');
    expect(r.useHeavy).toBe(true);
    expect(r.includeTools).toBe(true);
    expect(r.directTool?.tool).toBe('log_hydration');
  });

  it('routes task creation to heavy model', () => {
    const r = routeIntent('add task buy groceries');
    expect(r.intent).toBe('action');
    expect(r.useHeavy).toBe(true);
    expect(r.directTool?.tool).toBe('add_task');
  });

  it('routes compound actions to heavy model', () => {
    const r = routeIntent('please add a task for tomorrow');
    expect(r.intent).toBe('action');
    expect(r.useHeavy).toBe(true);
  });

  // Goal intents → heavy model (via goal pattern boost)
  it('routes goal-setting to heavy model', () => {
    const r = routeIntent('I want to drink 3L water daily');
    expect(r.useHeavy).toBe(true);
  });

  it('routes help-me requests to heavy model', () => {
    const r = routeIntent('help me exercise more');
    expect(r.useHeavy).toBe(true);
  });

  // Query intents → fast model (no tools)
  it('routes simple queries to fast model', () => {
    const r = routeIntent('what are my tasks?');
    expect(r.intent).toBe('query');
    expect(r.includeTools).toBe(false);
  });

  it('routes complex queries to heavy model', () => {
    const r = routeIntent('analyze my spending trends');
    expect(r.useHeavy).toBe(true);
  });

  // Chat intents → fast model
  it('routes greetings to fast model', () => {
    const r = routeIntent('hey');
    expect(r.intent).toBe('chat');
    expect(r.useHeavy).toBe(false);
    expect(r.includeTools).toBe(false);
  });

  it('routes casual chat to fast model', () => {
    const r = routeIntent('tell me a joke');
    expect(r.intent).toBe('chat');
    expect(r.useHeavy).toBe(false);
  });

  // System messages → full context + tools
  it('routes system messages with full context', () => {
    const r = routeIntent('[SYSTEM: MORNING BRIEFING]');
    expect(r.intent).toBe('system');
    expect(r.useHeavy).toBe(true);
    expect(r.includeTools).toBe(true);
    expect(r.contextNeeds.full).toBe(true);
  });

  // Context budget
  it('provides higher budget for actions than chat', () => {
    const action = routeIntent('add task meeting prep');
    const chat = routeIntent('hello');
    expect(action.contextBudget!).toBeGreaterThan(chat.contextBudget!);
  });
});
