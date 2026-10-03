import { type Profile } from "@workspace/db";

const REQUIRED_STEPS = [
  { key: "name", label: "name", check: (p: Profile) => !!p.name },
  { key: "age", label: "age", check: (p: Profile) => p.age != null && p.age >= 18 },
  { key: "bio", label: "bio", check: (p: Profile) => !!p.bio && p.bio.trim().length >= 20 },
  { key: "location", label: "location", check: (p: Profile) => !!p.country && p.country.length > 0 },
  { key: "primaryLanguage", label: "primary language", check: (p: Profile) => !!p.primaryLanguage && p.primaryLanguage.length > 0 },
  { key: "gender", label: "gender", check: (p: Profile) => !!p.gender && p.gender.length > 0 },
  { key: "lookingFor", label: "looking for", check: (p: Profile) => !!p.lookingFor && p.lookingFor.length > 0 },
  { key: "relationshipGoal", label: "relationship goal", check: (p: Profile) => !!p.relationshipGoal && p.relationshipGoal.length > 0 },
  { key: "photos", label: "photos" }, // checked separately via photo count
];

// Optional steps (not required for profile completion)
const OPTIONAL_STEPS = [
  { key: "interests", label: "interests", check: (p: Profile) => p.interests.length > 0 },
];

export function computeCompletionPercent(profile: Profile, photoCount: number): number {
  let done = 0;
  const totalSteps = REQUIRED_STEPS.length;

  for (const step of REQUIRED_STEPS) {
    if (step.key === "photos") {
      if (photoCount >= 1) done++;
    } else if (step.check) {
      if (step.check(profile)) done++;
    }
  }

  return Math.round((done / totalSteps) * 100);
}

export function getMissingSteps(profile: Profile, photoCount: number): string[] {
  const missing: string[] = [];

  for (const step of REQUIRED_STEPS) {
    if (step.key === "photos") {
      if (photoCount < 1) missing.push("At least one photo is required");
    } else if (step.check && !step.check(profile)) {
      missing.push(step.label!);
    }
  }

  return missing;
}

export function isProfileComplete(profile: Profile, photoCount: number): boolean {
  return getMissingSteps(profile, photoCount).length === 0;
}
