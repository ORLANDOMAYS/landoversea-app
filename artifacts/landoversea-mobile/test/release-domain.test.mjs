import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../scripts/validate-release-domain.js', import.meta.url);

function runValidation(overrides) {
  return spawnSync(process.execPath, [script.pathname], {
    encoding: 'utf8',
    env: {
      ...process.env,
      EAS_BUILD_PROFILE: '',
      EXPO_PUBLIC_RELEASE: '',
      EXPO_PUBLIC_DOMAIN: '',
      EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: '',
      EAS_BUILD_PLATFORM: '',
      ...overrides,
    },
  });
}

test('EAS production builds require the canonical mobile domain', async () => {
  const [easConfig, packageJson] = await Promise.all([
    readFile(new URL('../eas.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);

  assert.equal(
    packageJson.scripts['eas-build-pre-install'],
    'node scripts/validate-release-domain.js',
  );
  assert.equal(easConfig.build.production.env.EXPO_PUBLIC_DOMAIN, 'landover-sea.com');
  assert.equal(easConfig.build.production.env.EXPO_PUBLIC_RELEASE, '1');

  const valid = runValidation({
    EAS_BUILD_PROFILE: 'production',
    EXPO_PUBLIC_DOMAIN: 'landover-sea.com',
    EAS_BUILD_PLATFORM: 'ios',
    EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: 'configured-public-key',
  });
  assert.equal(valid.status, 0, valid.stderr);

  for (const domain of ['', 'land-over-sea-international.replit.app', 'other.example']) {
    const invalid = runValidation({
      EAS_BUILD_PROFILE: 'production',
      EXPO_PUBLIC_DOMAIN: domain,
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /Production mobile builds require EXPO_PUBLIC_DOMAIN=landover-sea\.com/);
  }
});

test('production iOS builds fail closed without a RevenueCat public SDK key', () => {
  const missing = runValidation({
    EAS_BUILD_PROFILE: 'production',
    EAS_BUILD_PLATFORM: 'ios',
    EXPO_PUBLIC_DOMAIN: 'landover-sea.com',
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /require EXPO_PUBLIC_REVENUECAT_IOS_API_KEY/);

  const preview = runValidation({
    EAS_BUILD_PROFILE: 'preview',
    EAS_BUILD_PLATFORM: 'ios',
    EXPO_PUBLIC_DOMAIN: 'preview.example',
  });
  assert.equal(preview.status, 0, preview.stderr);
});

test('development and preview EAS builds retain their injected preview domains', () => {
  const preview = runValidation({
    EAS_BUILD_PROFILE: 'preview',
    EXPO_PUBLIC_DOMAIN: 'preview.example',
  });
  assert.equal(preview.status, 0, preview.stderr);
});