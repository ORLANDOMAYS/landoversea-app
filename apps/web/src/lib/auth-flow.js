const REQUIRED_PROFILE_FIELDS = ["display_name", "age", "gender"];

function parseWebAuthCallback(search) {
  const params =
    search instanceof URLSearchParams
      ? search
      : new URLSearchParams(typeof search === "string" ? search : "");
  const error = params.get("error_description") || params.get("error");
  if (error) return { kind: "error", message: error };
  const code = params.get("code");
  if (code) return { kind: "pkce", code };
  return {
    kind: "invalid",
    message: "This sign-in link is invalid or has expired.",
  };
}

function isProfileComplete(profile) {
  if (!profile) return false;
  return REQUIRED_PROFILE_FIELDS.every((field) => {
    const value = profile[field];
    if (field === "age") return Number.isInteger(value) && value >= 18;
    return typeof value === "string" && value.trim().length > 0;
  });
}

function decideAuthDestination({ hasSession, profile, authError }) {
  if (authError || !hasSession) return "/auth";
  return isProfileComplete(profile) ? "/app" : "/app/profile?onboarding=1";
}

module.exports = {
  parseWebAuthCallback,
  isProfileComplete,
  decideAuthDestination,
};