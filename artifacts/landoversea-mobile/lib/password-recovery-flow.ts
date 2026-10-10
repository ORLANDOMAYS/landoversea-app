type AuthOperationResult = {
  error: unknown | null;
};

export type PasswordRecoveryAuth = {
  updateUser(attributes: { password: string }): Promise<AuthOperationResult>;
  signOut(options: { scope: 'local' }): Promise<AuthOperationResult>;
};

export class PasswordRecoveryCompletionError extends Error {
  readonly stage: 'update-password' | 'close-session';
  readonly passwordUpdated: boolean;
  readonly originalError: unknown;

  constructor(
    stage: 'update-password' | 'close-session',
    passwordUpdated: boolean,
    originalError: unknown,
  ) {
    const fallback = stage === 'update-password'
      ? 'Unable to update the password.'
      : 'The password was updated, but the recovery session could not be closed.';
    super(originalError instanceof Error ? originalError.message : fallback);
    this.name = 'PasswordRecoveryCompletionError';
    this.stage = stage;
    this.passwordUpdated = passwordUpdated;
    this.originalError = originalError;
  }
}

export async function completePasswordRecovery(
  auth: PasswordRecoveryAuth,
  newPassword: string,
  clearRecoverySession: () => Promise<void>,
): Promise<void> {
  const updateResult = await auth.updateUser({ password: newPassword });
  if (updateResult.error) {
    throw new PasswordRecoveryCompletionError(
      'update-password',
      false,
      updateResult.error,
    );
  }

  const signOutResult = await auth.signOut({ scope: 'local' });
  if (signOutResult.error) {
    throw new PasswordRecoveryCompletionError(
      'close-session',
      true,
      signOutResult.error,
    );
  }

  try {
    await clearRecoverySession();
  } catch (error) {
    throw new PasswordRecoveryCompletionError(
      'close-session',
      true,
      error,
    );
  }
}