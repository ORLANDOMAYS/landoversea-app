import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matchesUrl = new URL('../src/pages/matches.tsx', import.meta.url);
const reportModalUrl = new URL('../src/components/report-user-modal.tsx', import.meta.url);

test('matches resolves Supabase UUIDs before using the generated report flow', async () => {
  const [matches, modal] = await Promise.all([
    readFile(matchesUrl, 'utf8'),
    readFile(reportModalUrl, 'utf8'),
  ]);

  assert.match(matches, /resolveSafetyUser\(candidate\.supabaseUserId\)/);
  assert.match(matches, /localUserId:\s*data\.userId/);
  assert.match(matches, /onError:/);
  assert.match(matches, /REPORT_IDENTITY_UNAVAILABLE/);
  assert.match(matches, /<Loader2[\s\S]*animate-spin/);
  assert.match(matches, /<ReportUserModal[\s\S]*reportedUserId=\{reportTarget\.localUserId\}/);
  assert.match(modal, /useReportUser\(\)/);
  assert.match(modal, /reportMutation\.mutateAsync\(\{\s*data:/);
  assert.doesNotMatch(modal, /\bfetch\s*\(/);
});

test('a failed report resolution can retry the same UUID without consuming cached error state', async () => {
  const matches = await readFile(matchesUrl, 'utf8');
  assert.match(matches, /const reportAttempt = useRef\(0\)/);
  assert.match(matches, /const attempt = reportAttempt\.current \+ 1/);
  assert.match(matches, /reportAttempt\.current = attempt/);
  assert.match(matches, /reportResolution\.mutate\(\{\s*candidate,\s*attempt\s*\}\)/);
  assert.match(matches, /if \(attempt !== reportAttempt\.current\) return/g);
  assert.doesNotMatch(matches, /useResolveSafetyUser|reportResolution\.isError/);
});

test('successful reports invalidate Supabase match/discovery and report data', async () => {
  const matches = await readFile(matchesUrl, 'utf8');
  assert.match(matches, /invalidateQueries\(\{\s*queryKey:\s*liveKeys\.matches/);
  assert.match(matches, /invalidateQueries\(\{\s*queryKey:\s*liveKeys\.discovery/);
  assert.match(matches, /getGetMatchStatsQueryKey\(\)/);
  assert.match(matches, /queryKey:\s*\['\/api\/admin\/reports'\]/);
  assert.match(matches, /onSuccess=\{handleReportSuccess\}/);
});

test('block and UUID unmatch are truthful disabled controls with no numeric mutations', async () => {
  const matches = await readFile(matchesUrl, 'utf8');
  assert.match(matches, /SUPABASE_BLOCK_UNAVAILABLE/);
  assert.match(matches, /disabled\s*\n\s*title=\{SUPABASE_BLOCK_UNAVAILABLE\}/);
  assert.match(matches, /SUPABASE_UNMATCH_UNAVAILABLE/);
  assert.match(matches, /disabled\s*\n\s*title=\{SUPABASE_UNMATCH_UNAVAILABLE\}/);
  assert.doesNotMatch(matches, /useBlockUser|blockMutation|useUnmatch|unmatchMutation/);
  assert.doesNotMatch(matches, /matches\.blockedTitle|matches\.blockedDesc|matches\.unmatchedTitle/);
  assert.doesNotMatch(matches, /\bparseInt\s*\(|\bNumber\s*\(|as unknown as number/);
});