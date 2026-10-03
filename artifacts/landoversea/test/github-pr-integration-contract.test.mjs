import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const workspaceRoot = join(projectRoot, '..', '..');

test('the web entry renders real routes instead of an empty placeholder', async () => {
  const app = await readFile(join(projectRoot, 'src', 'App.tsx'), 'utf8');
  assert.match(app, /<Route path="\/" component=\{RootRedirect\}/);
  assert.match(app, /<Route path="\/discover" component=\{Discover\}/);
  assert.match(app, /<AuthGuard>/);
});

test('video calls remain scoped to authenticated match participants', async () => {
  const migration = await readFile(
    join(
      workspaceRoot,
      'supabase',
      'migrations',
      '20261003183000_add_secure_video_calls.sql',
    ),
    'utf8',
  );

  assert.match(migration, /alter table public\.video_calls enable row level security/i);
  assert.match(migration, /alter table public\.video_call_signals enable row level security/i);
  assert.match(migration, /matched_pair\.user1_id = video_calls\.caller_id/i);
  assert.match(migration, /matched_pair\.user2_id = video_calls\.receiver_id/i);
  assert.match(migration, /set_video_call_status/i);
  assert.match(migration, /security definer/i);
  assert.doesNotMatch(migration, /grant\s+update[\s\S]+video_calls\s+to authenticated/i);
  assert.doesNotMatch(migration, /grant\s+delete[\s\S]+video_call_signals\s+to authenticated/i);
});

test('the call page performs WebRTC negotiation instead of showing a remote placeholder', async () => {
  const page = await readFile(join(projectRoot, 'src', 'pages', 'video-call.tsx'), 'utf8');
  assert.match(page, /new RTCPeerConnection/);
  assert.match(page, /getUserMedia/);
  assert.match(page, /createOffer/);
  assert.match(page, /createAnswer/);
  assert.match(page, /setRemoteDescription/);
  assert.match(page, /onicecandidate/);
});