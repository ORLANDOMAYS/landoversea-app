import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const conversationUrl = new URL('../src/pages/conversation.tsx', import.meta.url);

test('Supabase conversation keeps UUIDs native and never calls numeric sidecars', async () => {
  const source = await readFile(conversationUrl, 'utf8');
  assert.doesNotMatch(source, /\bparseInt\s*\(|\bNumber\s*\(/);
  assert.match(source, /new Map<string, any>/);
  assert.match(source, /String\(a\.id\)\.localeCompare\(String\(b\.id\)\)/);
  assert.doesNotMatch(source, /api\/conversations|useMuteConversation|useBlockUser|useReportUser|useUnmatch|useRequestUploadUrl|useTranscribeVoiceNote/);
  assert.match(source, /UUID_SIDECAR_UNAVAILABLE/);
  assert.match(source, /disabled[\s\S]*title=\{UUID_SIDECAR_UNAVAILABLE\}/);
});

test('drafts, on-demand translations, and sends use the ID-independent endpoint', async () => {
  const source = await readFile(conversationUrl, 'utf8');
  const hooks = await readFile(
    new URL('../src/hooks/use-supabase-surfaces.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /api\/translations\/text/);
  assert.match(source, /handlePreviewDraft[\s\S]*translateText\(content, target, locale\)/);
  assert.match(source, /handleTranslate[\s\S]*translateText\(/);
  assert.match(source, /recipientTranslationLanguage[\s\S]*translatedBody[\s\S]*sendMessageMutation\.mutateAsync/);
  assert.match(hooks, /sendMessage\(matchId, body, language, translatedBody\)/);
  assert.match(hooks, /message\.translated_body[\s\S]*isStoredTranslation:\s*true/);
});

test('match and message lists do not route Supabase UUIDs into numeric mutations', async () => {
  const [matches, messages] = await Promise.all([
    readFile(new URL('../src/pages/matches.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/messages.tsx', import.meta.url), 'utf8'),
  ]);
  for (const source of [matches, messages]) {
    assert.doesNotMatch(source, /\bparseInt\s*\(|\bNumber\s*\(/);
    assert.doesNotMatch(source, /as unknown as number/);
  }
  assert.doesNotMatch(matches, /useUnmatch|unmatchMutation|handleUnmatch/);
  assert.match(matches, /SUPABASE_UNMATCH_UNAVAILABLE/);
  assert.match(matches, /disabled[\s\S]*title=\{SUPABASE_UNMATCH_UNAVAILABLE\}/);

  assert.doesNotMatch(messages, /useCreateGroupConversation|useGetMatches|getGetMatchesQueryKey|participantIds|handleCreateGroup/);
  assert.match(messages, /SUPABASE_GROUPS_UNAVAILABLE/);
  assert.match(messages, /disabled[\s\S]*title=\{SUPABASE_GROUPS_UNAVAILABLE\}/);
  assert.doesNotMatch(messages, /conv\?\.id[\s\S]*setLocation\(`\/messages/);
});