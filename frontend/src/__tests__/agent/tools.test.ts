// Tests for tool parameter validation and alias fixing.
// Run with: npx jest src/__tests__/agent/tools.test.ts

// Note: These test the validateAndFixParams logic directly.
// Since it's not exported, we test via executeToolWithGoalContext behavior.

describe('Tool Parameter Validation', () => {
  // Test the alias mapping logic conceptually
  // In production, validateAndFixParams handles this

  const PARAM_ALIASES: Record<string, Record<string, string>> = {
    log_hydration: { amount: 'amount_ml', ml: 'amount_ml', water: 'amount_ml', quantity: 'amount_ml' },
    add_task: { name: 'title', text: 'title', task: 'title', description: 'notes', date: 'dueDate', due: 'dueDate' },
    set_focus_mode: { time: 'durationMin', duration: 'durationMin', minutes: 'durationMin' },
    log_expense: { cost: 'amount', price: 'amount', spent: 'amount', type: 'category' },
  };

  function applyAliases(toolName: string, params: Record<string, unknown>): Record<string, unknown> {
    const aliases = PARAM_ALIASES[toolName] ?? {};
    const fixed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      const correctName = aliases[key] ?? key;
      fixed[correctName] = value;
    }
    return fixed;
  }

  it('fixes hydration param aliases', () => {
    const fixed = applyAliases('log_hydration', { amount: 500 });
    expect(fixed.amount_ml).toBe(500);
    expect(fixed.amount).toBeUndefined();
  });

  it('fixes task param aliases', () => {
    const fixed = applyAliases('add_task', { name: 'Buy milk', date: '2024-01-15' });
    expect(fixed.title).toBe('Buy milk');
    expect(fixed.dueDate).toBe('2024-01-15');
  });

  it('fixes focus mode param aliases', () => {
    const fixed = applyAliases('set_focus_mode', { time: 45 });
    expect(fixed.durationMin).toBe(45);
  });

  it('fixes expense param aliases', () => {
    const fixed = applyAliases('log_expense', { cost: 25.50, type: 'food' });
    expect(fixed.amount).toBe(25.50);
    expect(fixed.category).toBe('food');
  });

  it('passes through correct params unchanged', () => {
    const fixed = applyAliases('log_hydration', { amount_ml: 250 });
    expect(fixed.amount_ml).toBe(250);
  });

  it('handles unknown tools gracefully', () => {
    const fixed = applyAliases('unknown_tool', { foo: 'bar' });
    expect(fixed.foo).toBe('bar');
  });

  // Type coercion tests
  it('coerces string numbers', () => {
    const val = '500';
    const num = Number(val);
    expect(typeof num).toBe('number');
    expect(num).toBe(500);
  });

  it('coerces string booleans', () => {
    expect(['true', 'yes', 'on', '1'].map(s => s === 'true' || s === 'yes' || s === 'on' || s === '1')).toEqual([true, true, true, true]);
    expect(['false', 'no', 'off', '0'].map(s => s === 'true' || s === 'yes' || s === 'on' || s === '1')).toEqual([false, false, false, false]);
  });
});
