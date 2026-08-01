window.addEventListener('error', e => alert('JS ERROR: ' + e.message));
window.addEventListener('unhandledrejection', e => alert('PROMISE ERROR: ' + (e.reason?.message || e.reason)));

const SUPABASE_URL = "https://mlhuidtekecxgeizgmyr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vNUa__bfq0gHRIObYNe0rQ_MgI8s09r";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function attemptDownload(documentType, templateId) {
  pwTrack("cv_download_attempted", { document_type: documentType, template_id: templateId });
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const paidResult = await tryPaidDownload(documentType, templateId, session.access_token);
    if (paidResult.allowed) {
      pwTrack("cv_download_completed", { document_type: documentType, template_id: templateId, is_free: false });
      return renderAndDownload(documentType, templateId, { paid: true });
    }
  }
  const freeResult = await tryFreeDownload(documentType, templateId);
  if (freeResult.allowed) {
    pwTrack("cv_download_completed", { document_type: documentType, template_id: templateId, is_free: true });
    return renderAndDownload(documentType, templateId, { paid: false });
  }
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
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
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
    return { allowed: false, reason: "error" };
  }
}

async function checkSessionStatus(accessToken) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/session-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("session status check failed", e);
    return null;
  }
}

function showPaywall() {
  const modal = document.getElementById("paywall-modal");
  if (modal) modal.style.display = "flex";
}

function hidePaywall() {
  const modal = document.getElementById("paywall-modal");
  if (modal) modal.style.display = "none";
}

async function requestOtp(email) {
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
  const { data, error } = await supabase.auth.verifyOtp({ email: email, token: code, type: "email" });
  if (error || !data.session) {
    console.error("OTP confirm failed", error);
    return { ok: false, error: "Invalid or expired code." };
  }
  if (typeof posthog !== "undefined") {
    posthog.identify(data.session.user.id);
  }
  const status = await checkSessionStatus(data.session.access_token);
  hidePaywall();
  if (status && status.credits_remaining > 0) {
    return { ok: true, unlocked: true };
  }
  return { ok: true, unlocked: false };
}

async function renderAndDownload(documentType, templateId, meta) {
  if (documentType === "cv") {
    await exportPDFDirect();
  }
}

window.attemptDownload = attemptDownload;
window.requestOtp = requestOtp;
window.confirmOtp = confirmOtp;
window.hidePaywall = hidePaywall;
window.checkSessionStatus = checkSessionStatus;
window.supabase = supabase;
