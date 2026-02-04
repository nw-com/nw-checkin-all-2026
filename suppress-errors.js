(function() {
  // Enhanced Error Suppression Logic
  // This script must be loaded synchronously in the <head> before any other scripts.
  
  try {
    const _origError = console.error.bind(console);
    const _origWarn = console.warn.bind(console);
    
    const suppressKeywords = [
      "google.firestore.v1.Firestore/Listen/channel",
      "net::ERR_ABORTED",
      "failed to fetch",
      "network error",
      "XMLHTTP",
      "ERR_INTERNET_DISCONNECTED",
      "The operation was aborted",
      "Connection WebChannel transport errored",
      "firestore.googleapis.com",
      "gsessionid",
      "rpc",
      "SID="
    ];

    const isSuppressed = (msg) => {
      if (!msg) return false;
      const s = String(msg).toLowerCase();
      return suppressKeywords.some(k => s.includes(k.toLowerCase()));
    };

    // Override console.error
    console.error = (...args) => {
      const msg = args.map(a => {
        if (typeof a === "string") return a;
        if (a && typeof a === "object") {
           // Include stack and message
           return (a.message || "") + " " + (a.stack || "") + " " + String(a);
        }
        return String(a);
      }).join(" ");
      
      if (isSuppressed(msg)) return;
      _origError(...args);
    };

    // Override console.warn
    console.warn = (...args) => {
      const msg = args.map(a => {
        if (typeof a === "string") return a;
        if (a && typeof a === "object") {
           return (a.message || "") + " " + (a.stack || "") + " " + String(a);
        }
        return String(a);
      }).join(" ");
      
      if (isSuppressed(msg)) return;
      _origWarn(...args);
    };

    // Global error handler (addEventListener)
    window.addEventListener("error", (e) => {
      const m = e && (e.message || (e.error && e.error.message) || "");
      if (isSuppressed(m) || (e.filename && isSuppressed(e.filename))) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return true;
      }
    }, true);

    // Global unhandledrejection handler
    window.addEventListener("unhandledrejection", (e) => {
      const r = e && e.reason;
      const m = (r && r.message) ? r.message : String(r || "");
      if (isSuppressed(m)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);

    // Legacy onerror handler (backup)
    const _oldOnerror = window.onerror;
    window.onerror = function(message, source, lineno, colno, error) {
      const m = String(message || "") + " " + String(source || "");
      if (isSuppressed(m)) return true; // prevent default
      if (_oldOnerror) return _oldOnerror(message, source, lineno, colno, error);
      return false;
    };

  } catch (e) {
    // Failsafe
    console.log("Error suppression init failed", e);
  }
})();
