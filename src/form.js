/**
 * HTML escape for use in attribute values and text content.
 * @param {string} s
 * @returns {string}
 */
function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const STYLE = `
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 36rem;
         margin: 4rem auto; padding: 0 1rem; line-height: 1.5; color: #111; }
  form { display: flex; flex-direction: column; gap: 0.75rem; }
  label { font-weight: 600; }
  input[type="email"] { padding: 0.5rem; font-size: 1rem; border: 1px solid #999;
                        border-radius: 0.25rem; }
  button { padding: 0.5rem 1rem; font-size: 1rem; cursor: pointer;
           background: #111; color: #fff; border: 0; border-radius: 0.25rem; }
  button:hover { background: #333; }
  .hp { position: absolute; left: -9999px; top: -9999px; width: 1px;
        height: 1px; overflow: hidden; }
  .msg { padding: 0.75rem 1rem; background: #f4f4f4; border-radius: 0.25rem; }
`.trim();

/**
 * Render the login page (FR-22, FR-23).
 *
 * Two states share one page:
 *   - Initial GET /login: form is shown, no message.
 *   - After POST /login: form is shown again with the confirmation
 *     message above it (FR-7); user can resubmit if needed.
 *
 * No JavaScript, no external resources, inline minimal CSS only.
 *
 * @param {object} args
 * @param {string} args.loginPath        form action URL
 * @param {string} args.honeypotName     honeypot input field name (FR-41)
 * @param {string} [args.confirmationMessage] message shown after submission;
 *   supports "{email}" placeholder, replaced with HTML-escaped echoedEmail.
 *   Omit/null to render the bare form (initial GET).
 * @param {string} [args.echoedEmail]    user-supplied email to echo back
 * @param {string} [args.next]           forward-auth next URL to preserve
 * @returns {string} complete HTML5 document
 */
export function renderLoginForm(args) {
  const {
    loginPath,
    honeypotName,
    confirmationMessage,
    echoedEmail,
    next,
  } = args;

  // confirmationMessage is operator-supplied config, not user input — but
  // operators may naively interpolate user data into it. Escape the whole
  // message before substituting {email} (which is itself escaped). The
  // contract is "confirmationMessage is plain text + {email} placeholder";
  // operators who want HTML can pre-render upstream. Closes AF-6.5.
  const messageBlock =
    confirmationMessage != null
      ? `<div class="msg" role="status">${
          htmlEscape(confirmationMessage).replace(
            /\{email\}/g,
            htmlEscape(echoedEmail ?? ''),
          )
        }</div>`
      : '';

  const nextField = next
    ? `<input type="hidden" name="next" value="${htmlEscape(next)}">`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sign in</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<style>${STYLE}</style>
</head>
<body>
<h1>Sign in</h1>
${messageBlock}
<form method="POST" action="${htmlEscape(loginPath)}" autocomplete="off">
  <label for="email">Email address</label>
  <input id="email" name="email" type="email" required autocomplete="email"
         value="${htmlEscape(echoedEmail ?? '')}">
  <div class="hp" aria-hidden="true">
    <label for="${htmlEscape(honeypotName)}">Leave this empty</label>
    <input id="${htmlEscape(honeypotName)}" name="${htmlEscape(honeypotName)}"
           type="text" tabindex="-1" autocomplete="off">
  </div>
  ${nextField}
  <button type="submit">Send sign-in link</button>
</form>
</body>
</html>
`;
}

export { htmlEscape };
