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
