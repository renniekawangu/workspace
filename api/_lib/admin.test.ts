import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseServiceAccount } from "./admin";

describe("parseServiceAccount", () => {
  it("accepts a valid JSON service account and normalizes private keys", () => {
    const keyPair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const pem = keyPair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();

    const json = {
      type: "service_account",
      project_id: "b34stweb-management",
      private_key_id: "abc123",
      client_email: "firebase-adminsdk-test@b34stweb-management.iam.gserviceaccount.com",
      private_key: pem.replace(/\n/g, "\\n"),
    };

    const cert = parseServiceAccount(JSON.stringify(json), "b34stweb-management") as any;

    expect(cert.projectId).toBe("b34stweb-management");
    expect(cert.clientEmail).toBe(
      "firebase-adminsdk-test@b34stweb-management.iam.gserviceaccount.com",
    );
    expect(cert.privateKey).toContain("BEGIN PRIVATE KEY");
  });

  it("rejects a project mismatch with a helpful error", () => {
    const pem = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();

    const json = {
      type: "service_account",
      project_id: "other-project",
      private_key_id: "abc123",
      client_email: "firebase-adminsdk-test@other-project.iam.gserviceaccount.com",
      private_key: pem.replace(/\n/g, "\\n"),
    };

    expect(() =>
      parseServiceAccount(JSON.stringify(json), "b34stweb-management"),
    ).toThrow(/project_id.*b34stweb-management/i);
  });
});
