import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

if (!host || !user || !pass) {
  console.error("SMTP configuration missing. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.");
  process.exit(1);
}

if (pass.includes("<") || pass.includes(">") || pass.includes("new app password")) {
  console.error("SMTP_PASS is still a placeholder. Replace it with the real Gmail app password.");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host,
  port: Number(process.env.SMTP_PORT || 465),
  secure: Number(process.env.SMTP_PORT || 465) === 465,
  auth: { user, pass },
});

transporter
  .verify()
  .then(() => {
    console.log("SMTP verification succeeded.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("SMTP verification failed:");
    console.error(err.message || String(err));
    process.exit(1);
  });
