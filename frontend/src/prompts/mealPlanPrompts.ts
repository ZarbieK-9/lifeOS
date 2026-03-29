/**
 * User prompts for on-device meal / coach generation.
 * Keeps the model focused on food, kcal, macros, and supplements — not hydration essays.
 */

export function buildOneDayMealPlanPrompt(params: {
  weightKg: number;
  heightCm: number;
  goalType: string;
  targetWeightKg: number | null;
  targetDate: string | null;
  targetCalories: number;
}): string {
  const goalExtra =
    params.targetWeightKg != null
      ? `, target weight ${params.targetWeightKg} kg${params.targetDate ? ` by ${params.targetDate}` : ""}`
      : "";
  return `You are helping with a ONE-DAY EATING PLAN only.

User: ${params.weightKg} kg, ${params.heightCm} cm tall, goal: ${params.goalType}${goalExtra}.
Daily calorie budget: about ${params.targetCalories} kcal (stay near this total).

Respond with this exact structure (use ## headings):

## Breakfast (~___ kcal)
Specific foods with rough portions (e.g. "2 eggs, 1 slice wholegrain toast, 150g Greek yogurt").

## Lunch (~___ kcal)
Specific foods and portions.

## Dinner (~___ kcal)
Specific foods and portions.

## Snacks (~___ kcal)
Specific foods and portions.

## Daily totals
- Calories: sum should be close to ${params.targetCalories} kcal
- Protein: ___ g | Carbs: ___ g | Fat: ___ g

## Supplements (optional)
2–4 items that might complement this plan (e.g. vitamin D, omega-3, creatine only if relevant to goals). One line: "Not medical advice—check with a professional."

STRICT RULES:
- The plan must be mostly about WHAT TO EAT and approximate calories. Do not lead with water or hydration.
- Do not dedicate more than one short sentence to fluids; never invent extreme water amounts (no "drink 15 L" or similar).
- Give concrete food names, not vague advice like "eat healthy".`;
}

export function buildFitnessCoachMealPrompt(profileLine: string, targetCalories?: number): string {
  const kcal = targetCalories != null && targetCalories > 0 ? ` Daily calorie target ~${targetCalories} kcal.` : "";
  return `Create a concise fitness + NUTRITION plan for: ${profileLine}.${kcal}

Include:
1) Breakfast, lunch, dinner: name specific foods and approximate kcal per meal.
2) Total protein (g), carbs (g), fat (g) for the day.
3) 2–3 optional supplements only if relevant (not medical advice).
4) 2 short exercise ideas for today.

Do NOT focus on water or hydration; at most one brief line. Never suggest unrealistic fluid volumes.`;
}
