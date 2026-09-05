function normalizeDiscoveryFilters(filters = {}) {
  const numberInRange = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? Math.min(120, Math.max(18, Math.trunc(parsed)))
      : fallback;
  };
  const minAge = numberInRange(filters.minAge, 18);
  return {
    minAge,
    maxAge: Math.max(minAge, numberInRange(filters.maxAge, 120)),
    gender: typeof filters.gender === "string" ? filters.gender.trim() : "",
    location:
      typeof filters.location === "string"
        ? filters.location.replace(/[%_,()]/g, "").trim()
        : "",
  };
}

function translatedBodyOrNull(original, translated) {
  const value = typeof translated === "string" ? translated.trim() : "";
  return value && value !== original.trim() ? value : null;
}

function restoreFailedDraft(currentDraft, failedDraft) {
  return currentDraft.trim() ? currentDraft : failedDraft;
}

function nextSwipeState(index, persisted) {
  return persisted ? index + 1 : index;
}

module.exports = {
  normalizeDiscoveryFilters,
  translatedBodyOrNull,
  restoreFailedDraft,
  nextSwipeState,
};