// Local (no-network) trust & safety screen for job posts.
// Heuristic scam/spam detection so fake or low-quality posts can be held for review
// instead of going live. Runs instantly on the client — no API, no paid services.

export type ModerationResult = {
  risk: number; // 0..100
  level: "ok" | "review" | "block";
  flags: string[];
};

const SCAM_PATTERNS: Array<{ re: RegExp; flag: string; weight: number }> = [
  { re: /\b(registration|processing|security|training)\s+fee\b/i, flag: "Mentions an upfront fee", weight: 45 },
  { re: /\b(pay|send|deposit|transfer)\b[^.]{0,40}\b(money|amount|fee|inr|rs\.?|\$)\b/i, flag: "Asks candidate to pay money", weight: 50 },
  { re: /\b(crypto|bitcoin|usdt|forex|binary option)\b/i, flag: "Crypto/forex scheme language", weight: 35 },
  { re: /\b(whatsapp|telegram)\b[^.]{0,30}(\+?\d[\d\s-]{7,})?/i, flag: "Pushes off-platform contact (WhatsApp/Telegram)", weight: 30 },
  { re: /\b(earn|make)\b[^.]{0,30}\b(\$|rs\.?|inr)?\s?\d{2,3}[,k]?\d{0,3}\b[^.]{0,20}\b(per day|a day|daily|per week|weekly|from home)\b/i, flag: "Unrealistic 'earn $X/day from home' claim", weight: 40 },
  { re: /\b(no experience|no skills?|no qualification)\b[^.]{0,30}\b(required|needed)\b/i, flag: "‘No experience/skills required’ for a paid role", weight: 20 },
  { re: /\b(limited seats|act now|urgent hiring|immediate joining)\b/i, flag: "High-pressure urgency language", weight: 15 },
  { re: /\b(bank|aadhaar|aadhar|ssn|otp|cvv|card number)\b/i, flag: "Requests sensitive personal/financial info", weight: 40 },
  { re: /(.)\1{6,}/, flag: "Spammy repeated characters", weight: 15 },
];

export function screenJobPost(input: { title: string; description: string; ideal?: string }): ModerationResult {
  const text = `${input.title}\n${input.description}\n${input.ideal ?? ""}`;
  const flags: string[] = [];
  let risk = 0;

  for (const { re, flag, weight } of SCAM_PATTERNS) {
    if (re.test(text)) { flags.push(flag); risk += weight; }
  }

  // Quality signals (low-effort posts are a soft risk).
  const desc = input.description.trim();
  if (desc.length < 80) { flags.push("Very short description"); risk += 15; }
  const linkCount = (text.match(/https?:\/\//gi) ?? []).length;
  if (linkCount >= 4) { flags.push("Many external links"); risk += 15; }
  if (/[A-Z]{12,}/.test(input.title)) { flags.push("Shouty ALL-CAPS title"); risk += 10; }

  risk = Math.min(100, risk);
  const level: ModerationResult["level"] = risk >= 60 ? "block" : risk >= 30 ? "review" : "ok";
  return { risk, level, flags };
}
