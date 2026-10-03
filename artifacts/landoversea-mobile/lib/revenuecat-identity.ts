import Purchases from 'react-native-purchases';

let configured = false;
let configurePromise: Promise<void> | null = null;
let associatedUserId: string | null = null;
let operationQueue: Promise<void> = Promise.resolve();

export function privateRevenueCatAppUserId(userId: string): string {
  return `los_user_${userId}`;
}

export function getAssociatedRevenueCatUserId(): string | null {
  return associatedUserId;
}

export function runRevenueCatOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function configureRevenueCatForUser(userId: string, apiKey: string): Promise<void> {
  if (!configurePromise) {
    configurePromise = (async () => {
      if (!(await Purchases.isConfigured())) {
        Purchases.setLogLevel(__DEV__ ? Purchases.LOG_LEVEL.DEBUG : Purchases.LOG_LEVEL.ERROR);
        Purchases.configure({ apiKey, appUserID: userId });
      }
      configured = true;
      associatedUserId = userId;
    })().catch(error => {
      configurePromise = null;
      throw error;
    });
  }
  await configurePromise;
  if (associatedUserId !== userId) {
    if (associatedUserId) await Purchases.logOut();
    await Purchases.logIn(userId);
    associatedUserId = userId;
  }
}

export function disconnectRevenueCatUser(): Promise<void> {
  // Calling this function synchronously reserves a place in the same identity
  // queue used by configure/login, even though callers need not await the SDK.
  return runRevenueCatOperation(async () => {
    if (configurePromise) {
      try {
        await configurePromise;
      } catch {
        return;
      }
    }
    if (!configured || !associatedUserId) return;
    try {
      await Purchases.logOut();
    } finally {
      associatedUserId = null;
    }
  });
}