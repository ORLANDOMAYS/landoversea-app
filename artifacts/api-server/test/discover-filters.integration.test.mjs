import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const baseUrl = (process.env.TEST_BASE_URL ?? "http://127.0.0.1:8080").replace(
  /\/+$/,
  "",
);

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("x-forwarded-for", options.clientIp ?? "198.51.100.44");
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const rawBody = await response.text();
  const data = rawBody === "" ? null : JSON.parse(rawBody);
  const setCookie = response.headers.get("set-cookie");
  return { status: response.status, data, cookie: setCookie?.split(";", 1)[0] ?? null };
}

async function registerUser(label) {
  const suffix = randomUUID();
  const email = `${label}-${suffix}@example.com`;
  const password = "DiscoverPass123!";
  const res = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: `${label} ${suffix.slice(0, 6)}`,
      email,
      password,
      acceptedAgeRequirement: true,
    },
  });
  assert.equal(res.status, 201, `register ${label}: ${JSON.stringify(res.data)}`);
  const me = await request("/api/auth/me", { cookie: res.cookie });
  return { email, password, cookie: res.cookie, id: me.data?.id ?? me.data?.user?.id };
}

async function cleanup(user) {
  if (!user?.cookie) return;
  await request("/api/auth/delete-account", {
    method: "DELETE",
    cookie: user.cookie,
    body: { confirmPassword: user.password },
  });
}

// Deterministically walk every page of the discover deck (never assume the
// newest fixture lands in the first page) and collect all cards.
async function collectAllCards(user, query = "") {
  const all = [];
  const seen = new Set();
  const sep = query ? "&" : "";
  for (let offset = 0; offset < 5_000; offset += 50) {
    const page = await request(
      `/api/discover/cards?${query}${sep}limit=50&offset=${offset}`,
      { cookie: user.cookie },
    );
    assert.equal(page.status, 200, JSON.stringify(page.data));
    for (const card of page.data) {
      // The deck must be stable/non-overlapping across pages.
      assert.ok(!seen.has(card.userId), `duplicate card across pages: ${card.userId}`);
      seen.add(card.userId);
      all.push(card);
    }
    if (page.data.length < 50) break;
  }
  return all;
}

// A card matches a language filter when the candidate's primary language or one
// of their other languages is in the requested set.
function cardSpeaks(card, languages) {
  const spoken = [card.profile?.primaryLanguage, ...(card.profile?.otherLanguages ?? [])].filter(Boolean);
  return spoken.some((l) => languages.includes(l));
}

async function uploadPhoto(user) {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const form = new FormData();
  form.set("photo", new Blob([png], { type: "image/png" }), "profile.png");
  const response = await fetch(`${baseUrl}/api/profiles/me/photos`, {
    method: "POST",
    headers: {
      cookie: user.cookie,
      "x-forwarded-for": "198.51.100.44",
    },
    body: form,
  });
  assert.equal(response.status, 201, await response.text());
}

test("discover filters provision a missing local profile without registration coupling", async () => {
  const seeker = await registerUser("filter-only-seeker");
  try {
    await db.delete(profilesTable).where(eq(profilesTable.userId, seeker.id));

    const before = await request("/api/discover/filters", { cookie: seeker.cookie });
    assert.equal(before.status, 200);
    assert.equal(before.data.gender, null);

    const saved = await request("/api/discover/filters", {
      method: "PATCH",
      cookie: seeker.cookie,
      body: {
        minAge: 25,
        maxAge: 47,
        gender: "Woman",
        languages: ["French"],
        globalMode: true,
      },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.gender, "female");

    const hydrated = await request("/api/discover/filters", { cookie: seeker.cookie });
    assert.equal(hydrated.status, 200);
    assert.equal(hydrated.data.minAge, 25);
    assert.equal(hydrated.data.maxAge, 47);
    assert.equal(hydrated.data.gender, "female");
    assert.deepEqual(hydrated.data.languages, ["French"]);

    const [profile] = await db.select().from(profilesTable)
      .where(eq(profilesTable.userId, seeker.id)).limit(1);
    assert.ok(profile, "filter PATCH creates the missing profile boundary row");
    assert.equal(profile.name, "", "profile-only defaults are used instead of registration data");
  } finally {
    await cleanup(seeker);
  }
});

test("discover language filter persists, hydrates, and drives card results", async () => {
  const seeker = await registerUser("seeker");
  const jaSpeaker = await registerUser("ja-speaker");
  const frSpeaker = await registerUser("fr-speaker");
  try {
    // Complete the seeker: a Woman looking for Everyone, wide age band.
    await request("/api/profiles/me", {
      method: "PATCH",
      cookie: seeker.cookie,
      body: {
        age: 30,
        gender: "Woman",
        lookingFor: "Everyone",
        primaryLanguage: "English",
        country: "United States",
        preferredMinAge: 18,
        preferredMaxAge: 60,
      },
    });

    // A candidate who speaks Japanese (primary), open to everyone, with a photo.
    await request("/api/profiles/me", {
      method: "PATCH",
      cookie: jaSpeaker.cookie,
      body: {
        age: 31,
        gender: "Man",
        lookingFor: "Everyone",
        primaryLanguage: "Japanese",
        country: "Japan",
        preferredMinAge: 18,
        preferredMaxAge: 60,
      },
    });
    await uploadPhoto(jaSpeaker);

    // A candidate who speaks French only, otherwise identical.
    await request("/api/profiles/me", {
      method: "PATCH",
      cookie: frSpeaker.cookie,
      body: {
        age: 32,
        gender: "Man",
        lookingFor: "Everyone",
        primaryLanguage: "French",
        country: "France",
        preferredMinAge: 18,
        preferredMaxAge: 60,
      },
    });
    await uploadPhoto(frSpeaker);

    // Persisting the visible language filter must land in learningLanguages and
    // be readable back for hydration.
    const saved = await request("/api/discover/filters", {
      method: "PATCH",
      cookie: seeker.cookie,
      body: { minAge: 18, maxAge: 60, countries: [], languages: ["Japanese"], globalMode: true },
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.data.languages, ["Japanese"]);

    const hydrated = await request("/api/discover/filters", { cookie: seeker.cookie });
    assert.equal(hydrated.status, 200);
    assert.deepEqual(
      hydrated.data.languages,
      ["Japanese"],
      "saved filter language is returned for UI hydration",
    );

    // The cards endpoint honors the stored language filter (Japanese only).
    // Paginate the whole deck deterministically — do not assume the fixture is
    // on the first page — and require EVERY returned card to speak Japanese.
    const jaCards = await collectAllCards(seeker);
    const jaCardUserIds = jaCards.map((c) => c.userId);
    assert.ok(jaCardUserIds.includes(jaSpeaker.id), "Japanese candidate is surfaced");
    assert.ok(
      !jaCardUserIds.includes(frSpeaker.id),
      "French-only candidate is filtered out by a Japanese language filter",
    );
    for (const card of jaCards) {
      assert.ok(
        cardSpeaks(card, ["Japanese"]),
        `every card in a Japanese-filtered deck must speak Japanese (offender userId=${card.userId})`,
      );
    }

    // A per-request override to French flips which candidate is surfaced, and
    // every card in the French deck must speak French.
    const frCards = await collectAllCards(seeker, "languages=French");
    const frIds = frCards.map((c) => c.userId);
    assert.ok(frIds.includes(frSpeaker.id), "French candidate is surfaced by the override");
    assert.ok(
      !frIds.includes(jaSpeaker.id),
      "Japanese candidate excluded when overriding filter to French",
    );
    for (const card of frCards) {
      assert.ok(
        cardSpeaks(card, ["French"]),
        `every card in a French-filtered deck must speak French (offender userId=${card.userId})`,
      );
    }
  } finally {
    await cleanup(seeker);
    await cleanup(jaSpeaker);
    await cleanup(frSpeaker);
  }
});

test("advanced discover filters persist, hydrate, and drive card results", async () => {
  const seeker = await registerUser("adv-seeker");
  // matcher matches every advanced preference; misser fails each one.
  const matcher = await registerUser("adv-matcher");
  const misser = await registerUser("adv-misser");
  // Boundary candidate at the canonical unrestricted maxAge (99): must survive Clear.
  const elder = await registerUser("adv-elder");
  try {
    await request("/api/profiles/me", {
      method: "PATCH",
      cookie: seeker.cookie,
      body: {
        age: 30,
        gender: "Woman",
        lookingFor: "Everyone",
        primaryLanguage: "English",
        interests: ["hiking", "coffee"],
        preferredMinAge: 18,
        preferredMaxAge: 60,
      },
    });

    await request("/api/profiles/me", {
      method: "PATCH",
      cookie: matcher.cookie,
      body: {
        age: 31,
        gender: "Man",
        lookingFor: "Everyone",
        primaryLanguage: "English",
        relationshipGoal: "serious",
        interests: ["hiking", "travel"],
        longDistanceOpenness: true,
        relocationOpenness: true,
        preferredMinAge: 18,
        preferredMaxAge: 60,
      },
    });
    await uploadPhoto(matcher);

    await request("/api/profiles/me", {
      method: "PATCH",
      cookie: misser.cookie,
      body: {
        age: 32,
        gender: "Man",
        lookingFor: "Everyone",
        primaryLanguage: "English",
        relationshipGoal: "casual",
        interests: ["gaming", "cooking"],
        longDistanceOpenness: false,
        relocationOpenness: false,
        preferredMinAge: 18,
        preferredMaxAge: 60,
      },
    });
    await uploadPhoto(misser);

    // A qualifying candidate exactly at the canonical unrestricted maxAge (99).
    await request("/api/profiles/me", {
      method: "PATCH",
      cookie: elder.cookie,
      body: {
        age: 99,
        gender: "Man",
        lookingFor: "Everyone",
        primaryLanguage: "English",
        preferredMinAge: 18,
        preferredMaxAge: 99,
      },
    });
    await uploadPhoto(elder);

    // Persist the full canonical model with all five advanced preferences.
    const saved = await request("/api/discover/filters", {
      method: "PATCH",
      cookie: seeker.cookie,
      body: {
        gender: "MAN",
        relationshipGoal: "serious",
        interestsOverlap: true,
        verifiedOnly: false,
        longDistance: true,
        relocation: true,
      },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.gender, "male", "legacy aliases are persisted and returned canonically");
    assert.equal(saved.data.relationshipGoal, "serious");
    assert.equal(saved.data.interestsOverlap, true);
    assert.equal(saved.data.longDistance, true);
    assert.equal(saved.data.relocation, true);
    assert.equal(saved.data.verifiedOnly, false);
    const unchangedProfile = await request("/api/profiles/me", { cookie: seeker.cookie });
    assert.equal(unchangedProfile.status, 200);
    assert.equal(unchangedProfile.data.gender, "Woman");
    assert.equal(unchangedProfile.data.age, 30);

    // GET returns the full canonical model, including untouched basics.
    const hydrated = await request("/api/discover/filters", { cookie: seeker.cookie });
    assert.equal(hydrated.status, 200);
    assert.equal(hydrated.data.gender, "male");
    assert.equal(hydrated.data.relationshipGoal, "serious");
    assert.equal(hydrated.data.interestsOverlap, true);
    assert.equal(hydrated.data.longDistance, true);
    assert.equal(hydrated.data.relocation, true);
    assert.equal(hydrated.data.verifiedOnly, false);
    assert.equal(typeof hydrated.data.minAge, "number");
    assert.equal(typeof hydrated.data.globalMode, "boolean");

    // Stored advanced preferences drive card results: matcher passes all five,
    // misser fails relationship goal / interests overlap / long-distance / relocation.
    const cards = await request("/api/discover/cards", { cookie: seeker.cookie });
    assert.equal(cards.status, 200);
    const ids = cards.data.map((c) => c.userId);
    assert.ok(ids.includes(matcher.id), "candidate matching all advanced prefs is surfaced");
    assert.ok(!ids.includes(misser.id), "candidate failing advanced prefs is filtered out");
    assert.ok(
      ids.includes(matcher.id),
      "canonical male filter remains compatible with a legacy Man profile row",
    );

    // PATCH updates only fields present: flipping relationshipGoal alone must not
    // reset the other advanced booleans.
    const partial = await request("/api/discover/filters", {
      method: "PATCH",
      cookie: seeker.cookie,
      body: { relationshipGoal: "casual" },
    });
    assert.equal(partial.status, 200);
    assert.equal(partial.data.relationshipGoal, "casual");
    assert.equal(partial.data.interestsOverlap, true, "unspecified fields are preserved");
    assert.equal(partial.data.longDistance, true);
    assert.equal(partial.data.relocation, true);

    // verifiedOnly filtering: no test candidate is verified, so turning it on
    // yields an empty deck; turning it off surfaces the matcher again.
    const verifiedOn = await request("/api/discover/cards?verifiedOnly=true", {
      cookie: seeker.cookie,
    });
    assert.equal(verifiedOn.status, 200);
    assert.equal(
      verifiedOn.data.length,
      0,
      "verifiedOnly excludes all unverified candidates",
    );

    // Clear defaults genuinely remove restrictions: matcher and misser both
    // surface once every advanced preference is reset.
    const cleared = await request("/api/discover/filters", {
      method: "PATCH",
      cookie: seeker.cookie,
      body: {
        minAge: 18,
        maxAge: 99,
        gender: null,
        countries: [],
        languages: [],
        globalMode: true,
        relationshipGoal: null,
        interestsOverlap: false,
        verifiedOnly: false,
        longDistance: false,
        relocation: false,
      },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.relationshipGoal, null);
    assert.equal(cleared.data.interestsOverlap, false);
    assert.equal(cleared.data.verifiedOnly, false);
    assert.equal(cleared.data.longDistance, false);
    assert.equal(cleared.data.relocation, false);
    assert.equal(cleared.data.minAge, 18);
    assert.equal(cleared.data.maxAge, 99);
    assert.equal(cleared.data.globalMode, true);

    const clearedIds = [];
    for (let offset = 0; offset < 1_000; offset += 50) {
      const page = await request(
        `/api/discover/cards?limit=50&offset=${offset}`,
        { cookie: seeker.cookie },
      );
      assert.equal(page.status, 200);
      clearedIds.push(...page.data.map((c) => c.userId));
      if (page.data.length < 50) break;
    }
    assert.ok(
      clearedIds.includes(matcher.id) && clearedIds.includes(misser.id),
      "cleared defaults surface all candidates with no restrictions",
    );
    // Boundary: a qualifying candidate at exactly age 99 is NOT removed by Clear.
    assert.ok(
      clearedIds.includes(elder.id),
      "cleared defaults (maxAge 99) keep the age-99 boundary candidate",
    );
  } finally {
    await cleanup(seeker);
    await cleanup(matcher);
    await cleanup(misser);
    await cleanup(elder);
  }
});
