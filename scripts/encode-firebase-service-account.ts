import fs from "node:fs";

function parseEnvServiceAccount(contents: string): string {
  const key = "FIREBASE_SERVICE_ACCOUNT_JSON=";
  const start = contents.indexOf(key);
  if (start === -1) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON not found in the env file.");
  }

  const rest = contents.slice(start + key.length);
  const first = rest.trimStart()[0];

  if (first === "{") {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let value = "";

    for (const ch of rest) {
      value += ch;
      if (ch === '"' && !escaped) {
        inString = !inString;
      }
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = inString;
      }
      if (!inString) {
        if (ch === "{") depth += 1;
        if (ch === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
    }

    return value.trim();
  }

  const quoted = rest.trim();
  if ((quoted.startsWith('"') && quoted.endsWith('"')) || (quoted.startsWith("'") && quoted.endsWith("'"))) {
    return JSON.parse(quoted);
  }

  return quoted.trim();
}

function main() {
  const envPath = process.argv[2] ?? ".env.local";
  const raw = fs.readFileSync(envPath, "utf8");
  const envValue = parseEnvServiceAccount(raw);
  const object = JSON.parse(envValue);
  const encoded = Buffer.from(JSON.stringify(object), "utf8").toString("base64");

  console.log(encoded);
}

main();
