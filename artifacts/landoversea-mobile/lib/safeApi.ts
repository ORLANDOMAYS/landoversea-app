import { getSessionToken } from './auth';
import { isSupabaseUuid } from './liveSupabase';
import { resolveDomain } from './appDomain';

export type TextTranslation = {
  originalContent: string;
  translatedContent: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  status: 'done' | 'same_language';
};

export type CoachTimeSlot = {
  startAt: string;
  endAt: string;
  available: boolean;
};

export type UuidCoachBookingInput = {
  coachId: string;
  scheduledAt: string;
  durationMinutes: number;
  notes: string | null;
};

async function authenticatedApi<T>(path: string, init: RequestInit): Promise<T> {
  const domain = resolveDomain();
  if (!domain.ok) throw new Error(`API domain is unavailable (${domain.reason}).`);
  const token = await getSessionToken();
  if (!token) throw new Error('Authentication required.');
  const response = await fetch(`${domain.origin}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body.error === 'string' ? body.error : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

export function translateText(text: string, targetLanguage: string, sourceLanguage?: string | null) {
  return authenticatedApi<TextTranslation>('/api/translations/text', {
    method: 'POST',
    body: JSON.stringify({
      text,
      targetLanguage,
      ...(sourceLanguage ? { sourceLanguage } : {}),
    }),
  });
}

export function getUuidCoachAvailability(coachId: string, date: string, timeZone: string) {
  if (!isSupabaseUuid(coachId)) return Promise.reject(new Error('Invalid coach ID.'));
  const params = new URLSearchParams({ date, timeZone });
  return authenticatedApi<CoachTimeSlot[]>(
    `/api/coaches/${encodeURIComponent(coachId)}/availability?${params.toString()}`,
    { method: 'GET' },
  );
}

export function createUuidCoachBooking(input: UuidCoachBookingInput) {
  if (!isSupabaseUuid(input.coachId)) return Promise.reject(new Error('Invalid coach ID.'));
  return authenticatedApi<{ id: string | number }>('/api/bookings', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}