// procv-download-gate.js
//
// Drop-in module for ProCV_fixed__2_.html. Replaces the direct
// `window.print()` / `downloadWord()` calls on the download button with a
// gated flow: try free download -> if refused, show paywall -> OTP -> check
// credits -> unlock or send to payment.
//
// Fill in SUPABASE_URL / SUPABASE_ANON_KEY below (anon key is safe to ship
// to the frontend — it's RLS-restricted, not the service role key).

const SUPABASE_URL = "REPLACE_WITH_YOUR_PROJECT_URL";
const SUPABASE_ANON_KEY = "REPLACE_WITH_YOUR_ANON_KEY";

// Loaded via <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function attemptDownload(documentType, templateId) {
  pwTrack("cv_download_attempted", { document_type: documentType, template_id: templateId });

  // 1. Existing verified session? Try to consume a credit atomically —
  // this is the only place credits actually get deducted, so this call
  // must happen, not just a balance check.
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const paidResult = await tryPaidDownload(documentType, templateId, session.access_token);
    if (paidResult.allowed) {
      pwTrack("cv_download_completed", { document_type: documentType, template_id: templateId, is_free: false });
      return renderAndDownload(documentType, templateId, { paid: true });
    }
    // Verified but zero credits — fall through to the free-gate check
    // below (covers e.g. a returning verified user on a fresh IP who
    // hasn't used their free download yet), then the paywall's buy step.
  }

  // 2. No session, or zero credits — try the free-tier soft gate.
  const freeResult = await tryFreeDownload(documentType, templateId);
  if (freeResult.allowed) {
    pwTrack("cv_download_completed", { document_type: documentType, template_id: templateId, is_free: true });
    return renderAndDownload(documentType, templateId, { paid: false });
  }

  // 3. Free gate refused it — show the paywall, remembering what the user
  // was trying to download so we can resume after verification.
  pwTrack("paywall_shown", { document_type: documentType, template_id: templateId });
  if (window.pwOpenForDownload) {
    window.pwOpenForDownload(documentType, templateId);
  } else {
    showPaywall();
  }
}

async function tryPaidDownload(documentType, templateId, accessToken) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/download-paid`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ document_type: documentType, template_used: templateId }),
    });
    return await res.json();
  } catch (e) {
    console.error("paid download check failed", e);
    return { allowed: false, reason: "error" };
  }
}

async function tryFreeDownload(documentType, templateId) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/download-free`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_type: documentType, template_used: templateId }),
    });
    return await res.json();
  } catch (e) {
    console.error("free download check failed", e);
    // Fail closed: on network/server error, don't silently grant a free
    // download — show the paywall path instead, which re-checks status.
    return { allowed: false, reason: "error" };
  }
}

async function checkSessionStatus(accessToken) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/session-status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("session status check failed", e);
    return null;
  }
}

// --- Paywall UI -------------------------------------------------------

function showPaywall() {
  const modal = document.getElementById("paywall-modal");
  if (modal) modal.style.display = "flex";
}

function hidePaywall() {
  const modal = document.getElementById("paywall-modal");
  if (modal) modal.style.display = "none";
}

async function requestOtp(email) {
  // Basic client-side format check only — Supabase Auth does the real
  // validation server-side. Convenience, not security (per blueprint 6.5).
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const trimmed = email.trim();
  if (!emailRegex.test(trimmed)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: { shouldCreateUser: true },
  });
  if (error) {
    console.error("OTP request failed", error);
    return { ok: false, error: "Could not send code. Please try again shortly." };
  }
  return { ok: true, normalizedEmail: trimmed };
}

async function confirmOtp(email, code) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email,
    token: code,
    type: "email",
  });
  if (error || !data.session) {
    console.error("OTP confirm failed", error);
    return { ok: false, error: "Invalid or expired code." };
  }

  // Ties this browser's anonymous PostHog session to the Supabase user's
  // UUID, so client-side funnel steps (template_selected, paywall_shown...)
  // and the server-side payment_confirmed event (fired from the webhook,
  // using this same UUID) land in one funnel. The UUID alone isn't PII —
  // it only means something if someone also has access to the Supabase
  // database, so this doesn't violate the "no PII in PostHog" rule.
  if (typeof posthog !== "undefined") {
    posthog.identify(data.session.user.id);
  }

  const status = await checkSessionStatus(data.session.access_token);
  hidePaywall();

  if (status && status.credits_remaining > 0) {
    return { ok: true, unlocked: true };
  }
  // Verified, but no credits yet — send to payment (Section 4), not covered
  // in this file.
  return { ok: true, unlocked: false };
}

// --- Actual rendering (unchanged from existing app logic) -------------

function renderAndDownload(documentType, templateId, meta) {
  // Hook into whatever existing renderer ProCV already uses
  // (window.print() for PDF, downloadWord() for .doc) — call it here,
  // now that the gate has actually passed.
  if (documentType === "cv") {
    window.print();
  }
  // Log analytics event regardless of path taken (Section 5) — wired up
  // separately once PostHog snippet is added.
}

window.attemptDownload = attemptDownload;
window.requestOtp = requestOtp;
window.confirmOtp = confirmOtp;
window.hidePaywall = hidePaywall;
window.checkSessionStatus = checkSessionStatus;
// Note: this intentionally overwrites window.supabase (the SDK namespace,
// which exposes .createClient) with the already-created client instance.
// Fine here since createClient is only ever called once, above.
window.supabase = supabase;
