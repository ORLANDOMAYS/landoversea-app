const REQUIRED_PROFILE_FIELDS = ["display_name", "age", "gender"];

function parseAuthCallbackUrl(input) {
  if (typeof input !== "string" || !input.trim()) {
    return { kind: "invalid", message: "The sign-in link is missing." };
  }

  try {
    const url = new URL(input);
    const query = url.searchParams;
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const error =
      query.get("error_description") ||
      hash.get("error_description") ||
      query.get("error") ||
      hash.get("error");

    if (error) {
      return { kind: "error", message: error };
    }

    const code = query.get("code");
    if (code) return { kind: "pkce", code };

    const accessToken = hash.get("access_token") || query.get("access_token");
    const refreshToken = hash.get("refresh_token") || query.get("refresh_token");
    if (accessToken && refreshToken) {
      return { kind: "legacy", accessToken, refreshToken };
    }

    return {
      kind: "invalid",
      message: "This sign-in link is invalid or has expired.",
    };
  } catch {
    return { kind: "invalid", message: "The sign-in link is invalid." };
  }
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
  if (authError || !hasSession) return "/";
  return isProfileComplete(profile) ? "/(tabs)/discover" : "/(tabs)/profile";
}

module.exports = {
  parseAuthCallbackUrl,
  isProfileComplete,
  decideAuthDestination,
};