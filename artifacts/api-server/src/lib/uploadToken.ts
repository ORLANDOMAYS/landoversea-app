import jwt from "jsonwebtoken";

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) throw new Error("SESSION_SECRET must be set");

// Short-lived signed claim that binds an upload to an exact object path, the
// authenticated uploader, the declared purpose, and (for chat attachments) the
// target conversation. Presented back when registering the object so the server
// can prove the caller is the same user that minted the presigned URL.
const UPLOAD_TOKEN_ISSUER = "los-storage";
const UPLOAD_TOKEN_AUDIENCE = "los-attachment";
const UPLOAD_TOKEN_TTL_SECONDS = 15 * 60; // <= 15 minutes

export const ATTACHMENT_PURPOSES = [
  "photo",
  "voice_intro",
  "verification",
  "coach_credential",
  "attachment",
] as const;

export type UploadPurpose = (typeof ATTACHMENT_PURPOSES)[number];

export interface UploadClaim {
  // Exact normalized object path (e.g. /objects/uploads/<uuid>).
  objectPath: string;
  // Authenticated uploader user id.
  userId: number;
  purpose: UploadPurpose;
  // Present (positive) only for attachment purpose; binds to a conversation.
  conversationId?: number;
}

interface UploadTokenPayload {
  objectPath: string;
  purpose: UploadPurpose;
  conversationId?: number;
}

/**
 * Sign a short-lived upload claim. The secret is never exposed to callers; only
 * the resulting signed JWT string is returned.
 */
export function signUploadToken(claim: UploadClaim): string {
  const payload: UploadTokenPayload = {
    objectPath: claim.objectPath,
    purpose: claim.purpose,
  };
  if (claim.conversationId !== undefined) {
    payload.conversationId = claim.conversationId;
  }
  return jwt.sign(payload, SECRET!, {
    issuer: UPLOAD_TOKEN_ISSUER,
    audience: UPLOAD_TOKEN_AUDIENCE,
    subject: String(claim.userId),
    expiresIn: UPLOAD_TOKEN_TTL_SECONDS,
  });
}

/**
 * Verify signature + expiry and return the decoded claim, or null when invalid.
 */
export function verifyUploadToken(token: string): UploadClaim | null {
  try {
    const decoded = jwt.verify(token, SECRET!, {
      issuer: UPLOAD_TOKEN_ISSUER,
      audience: UPLOAD_TOKEN_AUDIENCE,
    }) as jwt.JwtPayload & UploadTokenPayload;

    const userId = Number(decoded.sub);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    if (typeof decoded.objectPath !== "string" || !decoded.objectPath) return null;
    if (!ATTACHMENT_PURPOSES.includes(decoded.purpose as UploadPurpose)) return null;

    const claim: UploadClaim = {
      objectPath: decoded.objectPath,
      userId,
      purpose: decoded.purpose as UploadPurpose,
    };
    if (typeof decoded.conversationId === "number") {
      claim.conversationId = decoded.conversationId;
    }
    return claim;
  } catch {
    return null;
  }
}
