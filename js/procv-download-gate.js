(function () {
  window.addEventListener('error', e => console.error('JS ERROR:', e.message, e.error));
  window.addEventListener('unhandledrejection', e => console.error('PROMISE ERROR:', e.reason));

  const SUPABASE_URL = "https://mlhuidtekecxgeizgmyr.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_vNUa__bfq0gHRIObYNe0rQ_MgI8s09r";

  
  const supabase = window.mellowSupabase || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.mellowSupabase = supabase; 
  window.MELLOW_SUPABASE_URL = SUPABASE_URL;
  window.MELLOW_SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

  // Device id: a stable per-browser id sent alongside free-download checks so
  // the backend can use it as a secondary signal next to IP (IP alone means
  // shared networks look "already used" while VPN switching looks unlimited).
  // NOTE: the download-free Edge Function must also be updated to read and
  // store this field — this only prepares the frontend side of that fix.
  const DEVICE_ID_KEY = "mellow_device_id";
  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function setCookie(name, value) {
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${400 * 24 * 60 * 60}; path=/; SameSite=Lax`;
  }
  function getDeviceId() {
    let id = null;
    try { id = window.localStorage.getItem(DEVICE_ID_KEY); } catch (e) {}
    if (!id) id = getCookie(DEVICE_ID_KEY);
    if (!id) {
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : ('dev_' + Date.now() + '_' + Math.random().toString(36).slice(2));
    }
    try { window.localStorage.setItem(DEVICE_ID_KEY, id); } catch (e) {}
    setCookie(DEVICE_ID_KEY, id);
    return id;
  }
  window.getMellowDeviceId = getDeviceId;

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
        if (window.updateGlobalCreditBadge) window.updateGlobalCreditBadge();
        return renderAndDownload(documentType, templateId, { paid: true });
      }
      if (paidResult.reason === "no_credits") {
        showToastSafe("You're out of credits — grab more to keep downloading", "info");
        if (window.pwOpenForBuy) window.pwOpenForBuy(documentType, templateId);
        else showPaywall();
        return;
      }
      // Any other outcome — including a server-side error response like
      // {error:"internal_error"} that has neither `allowed` nor a
      // recognized `reason` — used to fall straight through to the
      // free-download path below. For a logged-in, paid user that's always
      // wrong: the free download then fails too (already used), which
      // reopens the paid "unlocked" screen and loops forever. Treat any
      // unrecognized paid result as a hard error instead.
      console.error("paid download not allowed", paidResult);
      showToastSafe("Something went wrong — please try again.", "error");
      return;
    }

    const freeResult = await tryFreeDownload(documentType, templateId);
    if (freeResult.allowed) {
      return renderAndDownload(documentType, templateId, { paid: false });
    }
    if (freeResult.reason === "error") {
      showToastSafe("Something went wrong — please try again.", "error");
      return;
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY },
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
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ document_type: documentType, template_used: templateId, device_id: getDeviceId() }),
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY },
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
    if (window.updateGlobalCreditBadge) window.updateGlobalCreditBadge();
    if (status && status.credits_remaining > 0) {
      return { ok: true, unlocked: true };
    }
    return { ok: true, unlocked: false };
  }

  async function renderAndDownload(documentType, templateId, meta) {
    if (documentType === "cv") {
      await window.exportPDFDirect();
    } else if (documentType === "coverletter") {
      await window.exportCoverLetterPDFDirect();
    }
  }

  window.attemptDownload = attemptDownload;
  window.requestOtp = requestOtp;
  window.confirmOtp = confirmOtp;
  window.showPaywall = showPaywall;
  window.hidePaywall = hidePaywall;
  window.checkSessionStatus = checkSessionStatus;
})();
