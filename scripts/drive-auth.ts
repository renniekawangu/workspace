import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// One-time setup: signs in as the Google account that owns the asset Drive folder and prints a
// refresh token for GOOGLE_OAUTH_REFRESH_TOKEN. Run: npm run drive:auth
// Reads GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (and optionally GOOGLE_DRIVE_FOLDER_ID)
// from the environment or from a local .env file.

function loadDotEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadDotEnv();
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (!clientId || !clientSecret)
    throw new Error(
      "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (in .env or the environment) first.",
    );

  const state = randomBytes(16).toString("hex");
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive",
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  console.log(
    "\nOpen this link in your browser, sign in as the Drive owner and allow access:\n\n" +
      url +
      "\n",
  );

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out after 5 minutes.")),
      5 * 60_000,
    );
    server.on("request", (req, res) => {
      const q = new URL(req.url ?? "/", redirect).searchParams;
      if (!q.has("code") && !q.has("error")) {
        res.writeHead(404).end();
        return;
      }
      clearTimeout(timer);
      if (q.get("state") !== state || !q.get("code")) {
        res.writeHead(400).end("Authorisation failed. You can close this tab.");
        reject(new Error(q.get("error") ?? "State mismatch."));
        return;
      }
      res
        .writeHead(200, { "Content-Type": "text/plain" })
        .end("Done. You can close this tab and go back to the terminal.");
      resolve(q.get("code")!);
    });
  }).finally(() => server.close());

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    }),
  });
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    error_description?: string;
    error?: string;
  };
  if (!tokenRes.ok || !tokens.access_token)
    throw new Error(
      `Token exchange failed: ${tokens.error_description ?? tokens.error ?? tokenRes.status}`,
    );
  if (!tokens.refresh_token)
    throw new Error(
      "Google did not return a refresh token. Remove this app at https://myaccount.google.com/permissions and run again.",
    );

  console.log(
    "Success. Set this in Vercel (Production and Preview) and in your local .env:\n",
  );
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);

  if (folderId) {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=name,mimeType,capabilities/canAddChildren&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    const f = (await r.json()) as {
      name?: string;
      mimeType?: string;
      capabilities?: { canAddChildren?: boolean };
    };
    if (!r.ok)
      console.log(
        "Could not open GOOGLE_DRIVE_FOLDER_ID with this account. Check the id and that you signed in as the owner.",
      );
    else if (f.mimeType !== "application/vnd.google-apps.folder")
      console.log(
        `"${f.name}" is not a folder. Use the id from the folder's URL.`,
      );
    else
      console.log(
        `Connected to folder "${f.name}"${f.capabilities?.canAddChildren ? "" : " (read only: uploads will fail)"}.`,
      );
  } else
    console.log(
      "Tip: set GOOGLE_DRIVE_FOLDER_ID and run this again to check the folder.",
    );
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
