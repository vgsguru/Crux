import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";


import { getAdminDb, getAdminAuth } from '@/integrations/firebase/admin';

function renderTemplate(tpl: string, vars: Record<string, string | undefined>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_m, key) => vars[key] ?? "");
}

function mdToHtml(md: string): string {
  const escaped = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const withLinks = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#111;text-decoration:underline">$1</a>');
  const withBold = withLinks.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  return withBold.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.6">${p.replace(/\n/g, "<br/>")}</p>`).join("");
}

function emailShell(subject: string, htmlBody: string): string {
  return `<div style="font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,Inter,Arial;background:#fafafa;padding:32px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:24px;padding:36px;border:1px solid #eee"><h1 style="font-size:22px;margin:0 0 18px;font-weight:600">${subject}</h1>${htmlBody}<p style="color:#999;font-size:12px;margin-top:28px;border-top:1px solid #eee;padding-top:14px">Sent via Crux</p></div></div>`;
}

export const upsertMessageTemplate = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    id: z.string().optional(),
    name: z.string().min(2).max(120),
    kind: z.enum(["invite", "reject", "next_steps", "custom"]).default("custom"),
    subject: z.string().min(2).max(200),
    bodyMd: z.string().min(2).max(8000),
    companyId: z.string().nullable().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const payload = {
      owner_id: context.userId,
      name: data.name,
      kind: data.kind,
      subject: data.subject,
      body_md: data.bodyMd,
      company_id: data.companyId ?? null,
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
      await db.collection("message_templates").doc(data.id).update(payload);
      return { id: data.id };
    }
    const ref = await db.collection("message_templates").add({ ...payload, created_at: new Date().toISOString() });
    return { id: ref.id };
  });

export const deleteMessageTemplate = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const snap = await db.collection("message_templates").doc(data.id).get();
    if (!snap.exists || (snap.data() as any).owner_id !== context.userId) throw new Error("Not found");
    await db.collection("message_templates").doc(data.id).delete();
    return { ok: true };
  });

export const seedDefaultTemplates = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .handler(async ({ context }) => {
    const db = await getAdminDb();
    const snap = await db.collection("message_templates").where("owner_id", "==", context.userId).limit(1).get();
    if (!snap.empty) return { ok: true, seeded: 0 };
    const defaults = [
      {
        name: "Interview invitation",
        kind: "invite" as const,
        subject: "You're invited to interview for {{job_title}} at {{company_name}}",
        body_md: "Hi {{candidate_name}},\n\nWe loved your application for **{{job_title}}**. We'd like to invite you to the next stage.\n\nPlease reply to this email with your availability for a 30-minute call this week.\n\nThanks,\n{{recruiter_name}}",
      },
      {
        name: "Not moving forward",
        kind: "reject" as const,
        subject: "Update on your application for {{job_title}}",
        body_md: "Hi {{candidate_name}},\n\nThank you for applying to **{{job_title}}** at {{company_name}}. After careful review we won't be moving forward at this time.\n\nWe truly appreciate the time you put into your application, and we wish you the best in your search.\n\nWarm regards,\n{{recruiter_name}}",
      },
      {
        name: "Next steps",
        kind: "next_steps" as const,
        subject: "Next steps for {{job_title}}",
        body_md: "Hi {{candidate_name}},\n\nGreat news — you're moving forward to the next round for **{{job_title}}**. We'll be in touch shortly with logistics.\n\nReply if you have any questions.\n\n{{recruiter_name}}",
      },
    ];
    const batch = db.batch();
    for (const d of defaults) {
      const ref = db.collection("message_templates").doc();
      batch.set(ref, { ...d, owner_id: context.userId, created_at: new Date().toISOString() });
    }
    await batch.commit();
    return { ok: true, seeded: defaults.length };
  });

// ----- Bulk notify -----
const RATE_LIMIT = 100; // per hour
export const bulkNotify = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    applicationIds: z.array(z.string()).min(1).max(50),
    channel: z.enum(["email", "inapp", "both"]),
    templateId: z.string().optional(),
    subject: z.string().min(2).max(200).optional(),
    bodyMd: z.string().min(2).max(8000).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    // rate limit per recruiter
    const since = new Date(Date.now() - 3600_000).toISOString();
    const rateLimitSnap = await db.collection("application_messages")
      .where("sent_by", "==", context.userId)
      .where("created_at", ">=", since)
      .get();
    if (rateLimitSnap.size + data.applicationIds.length > RATE_LIMIT) {
      throw new Error(`Hourly notify limit reached (${RATE_LIMIT}). Try again later.`);
    }

    let subject = data.subject ?? "";
    let bodyMd = data.bodyMd ?? "";
    if (data.templateId) {
      const tSnap = await db.collection("message_templates").doc(data.templateId).get();
      if (!tSnap.exists || (tSnap.data() as any).owner_id !== context.userId) throw new Error("Template not found");
      const t = tSnap.data() as any;
      subject = data.subject ?? t.subject;
      bodyMd = data.bodyMd ?? t.body_md;
    }
    if (!subject || !bodyMd) throw new Error("Subject and body are required");

    const meSnap = await db.collection("profiles").doc(context.userId).get();
    const recruiterName = meSnap.exists ? (meSnap.data() as any).full_name || "The hiring team" : "The hiring team";

    let sentCount = 0;
    let errCount = 0;
    const resendKey = process.env.RESEND_API_KEY;
    const wantEmail = (data.channel === "email" || data.channel === "both") && !!resendKey;

    for (const appId of data.applicationIds) {
      const appSnap = await db.collection("applications").doc(appId).get();
      if (!appSnap.exists) continue;
      const row = appSnap.data() as any;

      const jobSnap = await db.collection("jobs").doc(row.job_id).get();
      if (!jobSnap.exists) continue;
      const job = jobSnap.data() as any;

      const compSnap = await db.collection("companies").doc(job.company_id).get();
      const comp = compSnap.exists ? compSnap.data() as any : null;
      if (comp?.owner_id !== context.userId) continue; // skip not-owned

      const profileSnap = await db.collection("profiles").doc(row.applicant_id).get();
      const profile = profileSnap.exists ? profileSnap.data() as any : null;
      const candidateName = profile?.full_name || "there";

      const vars = {
        candidate_name: candidateName,
        job_title: job.title,
        company_name: comp?.name ?? "",
        recruiter_name: recruiterName,
      };
      const renderedSubject = renderTemplate(subject, vars);
      const renderedBody = renderTemplate(bodyMd, vars);
      const html = emailShell(renderedSubject, mdToHtml(renderedBody));

      // in-app notification
      if (data.channel === "inapp" || data.channel === "both") {
        try {
          await db.collection("notifications").add({
            user_id: row.applicant_id,
            kind: "recruiter_message",
            title: renderedSubject,
            body: renderedBody.slice(0, 300),
            link: `/me/applications`,
            created_at: new Date().toISOString(),
            read_at: null,
          });
        } catch { /* swallow */ }
      }

      // email
      let emailStatus: "sent" | "error" | "skipped" = "skipped";
      let emailErr: string | null = null;
      if (wantEmail) {
        try {
          const firebaseUser = await (await getAdminAuth()).getUser(row.applicant_id);
          const email = firebaseUser?.email;
          if (email) {
            const res = await fetch(`https://api.resend.com/emails`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${resendKey!}`,
              },
              body: JSON.stringify({
                from: "Crux <onboarding@resend.dev>",
                to: [email],
                subject: renderedSubject,
                html,
              }),
            });
            if (res.ok) { emailStatus = "sent"; sentCount++; }
            else { emailStatus = "error"; emailErr = `${res.status}`; errCount++; }
          }
        } catch (e) {
          emailStatus = "error"; emailErr = e instanceof Error ? e.message : "unknown"; errCount++;
        }
      }

      await db.collection("application_messages").add({
        application_id: appId,
        sent_by: context.userId,
        template_id: data.templateId ?? null,
        subject: renderedSubject,
        body: renderedBody,
        channel: data.channel,
        status: data.channel === "inapp" ? "sent" : emailStatus,
        error: emailErr,
        created_at: new Date().toISOString(),
      });
    }
    return { ok: true, total: data.applicationIds.length, sent: sentCount, errors: errCount };
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().optional(), all: z.boolean().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    if (data.all) {
      const snap = await db.collection("notifications")
        .where("user_id", "==", context.userId)
        .where("read_at", "==", null)
        .get();
      const batch = db.batch();
      snap.forEach(( d: any ) => batch.update(d.ref, { read_at: new Date().toISOString() }));
      await batch.commit();
      return { ok: true };
    }
    if (!data.id) throw new Error("Need id or all");
    const snap = await db.collection("notifications").doc(data.id).get();
    if (!snap.exists || (snap.data() as any).user_id !== context.userId) throw new Error("Not found");
    await db.collection("notifications").doc(data.id).update({ read_at: new Date().toISOString() });
    return { ok: true };
  });

// ----- Headhunting: Recruiter invites an applicant to apply for a job -----
export const inviteToApply = createServerFn({ method: 'POST' })
  .middleware([requireFirebaseAuth])
  .inputValidator((input: unknown) => z.object({
    targetUserId: z.string(),
    jobId: z.string(),
    note: z.string().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await getAdminDb();
    const jobSnap = await db.collection('jobs').doc(data.jobId).get();
    if (!jobSnap.exists) throw new Error('Job not found');
    const job = jobSnap.data() as any;
    const compSnap = await db.collection('companies').doc(job.company_id).get();
    const comp = compSnap.exists ? compSnap.data() as any : null;
    if (!comp || comp.owner_id !== context.userId) throw new Error('Forbidden');
    const recProfileSnap = await db.collection('profiles').doc(context.userId).get();
    const recProfile = recProfileSnap.exists ? recProfileSnap.data() as any : null;
    await db.collection('notifications').add({
      user_id: data.targetUserId, type: 'invite_to_apply',
      title: "You've been invited to apply for " + job.title,
      body: data.note || (recProfile?.full_name ?? "A recruiter") + " at " + comp.name + " thinks you'd be a great fit.",
      data: { jobId: data.jobId, jobTitle: job.title, companyName: comp.name, recruiterId: context.userId },
      read_at: null, created_at: new Date().toISOString(),
    });
    await db.collection('invites').add({
      from_user_id: context.userId, to_user_id: data.targetUserId,
      job_id: data.jobId, note: data.note || null, created_at: new Date().toISOString(),
    });
    return { ok: true };
  });
