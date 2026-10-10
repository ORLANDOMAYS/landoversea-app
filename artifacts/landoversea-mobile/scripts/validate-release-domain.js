const CANONICAL_PRODUCTION_HOST = 'landover-sea.com';

function validateReleaseDomain(env = process.env) {
  const isProductionRelease =
    env.EAS_BUILD_PROFILE === 'production' ||
    env.EXPO_PUBLIC_RELEASE === '1';
  if (!isProductionRelease) return;

  const configuredHost = env.EXPO_PUBLIC_DOMAIN?.trim().toLowerCase();
  if (configuredHost !== CANONICAL_PRODUCTION_HOST) {
    throw new Error(
      `Production mobile builds require EXPO_PUBLIC_DOMAIN=${CANONICAL_PRODUCTION_HOST}.`,
    );
  }

  const isIosBuild = env.EAS_BUILD_PLATFORM === 'ios';
  if (isIosBuild && !env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim()) {
    throw new Error(
      'Production iOS builds require EXPO_PUBLIC_REVENUECAT_IOS_API_KEY.',
    );
  }
}

if (require.main === module) {
  try {
    validateReleaseDomain();
    console.log(`Validated production mobile domain: ${CANONICAL_PRODUCTION_HOST}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  CANONICAL_PRODUCTION_HOST,
  validateReleaseDomain,
};