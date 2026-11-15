import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

type ServiceAccountJson = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

/**
 * FIREBASE_SERVICE_ACCOUNT_JSON holds the service-account JSON, either raw or
 * base64-encoded (base64 avoids newline problems in the Vercel env editor).
 * It is a server-only variable: never prefix it with VITE_.
 */
export function parseServiceAccount(
  raw: string | undefined,
  projectIdHint?: string,
) {
  const value = raw?.trim();
  if (!value) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");

  let json = value;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    json = JSON.parse(value.slice(1, -1));
  }

  if (!json.startsWith("{")) {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (!decoded.trim().startsWith("{")) {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON or base64-encoded JSON.",
      );
    }
    json = decoded;
  }

  const parsed = JSON.parse(json) as ServiceAccountJson;
  const projectId = String(parsed.project_id ?? "").trim();
  const clientEmail = String(parsed.client_email ?? "").trim();
  let privateKey = String(parsed.private_key ?? "").trim();

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id, client_email, or private_key.",
    );
  }

  privateKey = privateKey.replace(/\\n/g, "\n");
  if (
    !privateKey.includes("-----BEGIN PRIVATE KEY-----") ||
    !privateKey.includes("-----END PRIVATE KEY-----")
  ) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON has an invalid private_key entry.",
    );
  }

  if (projectIdHint && projectId !== projectIdHint) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT_JSON project_id (${projectId}) does not match the app project (${projectIdHint}).`,
    );
  }

  return cert({
    projectId,
    clientEmail,
    privateKey,
  });
}

function credentials() {
  return parseServiceAccount(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
  );
}

function app(): App {
  return getApps()[0] ?? initializeApp({ credential: credentials() });
}

export const adminAuth = () => getAuth(app());
export const adminDb = () => getFirestore(app());
