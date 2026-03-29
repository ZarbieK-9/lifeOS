// Goal creation is LLM-driven via the create_goal tool — no regex planner.

import { toolRegistry } from '../../agent/tools';

describe('planner / goals', () => {
  it('exposes create_goal on the tool registry for LLM tool calling', () => {
    expect(toolRegistry.has('create_goal')).toBe(true);
    expect(toolRegistry.get('create_goal')?.name).toBe('create_goal');
  });
});
