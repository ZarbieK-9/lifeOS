import { validatePlanStep } from '../../agent/tools';

describe('validatePlanStep', () => {
  it('normalizes alias fields for log_habit', () => {
    const out = validatePlanStep({
      tool: 'log_habit',
      params: { habit_name: 'walk' },
    });
    expect(out.ok).toBe(true);
    expect(out.params?.name_match).toBe('walk');
  });

  it('fails when required params are missing', () => {
    const out = validatePlanStep({
      tool: 'schedule_reminder',
      params: {},
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('Missing required parameter');
  });
});
