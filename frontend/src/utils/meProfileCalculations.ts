// Me profile — BMR, TDEE, target calories, water (35 ml/kg)

export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";

const TDEE_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/**
 * Mifflin–St Jeor BMR: male = 10*weight + 6.25*height - 5*age + 5;
 * female = 10*weight + 6.25*height - 5*age - 161.
 * Weight in kg, height in cm.
 */
export function computeBMR(
  weightKg: number,
  heightCm: number,
  ageYears: number,
  gender: "male" | "female" | "other",
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  if (gender === "female") return base - 161;
  if (gender === "male") return base + 5;
  return base - 78; // other: midpoint
}

export function computeTDEE(
  bmr: number,
  activityLevel: ActivityLevel,
): number {
  return bmr * (TDEE_MULTIPLIERS[activityLevel] ?? 1.2);
}

/**
 * Target daily calories: lose = TDEE - deficit (~500 for ~0.5 kg/week),
 * gain = TDEE + surplus (300–500), maintain = TDEE.
 * If targetDate is set, derive weekly rate from (targetWeight - currentWeight) / weeks.
 */
export function computeTargetCalories(
  tdee: number,
  goalType: "gain" | "lose" | "maintain",
  currentWeightKg: number,
  targetWeightKg: number,
  targetDateIso: string | null,
): number {
  if (goalType === "maintain") return Math.round(tdee);
  const now = new Date();
  const target = targetDateIso ? new Date(targetDateIso) : null;
  const weeks =
    target && target > now
      ? (target.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000)
      : 52;
  const diff = targetWeightKg - currentWeightKg;
  const kgPerWeek = Math.abs(diff) / Math.max(weeks, 0.1);
  if (goalType === "lose") {
    const deficit = Math.min(1000, Math.max(250, kgPerWeek * 7700)); // ~7700 kcal per kg
    return Math.round(tdee - deficit);
  }
  const surplus = Math.min(500, Math.max(300, kgPerWeek * 7700));
  return Math.round(tdee + surplus);
}

/** Recommended water: 35 ml per kg body weight (or 2–3 L default). */
export function computeWaterMl(weightKg: number): number {
  if (!weightKg || weightKg <= 0) return 2500;
  return Math.round(weightKg * 35);
}

/** Age in years from birth date (ISO string). */
export function ageFromBirthDate(birthDateIso: string | null): number {
  if (!birthDateIso) return 30;
  const birth = new Date(birthDateIso);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return Math.max(0, Math.min(120, age));
}

export function bmi(weightKg: number, heightCm: number): number {
  if (!heightCm || heightCm <= 0) return 0;
  const heightM = heightCm / 100;
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}
