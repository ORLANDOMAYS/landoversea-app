async function loadMatchesForCurrentUser(getCurrentUser, getMatches) {
  const user = await getCurrentUser();
  if (!user) return { userId: null, matches: [] };
  return {
    userId: user.id,
    matches: await getMatches(user.id),
  };
}

module.exports = {
  loadMatchesForCurrentUser,
};