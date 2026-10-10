import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PurchasesPackage } from 'react-native-purchases';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useColors } from '@/hooks/useColors';
import { useI18n } from '@/i18n';
import { useRevenueCat } from '@/lib/revenuecat';

export default function PremiumScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t, locale } = useI18n();
  const router = useRouter();
  const {
    packages,
    premiumEntitlement,
    isPremium,
    serverSynchronized,
    isPreviewPremium,
    isLoading,
    isPurchasing,
    isRestoring,
    isTestMode,
    configurationAvailable,
    error,
    refresh,
    purchase,
    restore,
    clearError,
  } = useRevenueCat();
  const [confirmationPackage, setConfirmationPackage] = useState<PurchasesPackage | null>(null);
  const [notice, setNotice] = useState<'cancelled' | 'restored' | 'nothingToRestore' | null>(null);
  const compact = width < 560;
  const webTopInset = Platform.OS === 'web' ? 67 : 0;
  const webBottomInset = Platform.OS === 'web' ? 34 : 0;

  const activeProductName = useMemo(() => {
    if (!premiumEntitlement) return null;
    return packages.find(item => item.product.identifier === premiumEntitlement.productIdentifier)
      ?.product.title ?? null;
  }, [packages, premiumEntitlement]);

  const completePurchase = async (selectedPackage: PurchasesPackage) => {
    setConfirmationPackage(null);
    setNotice(null);
    try {
      const result = await purchase(selectedPackage);
      if (result === 'cancelled') setNotice('cancelled');
    } catch {
      // The provider exposes a localized error state for rendering.
    }
  };

  const requestPurchase = (selectedPackage: PurchasesPackage) => {
    clearError();
    setNotice(null);
    if (isTestMode) {
      setConfirmationPackage(selectedPackage);
    } else {
      void completePurchase(selectedPackage);
    }
  };

  const handleRestore = async () => {
    setNotice(null);
    try {
      const restoredInfo = await restore();
      setNotice(restoredInfo.entitlements.active.premium ? 'restored' : 'nothingToRestore');
    } catch {
      // The provider exposes a localized error state for rendering.
    }
  };

  const visibleError = error?.kind === 'reconcile' && isPreviewPremium ? null : error;
  const errorText = visibleError?.kind === 'configuration'
    ? t('premium.storeConfigurationUnavailable')
    : visibleError?.kind === 'purchase'
      ? t('premium.purchaseError')
      : visibleError?.kind === 'restore'
        ? t('premium.restoreError')
        : visibleError?.kind === 'reconcile'
          ? t('premium.syncError')
          : t('premium.loadError');

  const noticeText = notice === 'cancelled'
    ? t('premium.checkoutCancelled')
    : notice === 'restored'
      ? isPreviewPremium
        ? t('premium.previewRestoreSuccess')
        : t('premium.restoreSuccess')
      : notice === 'nothingToRestore'
        ? t('premium.nothingToRestore')
        : null;

  return (
    <View style={[
      styles.container,
      { backgroundColor: colors.background, paddingTop: Math.max(insets.top, webTopInset) },
    ]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.backButton}
          testID="premium-back"
        >
          <Ionicons name="chevron-back" size={28} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('premium.title')}</Text>
      </View>

      {isLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
            {t('premium.loadingPlans')}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={[
            styles.contentContainer,
            { paddingBottom: Math.max(insets.bottom, webBottomInset) + 28 },
          ]}
        >
          <View style={[styles.contentWidth, !compact && styles.contentWide]}>
            {isPremium ? (
              <GlassCard style={[styles.activeCard, { borderColor: colors.primary }]}>
                <View style={[styles.iconCircle, { backgroundColor: colors.glassStrong }]}>
                  <Ionicons name="star" size={38} color={colors.primary} />
                </View>
                <Text style={[styles.activeTitle, { color: colors.foreground }]}>
                  {t('premium.active')}
                </Text>
                {activeProductName ? (
                  <Text style={[styles.productName, { color: colors.foreground }]}>
                    {activeProductName}
                  </Text>
                ) : null}
                <Text style={[styles.activeDescription, { color: colors.mutedForeground }]}>
                  {premiumEntitlement?.expirationDate
                    ? t('premium.renews', {
                        date: new Date(premiumEntitlement.expirationDate).toLocaleDateString(locale),
                      })
                    : t('premium.activeEntitlement')}
                </Text>
                {!serverSynchronized && !isPreviewPremium ? (
                  <Text
                    accessibilityRole="alert"
                    style={[styles.syncStatus, { color: colors.mutedForeground }]}
                  >
                    {t('premium.syncPending')}
                  </Text>
                ) : null}
              </GlassCard>
            ) : (
              <>
                <View style={styles.hero}>
                  <Text style={[styles.eyebrow, { color: colors.accent }]}>
                    {t('premium.heading')}
                  </Text>
                  <Text style={[styles.heroTitle, { color: colors.foreground }]}>
                    {t('premium.upgrade')}
                  </Text>
                  <Text style={[styles.heroDesc, { color: colors.mutedForeground }]}>
                    {t('premium.subtitle')}
                  </Text>
                </View>
                <View style={[styles.features, !compact && styles.featuresWide]}>
                  {([
                    'premium.featureSeeLikes',
                    'premium.featureUnlimited',
                    'premium.featureBoost',
                    'premium.featureAdvancedFilters',
                  ] as const).map(feature => (
                    <View key={feature} style={styles.featureRow}>
                      <Ionicons name="checkmark-circle" size={23} color={colors.primary} />
                      <Text style={[styles.featureText, { color: colors.foreground }]}>{t(feature)}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {isPreviewPremium ? (
              <View
                accessibilityRole="alert"
                testID="premium-preview-only"
                style={[styles.notice, { backgroundColor: colors.glass, borderColor: colors.border }]}
              >
                <Text style={[styles.messageTitle, { color: colors.foreground }]}>
                  {t('premium.previewOnlyTitle')}
                </Text>
                <Text style={[styles.messageText, { color: colors.mutedForeground }]}>
                  {t('premium.previewOnlyDescription')}
                </Text>
                <Button
                  title={t('common.retry')}
                  variant="outline"
                  size="sm"
                  onPress={() => void refresh()}
                  loading={isLoading}
                  disabled={isLoading || isPurchasing || isRestoring}
                  testID="premium-retry"
                />
              </View>
            ) : null}

            {visibleError ? (
              <GlassCard
                accessibilityRole="alert"
                style={[styles.messageCard, { borderColor: colors.destructive }]}
              >
                <Ionicons name="warning-outline" size={24} color={colors.destructive} />
                <View style={styles.messageBody}>
                  <Text style={[styles.messageTitle, { color: colors.foreground }]}>
                    {t('premium.genericError')}
                  </Text>
                  <Text style={[styles.messageText, { color: colors.mutedForeground }]}>{errorText}</Text>
                </View>
                {visibleError.kind !== 'configuration' ? (
                  <Button
                    title={t('common.retry')}
                    variant="outline"
                    size="sm"
                    onPress={() => void refresh()}
                    loading={isLoading}
                    disabled={isLoading || isPurchasing || isRestoring}
                    testID="premium-retry"
                  />
                ) : null}
              </GlassCard>
            ) : null}

            {noticeText ? (
              <View
                accessibilityRole="alert"
                style={[styles.notice, { backgroundColor: colors.glass, borderColor: colors.border }]}
              >
                <Text style={[styles.noticeText, { color: colors.foreground }]}>{noticeText}</Text>
              </View>
            ) : null}

            {!isPremium && configurationAvailable && !visibleError && packages.length === 0 ? (
              <GlassCard style={styles.emptyCard}>
                <Ionicons name="cloud-offline-outline" size={32} color={colors.secondary} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  {t('premium.noOffering')}
                </Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  {t('premium.noOfferingDescription')}
                </Text>
                <Button
                  title={t('common.retry')}
                  variant="outline"
                  onPress={() => void refresh()}
                  loading={isLoading}
                  disabled={isLoading || isPurchasing || isRestoring}
                  testID="premium-offerings-retry"
                />
              </GlassCard>
            ) : null}

            {!isPremium && packages.length > 0 ? (
              <View
                testID="premium-subscribe-plans"
                style={[styles.plans, !compact && styles.plansWide]}
              >
                {packages.map(item => (
                  <GlassCard key={item.identifier} style={[styles.planCard, !compact && styles.planCardWide]}>
                    <Text style={[styles.planName, { color: colors.foreground }]}>
                      {item.product.title}
                    </Text>
                    {item.product.description ? (
                      <Text numberOfLines={2} style={[styles.planDescription, { color: colors.mutedForeground }]}>
                        {item.product.description}
                      </Text>
                    ) : null}
                    <Text style={[styles.planPrice, { color: colors.primary }]}>
                      {item.product.priceString}
                    </Text>
                    <Button
                      title={t('mobile.subscribe')}
                      onPress={() => requestPurchase(item)}
                      loading={isPurchasing}
                      disabled={isRestoring}
                      accessibilityLabel={t('premium.purchasePlan', { plan: item.product.title })}
                      testID={`purchase-${item.identifier}`}
                    />
                  </GlassCard>
                ))}
              </View>
            ) : null}

            {configurationAvailable ? (
              <View style={styles.restoreArea}>
                <Button
                  title={t('premium.restorePurchases')}
                  variant="ghost"
                  onPress={() => void handleRestore()}
                  loading={isRestoring}
                  disabled={isPurchasing || isLoading || isRestoring}
                  testID="restore-purchases"
                />
                <Text style={[styles.managedText, { color: colors.mutedForeground }]}>
                  {t('premium.managedInApp')}
                </Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      )}

      <Modal
        transparent
        animationType="fade"
        visible={confirmationPackage !== null}
        onRequestClose={() => setConfirmationPackage(null)}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
          <View
            accessibilityViewIsModal
            style={[styles.modalCard, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}
          >
            <View style={[styles.modalIcon, { backgroundColor: colors.glassStrong }]}>
              <Ionicons name="flask-outline" size={28} color={colors.accent} />
            </View>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {t('premium.testPurchaseTitle')}
            </Text>
            <Text style={[styles.modalText, { color: colors.mutedForeground }]}>
              {t('premium.testPurchaseDescription', {
                plan: confirmationPackage?.product.title ?? '',
                price: confirmationPackage?.product.priceString ?? '',
              })}
            </Text>
            <View style={styles.modalActions}>
              <Button
                title={t('common.cancel')}
                variant="outline"
                onPress={() => setConfirmationPackage(null)}
                style={styles.modalButton}
                testID="cancel-test-purchase"
              />
              <Button
                title={t('common.confirm')}
                onPress={() => {
                  if (confirmationPackage) void completePurchase(confirmationPackage);
                }}
                style={styles.modalButton}
                testID="confirm-test-purchase"
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { height: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, marginLeft: 4 },
  content: { flex: 1 },
  contentContainer: { paddingHorizontal: 20, paddingTop: 8 },
  contentWidth: { width: '100%', maxWidth: 980, alignSelf: 'center' },
  contentWide: { paddingHorizontal: 24 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  stateText: { fontFamily: 'Inter_400Regular', fontSize: 15 },
  hero: { alignItems: 'center', marginBottom: 26 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 13, letterSpacing: 1.4, textTransform: 'uppercase' },
  heroTitle: { fontFamily: 'Inter_700Bold', fontSize: 30, textAlign: 'center', marginTop: 8 },
  heroDesc: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: 8 },
  features: { gap: 14, marginBottom: 28 },
  featuresWide: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 210 },
  featureText: { fontFamily: 'Inter_500Medium', fontSize: 15, flexShrink: 1 },
  activeCard: { padding: 28, alignItems: 'center', borderWidth: 1, marginBottom: 20 },
  iconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  activeTitle: { fontFamily: 'Inter_700Bold', fontSize: 25, textAlign: 'center', marginTop: 16 },
  productName: { fontFamily: 'Inter_600SemiBold', fontSize: 17, textAlign: 'center', marginTop: 8 },
  activeDescription: { fontFamily: 'Inter_400Regular', fontSize: 15, textAlign: 'center', marginTop: 8 },
  syncStatus: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 12 },
  plans: { gap: 14 },
  plansWide: { flexDirection: 'row', alignItems: 'stretch' },
  planCard: { padding: 20, gap: 10 },
  planCardWide: { flex: 1 },
  planName: { fontFamily: 'Inter_700Bold', fontSize: 19 },
  planDescription: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, minHeight: 36 },
  planPrice: { fontFamily: 'Inter_700Bold', fontSize: 25, marginBottom: 4 },
  messageCard: { padding: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  messageBody: { flex: 1 },
  messageTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  messageText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, marginTop: 2 },
  notice: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 18 },
  noticeText: { fontFamily: 'Inter_500Medium', fontSize: 14, textAlign: 'center' },
  emptyCard: { padding: 24, alignItems: 'center', gap: 10 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, textAlign: 'center' },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  restoreArea: { alignItems: 'center', marginTop: 16 },
  managedText: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center' },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 430, borderWidth: 1, borderRadius: 20, padding: 24 },
  modalIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, marginTop: 16 },
  modalText: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, marginTop: 8 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalButton: { flex: 1 },
});