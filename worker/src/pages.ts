export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function page(status: number, title: string, body: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
${body}
</body>
</html>
`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export function errorPage(message: string): Response {
  return page(400, "Authorization error", `<h1>Authorization error</h1>\n<p>${escapeHtml(message)}</p>`);
}

export function refusalPage(): Response {
  return page(403, "Access refused", "<h1>Access refused</h1>\n<p>This account is not invited.</p>");
}

export function consentPage(requestId: string, clientName: string, redirectUri: string, scope: string): Response {
  return page(
    200,
    "Authorize access",
    `<h1>Authorize access</h1>
<p><strong>${escapeHtml(clientName)}</strong> wants to access your yt-digest account.</p>
<p>Redirect URI: <code>${escapeHtml(redirectUri)}</code></p>
<p>Scope: <code>${escapeHtml(scope)}</code></p>
<form method="post" action="/authorize/consent">
<input type="hidden" name="request" value="${escapeHtml(requestId)}">
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form>`,
  );
}
