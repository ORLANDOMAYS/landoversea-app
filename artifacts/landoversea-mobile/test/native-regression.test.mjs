import assert from "node:assert/strict";
import { readFile, access, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

async function read(relative) {
  return readFile(join(root, relative), "utf8");
}

async function exists(relative) {
  try {
    await access(join(root, relative));
    return true;
  } catch {
    return false;
  }
}

async function sourceFiles(relative) {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const next = join(relative, entry.name);
    if (entry.isDirectory()) return sourceFiles(next);
    return /\.(ts|tsx)$/.test(entry.name) ? [next] : [];
  }));
  return nested.flat();
}

function mobileEntries(source) {
  const start = source.indexOf("  mobile: {");
  assert.notEqual(start, -1, "missing mobile localization section");
  const section = source.slice(start, source.indexOf("\n  },\n};", start));
  return new Map([...section.matchAll(/\b(\w+):\s*(['"])((?:\\.|(?!\2).)*)\2/g)]
    .map(([, key, , value]) => [key, value]));
}

test("package.json keeps native runtime dependencies on the reviewed singleton boundary", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.ok(!pkg.dependencies["react-native-webview"], "react-native-webview must be removed");
  assert.ok(!pkg.devDependencies["expo-location"] && !pkg.dependencies["expo-location"], "expo-location must be removed");
  assert.ok(pkg.dependencies["react-native-purchases"], "RevenueCat native SDK must be installed in the mobile workspace");
  assert.equal(pkg.dependencies["@supabase/supabase-js"], "2.115.0", "Supabase must use the React Native-compatible Realtime graph");
  assert.equal(pkg.devDependencies.react, "catalog:", "mobile React must use the workspace singleton");
  assert.ok(!pkg.devDependencies["@expo/cli"], "Expo must own its compatible CLI version");
});

test("startup bundles only the four Inter weights used by native typography", async () => {
  const layout = await read("app/_layout.tsx");
  assert.doesNotMatch(layout, /from ['"]@expo-google-fonts\/inter['"]/);
  for (const weight of ["400Regular", "500Medium", "600SemiBold", "700Bold"]) {
    assert.match(
      layout,
      new RegExp(`from ['"]@expo-google-fonts/inter/${weight}['"]`),
      `Inter ${weight} must use its asset-scoped entry point`,
    );
  }
  assert.match(layout, /useFonts[\s\S]*Inter_400Regular[\s\S]*Inter_700Bold/);
  assert.match(layout, /if \(!fontsLoaded && !fontError\) return null/);
});

test("premium uses RevenueCat offerings and entitlement as its native source of truth", async () => {
  const premium = await read("app/premium.tsx");
  const revenueCat = await read("lib/revenuecat.tsx");
  const revenueCatIdentity = await read("lib/revenuecat-identity.ts");
  const layout = await read("app/_layout.tsx");
  const auth = await read("lib/auth.ts");

  assert.match(layout, /RevenueCatProvider/);
  assert.match(revenueCat, /REVENUECAT_ENTITLEMENT_IDENTIFIER = ['"]premium['"]/);
  assert.match(revenueCat, /visibleOfferings\?\.current\?\.availablePackages/);
  assert.match(revenueCat, /addCustomerInfoUpdateListener/);
  assert.match(revenueCat, /EXPO_PUBLIC_REVENUECAT_TEST_API_KEY/);
  assert.match(revenueCat, /EXPO_PUBLIC_REVENUECAT_IOS_API_KEY/);
  assert.match(revenueCat, /EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY/);
  assert.match(revenueCat, /PURCHASE_CANCELLED_ERROR/);
  assert.match(revenueCat, /useReconcileNativePremium/);
  assert.match(
    revenueCat,
    /await reconcile\(expectedUserId, expectedGeneration\)/,
    "app start, purchase, and restore must reconcile server authorization",
  );
  assert.match(
    revenueCat,
    /isPremium:\s*premiumEntitlement !== null/,
    "native premium presentation must follow RevenueCat CustomerInfo",
  );
  assert.match(revenueCat, /serverSynchronized/, "backend projection state must remain explicit");
  assert.match(
    revenueCat,
    /session\?\.access_token[\s\S]*user\?\.id === session\.user\.id/,
    "RevenueCat must wait for an authenticated Supabase user and access token",
  );
  assert.match(
    revenueCat,
    /const isPreviewPremium = configuration\.isTestMode && premiumEntitlement !== null/,
    "every active Test Store entitlement must remain preview-only regardless of backend sync",
  );
  assert.doesNotMatch(
    revenueCat,
    /const isPreviewPremium =[^\n]*(?:visibleServerPremium|visibleServerSynchronized)/,
    "Test Store preview semantics must not depend on backend verification",
  );
  assert.match(revenueCat, /refreshPromise/, "duplicate retries must be coalesced while loading");
  assert.match(revenueCat, /await Purchases\.restorePurchases\(\)[\s\S]*Purchases\.getCustomerInfo\(\)/);
  assert.match(
    revenueCat,
    /await reconcile\(expectedUserId, expectedGeneration\)[\s\S]*return restoredInfo/,
    "restore must rerun backend reconciliation before completing",
  );
  assert.match(revenueCat, /Do not mislabel a completed store purchase as a purchase failure/);
  assert.match(revenueCatIdentity, /operationQueue/, "native identity and purchase operations must be serialized");
  assert.match(
    revenueCat,
    /observedUserId\.current !== renderedUserId[\s\S]*generation\.current \+= 1/,
    "account changes must invalidate stale work before effects run",
  );
  assert.match(
    revenueCat,
    /info\.originalAppUserId !== expectedUserId/,
    "listener updates must not cross RevenueCat account boundaries",
  );
  assert.match(
    revenueCat,
    /const ownsState = stateOwner === renderedUserId/,
    "render-before-effect account changes must expose neutral state",
  );
  assert.doesNotMatch(
    revenueCat,
    /runRevenueCatOperation\([\s\S]{0,120}reconcile\(expectedUserId, expectedGeneration\)/,
    "server reconciliation must not hold the native SDK identity queue",
  );
  assert.match(revenueCatIdentity, /los_user_\$\{userId\}/, "mobile and server must share the opaque app user id mapping");
  assert.match(auth, /from ['"]\.\/revenuecat-identity['"]/);
  assert.match(
    auth,
    /void disconnectRevenueCatUser\(\)\.catch[\s\S]*await clearSessionToken\(\)/,
    "logout must synchronously enqueue RevenueCat disconnect before local logout",
  );
  assert.match(premium, /item\.product\.priceString/);
  assert.match(premium, /item\.product\.title/);
  assert.match(premium, /restorePurchases/);
  assert.match(premium, /testID="premium-preview-only"/);
  assert.match(premium, /testID="premium-retry"/);
  assert.match(premium, /testID="restore-purchases"/);
  assert.match(premium, /testID="premium-subscribe-plans"/);
  assert.match(
    premium,
    /\{!isPremium && packages\.length > 0 \? \(/,
    "Subscribe plan cards must be suppressed whenever device CustomerInfo is premium",
  );
  assert.match(
    premium,
    /error\?\.kind === 'reconcile' && isPreviewPremium \? null : error/,
    "preview-only entitlement must not render the production sync error",
  );
  assert.match(premium, /<Modal/);
  assert.doesNotMatch(premium, /Alert\.alert|useGetPremiumPlans|useGetMySubscription/);
  assert.doesNotMatch(premium, /Intl\.NumberFormat|currency:\s*['"]/);

  const localeNames = ["ar", "de", "en", "es", "fr", "hi", "id", "it", "ja", "ko", "lo", "pt", "ru", "th", "vi", "zh-CN"];
  const premiumKeys = [
    "activeEntitlement", "loadingPlans", "storeConfigurationUnavailable", "purchaseError",
    "restoreError", "loadError", "restoreSuccess", "nothingToRestore", "noOffering",
    "noOfferingDescription", "purchasePlan", "restorePurchases", "testPurchaseTitle",
    "testPurchaseDescription", "syncError", "syncPending", "previewOnlyTitle",
    "previewOnlyDescription", "previewRestoreSuccess",
  ];
  for (const locale of localeNames) {
    const translations = await read(`i18n/locales/${locale}.ts`);
    for (const key of premiumKeys) {
      assert.match(translations, new RegExp(`\\b${key}:`), `${locale}.premium.${key} is missing`);
    }
  }
});

test("every privacy disclosure acknowledges native notification and purchase providers", async () => {
  const privacyMarkers = {
    ar: ["الإشعارات الفورية", "عمليات الشراء داخل التطبيق"],
    de: ["Push-Benachrichtigungen", "In-App-Käufe"],
    en: ["push notifications", "in-app purchases"],
    es: ["notificaciones push", "compras dentro de la aplicación"],
    fr: ["notifications push", "achats intégrés"],
    hi: ["पुश नोटिफिकेशन", "इन-ऐप खरीदारी"],
    id: ["notifikasi push", "pembelian dalam aplikasi"],
    it: ["notifiche push", "acquisti in-app"],
    ja: ["プッシュ通知", "アプリ内課金"],
    ko: ["푸시 알림", "인앱 결제"],
    lo: ["ການແຈ້ງເຕືອນ push", "ການຊື້ໃນແອັບ"],
    pt: ["notificações push", "compras no aplicativo"],
    ru: ["push-уведомлений", "покупок в приложении"],
    th: ["การแจ้งเตือนแบบพุช", "การซื้อภายในแอป"],
    vi: ["thông báo đẩy", "mua hàng trong ứng dụng"],
    "zh-CN": ["推送通知", "应用内购买"],
  };

  for (const [locale, markers] of Object.entries(privacyMarkers)) {
    const source = await read(`i18n/locales/${locale}.ts`);
    const start = source.lastIndexOf("  privacy: {");
    const end = source.indexOf("\n  mobile: {", start);
    assert.notEqual(start, -1, `${locale} is missing its privacy section`);
    assert.notEqual(end, -1, `${locale} privacy section has no boundary`);
    const privacy = source.slice(start, end);
    for (const marker of markers) {
      assert.ok(privacy.includes(marker), `${locale} privacy disclosure is missing ${marker}`);
    }
    assert.ok(privacy.includes("KYC"), `${locale} privacy disclosure must retain the KYC limitation`);
  }
});

test("app.json handles notifications and native configs without inventing fields", async () => {
  const config = JSON.parse(await read("app.json"));
  const expo = config.expo;

  assert.ok(expo.plugins.includes("expo-notifications"), "must include expo-notifications");
  assert.ok(expo.plugins.includes("expo-document-picker"), "must include expo-document-picker");
  assert.equal(expo.runtimeVersion.policy, "appVersion");
  assert.equal(expo.ios.bundleIdentifier, "com.base69d7f8da4081d841a49332c3.app");
  assert.equal(expo.scheme, "landoversea", "native callbacks must use the registered LandOverSEA scheme");
  assert.equal(expo.version, "2.121943.2");
  assert.equal(expo.ios.buildNumber, "4");
  assert.ok(expo.android.versionCode);
  assert.ok(!expo.extra?.eas?.projectId, "do not invent EAS IDs if not provided");

  const eas = JSON.parse(await read("eas.json"));
  assert.notEqual(
    eas.build?.production?.autoIncrement,
    true,
    "the owner-reviewed TestFlight build number must not be changed during Launch",
  );

  const androidFilters = expo.android.intentFilters || [];
  const linkFilter = androidFilters.find(f => f.action === "VIEW" && f.data.some(d => d.pathPrefix === "/"));
  assert.ok(linkFilter, "must support correct Android deep links for all paths");
});

test("onboarding and registration actions stay scrollable above small-screen safe areas and keyboards", async () => {
  const wrapper = await read("components/KeyboardAwareScrollViewCompat.tsx");
  const glassCard = await read("components/ui/GlassCard.tsx");
  const onboarding = await read("app/onboarding.tsx");
  const rootLayout = await read("app/_layout.tsx");
  const register = await read("app/(auth)/register.tsx");
  const verifyEmail = await read("app/(auth)/verify-email.tsx");

  assert.match(wrapper, /FORM_ACTION_KEYBOARD_OFFSET = 80/);
  assert.match(wrapper, /Platform\.OS === 'web'/);
  assert.match(wrapper, /<ScrollView \{\.\.\.sharedProps\}>/);
  assert.match(wrapper, /flexGrow: 1/);
  assert.match(wrapper, /scrollEnabled: true/);
  assert.match(wrapper, /contentInsetAdjustmentBehavior: 'never'/);
  assert.match(wrapper, /automaticallyAdjustContentInsets: false/);
  assert.match(wrapper, /keyboardShouldPersistTaps = 'handled'/);
  assert.match(wrapper, /keyboardDismissMode = Platform\.OS === 'ios' \? 'interactive' : 'on-drag'/);

  const cardContainerStyles = glassCard.slice(
    glassCard.indexOf("container: {"),
    glassCard.indexOf("blurClip: {"),
  );
  assert.doesNotMatch(cardContainerStyles, /overflow:\s*['"]hidden['"]/);
  assert.doesNotMatch(glassCard, /height:\s*['"]100%['"]/);
  assert.match(glassCard, /blurClip:[\s\S]*overflow:\s*['"]hidden['"]/);

  assert.match(rootLayout, /name="onboarding" options=\{\{ presentation: 'fullScreenModal' \}\}/);
  assert.match(onboarding, /testID="onboarding-scroll"/);
  assert.match(onboarding, /testID="onboarding-next"/);
  assert.match(onboarding, /testID="onboarding-footer"/);
  assert.match(onboarding, /testID=\{`onboarding-step-\$\{step\}`\}/);
  assert.match(onboarding, /bottomOffset=\{FORM_ACTION_KEYBOARD_OFFSET\}/);
  assert.match(onboarding, /paddingBottom: insets\.bottom \+ 40/);
  assert.match(onboarding, /scrollContent: \{ flexGrow: 1, width: '100%' \}/);
  assert.match(onboarding, /card: \{ padding: 24, marginBottom: 24, flexShrink: 0 \}/);
  assert.match(onboarding, /footer: \{ flexDirection: 'row', marginTop: 'auto', flexShrink: 0 \}/);
  assert.equal(
    [...onboarding.matchAll(/\{step === (\d+) && \(\s*<>/g)].length,
    14,
    "all onboarding steps must stay inside the same scrollable viewport",
  );
  assert.ok(
    onboarding.indexOf('testID="onboarding-footer"') < onboarding.indexOf('</KeyboardAwareScrollViewCompat>'),
    "the Next/Finish action must remain part of the scrollable content",
  );

  assert.match(register, /testID="register-scroll"/);
  assert.match(register, /testID="register-language-next"/);
  assert.match(register, /testID="register-age-next"/);
  assert.match(register, /testID="register-submit"/);
  assert.match(register, /bottomOffset=\{FORM_ACTION_KEYBOARD_OFFSET\}/);
  assert.match(register, /paddingBottom: insets\.bottom \+ 20/);
  assert.match(register, /scrollContent: \{ flexGrow: 1 \}/);

  assert.match(verifyEmail, /testID="verify-email-scroll"/);
  assert.match(verifyEmail, /bottomOffset=\{FORM_ACTION_KEYBOARD_OFFSET\}/);
});

test("onboarding location uses searchable ISO country and subdivision selections", async () => {
  const onboarding = await read("app/onboarding.tsx");
  const autocomplete = await read("components/ui/LocationAutocomplete.tsx");
  const locationData = await read("lib/location-data.ts");
  const pkg = JSON.parse(await read("package.json"));
  const { getAllCountries, getStatesOfCountry } = await import("localized-countries-states");

  assert.equal(pkg.devDependencies["localized-countries-states"], "2.0.0");

  const countryMatches = getAllCountries("en")
    .filter(country => country.name.toLowerCase().includes("un"));
  assert.ok(countryMatches.some(country => country.code === "US"), "\"un\" must match United States");
  assert.ok(countryMatches.some(country => country.code === "GB"), "\"un\" must match United Kingdom");
  assert.ok(
    getStatesOfCountry("US", "en").some(state => state.code === "US-MD" && state.name === "Maryland"),
    "United States subdivisions must include Maryland",
  );

  assert.match(locationData, /normalized\.startsWith\(query\)/, "prefix matches must rank ahead of substring matches");
  assert.match(locationData, /\.slice\(0, limit\)/, "the visible result panel must stay bounded");
  assert.match(locationData, /getStatesOfCountry\(countryCode, locale\)/);
  assert.match(locationData, /LEGACY_COUNTRY_CODES/);

  assert.match(autocomplete, /<Pressable/);
  assert.match(autocomplete, /onPress=\{\(\) => handleSelect\(option\)\}/);
  assert.doesNotMatch(autocomplete, /FlatList|ScrollView|position:\s*['"]absolute['"]/);

  assert.match(onboarding, /testIDPrefix="onboarding-country"/);
  assert.match(onboarding, /testIDPrefix="onboarding-subdivision"/);
  assert.match(onboarding, /if \(step === 4 && !selectedCountryCode\)/);
  assert.match(onboarding, /country: '', city: ''/, "editing country must invalidate both prior selections");
  assert.match(onboarding, /country: option\.canonicalName/);
  assert.match(onboarding, /city: option\.canonicalName/);
  assert.match(onboarding, /subdivisionOptions\.length > 0/);
});

test("route presence matches requirements", async () => {
  const routes = [
    "app/(auth)/welcome.tsx", "app/(auth)/login.tsx", "app/(auth)/register.tsx",
    "app/(auth)/verify-email.tsx", "app/(auth)/reset-password.tsx", "app/(tabs)/discover.tsx", "app/(tabs)/matches.tsx",
    "app/(tabs)/messages.tsx", "app/(tabs)/coaches.tsx", "app/(tabs)/profile.tsx",
    "app/delete-account.tsx", "app/delete-account-request.tsx", "app/coaches/[id].tsx",
    "app/coaches/dashboard.tsx", "app/coaches/apply.tsx", "app/admin.tsx", "app/messages/[conversationId].tsx", "app/profile/edit.tsx",
    "app/settings.tsx", "app/notifications.tsx", "app/onboarding.tsx", "app/premium.tsx",
    "app/safety.tsx", "app/culture.tsx", "app/learning.tsx", "app/terms.tsx", "app/privacy.tsx",
  ];
  for (const route of routes) assert.ok(await exists(route), `missing route ${route}`);

  const rootLayout = await read("app/_layout.tsx");
  for (const routeName of ["events/index", "tribes/index", "workshops/index"]) {
    assert.match(rootLayout, new RegExp(`<Stack\\.Screen name="${routeName.replace("/", "\\/")}"`));
  }
  assert.doesNotMatch(rootLayout, /<Stack\.Screen name="(?:events|tribes|workshops|\(auth\)\/reset-password)"/);
});

test("secure token wiring fails explicitly", async () => {
  const authCode = await read("lib/auth.ts");
  assert.match(authCode, /throw new Error/);
  assert.match(authCode, /expo-secure-store/);
  assert.match(authCode, /setAuthTokenGetter\(getSessionToken\)/, "cold launches must read SecureStore for API requests");
  assert.match(authCode, /window\.localStorage/, "web preview sessions must survive reloads");
  assert.match(authCode, /Platform\.OS === 'web'/, "web storage must not replace native SecureStore");
});

test("native locale selection detects devices, persists choices, and switches RTL immediately", async () => {
  const provider = await read("i18n/provider.tsx");
  assert.match(provider, /getLocales\(\)\[0\]\?\.languageTag/);
  assert.match(provider, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.locale/);
  assert.match(provider, /navigator\.languages/);
  assert.match(provider, /AsyncStorage\.multiGet/);
  assert.match(provider, /LEGACY_STORAGE_KEY = 'appLanguage'/);
  assert.match(provider, /lookup\(active, key\) \?\? lookup\(baseDictionary, key\)/);
  assert.match(provider, /direction: value\.dir/);
  assert.match(provider, /I18nManager\.forceRTL/);
});

test("password reset deep link consumes the Supabase recovery session", async () => {
  const reset = await read("app/(auth)/reset-password.tsx");
  const completion = await read("lib/password-recovery-flow.ts");
  assert.match(completion, /auth\.updateUser\(\{ password: newPassword \}\)/);
  assert.match(completion, /auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(reset, /newPassword\.length < 8/);
  assert.match(reset, /completePasswordRecovery/);
  assert.match(reset, /t\('auth\.resetSuccess'\)/);
  assert.match(reset, /router\.replace\('\/\(auth\)\/login'\)/);
  const callback = await read("app/auth-callback.tsx");
  const authFlow = await read("lib/auth-flow.ts");
  const login = await read("app/(auth)/login.tsx");
  assert.match(callback, /exchangeCodeForSession/);
  assert.match(callback, /parsed\.isRecovery/);
  assert.match(authFlow, /query\.get\('type'\) === 'recovery' \|\| hash\.get\('type'\) === 'recovery'/);
  assert.match(callback, /reset-password/);
  assert.match(login, /router\.push\('\/\(auth\)\/forgot-password'/);
  assert.match(login, /t\('auth\.forgotPassword'\)/);
  assert.match(login, /accessibilityRole="link"/);
  const storage = await read("lib/supabase.ts");
  assert.match(storage, /async getItem\(key\)/);
  assert.match(storage, /scopedStorageKey\(key\)/);
  assert.doesNotMatch(storage, /async setItem\(_key/);
  const liveSupabase = await read("lib/liveSupabase.ts");
  assert.doesNotMatch(liveSupabase, /\.from\('profiles'\)\.upsert\(/);
  const layout = await read("app/_layout.tsx");
  assert.match(layout, /isAuthCallback/);
  assert.match(layout, /inAuthGroup \|\| isAuthCallback/);

  const config = JSON.parse(await read("app.json"));
  assert.equal(config.expo.scheme, "landoversea");
  assert.ok(config.expo.ios.associatedDomains.includes("applinks:landover-sea.com"));
  const data = config.expo.android.intentFilters.flatMap(filter => filter.data || []);
  assert.ok(data.some(entry => entry.scheme === "landoversea"));
  assert.ok(data.some(entry => entry.pathPrefix === "/reset-password"));
});

test("native auth email flows are single-flight, resendable, and deep-link safe", async () => {
  const register = await read("app/(auth)/register.tsx");
  const login = await read("app/(auth)/login.tsx");
  const forgot = await read("app/(auth)/forgot-password.tsx");
  const reset = await read("app/(auth)/reset-password.tsx");
  const callback = await read("app/auth-callback.tsx");

  assert.match(register, /supabase\.auth\.resend\(\{\s*type: 'signup'/);
  assert.doesNotMatch(register, /router\.replace\('\/\(auth\)\/login'\);\s*\}/);
  assert.match(register, /signupFlight = useRef\(false\)/);
  assert.match(register, /resendFlight = useRef\(false\)/);
  assert.match(
    register.slice(register.indexOf("const handleRegister"), register.indexOf("const handleResend")),
    /getEmailRetryAfter\(e\)[\s\S]*setResendCooldown\(emailRetryAfter\)[\s\S]*t\('auth\.verifyCooldown'\)/,
  );
  assert.match(register, /getEmailRetryAfter\(cause\)/);
  assert.match(login, /supabase\.auth\.signInWithOtp/);
  assert.match(login, /shouldCreateUser: false/);
  assert.match(login, /createAuthCallbackUrl\(\)/);
  assert.match(login, /magicLinkFlight = useRef\(false\)/);
  assert.match(login, /getEmailRetryAfter\(e\)/);
  assert.match(forgot, /recoveryFlight = useRef\(false\)/);
  assert.match(forgot, /getEmailRetryAfter\(cause\)/);
  assert.match(forgot, /createRecoveryCallbackUrl\(\)/);
  assert.match(forgot, /submitted[\s\S]*handleSubmit/);
  assert.match(reset, /updateFlight = useRef\(false\)/);
  assert.match(reset, /if \(updateFlight\.current \|\| loading\) return/);
  assert.match(reset, /accessibilityLabel=\{t\('auth\.newPassword'\)\}/);
  assert.match(reset, /accessibilityLabel=\{t\('auth\.confirmPassword'\)\}/);
  assert.match(callback, /Linking\.getInitialURL\(\)/);
  assert.match(callback, /Linking\.addEventListener\('url'/);
  assert.match(callback, /consumedCallbacks/);
  assert.match(callback, /token_hash/);
  assert.match(callback, /verifyOtp/);
  assert.doesNotMatch(callback, /SecureStore|AsyncStorage/);
});

test("native email retry parsing is bounded and limited to email-send callers", async () => {
  const helper = await read("lib/password-recovery.ts");
  const register = await read("app/(auth)/register.tsx");
  const login = await read("app/(auth)/login.tsx");

  assert.match(helper, /export function getEmailRetryAfter/);
  assert.match(helper, /error\.retryAfter, error\.retry_after/);
  assert.match(helper, /findRetryAfter\(error\.data\)/);
  assert.match(helper, /Math\.ceil\(retryAfter\)/);
  assert.match(helper, /MAX_EMAIL_RETRY_AFTER_SECONDS/);
  assert.match(helper, /if \(!isEmailRateLimitError\(error\)\) return 0/);
  assert.doesNotMatch(
    login.slice(login.indexOf("const handleLogin"), login.indexOf("const handleMagicLink")),
    /getEmailRetryAfter/,
  );
  assert.match(
    register.slice(register.indexOf("const handleRegister"), register.indexOf("const handleResend")),
    /getEmailRetryAfter\(e\)/,
  );
});

test("verification resend is throttled with visible disabled feedback", async () => {
  const verify = await read("app/(auth)/verify-email.tsx");
  assert.doesNotMatch(verify, /setResendCooldown\(60\)/);
  assert.match(verify, /data\.verificationDelivery !== 'email'/);
  assert.match(verify, /data\.retryAfter/);
  assert.match(verify, /details\.status === 429/);
  assert.match(verify, /disabled=\{resendCooldown > 0\}/);
  assert.match(verify, /accessibilityLiveRegion="polite"/);
  assert.match(verify, /auth\.verifyCooldown/);
});

test("onboarding shows localized validation and enforces adult and language limits", async () => {
  const onboarding = await read("app/onboarding.tsx");
  assert.match(onboarding, /validationError/);
  assert.match(onboarding, /accessibilityRole="alert"/);
  assert.match(onboarding, /age < 18/);
  assert.match(onboarding, /prev\.length >= 4/);
  assert.match(onboarding, /learningLanguages\.length > 4/);
  assert.match(onboarding, /onboarding\.langSelected/);
  assert.match(onboarding, /useLivePhotoMutations/);
  assert.match(onboarding, /asset\.mimeType \|\| asset\.file\?\.type \|\| inferPhotoMime/);
  assert.doesNotMatch(onboarding, /XMLHttpRequest|\/api\//);
  assert.match(onboarding, /retryPhotoAsset/);
  assert.match(onboarding, /confirmedPhotoUrl/);
  assert.match(onboarding, /disabled=\{step === 13 && \(!photoUploaded \|\| uploadingPhoto\)\}/);
  assert.doesNotMatch(onboarding, /name:\s*'photo\.jpg'[\s\S]{0,80}type:\s*'image\/jpeg'/);
});

test("startup, onboarding, and legal native flows are recoverable", async () => {
  const layout = await read("app/_layout.tsx");
  assert.match(layout, /StartupErrorScreen/);
  assert.match(layout, /retryStartup/);
  assert.match(layout, /name="terms"/);
  assert.match(layout, /name="privacy"/);

  const onboarding = await read("app/onboarding.tsx");
  assert.match(onboarding, /serverPhoto/);
  assert.match(onboarding, /profileQuery\.data\?\.photos/);
  assert.match(onboarding, /profileQuery\.refetch/);

  const register = await read("app/(auth)/register.tsx");
  assert.match(register, /router\.push\('\/terms'/);
  assert.match(register, /router\.push\('\/privacy'/);
  const settings = await read("app/settings.tsx");
  assert.match(settings, /router\.push\('\/terms'/);
  assert.match(settings, /router\.push\('\/privacy'/);
  for (const route of ["app/terms.tsx", "app/privacy.tsx"]) {
    const source = await read(route);
    assert.match(source, /ScrollView/);
    assert.match(source, /width:\s*44/);
  }
});

test("discovery filters are dirty-safe, complete, retryable, and tap-safe", async () => {
  const discover = await read("app/(tabs)/discover.tsx");
  assert.match(discover, /filtersDirty/);
  assert.match(discover, /if \(filters && !filtersDirty\)/);
  assert.match(discover, /isError \?/);
  assert.match(discover, /discover\.loadErrorTitle/);
  assert.doesNotMatch(discover, /useGetDiscoverFilters|useUpdateDiscoverFilters/);
  assert.match(discover, /setFilters\(filtersToSave\)/);
  for (const dimension of [
    "minAge", "maxAge", "gender", "relationshipGoal", "countries", "languages",
    "globalMode", "interestsOverlap", "longDistance", "relocation", "verifiedOnly",
  ]) assert.match(discover, new RegExp(`\\b${dimension}\\b`), `missing filter dimension ${dimension}`);
  assert.match(discover, /GESTURE_ACTIVATION_THRESHOLD/);
  assert.match(discover, /horizontalDistance > verticalDistance \* 1\.25/, "vertical movement must remain with the list");
  assert.match(discover, /position\.setValue\(\{ x: gestureState\.dx, y: 0 \}\)/, "card dragging must be horizontally locked");
  assert.doesNotMatch(discover, /gestureState\.dy < -SWIPE_THRESHOLD/, "vertical movement must not trigger a card action");
  assert.match(discover, /cardPressable/);
  assert.match(discover, /router\.push\(`\/profile\/\$\{currentCard\.userId\}`/);
  for (const [id, label] of [["discover-pass", "discover.pass"], ["discover-superlike", "discover.superLike"], ["discover-like", "discover.like"]]) {
    assert.match(discover, new RegExp(`testID=["']${id}["'][\\s\\S]{0,100}accessibilityLabel=\\{t\\(['"]${label.replace(".", "\\.")}['"]\\)\\}`), `${id} needs its localized accessible label`);
  }
  assert.match(discover, /onRequestClose=\{closeFilters\}/);
  assert.match(discover, /filterSessionRef\.current \+= 1/);
  assert.doesNotMatch(discover, /onPress=\{\(\) => setShowFilters\(false\)\}\s*disabled=\{updateFilters\.isPending\}/, "a hung save must not trap users");
});

test("discovery filter persistence is account-scoped with one-time guarded legacy migration", async () => {
  const discover = await read("app/(tabs)/discover.tsx");
  assert.match(discover, /const \{ user \} = useAuth\(\)/, "discovery persistence must follow the authenticated identity");
  assert.match(discover, /DISCOVERY_FILTERS_STORAGE_KEY_PREFIX/);
  assert.match(discover, /encodeURIComponent\(userId\)/, "account IDs must produce safe scoped keys");
  assert.match(discover, /if \(!userId\) return;/, "unauthenticated state must never be persisted");
  assert.match(discover, /persistDiscoveryFilters\(storageKey, filtersToSave, ownsSave\)/);
  assert.doesNotMatch(
    discover,
    /AsyncStorage\.setItem\(LEGACY_DISCOVERY_FILTERS_STORAGE_KEY/,
    "the legacy global key must never receive new filter state",
  );
  assert.match(discover, /if \(stored !== null\) return[\s\S]*legacyMigrationQueue/, "migration is allowed only when the scoped key is absent");
  assert.match(discover, /parseStoredFilters\(legacyValue\) \?\? normalizeFilters\(\)/, "malformed legacy data must become defaults");
  assert.match(discover, /AsyncStorage\.setItem\(storageKey[\s\S]*AsyncStorage\.removeItem\(LEGACY_DISCOVERY_FILTERS_STORAGE_KEY\)/, "migration must save scoped state before removing the global value");
  assert.match(discover, /setFiltersOwnerUserId\(null\)[\s\S]*loadDiscoveryFilters\(storageKey\)/, "account switches must reset before loading");
  assert.match(discover, /filterLoadGenerationRef\.current !== generation/, "late loads must not cross account boundaries");
  assert.match(discover, /filtersOwnerUserId === userId \? filters : DEFAULT_FILTERS/, "render-before-effect identity changes must expose defaults");
});

test("discovery filter saves are ordered, load-race safe, and retryable after failure", async () => {
  const discover = await read("app/(tabs)/discover.tsx");
  assert.match(discover, /accountPersistenceQueues = new Map<string, Promise<void>>\(\)/);
  assert.match(discover, /previous\.catch\([\s\S]*\)\.then\(operation\)/, "per-account operations must execute sequentially even after a failure");
  assert.match(discover, /return runAccountPersistenceOperation\(storageKey/, "loads and saves must share the same account queue");
  assert.match(discover, /filterLoadGenerationRef\.current = saveGeneration[\s\S]*await persistDiscoveryFilters/, "save must invalidate an in-flight load before yielding");
  assert.match(discover, /const persisted = await persistDiscoveryFilters/, "save persistence must not be fire-and-forget");
  assert.match(discover, /renderedUserIdRef\.current === expectedUserId/, "queued writes must recheck account ownership");
  assert.match(discover, /if \(!canWrite\(\)\) return false[\s\S]*AsyncStorage\.setItem/, "an old account's queued write must be cancelled before storage");
  assert.match(discover, /await persistDiscoveryFilters[\s\S]*setShowFilters\(false\)/, "the modal may dismiss only after persistence succeeds");
  assert.match(discover, /catch \{[\s\S]*setFilterSaveError\(t\('premium\.genericError'\)\)/, "save failures must expose a localized generic error");
  assert.match(discover, /testID="discover-filter-save-error"[\s\S]*accessibilityRole="alert"/, "save errors must be visible and accessible");
  assert.doesNotMatch(discover, /catch \{[\s\S]{0,250}setShowFilters\(false\)/, "failure must retain the draft modal for retry");
});

test("discovery gender filters canonicalize legacy storage and save canonical values", async () => {
  const discover = await read("app/(tabs)/discover.tsx");
  for (const canonical of ["male", "female", "non_binary"]) {
    assert.match(discover, new RegExp(`value: ['\"]${canonical}['\"]`));
  }
  assert.doesNotMatch(discover, /value: ['"](?:man|woman|non-binary)['"]/);
  assert.match(discover, /normalized === 'male' \|\| normalized === 'man'[\s\S]*return 'male'/);
  assert.match(discover, /normalized === 'female' \|\| normalized === 'woman'[\s\S]*return 'female'/);
  assert.match(discover, /normalized === 'non_binary' \|\| normalized === 'nonbinary'[\s\S]*return 'non_binary'/);
  assert.match(discover, /gender:\s*canonicalDiscoveryGender\(filters\?\.gender\)/, "loads and saves must normalize through canonical gender");
  assert.match(discover, /persistDiscoveryFilters\(storageKey, filtersToSave, ownsSave\)/, "the normalized canonical draft must be persisted");
});

test("workshop and tribe membership failures remain visible, retryable, and invalidate stale queries", async () => {
  const workshop = await read("app/workshops/[id].tsx");
  assert.match(workshop, /await enroll\.mutateAsync/);
  assert.match(workshop, /getGetWorkshopQueryKey\(id\)/, "workshop detail cache must be invalidated");
  assert.match(workshop, /getGetWorkshopsQueryKey\(\)/, "all workshop list variants must be invalidated by prefix");
  assert.match(workshop, /accessibilityLiveRegion="assertive"/);
  assert.match(workshop, /testID="retry-workshop-enrollment"/);

  const tribe = await read("app/tribes/[id].tsx");
  assert.match(tribe, /await (?:leave|join)\.mutateAsync/);
  assert.match(tribe, /invalidateQueries\(\{ queryKey: getGetTribesQueryKey\(\) \}\)/);
  assert.match(tribe, /accessibilityLiveRegion="assertive"/);
  assert.match(tribe, /testID="retry-tribe-membership"/);
  assert.match(tribe, /testID=\{tribe\.isMember \? 'leave-tribe' : 'join-tribe'\}/);
});

test("native profile photos and locations use Supabase while current-user preferences use their safe bridge", async () => {
  const profile = await read("app/(tabs)/profile.tsx");
  assert.match(profile, /useLiveMyProfile/);
  assert.match(profile, /find\(photo => photo\.isPrimary\) \?\? photos\[0\]/);
  assert.match(profile, /AuthenticatedProfileImage/);
  assert.match(profile, /isLoading/);
  assert.match(profile, /isError/);

  const edit = await read("app/profile/edit.tsx");
  assert.match(edit, /useLivePhotoMutations/);
  for (const operation of ["photoMutations.upload", "photoMutations.remove", "photoMutations.reorder", "photoMutations.primary"]) {
    assert.match(edit, new RegExp(operation.replace(".", "\\.")), `missing ${operation}`);
  }
  assert.match(edit, /slice\(0,\s*6\)/);
  assert.match(edit, /profileQuery\.refetch/);
  assert.match(edit, /photos\.length === 1/);

  const settings = await read("app/settings.tsx");
  assert.match(settings, /useLiveLocations/);
  assert.match(settings, /useGetNotificationPreferences/);
  assert.match(settings, /useUpdateNotificationPreferences/);
  assert.match(settings, /failedPreferences/);
  assert.doesNotMatch(settings, /AsyncStorage|localStorage/);
});

test("push project-ID truthfulness is observed", async () => {
  const pushCode = await read("lib/push.ts");
  assert.match(pushCode, /Constants\.expoConfig\?\.extra\?\.eas\?\.projectId/);
  assert.match(pushCode, /registerPushToken/);
});

test("no hosted-web shell or fake remote images", async () => {
  const discover = await read("app/(tabs)/discover.tsx");
  assert.doesNotMatch(discover, /react-native-webview/);
  assert.doesNotMatch(discover, /unsplash/i);

  const onboarding = await read("app/onboarding.tsx");
  assert.doesNotMatch(onboarding, /unsplash/i);
});

test("chat maintains stable retry IDs", async () => {
  const chat = await read("app/messages/[conversationId].tsx");
  assert.match(chat, /clientRequestId/);
  assert.match(chat, /createClientRequestId/);
  assert.match(chat, /randomUUID/);
  assert.doesNotMatch(chat, /Date\.now\(\)\.toString\(\) \+ ['"]-['"] \+ Math\.random/);
  assert.match(chat, /retry/i);
});

test("message attachments remain disabled without a UUID-safe contract", async () => {
  const chat = await read("app/messages/[conversationId].tsx");
  assert.doesNotMatch(chat, /AuthenticatedMediaImage|useRequestUploadUrl|useUploadMessageAttachment/);
  assert.match(chat, /Attachments, reactions, read receipts, and saved conversation translation preferences are unavailable/);
});

test("tab bar follows appearance and touched stack headers expose full-size accessible back controls", async () => {
  const tabs = await read("app/(tabs)/_layout.tsx");
  assert.match(tabs, /useColorScheme/);
  assert.match(tabs, /colors\.navigation/);
  assert.match(tabs, /colors\.mutedForeground/);
  assert.match(tabs, /colorScheme === ['"]dark['"] \? ['"]dark['"] : ['"]light['"]/);
  assert.doesNotMatch(tabs, /<BlurView tint=['"]dark['"]/);

  for (const route of [
    "app/safety.tsx",
    "app/learning.tsx",
    "app/culture.tsx",
    "app/notifications.tsx",
    "app/coaches/[id].tsx",
    "app/coaches/dashboard.tsx",
    "app/messages/[conversationId].tsx",
  ]) {
    const source = await read(route);
    assert.match(source, /accessibilityLabel=\{t\(['"]common\.back['"]\)\}/, `${route} back control needs a label`);
    assert.match(source, /(?:backButton|backBtn):\s*\{[^}]*width:\s*44[^}]*height:\s*44/, `${route} back target must be at least 44pt`);
    assert.doesNotMatch(source, /<Ionicons[^>]+(?:chevron-back|arrow-back)[^>]+onPress=/s, `${route} must not attach back presses to an icon`);
  }
});

test("primitives preserve readable text contrast", async () => {
  const colors = await read("constants/colors.ts");
  assert.match(colors, /disabled:/);
  assert.match(colors, /disabledForeground:/);
  assert.match(colors, /placeholder:/);
  assert.match(colors, /overlayForeground:/);
  assert.match(colors, /overlay:\s*'rgba\(0, 0, 0, 0\.[6-9]\d*\)'/g, "overlay must be neutral black with sufficient opacity");
  assert.doesNotMatch(colors, /overlay:\s*'rgba\((?!0, 0, 0)/, "overlay must not be tinted to guarantee text contrast over bright images");

  const button = await read("components/ui/Button.tsx");
  assert.doesNotMatch(button, /opacity:\s*0\.5/, "disabled buttons must remain readable via colors, not low opacity");
  assert.match(button, /colors\.disabledForeground/);

  const input = await read("components/ui/Input.tsx");
  assert.match(input, /placeholderTextColor=\{placeholderTextColor \?\? colors\.placeholder\}/);
});

test("network-backed collection screens expose loading, error, retry, and pull-to-refresh", async () => {
  for (const route of [
    "app/(tabs)/messages.tsx",
    "app/(tabs)/matches.tsx",
    "app/(tabs)/coaches.tsx",
    "app/notifications.tsx",
  ]) {
    const source = await read(route);
    assert.match(source, /isLoading/, `${route} needs loading state`);
    assert.match(source, /isError/, `${route} needs error state`);
    assert.match(source, /refetch/, `${route} needs retry`);
    assert.match(source, /RefreshControl/, `${route} needs pull-to-refresh`);
  }
  const messages = await read("app/(tabs)/messages.tsx");
  assert.match(messages, /useLiveMatches/, "conversation list needs live Supabase freshness");
  const notifications = await read("app/notifications.tsx");
  assert.match(notifications, /markingIds/);
  assert.match(notifications, /refetchInterval:\s*30_000/);
});

test("conversation fetch is recoverable and fresh without unsafe read-receipt calls", async () => {
  const source = await read("app/messages/[conversationId].tsx");
  assert.match(source, /conversationQuery\.isError/);
  assert.match(source, /messagesQuery\.isError/);
  assert.match(source, /RefreshControl/);
  assert.match(source, /subscribeLiveMessages/);
  assert.match(source, /status === 'SUBSCRIBED'|messagesQuery\.refetch/);
  assert.doesNotMatch(source, /useMarkConversationRead|markedConversationId/);
  assert.match(source, /read receipts.+unavailable/);
});

test("events, tribes, and workshops are real generated-API list/detail flows", async () => {
  const flows = [
    ["events", "useGetCulturalEvents", "useRsvpEvent"],
    ["tribes", "useGetTribes", "useJoinTribe"],
    ["workshops", "useGetWorkshops", "useEnrollWorkshop"],
  ];
  for (const [name, listHook, mutationHook] of flows) {
    for (const suffix of ["index.tsx", "[id].tsx"]) assert.ok(await exists(`app/${name}/${suffix}`), `missing ${name}/${suffix}`);
    const list = await read(`app/${name}/index.tsx`);
    const detail = await read(`app/${name}/[id].tsx`);
    assert.match(list, new RegExp(listHook));
    assert.match(list, /RefreshControl/);
    assert.match(list, /isError/);
    assert.match(detail, new RegExp(mutationHook));
    assert.match(detail, new RegExp(`mobile\\.${name.slice(0, -1)}NotFound|mobile\\.workshopNotFound`));
    assert.match(detail, /isError/);
  }
  assert.match(await read("app/culture.tsx"), /router\.push\(['"]\/events['"]/);
  assert.match(await read("app/culture.tsx"), /router\.push\(['"]\/tribes['"]/);
  assert.match(await read("app/(tabs)/coaches.tsx"), /router\.push\(['"]\/workshops['"]/);
});

test("native event RSVP cancellation is generated, retryable, and localized", async () => {
  for (const route of ["app/events/index.tsx", "app/events/[id].tsx"]) {
    const source = await read(route);
    assert.match(source, /useCancelEventRsvp/, `${route} must use the generated cancellation mutation`);
    assert.match(source, /invalidateQueries/, `${route} must synchronize persisted RSVP state`);
    assert.match(source, /cancelRsvpError/, `${route} must expose cancellation failures`);
    assert.match(source, /common\.retry/, `${route} cancellation failures must be retryable`);
  }
  const detail = await read("app/events/[id].tsx");
  assert.match(detail, /testID=\{event\.isRsvped \? 'cancel-event-rsvp'/);
  assert.match(detail, /accessibilityLiveRegion="polite"/);

  for (const locale of ["ar", "de", "en", "es", "fr", "hi", "id", "it", "ja", "ko", "lo", "pt", "ru", "th", "vi", "zh-CN"]) {
    const source = await read(`i18n/locales/${locale}.ts`);
    for (const key of ["cancelRsvp", "rsvpCancelled", "cancelRsvpError"]) {
      assert.match(source, new RegExp(`\\b${key}:`), `${locale}.mobile.${key} missing`);
    }
  }
});

test("notification routing is allowlisted with graceful internal fallback and support opens safety", async () => {
  const routes = await read("lib/internalRoutes.ts");
  for (const route of ["messages", "coaches", "profile", "events", "tribes", "workshops"]) {
    assert.match(routes, new RegExp(route), `missing safe route ${route}`);
  }
  assert.match(routes, /return ['"]\/not-found['"]/);
  assert.match(routes, /return ['"]\/notifications['"]/);
  assert.doesNotMatch(routes, /https?:|universal/i);
  assert.match(await read("app/_layout.tsx"), /resolveInternalRoute/);
  assert.match(await read("app/settings.tsx"), /router\.push\(['"]\/safety['"]/);
});

test("HTTPS association manifests match the canonical internal route allowlist", async () => {
  const routeSource = await read("lib/internalRoutes.ts");
  const listMatch = routeSource.match(/export const INTERNAL_LINK_PATHS = \[([\s\S]*?)\] as const;/);
  assert.ok(listMatch, "internal routes must export the canonical HTTPS path list");
  const canonicalPaths = [...listMatch[1].matchAll(/'([^']+)'/g)].map(match => match[1]);

  const config = JSON.parse(await read("app.json"));
  const httpsPaths = config.expo.android.intentFilters
    .flatMap(filter => filter.data || [])
    .filter(entry => entry.scheme === "https" && entry.host === "landover-sea.com")
    .map(entry => entry.pathPrefix);
  assert.deepEqual(httpsPaths.sort(), [...canonicalPaths].sort(), "Android HTTPS paths differ from internal routes");

  const association = JSON.parse(await read("release/apple-app-site-association.template"));
  const applePaths = association.applinks.details[0].paths;
  for (const path of canonicalPaths) {
    assert.ok(applePaths.includes(path), `Apple association is missing ${path}`);
  }
  for (const dynamicBase of ["/messages", "/profile", "/coaches", "/events", "/tribes", "/workshops"]) {
    assert.ok(applePaths.includes(`${dynamicBase}/*`), `Apple association is missing ${dynamicBase}/*`);
  }
  assert.match(association.applinks.details[0].appID, /^REPLACE_WITH_APPLE_TEAM_ID\./);
});

test("event, tribe, and workshop screens localize literals and support RTL", async () => {
  const routeFiles = [
    "app/events/index.tsx", "app/events/[id].tsx",
    "app/tribes/index.tsx", "app/tribes/[id].tsx",
    "app/workshops/index.tsx", "app/workshops/[id].tsx",
  ];
  for (const route of routeFiles) {
    const source = await read(route);
    assert.match(source, /useI18n\(\)/, route);
    assert.match(source, /writingDirection:\s*dir|dir === ['"]rtl['"]/, `${route} must be RTL-safe`);
    assert.doesNotMatch(source, />\s*(?:No upcoming|Event not found|Tribe not found|Workshop not found|Join tribe|Leave tribe|Could not (?:save|update|enroll))[^<{]*</, route);
  }
  const keys = [
    "eventsEmpty", "eventNotFound", "rsvp", "rsvpConfirmed", "rsvpError",
    "tribesEmpty", "tribeNotFound", "membersCount", "joinTribe", "leaveTribe", "tribeMembershipError",
    "workshopsEmpty", "workshopNotFound", "participantsCount", "workshopDurationParticipants",
    "enroll", "enrolled", "workshopEnrollError",
  ];
  for (const locale of ["ar", "de", "en", "es", "fr", "hi", "id", "it", "ja", "ko", "lo", "pt", "ru", "th", "vi", "zh-CN"]) {
    const source = await read(`i18n/locales/${locale}.ts`);
    for (const key of keys) assert.match(source, new RegExp(`\\b${key}:`), `${locale}.mobile.${key} missing`);
  }
});

test("admin route trusts server role and exposes generated moderation controls", async () => {
  const admin = await read("app/admin.tsx");
  const profile = await read("app/(tabs)/profile.tsx");
  const settings = await read("app/settings.tsx");
  assert.match(admin, /useGetCurrentUser/);
  assert.match(admin, /userQuery\.data\?\.role === ['"]admin['"]/);
  assert.match(admin, /enabled:\s*isAdmin/);
  for (const hook of ["useAdminListReports", "useAdminReviewReport", "useAdminListVerifications", "useAdminReviewVerification"]) {
    assert.match(admin, new RegExp(hook), `admin route missing ${hook}`);
  }
  assert.match(admin, /isLoading/);
  assert.match(admin, /isError/);
  assert.match(admin, /refetch/);
  assert.match(admin, /approve-verification-/);
  assert.match(admin, /reject-verification-/);
  assert.match(admin, /dismiss-report-/);
  assert.match(admin, /action-report-/);
  assert.match(profile, /profile\?\.role === ['"]admin['"][\s\S]*router\.push\(['"]\/admin/);
  assert.match(settings, /profile\?\.role === ['"]admin['"][\s\S]*router\.push\(['"]\/admin/);
});

test("coaching application, management, discovery, detail, and booking are reachable", async () => {
  const application = await read("app/coaches/apply.tsx");
  const dashboard = await read("app/coaches/dashboard.tsx");
  const discovery = await read("app/(tabs)/coaches.tsx");
  const detail = await read("app/coaches/[id].tsx");
  const profile = await read("app/(tabs)/profile.tsx");
  const settings = await read("app/settings.tsx");
  for (const hook of ["useGetMyCoachProfile", "useCreateCoachProfile", "useSubmitCoachVerification"]) assert.match(application, new RegExp(hook));
  assert.match(application, /verificationStatus/);
  assert.match(dashboard, /useUpdateCoachProfile/);
  assert.match(dashboard, /save-coach-profile/);
  assert.match(discovery, /router\.push\(`\/coaches\/\$\{item\.id\}`/);
  assert.match(detail, /getUuidCoachAvailability/);
  assert.match(detail, /createUuidCoachBooking/);
  assert.doesNotMatch(detail, /\b(?:Number|parseInt)\s*\(\s*liveCoachId/);
  for (const source of [profile, settings]) {
    assert.match(source, /\/coaches\/apply/);
    assert.match(source, /\/coaches\/dashboard/);
  }
});

test("source has no known placeholder, translation fallback, or production-domain fallback", async () => {
  const files = [
    ...await sourceFiles("app"),
    ...await sourceFiles("components"),
    ...await sourceFiles("lib"),
  ];
  for (const file of files) {
    const source = await read(file);
    assert.doesNotMatch(source, /Edit Profile Form|https:\/\/landoversea\.com|Sent an attachment|['"]Unknown['"]/, file);
    assert.doesNotMatch(source, /t\([^\n]+\)\s*\|\|\s*['"]/, file);
  }
});

test("every locale provides complete, translated mobile strings", async () => {
  const localeNames = ["ar", "de", "es", "fr", "hi", "id", "it", "ja", "ko", "lo", "pt", "ru", "th", "vi", "zh-CN"];
  const english = mobileEntries(await read("i18n/locales/en.ts"));
  const properNouns = new Set(["LandOverSEA"]);
  const properNounOrLoanwordKeys = new Set([
    "xpLabel", "errorLabel", "languageMandarin", "languageHindi", "languageTagalog", "languageSwahili",
    "interestArt", "interestYoga", "interestSports", "interestAnime", "interestKPop", "interestJazz",
    "interestMeditation", "interestFestivals", "interestArchitecture",
  ]);
  const requiredKeys = [
    "noCoachesAvailable", "levelLabel", "xpLabel", "learningPracticeDescription", "errorReloadDescription", "errorDetails",
    "viewErrorDetails", "closeErrorDetails", "errorLabel", "stackTraceLabel",
    ...["English", "Mandarin", "Spanish", "French", "Japanese", "Korean", "Portuguese", "Arabic", "Hindi", "German", "Italian", "Russian", "Thai", "Vietnamese", "Indonesian", "Malay", "Turkish", "Dutch", "Polish", "Swedish", "Tagalog", "Swahili"].map(value => `language${value}`),
    ...["Japan", "Korea", "France", "Brazil", "India", "Mexico", "Nigeria", "Italy", "China", "Spain", "UK", "Australia", "Germany", "Morocco", "Colombia", "Ethiopia", "Turkey", "Indonesia", "Philippines", "Egypt"].map(value => `country${value}`),
    ...["Languages", "Cooking", "Music", "Art", "Hiking", "Photography", "Movies", "Reading", "Yoga", "Dancing", "Gaming", "Fashion", "Sports", "Coffee", "Wine", "TeaCeremonies", "Meditation", "Surfing", "Cycling", "Festivals", "History", "Architecture", "StreetFood", "Anime", "KPop", "Jazz", "ClassicalMusic", "Volunteering", "Entrepreneurship"].map(value => `interest${value}`),
  ];

  assert.ok(english.has("nativeSubscriptionUnavailable"));
  for (const key of requiredKeys) assert.ok(english.has(key), `en.mobile.${key} is missing`);
  for (const localeName of localeNames) {
    const localized = mobileEntries(await read(`i18n/locales/${localeName}.ts`));
    assert.deepEqual([...localized.keys()].sort(), [...english.keys()].sort(), `${localeName} mobile keys differ from English`);
    for (const [key, englishValue] of english) {
      const localizedValue = localized.get(key);
      assert.ok(localizedValue, `${localeName}.mobile.${key} must not be empty`);
      const properName = key.startsWith("country");
      assert.ok(localizedValue !== englishValue || properNouns.has(englishValue) || properName || properNounOrLoanwordKeys.has(key), `${localeName}.mobile.${key} still equals English`);
      assert.deepEqual(
        [...localizedValue.matchAll(/\{[^}]+\}/g)].map(match => match[0]).sort(),
        [...englishValue.matchAll(/\{[^}]+\}/g)].map(match => match[0]).sort(),
        `${localeName}.mobile.${key} placeholders differ from English`,
      );
    }
  }
});

test("onboarding retains all fourteen stages and full web option sets", async () => {
  const source = await read("app/onboarding.tsx");
  const branches = new Set([...source.matchAll(/step === (\d+)/g)].map(match => Number(match[1])));
  for (let step = 1; step <= 14; step += 1) assert.ok(branches.has(step), `missing step ${step}`);
  assert.equal(branches.size, 14);
  for (const [name, minimum] of [["GENDER_OPTIONS", 6], ["LANGUAGE_OPTIONS", 22], ["COUNTRY_OPTIONS", 20], ["INTERESTS_OPTIONS", 30], ["CULTURAL_GOALS", 6]]) {
    const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
    assert.ok(match, `missing ${name}`);
    assert.ok((match[1].match(/"[^"]+"/g) || []).length >= minimum, `${name} is incomplete`);
  }
});

test("onboarding localizes display labels without changing submitted option values", async () => {
  const source = await read("app/onboarding.tsx");
  const stableValues = {
    LANGUAGE_OPTIONS: ["English", "Mandarin", "Spanish", "French", "Japanese", "Korean", "Portuguese", "Arabic", "Hindi", "German", "Italian", "Russian", "Thai", "Vietnamese", "Indonesian", "Malay", "Turkish", "Dutch", "Polish", "Swedish", "Tagalog", "Swahili"],
    COUNTRY_OPTIONS: ["Japan", "Korea", "France", "Brazil", "India", "Mexico", "Nigeria", "Italy", "China", "Spain", "UK", "Australia", "Germany", "Morocco", "Colombia", "Ethiopia", "Turkey", "Indonesia", "Philippines", "Egypt"],
    INTERESTS_OPTIONS: ["Travel", "Languages", "Cooking", "Music", "Art", "Hiking", "Photography", "Movies", "Reading", "Yoga", "Dancing", "Gaming", "Fashion", "Sports", "Coffee", "Wine", "Tea Ceremonies", "Meditation", "Surfing", "Cycling", "Festivals", "History", "Architecture", "Street Food", "Anime", "K-pop", "Jazz", "Classical Music", "Volunteering", "Entrepreneurship"],
  };
  for (const [name, expected] of Object.entries(stableValues)) {
    const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
    assert.ok(match, `missing ${name}`);
    assert.deepEqual([...match[1].matchAll(/"([^"]+)"/g)].map(result => result[1]), expected, `${name} persisted values changed`);
  }
  assert.match(source, /DISPLAY_LABEL_KEYS/);
  assert.match(source, /return t\(DISPLAY_LABEL_KEYS/);
  assert.doesNotMatch(source, /title=\{(?:l|c|interest)\}/, "onboarding must not render raw option values");
  assert.match(source, /primaryLanguage:\s*formData\.primaryLanguage/);
  assert.match(source, /learningLanguages,/);
  assert.match(source, /countriesOfInterest:\s*preferredCountries/);
  assert.match(source, /interests,/);
});

test("private uploads convert Blob to ArrayBuffer before authorized PUT", async () => {
  for (const file of ["app/coaches/dashboard.tsx"]) {
    const source = await read(file);
    assert.match(source, /\.blob\(\)/, file);
    assert.match(source, /\.arrayBuffer\(\)/, file);
    assert.match(source, /method:\s*['"]PUT['"]/, file);
    assert.match(source, /uploadURL/, file);
  }
});

test("registration, discovery, auth allowlist, push, and release artifacts are wired", async () => {
  const register = await read("app/(auth)/register.tsx");
  assert.match(register, /step === 1/);
  assert.match(register, /step === 2/);
  assert.match(register, /step === 3/);
  assert.match(register, /LOCALE_META/);
  assert.match(register, /isAdult/);
  assert.match(register, /accepted_age_requirement:\s*true/);
  assert.match(register, /useGetAuthProviders/);

  const discover = await read("app/(tabs)/discover.tsx");
  assert.match(discover, /useLiveDiscovery/);
  assert.match(discover, /useLiveSwipe/);
  assert.doesNotMatch(discover, /useGetDiscoverFilters|useUpdateDiscoverFilters|useGetSuperlikeBalance/);

  const layout = await read("app/_layout.tsx");
  assert.match(layout, /delete-account-request/);
  assert.match(layout, /isPublicDeletion/);
  assert.match(layout, /if \(!user && !isPublic\)/);

  const push = await read("lib/push.ts");
  assert.match(push, /registerPushToken/);
  assert.match(push, /unavailable|denied/);

  assert.ok(await exists("eas.json"));
  for (const artifact of [
    "release/README.md", "release/app-store-metadata.txt", "release/play-store-metadata.txt",
    "release/privacy-data-map.md", "release/apple-app-site-association.template",
    "release/assetlinks.json.template",
  ]) assert.ok(await exists(artifact), `missing ${artifact}`);
});

test("native chat restores UUID-independent translation while disabling integer-only rich actions", async () => {
  const chat = await read("app/messages/[conversationId].tsx");
  assert.doesNotMatch(chat, /useUpdateTranslationPreferences|usePreviewMessageTranslation|useTranslateMessage|useReactToMessage/);
  assert.match(chat, /writingDirection:\s*(?:getDir|dir|originalDir)/);
  assert.match(chat, /flatList|loadEarlier|Load earlier/i);
  assert.match(chat, /retry/i);
  assert.match(chat, /translateText/);
  assert.match(chat, /draftTranslation/);
  assert.match(chat, /messageTranslations/);
  assert.match(chat, /saved conversation translation preferences are unavailable/);
  assert.match(chat, /failed/);
  assert.match(chat, /group/i);
  assert.doesNotMatch(chat, /@workspace\/api-client-react/);
  assert.match(chat, /if \(cursor !== undefined\) setCursor\(undefined\)/);
});
