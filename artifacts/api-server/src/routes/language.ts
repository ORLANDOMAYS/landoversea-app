import { Router, type IRouter } from "express";
import {
  db, languageStreaksTable, languageQuizzesTable, quizAttemptsTable, aiCoachMessagesTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { openai } from "@workspace/integrations-openai-ai-server";
import { parsePositiveSafeInteger } from "../lib/positiveSafeInteger";

const router: IRouter = Router();

interface StoredQuizQuestion {
  id: number;
  text: string;
  options: string[];
  correctAnswer: string;
}

async function ensureStreak(userId: number) {
  const [streak] = await db.select().from(languageStreaksTable).where(eq(languageStreaksTable.userId, userId)).limit(1);
  if (streak) return streak;
  const [created] = await db.insert(languageStreaksTable).values({ userId }).returning();
  return created;
}

function getStoredQuestions(quiz: typeof languageQuizzesTable.$inferSelect): StoredQuizQuestion[] {
  if (!Array.isArray(quiz.questions)) return [];
  return quiz.questions.filter((question): question is StoredQuizQuestion => {
    if (!question || typeof question !== "object") return false;
    const item = question as Record<string, unknown>;
    return Number.isInteger(item.id)
      && typeof item.text === "string"
      && Array.isArray(item.options)
      && item.options.every((option) => typeof option === "string")
      && typeof item.correctAnswer === "string";
  });
}

function toPublicQuiz(quiz: typeof languageQuizzesTable.$inferSelect) {
  const questions = getStoredQuestions(quiz).map(({ correctAnswer: _correctAnswer, ...question }) => question);
  return { ...quiz, questions };
}

router.get("/language/streak", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const streak = await ensureStreak(user.id);
  res.json(streak);
});

router.get("/language/quizzes", requireAuth, async (req, res): Promise<void> => {
  const { language, category, difficulty } = req.query as Record<string, string>;
  let quizzes = await db.select().from(languageQuizzesTable).limit(20);
  if (language) quizzes = quizzes.filter((q) => q.language === language);
  if (category) quizzes = quizzes.filter((q) => q.category === category);
  if (difficulty) quizzes = quizzes.filter((q) => q.difficulty === difficulty);

  res.json(quizzes.map(toPublicQuiz));
});

router.get("/language/quizzes/:quizId", requireAuth, async (req, res): Promise<void> => {
  const quizId = parsePositiveSafeInteger(Array.isArray(req.params.quizId) ? req.params.quizId[0] : req.params.quizId);
  if (quizId === null) {
    res.status(400).json({ error: "Invalid quiz id" });
    return;
  }
  const [quiz] = await db.select().from(languageQuizzesTable).where(eq(languageQuizzesTable.id, quizId)).limit(1);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found" });
    return;
  }
  res.json(toPublicQuiz(quiz));
});

router.post("/language/quizzes/:quizId/attempt", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const qId = parsePositiveSafeInteger(Array.isArray(req.params.quizId) ? req.params.quizId[0] : req.params.quizId);
  if (qId === null) {
    res.status(400).json({ error: "Invalid quiz id" });
    return;
  }
  const { answers } = req.body;
  if (!Array.isArray(answers)) {
    res.status(400).json({ error: "answers must be an array" });
    return;
  }
  const [quiz] = await db.select().from(languageQuizzesTable).where(eq(languageQuizzesTable.id, qId)).limit(1);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found" });
    return;
  }
  const questions = getStoredQuestions(quiz);
  if (questions.length === 0) {
    res.status(409).json({ error: "Quiz has no questions" });
    return;
  }
  const submitted = new Map<number, string>();
  for (const answer of answers) {
    if (!answer || typeof answer !== "object") continue;
    const entry = answer as Record<string, unknown>;
    if (Number.isInteger(entry.questionId) && typeof entry.answer === "string") {
      submitted.set(entry.questionId as number, entry.answer.trim());
    }
  }
  const feedback = questions.map((question) => {
    const answer = submitted.get(question.id) ?? "";
    return {
      questionId: question.id,
      correct: answer.localeCompare(question.correctAnswer, undefined, { sensitivity: "accent" }) === 0,
      correctAnswer: question.correctAnswer,
    };
  });
  const score = feedback.filter((item) => item.correct).length;
  const total = questions.length;
  const xpReward = quiz.xpReward;
  const passed = score / total >= 0.7;
  const xpEarned = passed ? xpReward : Math.floor(xpReward * 0.3);

  const [attempt] = await db.insert(quizAttemptsTable).values({
    quizId: qId,
    userId: user.id,
    score,
    total,
    passed,
    xpEarned,
    answers,
  }).returning();

  // Update streak
  const streak = await ensureStreak(user.id);
  const lastActivity = streak.lastActivityAt ? new Date(streak.lastActivityAt) : null;
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);

  let newStreak = streak.currentStreak;
  if (!lastActivity || lastActivity < yesterday) {
    newStreak = 1;
  } else if (lastActivity.toDateString() !== now.toDateString()) {
    newStreak = streak.currentStreak + 1;
  }

  const newXp = streak.xpTotal + xpEarned;
  let level = "Beginner";
  if (newXp >= 5000) level = "Master";
  else if (newXp >= 2000) level = "Advanced";
  else if (newXp >= 500) level = "Intermediate";

  await db.update(languageStreaksTable).set({
    currentStreak: newStreak,
    longestStreak: Math.max(newStreak, streak.longestStreak),
    xpTotal: newXp,
    level,
    lastActivityAt: now,
  }).where(eq(languageStreaksTable.userId, user.id));

  res.json({ ...attempt, score, total, xpEarned, passed, feedback, newStreak, level });
});

router.post("/language/ai-coach", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { message, targetLanguage, mode = "freeform" } = req.body;
  if (!message) { res.status(400).json({ error: "message required" }); return; }

  // Store user message
  await db.insert(aiCoachMessagesTable).values({
    userId: user.id,
    role: "user",
    content: message,
    targetLanguage: targetLanguage ?? null,
    mode,
  });

  // Fetch conversation history
  const history = await db.select().from(aiCoachMessagesTable)
    .where(eq(aiCoachMessagesTable.userId, user.id))
    .orderBy(desc(aiCoachMessagesTable.createdAt)).limit(20);
  const orderedHistory = history.reverse().slice(0, -1); // exclude the just-inserted user message

  let response: string;
  try {
    const systemPrompt = `You are LinguaCoach, a warm and encouraging language learning assistant for LandOverSEA, an international dating and cultural connection app.
Help the user practice ${targetLanguage ?? "their target language"}, explain grammar and vocabulary, give cultural context, and build confidence for real conversations.
Mode: ${mode === "translation" ? "Focus on accurate translation and explanation." : mode === "pronunciation" ? "Give pronunciation tips using phonetic guides (e.g. IPA or romanization)." : "Engage in friendly practice conversation."}
Keep responses encouraging, concise (2-4 sentences max), and practical. When correcting mistakes, be gentle and explain why.`;

    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      ...orderedHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      max_completion_tokens: 400,
      messages: chatMessages,
    });

    response = completion.choices[0]?.message?.content ?? "I'm having trouble connecting right now. Please try again!";
  } catch (err) {
    response = "I'm having trouble connecting right now. Please try again!";
  }

  const [assistantMsg] = await db.insert(aiCoachMessagesTable).values({
    userId: user.id,
    role: "assistant",
    content: response,
    targetLanguage: targetLanguage ?? null,
    mode,
  }).returning();

  res.json({ ...assistantMsg, content: response });
});

router.get("/language/ai-coach/history", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const history = await db.select().from(aiCoachMessagesTable)
    .where(eq(aiCoachMessagesTable.userId, user.id))
    .orderBy(desc(aiCoachMessagesTable.createdAt)).limit(50);
  res.json(history.reverse());
});

export default router;
