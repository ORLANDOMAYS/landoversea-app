import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useReconcileNativePremium } from '@workspace/api-client-react';
import { useAuth } from './AuthProvider';
import Purchases, {
  type CustomerInfo,
  type CustomerInfoUpdateListener,
  type PurchasesOfferings,
  type PurchasesPackage,
} from 'react-native-purchases';
import {
  configureRevenueCatForUser,
  disconnectRevenueCatUser,
  getAssociatedRevenueCatUserId,
  privateRevenueCatAppUserId,
  runRevenueCatOperation,
} from './revenuecat-identity';

export const REVENUECAT_ENTITLEMENT_IDENTIFIER = 'premium';

const testApiKey = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY?.trim();
const iosApiKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim();
const androidApiKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim();

export type RevenueCatErrorKind = 'configuration' | 'load' | 'purchase' | 'restore' | 'reconcile';

type RevenueCatError = {
  kind: RevenueCatErrorKind;
  message?: string;
};

type PurchaseResult = 'purchased' | 'cancelled';

type RevenueCatContextValue = {
  offerings: PurchasesOfferings | null;
  packages: PurchasesPackage[];
  customerInfo: CustomerInfo | null;
  premiumEntitlement: CustomerInfo['entitlements']['active'][string] | null;
  isPremium: boolean;
  serverPremium: boolean;
  serverSynchronized: boolean;
  isPreviewPremium: boolean;
  isLoading: boolean;
  isPurchasing: boolean;
  isRestoring: boolean;
  isTestMode: boolean;
  configurationAvailable: boolean;
  error: RevenueCatError | null;
  refresh: () => Promise<void>;
  purchase: (packageToPurchase: PurchasesPackage) => Promise<PurchaseResult>;
  restore: () => Promise<CustomerInfo>;
  clearError: () => void;
};

const RevenueCatContext = createContext<RevenueCatContextValue | null>(null);

function isPreviewEnvironment(): boolean {
  return __DEV__ || Platform.OS === 'web' || Constants.executionEnvironment === 'storeClient';
}

export function getRevenueCatConfiguration(): {
  apiKey: string | null;
  isTestMode: boolean;
} {
  const isTestMode = isPreviewEnvironment();
  if (isTestMode) return { apiKey: testApiKey ?? null, isTestMode };
  if (Platform.OS === 'ios') return { apiKey: iosApiKey ?? null, isTestMode };
  if (Platform.OS === 'android') return { apiKey: androidApiKey ?? null, isTestMode };
  return { apiKey: null, isTestMode };
}

function isCancellation(error: unknown): boolean {
  const candidate = error as { userCancelled?: boolean; code?: string | number };
  return candidate?.userCancelled === true
    || candidate?.code === Purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
}

export function RevenueCatProvider({ children }: { children: React.ReactNode }) {
  const { session, user, loading: userLoading } = useAuth();
  const configuration = getRevenueCatConfiguration();
  const hasAuthenticatedSession = Boolean(
    session?.access_token
    && session.user.id
    && user?.id === session.user.id,
  );
  const renderedUserId = hasAuthenticatedSession && user
    ? privateRevenueCatAppUserId(user.id)
    : null;
  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [serverPremium, setServerPremium] = useState(false);
  const [serverSynchronized, setServerSynchronized] = useState(false);
  const [stateOwner, setStateOwner] = useState<string | null>(renderedUserId);
  const [isLoading, setIsLoading] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<RevenueCatError | null>(null);
  const generation = useRef(0);
  const activeUserId = useRef<string | null>(renderedUserId);
  const observedUserId = useRef<string | null>(renderedUserId);
  const scheduledGeneration = useRef(-1);
  const refreshPromise = useRef<Promise<void> | null>(null);
  const reconcileMutation = useReconcileNativePremium();

  // Invalidate in-flight work during render, before an effect can run. This
  // prevents an old account's native response from landing in a newly rendered
  // account during the render-to-effect gap.
  if (observedUserId.current !== renderedUserId) {
    observedUserId.current = renderedUserId;
    activeUserId.current = renderedUserId;
    generation.current += 1;
    refreshPromise.current = null;
  }

  const isCurrentAccount = useCallback((expectedUserId: string, expectedGeneration: number) => (
    activeUserId.current === expectedUserId
    && generation.current === expectedGeneration
  ), []);

  const reconcile = useCallback(async (
    expectedUserId: string,
    expectedGeneration: number,
  ) => {
    if (!isCurrentAccount(expectedUserId, expectedGeneration)) return null;
    try {
      const result = await reconcileMutation.mutateAsync();
      if (isCurrentAccount(expectedUserId, expectedGeneration)) {
        setServerPremium(result.isPremium);
        setServerSynchronized(true);
        setError(current => current?.kind === 'reconcile' ? null : current);
      }
      return result;
    } catch (reconcileError) {
      if (isCurrentAccount(expectedUserId, expectedGeneration)) {
        setServerSynchronized(false);
        setError({ kind: 'reconcile', message: (reconcileError as Error)?.message });
      }
      throw reconcileError;
    }
  }, [isCurrentAccount, reconcileMutation.mutateAsync]);

  const loadForAccount = useCallback(async (
    expectedUserId: string,
    expectedGeneration: number,
  ): Promise<boolean> => {
    if (!configuration.apiKey || !isCurrentAccount(expectedUserId, expectedGeneration)) return false;
    setStateOwner(expectedUserId);
    try {
      await configureRevenueCatForUser(expectedUserId, configuration.apiKey);
      if (!isCurrentAccount(expectedUserId, expectedGeneration)) return false;
      const [nextOfferings, nextCustomerInfo] = await Promise.all([
        Purchases.getOfferings(),
        Purchases.getCustomerInfo(),
      ]);
      if (
        !isCurrentAccount(expectedUserId, expectedGeneration)
        || getAssociatedRevenueCatUserId() !== expectedUserId
      ) return false;
      setOfferings(nextOfferings);
      setCustomerInfo(nextCustomerInfo);
      setServerSynchronized(false);
      return true;
    } catch (loadError) {
      if (isCurrentAccount(expectedUserId, expectedGeneration)) {
        setError({ kind: 'load', message: (loadError as Error)?.message });
      }
      return false;
    }
  }, [configuration.apiKey, isCurrentAccount]);

  const load = useCallback(async () => {
    if (refreshPromise.current) return refreshPromise.current;
    const expectedUserId = activeUserId.current;
    const expectedGeneration = generation.current;
    if (!expectedUserId) return;
    if (isCurrentAccount(expectedUserId, expectedGeneration)) {
      setIsLoading(true);
      setError(null);
    }
    const task = (async () => {
      try {
        const loaded = await runRevenueCatOperation(
          () => loadForAccount(expectedUserId, expectedGeneration),
        );
        if (loaded && isCurrentAccount(expectedUserId, expectedGeneration)) {
          try {
            await reconcile(expectedUserId, expectedGeneration);
          } catch {
            // CustomerInfo remains authoritative for device presentation only.
            // Server-protected Premium remains fail-closed until projection succeeds.
          }
        }
      } finally {
        if (isCurrentAccount(expectedUserId, expectedGeneration)) {
          setIsLoading(false);
          refreshPromise.current = null;
        }
      }
    })();
    refreshPromise.current = task;
    return task;
  }, [isCurrentAccount, loadForAccount, reconcile]);

  useEffect(() => {
    if (userLoading) return;
    const expectedGeneration = generation.current;
    if (scheduledGeneration.current === expectedGeneration) return;
    scheduledGeneration.current = expectedGeneration;

    setOfferings(null);
    setCustomerInfo(null);
    setServerPremium(false);
    setServerSynchronized(false);
    setStateOwner(renderedUserId);
    setIsLoading(false);
    setIsPurchasing(false);
    setIsRestoring(false);
    setError(null);

    if (!configuration.apiKey) {
      setError({ kind: 'configuration' });
      return;
    }
    if (!renderedUserId) {
      void disconnectRevenueCatUser();
      return;
    }
    void load();
  }, [
    configuration.apiKey, load, renderedUserId, userLoading,
  ]);

  useEffect(() => {
    const listener: CustomerInfoUpdateListener = info => {
      const expectedUserId = activeUserId.current;
      const expectedGeneration = generation.current;
      if (
        !expectedUserId
        || getAssociatedRevenueCatUserId() !== expectedUserId
        || info.originalAppUserId !== expectedUserId
        || !isCurrentAccount(expectedUserId, expectedGeneration)
      ) return;
      setStateOwner(expectedUserId);
      setCustomerInfo(info);
      setServerSynchronized(false);
      void reconcile(expectedUserId, expectedGeneration).catch(() => {
        // The reconcile callback exposes a truthful, retryable error state.
      });
    };
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, [isCurrentAccount, reconcile]);

  const purchase = useCallback(async (packageToPurchase: PurchasesPackage): Promise<PurchaseResult> => {
    const expectedUserId = activeUserId.current;
    const expectedGeneration = generation.current;
    if (!expectedUserId) return 'cancelled';
    if (isCurrentAccount(expectedUserId, expectedGeneration)) {
      setIsPurchasing(true);
      setError(null);
    }
    const outcome = await runRevenueCatOperation(async (): Promise<PurchaseResult> => {
      try {
        if (
          !isCurrentAccount(expectedUserId, expectedGeneration)
          || getAssociatedRevenueCatUserId() !== expectedUserId
        ) return 'cancelled';
        const result = await Purchases.purchasePackage(packageToPurchase);
        if (isCurrentAccount(expectedUserId, expectedGeneration)) {
          setStateOwner(expectedUserId);
          setCustomerInfo(result.customerInfo);
          setServerSynchronized(false);
        }
        return 'purchased';
      } catch (purchaseError) {
        if (isCancellation(purchaseError)) return 'cancelled';
        if (isCurrentAccount(expectedUserId, expectedGeneration)) {
          setError({ kind: 'purchase', message: (purchaseError as Error)?.message });
        }
        throw purchaseError;
      } finally {
        if (isCurrentAccount(expectedUserId, expectedGeneration)) setIsPurchasing(false);
      }
    });
    if (outcome === 'purchased' && isCurrentAccount(expectedUserId, expectedGeneration)) {
      void reconcile(expectedUserId, expectedGeneration).catch(() => {
        // Do not mislabel a completed store purchase as a purchase failure.
      });
    }
    return outcome;
  }, [isCurrentAccount, reconcile]);

  const restore = useCallback(async () => {
    const expectedUserId = activeUserId.current;
    const expectedGeneration = generation.current;
    if (!expectedUserId) throw new Error('A signed-in account is required to restore purchases.');
    if (isCurrentAccount(expectedUserId, expectedGeneration)) {
      setIsRestoring(true);
      setError(null);
    }
    const restoredInfo = await runRevenueCatOperation(async () => {
      try {
        if (
          !isCurrentAccount(expectedUserId, expectedGeneration)
          || getAssociatedRevenueCatUserId() !== expectedUserId
        ) {
          throw new Error('The signed-in account changed before purchases could be restored.');
        }
        await Purchases.restorePurchases();
        const nextRestoredInfo = await Purchases.getCustomerInfo();
        if (isCurrentAccount(expectedUserId, expectedGeneration)) {
          setStateOwner(expectedUserId);
          setCustomerInfo(nextRestoredInfo);
          setServerSynchronized(false);
        }
        return nextRestoredInfo;
      } catch (restoreError) {
        if (isCurrentAccount(expectedUserId, expectedGeneration)) {
          setError({ kind: 'restore', message: (restoreError as Error)?.message });
        }
        throw restoreError;
      } finally {
        if (isCurrentAccount(expectedUserId, expectedGeneration)) setIsRestoring(false);
      }
    });
    if (isCurrentAccount(expectedUserId, expectedGeneration)) {
      try {
        await reconcile(expectedUserId, expectedGeneration);
      } catch {
        // Restored CustomerInfo remains valid for device presentation only.
      }
    }
    return restoredInfo;
  }, [isCurrentAccount, reconcile]);

  const ownsState = stateOwner === renderedUserId;
  const visibleOfferings = ownsState ? offerings : null;
  const visibleCustomerInfo = ownsState ? customerInfo : null;
  const visibleServerPremium = ownsState ? serverPremium : false;
  const visibleServerSynchronized = ownsState ? serverSynchronized : false;
  const visibleError = ownsState
    ? error
    : !userLoading && !configuration.apiKey
      ? { kind: 'configuration' as const }
      : null;
  const premiumEntitlement = visibleCustomerInfo
    ?.entitlements.active[REVENUECAT_ENTITLEMENT_IDENTIFIER] ?? null;
  const isPreviewPremium = configuration.isTestMode && premiumEntitlement !== null;
  const value = useMemo<RevenueCatContextValue>(() => ({
    offerings: visibleOfferings,
    packages: visibleOfferings?.current?.availablePackages ?? [],
    customerInfo: visibleCustomerInfo,
    premiumEntitlement,
    isPremium: premiumEntitlement !== null,
    serverPremium: visibleServerPremium,
    serverSynchronized: visibleServerSynchronized,
    isPreviewPremium,
    isLoading: userLoading || (ownsState ? isLoading : Boolean(renderedUserId && configuration.apiKey)),
    isPurchasing: ownsState ? isPurchasing : false,
    isRestoring: ownsState ? isRestoring : false,
    isTestMode: configuration.isTestMode,
    configurationAvailable: configuration.apiKey !== null,
    error: visibleError,
    refresh: load,
    purchase,
    restore,
    clearError: () => setError(null),
  }), [
    visibleOfferings, visibleCustomerInfo, premiumEntitlement, visibleServerPremium, isPreviewPremium,
    visibleServerSynchronized, ownsState, renderedUserId, userLoading, isLoading,
    isPurchasing, isRestoring, configuration, visibleError, load, purchase, restore,
  ]);

  return <RevenueCatContext.Provider value={value}>{children}</RevenueCatContext.Provider>;
}

export function useRevenueCat(): RevenueCatContextValue {
  const context = useContext(RevenueCatContext);
  if (!context) throw new Error('useRevenueCat must be used within RevenueCatProvider');
  return context;
}