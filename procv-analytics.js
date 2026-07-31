// procv-analytics.js
//
// PII-safe wrapper around posthog.capture(). Never pass email, phone,
// or anything identity-linked into these — PostHog gets an anonymous
// distinct_id automatically; correlation to a real person only ever
// happens inside Supabase (blueprint 5.4).
//
// Load this AFTER the PostHog snippet (procv-posthog.html) and BEFORE
// procv-download-gate.js / the paywall modal, since both call these.

function pwTrack(event, props) {
  if (typeof posthog === "undefined") return;
  // Allow-list only. Extend deliberately, not by just passing through
  // whatever object a caller hands in — that's how PII leaks in.
  const SAFE_KEYS = ["template_id", "is_free", "package", "document_type"];
  const safeProps = {};
  if (props) {
    for (const k of SAFE_KEYS) {
      if (k in props) safeProps[k] = props[k];
    }
  }
  posthog.capture(event, safeProps);
}

window.pwTrack = pwTrack;
