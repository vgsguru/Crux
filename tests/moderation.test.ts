import { describe, it, expect } from "vitest";
import { screenJobPost } from "../src/lib/moderation";

const GOOD = {
  title: "Senior Frontend Engineer",
  description: "We're hiring a senior frontend engineer to build our React + TypeScript product. You'll own the design system, improve performance, and mentor two engineers. Remote within India.",
  ideal: "5+ years React, strong TypeScript, product sense.",
};

describe("screenJobPost — trust & safety screen", () => {
  it("passes a normal, well-written job post", () => {
    const r = screenJobPost(GOOD);
    expect(r.level).toBe("ok");
    expect(r.risk).toBeLessThan(30);
    expect(r.flags).toHaveLength(0);
  });

  it("blocks an upfront-fee scam", () => {
    const r = screenJobPost({
      title: "Easy Job",
      description: "Pay a registration fee of Rs 2000 to confirm your seat. Immediate joining, no experience required.",
    });
    expect(r.level).toBe("block");
    expect(r.risk).toBeGreaterThanOrEqual(60);
    expect(r.flags.join(" ")).toMatch(/fee/i);
  });

  it("flags off-platform contact and earn-from-home claims as risky", () => {
    const r = screenJobPost({
      title: "Work From Home",
      description: "Earn $500 per day from home! Contact us on WhatsApp +91 9999988888 to start immediately.",
    });
    expect(r.risk).toBeGreaterThanOrEqual(30);
    expect(["review", "block"]).toContain(r.level);
  });

  it("treats a very short description as a soft risk, not a block", () => {
    const r = screenJobPost({ title: "Designer", description: "Need a designer." });
    expect(r.flags).toContain("Very short description");
    expect(r.level).not.toBe("block");
  });

  it("caps risk at 100 and never returns a negative score", () => {
    const r = screenJobPost({
      title: "URGENT HIRING LIMITED SEATS",
      description: "Pay processing fee. Send money via crypto/bitcoin. Share your aadhaar, OTP and card number. Earn Rs 5000 a day from home. Act now!",
    });
    expect(r.risk).toBeLessThanOrEqual(100);
    expect(r.risk).toBeGreaterThanOrEqual(0);
    expect(r.level).toBe("block");
  });
});
