export interface Profile {
  id: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  age: number | null;
  gender: string | null;
  interested_in: string | null;
  language: string;
  verified: boolean;
  premium: boolean;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  country: string | null;
  daily_swipes_used: number;
  last_swipe_reset: string | null;
  created_at: string;
}

export interface Photo {
  id: string;
  user_id: string;
  url: string;
  position: number;
  created_at: string;
}

export interface Swipe {
  id: string;
  swiper_id: string;
  swiped_id: string;
  direction: "like" | "pass" | "superlike";
  created_at: string;
}

export interface Match {
  id: string;
  user1_id: string;
  user2_id: string;
  created_at: string;
}

export interface Message {
  id: string;
  match_id: string;
  sender_id: string;
  body: string;
  translated_body: string | null;
  sender_language: string | null;
  created_at: string;
}

export interface UserLocation {
  id: string;
  user_id: string;
  city: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  created_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  tier: "weekly" | "monthly" | "yearly";
  status: "active" | "canceled" | "expired" | "past_due";
  price: number;
  start_date: string;
  end_date: string;
  created_at: string;
}

export interface Coach {
  id: string;
  user_id: string;
  display_name: string;
  bio: string | null;
  specialties: string[];
  hourly_rate: number;
  rating: number;
  total_reviews: number;
  total_sessions: number;
  verified: boolean;
  active: boolean;
  monthly_fee_paid: boolean;
  monthly_fee_amount: number;
  platform_fee_percent: number;
  avatar_url: string | null;
  languages: string[];
  created_at: string;
}

export interface CoachSession {
  id: string;
  coach_id: string;
  client_id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: "pending" | "confirmed" | "completed" | "canceled";
  amount: number;
  platform_fee: number;
  coach_payout: number;
  notes: string | null;
  created_at: string;
}

export interface CoachReview {
  id: string;
  coach_id: string;
  client_id: string;
  session_id: string | null;
  rating: number;
  review: string | null;
  created_at: string;
}

export interface Boost {
  id: string;
  user_id: string;
  started_at: string;
  duration_minutes: number;
  active: boolean;
  created_at: string;
}

export interface ProfileView {
  id: string;
  viewer_id: string;
  viewed_id: string;
  created_at: string;
}

export interface VideoCall {
  id: string;
  match_id: string;
  caller_id: string;
  receiver_id: string;
  status: "ringing" | "active" | "ended" | "missed" | "declined";
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export interface CoachWithProfile extends Coach {
  profile?: Profile | null;
}

export interface CoachSessionWithDetails extends CoachSession {
  coach?: Coach | null;
  client?: Profile | null;
}

export const SUBSCRIPTION_TIERS = {
  weekly: { label: "Weekly", price: 9.99, period: "week" },
  monthly: { label: "Monthly", price: 35.99, period: "month" },
  yearly: { label: "Yearly", price: 199.99, period: "year" },
} as const;

export const COACH_SPECIALTIES = [
  "Profile Optimization",
  "Conversation Skills",
  "First Date Coaching",
  "Confidence Building",
  "Photo Selection",
  "Bio Writing",
  "Cultural Dating",
  "Long-Distance Relationships",
  "Matchmaking",
  "Relationship Coaching",
] as const;

export interface ProfileWithPhotos extends Profile {
  photos: Photo[];
}

export interface MatchWithProfile extends Match {
  profile: Profile;
  lastMessage?: Message | null;
}

export const LANGUAGES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  ar: "Arabic",
  hi: "Hindi",
  th: "Thai",
  vi: "Vietnamese",
  ru: "Russian",
  tr: "Turkish",
  pl: "Polish",
  nl: "Dutch",
  sv: "Swedish",
  tl: "Filipino",
};
