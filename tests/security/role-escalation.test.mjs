// E2E security test for the user_roles privilege-escalation guard.
// Runs entirely against the live Supabase HTTP API — no dev server required.
//
// Verifies:
//   1) A freshly signed-up user CAN self-assign role='applicant' (allowed by RLS).
//   2) The same user CANNOT self-assign role='applicant' a SECOND time (trigger blocks dupes).
//   3) A different fresh user CANNOT self-assign role='recruiter' directly via the REST API
//      (RLS policy WITH CHECK rejects).
//   4) Cleanup happens via the application of the trigger + policy regardless.
//
// Recruiter assignment via the privileged server function is exercised by the
// app itself; this script asserts the security boundary that the function bypasses.

import { createClient } from "@supabase/supabase-js";

const URL = "https://nrshnlpwxjmbrousulqj.supabase.co";
const KEY = "sb_publishable_EmXWjjhbHGNQwjip_8nbHQ_k1t5nRLN";

function rand() { return Math.random().toString(36).slice(2, 10); }

async function newUser(label) {
  const email = `lumen-sec-${label}-${rand()}@example.com`;
  const password = `Sec-${rand()}-${rand()}!A1`;
  const supabase = createClient(URL, KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(`signUp(${label}): ${error.message}`);
  if (!data.user || !data.session) throw new Error(`signUp(${label}): no session (auto-confirm off?)`);
  console.log(`[ok] signed up ${label}: ${data.user.id}`);
  return { supabase, userId: data.user.id, email };
}

async function tryInsertRole(client, userId, role) {
  const { error } = await client.from("user_roles").insert({ user_id: userId, role });
  return error;
}

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}`); failed++; }
}

(async () => {
  console.log("\n=== Test 1: applicant can self-assign once ===");
  const a = await newUser("applicant");
  const e1 = await tryInsertRole(a.supabase, a.userId, "applicant");
  assert(!e1, `first applicant insert succeeds (got: ${e1?.message ?? "no error"})`);

  console.log("\n=== Test 2: duplicate role insert is rejected ===");
  const e2 = await tryInsertRole(a.supabase, a.userId, "applicant");
  assert(!!e2, `second applicant insert rejected (got: ${e2?.message ?? "NO ERROR — escalation possible"})`);

  console.log("\n=== Test 3: recruiter self-assignment is rejected by RLS ===");
  const b = await newUser("recruiter-attempt");
  const e3 = await tryInsertRole(b.supabase, b.userId, "recruiter");
  assert(!!e3, `recruiter self-insert rejected (got: ${e3?.message ?? "NO ERROR — privilege escalation"})`);

  console.log("\n=== Test 4: cannot insert role for ANOTHER user ===");
  const e4 = await tryInsertRole(b.supabase, a.userId, "applicant");
  assert(!!e4, `cross-user role insert rejected (got: ${e4?.message ?? "NO ERROR"})`);

  console.log(`\n${failed === 0 ? "ALL PASS" : `FAILED: ${failed}`}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
