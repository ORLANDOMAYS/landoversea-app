import { and, eq } from "drizzle-orm";
import {
  db,
  safetyTipsTable,
  culturalFactsTable,
  tribesTable,
  culturalEventsTable,
  conversationStartersTable,
  usersTable,
  profilesTable,
  profilePhotosTable,
  coachesTable,
  coachAuditEventsTable,
  groupWorkshopsTable,
  languageQuizzesTable,
} from "../index";

// Deliberately not a bcrypt hash: bcrypt.compare always fails, so seeded
// showcase identities cannot be used to authenticate.
const DEMO_PASSWORD_HASH = "!demo-login-disabled";

/**
 * Named human coaches for the approved marketplace. These upsert idempotently
 * on the coach's dedicated demo user email and are marked verified/approved so
 * they appear in discovery. Genuine (non-demo) users are never touched.
 */
const COACH_SEEDS: Array<{
  slug: string;
  name: string;
  bio: string;
  photoUrl: string;
  specialties: string[];
  languages: string[];
  ratesPerHour: number;
  pricingTiers: Array<{ minutes: number; price: number }>;
}> = [
  {
    slug: "sofia-morales",
    name: "Sofia Morales",
    bio: "Cross-cultural relationship coach helping couples bridge Latin American and Western communication styles.",
    photoUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80",
    specialties: ["Cross-cultural relationships", "Communication"],
    languages: ["Spanish", "English", "Portuguese"],
    ratesPerHour: 60,
    pricingTiers: [{ minutes: 15, price: 20 }, { minutes: 30, price: 35 }, { minutes: 60, price: 60 }],
  },
  {
    slug: "mei-lin-zhang",
    name: "Mei Lin Zhang",
    bio: "Mandarin language and etiquette coach for professionals navigating relationships in East Asia.",
    photoUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&q=80",
    specialties: ["Language exchange", "Etiquette"],
    languages: ["Mandarin", "English"],
    ratesPerHour: 55,
    pricingTiers: [{ minutes: 15, price: 18 }, { minutes: 30, price: 32 }, { minutes: 60, price: 55 }],
  },
  {
    slug: "james-okafor",
    name: "James Okafor",
    bio: "Confidence and dating coach specializing in long-distance and intercontinental connections.",
    photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80",
    specialties: ["Confidence", "Long-distance"],
    languages: ["English", "French"],
    ratesPerHour: 50,
    pricingTiers: [{ minutes: 15, price: 15 }, { minutes: 30, price: 28 }, { minutes: 60, price: 50 }],
  },
  {
    slug: "marco-vitali",
    name: "Marco Vitali",
    bio: "Italian culture and romance coach helping members plan meaningful cross-border first meetings.",
    photoUrl: "https://images.unsplash.com/photo-1463453091185-61582044d556?w=400&q=80",
    specialties: ["Cultural immersion", "Date planning"],
    languages: ["Italian", "English"],
    ratesPerHour: 65,
    pricingTiers: [{ minutes: 15, price: 22 }, { minutes: 30, price: 38 }, { minutes: 60, price: 65 }],
  },
  {
    slug: "marcus-chen",
    name: "Marcus Chen",
    bio: "Relationship strategist focused on building trust across cultural and language barriers.",
    photoUrl: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&q=80",
    specialties: ["Trust building", "Communication"],
    languages: ["English", "Cantonese"],
    ratesPerHour: 58,
    pricingTiers: [{ minutes: 15, price: 20 }, { minutes: 30, price: 34 }, { minutes: 60, price: 58 }],
  },
  {
    slug: "isabella-torres",
    name: "Isabella Torres",
    bio: "Bilingual dating coach helping members present their authentic selves internationally.",
    photoUrl: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&q=80",
    specialties: ["Self-presentation", "Cross-cultural relationships"],
    languages: ["Spanish", "English"],
    ratesPerHour: 52,
    pricingTiers: [{ minutes: 15, price: 18 }, { minutes: 30, price: 30 }, { minutes: 60, price: 52 }],
  },
  {
    slug: "dr-sophia-laurent",
    name: "Dr. Sophia Laurent",
    bio: "Licensed relationship psychologist offering evidence-based coaching for intercultural couples.",
    photoUrl: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&q=80",
    specialties: ["Psychology", "Intercultural couples"],
    languages: ["French", "English"],
    ratesPerHour: 90,
    pricingTiers: [{ minutes: 30, price: 55 }, { minutes: 60, price: 90 }],
  },
  {
    slug: "james-whitfield",
    name: "James Whitfield",
    bio: "Executive-style communication coach for busy professionals dating across time zones.",
    photoUrl: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400&q=80",
    specialties: ["Communication", "Time management"],
    languages: ["English"],
    ratesPerHour: 70,
    pricingTiers: [{ minutes: 15, price: 24 }, { minutes: 30, price: 42 }, { minutes: 60, price: 70 }],
  },
  {
    slug: "orlando-mays",
    name: "Orlando Mays",
    bio: "Life and relationship coach helping members build genuine connections with confidence.",
    photoUrl: "https://images.unsplash.com/photo-1531384441138-2736e62e0919?w=400&q=80",
    specialties: ["Confidence", "Life coaching"],
    languages: ["English"],
    ratesPerHour: 48,
    pricingTiers: [{ minutes: 15, price: 15 }, { minutes: 30, price: 27 }, { minutes: 60, price: 48 }],
  },
];

// Named demo dating profiles requested for the showcase. Each has a stable
// image URL. These upsert on a dedicated demo email so genuine user records are
// never overwritten.
const PROFILE_SEEDS: Array<{
  slug: string;
  name: string;
  age: number;
  country: string;
  city: string;
  bio: string;
  gender: string;
  primaryLanguage: string;
  photoUrl: string;
}> = [
  { slug: "yuki-tanaka", name: "Yuki Tanaka", age: 28, country: "Japan", city: "Tokyo", bio: "Tea ceremony enthusiast looking for genuine cross-cultural connection.", gender: "female", primaryLanguage: "Japanese", photoUrl: "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400&q=80" },
  { slug: "carlos-mendez", name: "Carlos Mendez", age: 32, country: "Mexico", city: "Mexico City", bio: "Chef and traveler who believes food is the universal language.", gender: "male", primaryLanguage: "Spanish", photoUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&q=80" },
  { slug: "priya-sharma", name: "Priya Sharma", age: 27, country: "India", city: "Mumbai", bio: "Software engineer, dancer, and lover of world cinema.", gender: "female", primaryLanguage: "Hindi", photoUrl: "https://images.unsplash.com/photo-1534751516642-a1af1ef26a56?w=400&q=80" },
  { slug: "sofia-oliveira", name: "Sofia Oliveira", age: 29, country: "Brazil", city: "Rio de Janeiro", bio: "Samba teacher seeking someone to explore the world with.", gender: "female", primaryLanguage: "Portuguese", photoUrl: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400&q=80" },
  { slug: "amir-hassan", name: "Amir Hassan", age: 31, country: "UAE", city: "Dubai", bio: "Architect passionate about design, coffee, and long conversations.", gender: "male", primaryLanguage: "Arabic", photoUrl: "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=400&q=80" },
  { slug: "kwame-asante", name: "Kwame Asante", age: 30, country: "Ghana", city: "Accra", bio: "Musician and entrepreneur celebrating African heritage.", gender: "male", primaryLanguage: "English", photoUrl: "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&q=80" },
  { slug: "mei-chen", name: "Mei Chen", age: 26, country: "China", city: "Shanghai", bio: "Painter and language exchange fan learning five languages.", gender: "female", primaryLanguage: "Mandarin", photoUrl: "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=400&q=80" },
  { slug: "diego-ramirez", name: "Diego Ramirez", age: 33, country: "Argentina", city: "Buenos Aires", bio: "Football coach who loves tango and spontaneous adventures.", gender: "male", primaryLanguage: "Spanish", photoUrl: "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=400&q=80" },
  { slug: "amara-okafor", name: "Amara Okafor", age: 28, country: "Nigeria", city: "Lagos", bio: "Fashion designer bringing Afro-futurist style to the world.", gender: "female", primaryLanguage: "English", photoUrl: "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400&q=80" },
  { slug: "jin-park", name: "Jin Park", age: 29, country: "South Korea", city: "Seoul", bio: "Film producer and coffee snob searching for real connection.", gender: "male", primaryLanguage: "Korean", photoUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&q=80" },
  { slug: "luca-ferrari", name: "Luca Ferrari", age: 34, country: "Italy", city: "Milan", bio: "Wine importer who lives for slow dinners and good company.", gender: "male", primaryLanguage: "Italian", photoUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&q=80" },
  { slug: "fatima-ali", name: "Fatima Ali", age: 27, country: "Morocco", city: "Marrakesh", bio: "Photographer capturing culture and color across the globe.", gender: "female", primaryLanguage: "Arabic", photoUrl: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&q=80" },
  { slug: "aria", name: "Aria", age: 25, country: "United States", city: "Los Angeles", bio: "Singer-songwriter who believes love has no borders.", gender: "female", primaryLanguage: "English", photoUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&q=80" },
  { slug: "lucas", name: "Lucas", age: 30, country: "France", city: "Paris", bio: "Pastry chef with a passion for languages and late-night walks.", gender: "male", primaryLanguage: "French", photoUrl: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&q=80" },
  { slug: "yuna", name: "Yuna", age: 26, country: "South Korea", city: "Busan", bio: "Illustrator who loves the ocean and quiet cafés.", gender: "female", primaryLanguage: "Korean", photoUrl: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&q=80" },
  { slug: "rafael", name: "Rafael", age: 31, country: "Portugal", city: "Lisbon", bio: "Surfer and startup founder chasing sunsets and good conversation.", gender: "male", primaryLanguage: "Portuguese", photoUrl: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400&q=80" },
  { slug: "orlando-mays-member", name: "Orlando Mays", age: 35, country: "United States", city: "Atlanta", bio: "Coach and creative connecting cultures one story at a time.", gender: "male", primaryLanguage: "English", photoUrl: "https://images.unsplash.com/photo-1531384441138-2736e62e0919?w=400&q=80" },
];

function demoEmail(slug: string): string {
  return `demo+${slug}@landoversea.app`;
}

/**
 * Insert a demo user only if the deterministic demo email is free. Returns the
 * user id, or null when the email already belongs to a genuine record we must
 * not overwrite.
 */
async function ensureDemoUser(tx: any, slug: string, name: string, role: "user" | "coach"): Promise<number | null> {
  const email = demoEmail(slug);
  const [existing] = await tx.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) {
    // Only treat as ours if it is clearly a demo account (never overwrite real users).
    return existing.email === email ? existing.id : null;
  }
  const [created] = await tx
    .insert(usersTable)
    .values({ email, passwordHash: DEMO_PASSWORD_HASH, name, role, isProfileComplete: true })
    .onConflictDoNothing()
    .returning();
  return created?.id ?? null;
}

async function seedCoaches(): Promise<void> {
  // Approved showcase coaches are useful in development but must never become
  // production marketplace identities.
  if (process.env.NODE_ENV === "production") return;

  for (const seed of COACH_SEEDS) {
    await db.transaction(async (tx) => {
      const userId = await ensureDemoUser(tx, `coach-${seed.slug}`, seed.name, "coach");
      if (!userId) return;
      // Idempotent profile so the coach's demo user is also a member.
      await tx
        .insert(profilesTable)
        .values({ userId, name: seed.name, bio: seed.bio, completionPercent: 100 })
        .onConflictDoNothing();
      // Upsert the coach record keyed on the unique userId.
      const [existingCoach] = await tx.select().from(coachesTable).where(eq(coachesTable.userId, userId)).limit(1);
      const values = {
        userId,
        displayName: seed.name,
        bio: seed.bio,
        photoUrl: seed.photoUrl,
        specialties: seed.specialties,
        languages: seed.languages,
        sessionLengthsMinutes: seed.pricingTiers.map((t) => t.minutes),
        ratesPerHour: seed.ratesPerHour,
        pricingTiers: seed.pricingTiers,
        currency: "USD",
        isVerified: true,
        verificationStatus: "approved",
        availabilitySlots: [
          { dayOfWeek: 1, startTime: "09:00", endTime: "17:00", timeZone: "UTC" },
          { dayOfWeek: 3, startTime: "09:00", endTime: "17:00", timeZone: "UTC" },
          { dayOfWeek: 5, startTime: "09:00", endTime: "17:00", timeZone: "UTC" },
        ],
      };
      if (existingCoach) {
        await tx.update(coachesTable).set(values).where(eq(coachesTable.id, existingCoach.id));
        if (existingCoach.verificationStatus !== "approved") {
          await tx.insert(coachAuditEventsTable).values({
            coachId: existingCoach.id,
            actorUserId: userId,
            field: "verification",
            action: "approved",
            previousValue: existingCoach.verificationStatus,
            newValue: "approved",
            notes: "Development fixture normalized to the approved marketplace state.",
          });
        }
      } else {
        const [coach] = await tx.insert(coachesTable).values(values).onConflictDoNothing().returning();
        if (coach) {
          await tx.insert(coachAuditEventsTable).values([
            {
              coachId: coach.id,
              actorUserId: userId,
              field: "verification",
              action: "submitted",
              previousValue: "unsubmitted",
              newValue: "pending",
              notes: "Development fixture application submitted.",
            },
            {
              coachId: coach.id,
              actorUserId: userId,
              field: "verification",
              action: "approved",
              previousValue: "pending",
              newValue: "approved",
              notes: "Development fixture approved for marketplace testing.",
            },
          ]);
        }
      }
    });
  }
}

async function seedProfiles(): Promise<void> {
  for (const seed of PROFILE_SEEDS) {
    await db.transaction(async (tx) => {
      const userId = await ensureDemoUser(tx, seed.slug, seed.name, "user");
      if (!userId) return;
      await tx
        .insert(profilesTable)
        .values({
          userId,
          name: seed.name,
          age: seed.age,
          bio: seed.bio,
          gender: seed.gender,
          country: seed.country,
          city: seed.city,
          primaryLanguage: seed.primaryLanguage,
          completionPercent: 90,
        })
        .onConflictDoNothing();
      const [existingPhoto] = await tx
        .select()
        .from(profilePhotosTable)
        .where(eq(profilePhotosTable.userId, userId))
        .limit(1);
      if (!existingPhoto) {
        await tx.insert(profilePhotosTable).values({ userId, url: seed.photoUrl, position: 0, isPrimary: true });
      }
    });
  }
}

async function seedLanguageQuizzes(): Promise<void> {
  const quizzes = [
    {
      title: "Japanese Basics — Greetings",
      language: "Japanese",
      category: "vocabulary",
      difficulty: "beginner",
      xpReward: 50,
      questions: [
        { id: 1, text: "What does こんにちは mean?", options: ["Goodbye", "Hello", "Thank you", "Sorry"], correctAnswer: "Hello" },
        { id: 2, text: "What does ありがとう mean?", options: ["Hello", "Excuse me", "Thank you", "Good night"], correctAnswer: "Thank you" },
        { id: 3, text: "Which phrase means good morning?", options: ["おはようございます", "こんばんは", "さようなら", "すみません"], correctAnswer: "おはようございます" },
      ],
    },
    {
      title: "Spanish Conversation — First Meeting",
      language: "Spanish",
      category: "vocabulary",
      difficulty: "beginner",
      xpReward: 60,
      questions: [
        { id: 1, text: "How do you say “Nice to meet you”?", options: ["Mucho gusto", "Hasta luego", "De nada", "Lo siento"], correctAnswer: "Mucho gusto" },
        { id: 2, text: "What does “¿De dónde eres?” mean?", options: ["How old are you?", "Where are you from?", "What is your name?", "Do you travel?"], correctAnswer: "Where are you from?" },
        { id: 3, text: "Choose the polite way to ask someone's name.", options: ["¿Cómo te llamas?", "¿Qué hora es?", "¿Dónde vives?", "¿Hablas inglés?"], correctAnswer: "¿Cómo te llamas?" },
      ],
    },
    {
      title: "French Cultural Etiquette",
      language: "French",
      category: "cultural",
      difficulty: "intermediate",
      xpReward: 80,
      questions: [
        { id: 1, text: "Which greeting is appropriate when entering a shop?", options: ["Bonjour", "Bonne nuit", "À demain", "Santé"], correctAnswer: "Bonjour" },
        { id: 2, text: "What is la bise?", options: ["A formal handshake", "A cheek-kiss greeting", "A dinner toast", "A thank-you note"], correctAnswer: "A cheek-kiss greeting" },
        { id: 3, text: "Which pronoun is generally more formal?", options: ["Tu", "Vous", "On", "Je"], correctAnswer: "Vous" },
      ],
    },
  ];

  for (const quiz of quizzes) {
    await db
      .insert(languageQuizzesTable)
      .values({ ...quiz, questionCount: quiz.questions.length })
      .onConflictDoUpdate({
        target: [languageQuizzesTable.title, languageQuizzesTable.language],
        set: {
          category: quiz.category,
          difficulty: quiz.difficulty,
          xpReward: quiz.xpReward,
          questionCount: quiz.questions.length,
          questions: quiz.questions,
        },
      });
  }
}

async function seedWorkshops(): Promise<void> {
  const coaches = await db.select().from(coachesTable);
  const coachByName = new Map(coaches.map((coach) => [coach.displayName, coach.id]));
  const futureAt = (days: number, hourUtc: number) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    date.setUTCHours(hourUtc, 0, 0, 0);
    return date;
  };
  const workshops = [
    {
      coachName: "Mei Lin Zhang",
      title: "Confident Cross-Cultural Introductions",
      description: "Practice warm introductions, respectful questions, and conversation starters for a first international date.",
      scheduledAt: futureAt(7, 18),
      durationMinutes: 60,
      maxParticipants: 16,
      price: 18,
    },
    {
      coachName: "Sofia Morales",
      title: "Love Languages Across Cultures",
      description: "Learn how affection and communication styles vary across cultures through guided examples and live discussion.",
      scheduledAt: futureAt(12, 19),
      durationMinutes: 75,
      maxParticipants: 20,
      price: 22,
    },
    {
      coachName: "James Okafor",
      title: "Long-Distance Trust Workshop",
      description: "Build practical routines for communication, boundaries, and trust in a relationship that spans borders.",
      scheduledAt: futureAt(17, 17),
      durationMinutes: 60,
      maxParticipants: 18,
      price: 20,
    },
  ];

  for (const workshop of workshops) {
    const coachId = coachByName.get(workshop.coachName);
    if (!coachId) continue;
    await db
      .insert(groupWorkshopsTable)
      .values({
        coachId,
        title: workshop.title,
        description: workshop.description,
        scheduledAt: workshop.scheduledAt,
        durationMinutes: workshop.durationMinutes,
        maxParticipants: workshop.maxParticipants,
        price: workshop.price,
        currency: "USD",
      })
      .onConflictDoUpdate({
        target: [groupWorkshopsTable.coachId, groupWorkshopsTable.title],
        set: {
          description: workshop.description,
          scheduledAt: workshop.scheduledAt,
          durationMinutes: workshop.durationMinutes,
          maxParticipants: workshop.maxParticipants,
          price: workshop.price,
        },
      });
  }
}

export async function seedDatabase(): Promise<void> {
  try {
    // Safety tips — idempotent on unique title.
    await db
      .insert(safetyTipsTable)
      .values([
        { title: "Meet in Public Places", body: "Always meet new connections in well-lit, busy public locations for the first time. Coffee shops, malls, and popular restaurants are ideal spots.", category: "meetup_safety" },
        { title: "Share Your Plans", body: "Before meeting someone new, share your plans with a trusted friend or family member — including where you're going, who you're meeting, and when you expect to return.", category: "meetup_safety" },
        { title: "Watch Out for Romance Scams", body: "Be cautious if someone you've never met in person asks for money, gift cards, or financial help. Scammers often build emotional connections quickly before making requests.", category: "scam_prevention" },
        { title: "Verify Profiles Before Meeting", body: "Use video calls to verify a match is who they claim to be before meeting in person. Reverse-image-search their photos to check for stolen profile pictures.", category: "verification" },
        { title: "Protect Your Personal Information", body: "Avoid sharing your home address, workplace, financial details, or government ID with someone you've just met online. Share information gradually as trust builds.", category: "privacy" },
        { title: "Trust Your Instincts", body: "If something feels off about a conversation or a person, trust your gut and disengage. Your safety is more important than being polite.", category: "travel_safety" },
        { title: "Research Local Laws and Customs", body: "Before traveling to meet someone, research the local laws, cultural norms, and LGBTQ+ rights of your destination to stay safe and respectful.", category: "travel_safety" },
        { title: "Keep Your Accounts Secure", body: "Use a strong, unique password for your LandOverSEA account and enable two-factor authentication. Never share your login credentials with anyone.", category: "privacy" },
      ])
      .onConflictDoNothing();

    // Cultural facts — idempotent on unique (country, fact).
    await db
      .insert(culturalFactsTable)
      .values([
        { country: "Japan", fact: "In Japan, it is customary to bow when greeting someone. The depth of the bow reflects the level of respect — a deeper bow shows more deference.", category: "etiquette" },
        { country: "Japan", fact: "Exchanging business cards (meishi) is a formal ritual in Japan. Always present and receive cards with both hands and take a moment to read the card respectfully.", category: "business" },
        { country: "South Korea", fact: "In South Korea, it is common to pour drinks for others before pouring for yourself. Accepting a drink with two hands is a sign of respect.", category: "dining" },
        { country: "Brazil", fact: "Brazilians are known for their warmth and physicality in greetings. Cheek kisses and hugs are common, even upon first meetings, especially in social settings.", category: "etiquette" },
        { country: "France", fact: "In France, la bise (a light kiss on each cheek) is a standard greeting among friends and acquaintances. The number of kisses varies by region.", category: "etiquette" },
        { country: "India", fact: "The Namaste gesture — pressing palms together and bowing slightly — is a traditional greeting in India that conveys respect and acknowledges the divine in the other person.", category: "etiquette" },
        { country: "Thailand", fact: "The Wai — pressing palms together in a prayer-like gesture — is Thailand's traditional greeting. The higher the hands and deeper the bow, the more respect is shown.", category: "etiquette" },
        { country: "China", fact: "In China, giving gifts wrapped in red and gold is considered lucky, as these colors symbolize prosperity and good fortune. Avoid white or black wrapping, associated with mourning.", category: "customs" },
        { country: "Mexico", fact: "Punctuality in social settings in Mexico is flexible — arriving 30 minutes late to a party is often expected and acceptable. Business meetings, however, tend to be more time-conscious.", category: "customs" },
        { country: "Nigeria", fact: "In many Nigerian cultures, younger people greet elders by prostrating (lying face down) or kneeling as a sign of deep respect. This varies by ethnic group and region.", category: "etiquette" },
        { country: "UAE", fact: "In the UAE, it is considered impolite to eat, drink, or smoke in public during Ramadan daylight hours. Visitors are expected to respect this important cultural practice.", category: "religion" },
        { country: "UAE", fact: "When visiting someone's home in the UAE, removing your shoes before entering is customary and a sign of respect for the household.", category: "customs" },
        { country: "South Korea", fact: "Age plays a major role in Korean social dynamics. Koreans often ask your age early in a conversation to determine the appropriate speech level and level of formality.", category: "social" },
        { country: "Brazil", fact: "Brazil is home to the world's largest carnival celebration in Rio de Janeiro, drawing millions of visitors each year with vibrant parades, samba music, and elaborate costumes.", category: "festivals" },
        { country: "India", fact: "India has 22 officially recognized languages and hundreds of dialects. Hindi and English are widely used, but regional languages like Tamil, Bengali, and Telugu have rich literary traditions.", category: "language" },
      ].map((f) => ({ ...f, status: "approved" as const })))
      .onConflictDoNothing();

    // Tribes — idempotent on unique name.
    await db
      .insert(tribesTable)
      .values([
        { name: "Wanderlust Travelers", description: "A community for passionate travelers exploring the world and sharing their adventures, tips, and hidden gems across every continent.", country: null, language: "English", memberCount: 0 },
        { name: "Language Exchange", description: "Connect with native speakers to practice languages, share linguistic insights, and celebrate multilingual communication.", country: null, language: null, memberCount: 0 },
        { name: "Global Foodies", description: "Celebrate world cuisines, share recipes, discover local restaurants, and bond over the universal love of food across cultures.", country: null, language: null, memberCount: 0 },
        { name: "Expat Life", description: "A supportive space for expatriates navigating life abroad — from visa challenges and homesickness to finding community in new countries.", country: null, language: "English", memberCount: 0 },
        { name: "World Music Lovers", description: "From Afrobeats to K-pop, bossa nova to flamenco — unite over the rhythms and melodies that transcend borders.", country: null, language: null, memberCount: 0 },
        { name: "Global Art & Culture", description: "Explore art, architecture, literature, and creative expression from every corner of the globe. Share inspiration and discover new cultural perspectives.", country: null, language: null, memberCount: 0 },
        { name: "Mindful Nomads", description: "For travelers and expats who prioritize mental wellness, mindfulness, and intentional living while navigating life across borders.", country: null, language: null, memberCount: 0 },
        { name: "Tech Nomads", description: "Digital nomads and remote workers who blend technology and travel — sharing workspace tips, tools, and the best cities for working remotely.", country: null, language: "English", memberCount: 0 },
        { name: "Intercultural Couples", description: "A warm community for couples from different cultural backgrounds, sharing experiences, challenges, and the beauty of cross-cultural relationships.", country: null, language: null, memberCount: 0 },
        { name: "African Diaspora Connect", description: "A space for the African diaspora to connect, celebrate heritage, share stories, and build community across the world.", country: null, language: null, memberCount: 0 },
      ])
      .onConflictDoNothing();

    // Cultural events — idempotent on unique (title, country).
    await db
      .insert(culturalEventsTable)
      .values([
        { title: "Virtual Japan Cultural Immersion", description: "Join us for an interactive virtual tour of Japan's rich cultural traditions, including a tea ceremony demonstration, origami workshop, and a live Q&A with Tokyo locals.", country: "Japan", date: new Date(Date.now() + 7 * 86400000) },
        { title: "Latin America Connection Night", description: "An online mixer celebrating the diversity of Latin American cultures. Featuring music, dance introductions, and a chance to meet people from Brazil, Mexico, Colombia, and beyond.", country: "Brazil", date: new Date(Date.now() + 14 * 86400000) },
        { title: "Global Singles Speed Networking", description: "A virtual speed-networking event for international singles looking to make genuine connections across cultures. Facilitated icebreakers, cultural trivia, and breakout rooms by interest.", country: "Global", date: new Date(Date.now() + 21 * 86400000) },
      ])
      .onConflictDoNothing();

    // Conversation starters — idempotent on unique text.
    await db
      .insert(conversationStartersTable)
      .values([
        { text: "What's a tradition from your country that you wish more people knew about?", country: null, category: "culture" },
        { text: "What language are you most excited to learn and why?", country: null, category: "language" },
        { text: "If you could live in any country for a year, where would you go and what would you do?", country: null, category: "travel" },
        { text: "What's a food from your culture that you think everyone should try?", country: null, category: "food" },
        { text: "What's the biggest cultural difference you've experienced when meeting someone from another country?", country: null, category: "culture" },
      ])
      .onConflictDoNothing();

    // Normalize the status emitted by the legacy admin approval endpoint so
    // valid existing coaches satisfy the single approved-marketplace predicate.
    await db.update(coachesTable)
      .set({ verificationStatus: "approved" })
      .where(and(
        eq(coachesTable.isVerified, true),
        eq(coachesTable.verificationStatus, "verified"),
      ));

    await seedCoaches();
    await seedProfiles();
    await seedLanguageQuizzes();
    await seedWorkshops();

    console.log("[seed] Database seeded successfully");
  } catch (err) {
    console.warn("[seed] Seed error (non-fatal):", (err as Error).message);
  }
}
