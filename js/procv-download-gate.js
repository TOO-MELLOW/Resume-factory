(function () {
  window.addEventListener('error', e => console.error('JS ERROR:', e.message, e.error));
  window.addEventListener('unhandledrejection', e => console.error('PROMISE ERROR:', e.reason));

  const SUPABASE_URL = "https://mlhuidtekecxgeizgmyr.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_vNUa__bfq0gHRIObYNe0rQ_MgI8s09r";

  // Only create the client if nobody has already created one on this page.
  // Prevents "Multiple GoTrueClient instances" auth bugs if another file
  // (e.g. procv-analytics.js) also needs Supabase access.
  const supabase = window.mellowSupabase || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.mellowSupabase = supabase; 
  window.MELLOW_SUPABASE_URL = SUPABASE_URL;
  window.MELLOW_SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

  async function attemptDownload(documentType, templateId) {
    if (typeof window.pwTrack === "function") {
      try { window.pwTrack("cv_download_attempted", { document_type: documentType, template_id: templateId }); }
      catch (e) { console.error("pwTrack failed", e); }
    }

    let session = null;
    try {
      const { data } = await supabase.auth.getSession();
      session = data.session;
    } catch (e) {
      console.error("getSession failed", e);
      showToastSafe("Something went wrong checking your account. Please try again.", "error");
      return;
    }

    if (session) {
      const paidResult = await tryPaidDownload(documentType, templateId, session.access_token);
      if (paidResult.allowed) {
        return renderAndDownload(documentType, templateId, { paid: true });
      }
    }

    const freeResult = await tryFreeDownload(documentType, templateId);
    if (freeResult.allowed) {
      return renderAndDownload(documentType, templateId, { paid: false });
    }
    if (window.pwOpenForDownload) {
      window.pwOpenForDownload(documentType, templateId);
    } else {
      showPaywall();
    }
  }

  function showToastSafe(msg, type) {
    if (typeof window.showToast === "function") window.showToast(msg, type);
    else console.error(msg);
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
    if (status && status.credits_remaining > 0) {
      return { ok: true, unlocked: true };
    }
    return { ok: true, unlocked: false };
  }

  async function renderAndDownload(documentType, templateId, meta) {
    if (documentType === "cv") {
      await window.exportPDFDirect();
    }
  }

  window.attemptDownload = attemptDownload;
  window.requestOtp = requestOtp;
  window.confirmOtp = confirmOtp;
  window.showPaywall = showPaywall;
  window.hidePaywall = hidePaywall;
  window.checkSessionStatus = checkSessionStatus;
})();
