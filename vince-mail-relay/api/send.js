// Gmail SMTP relay for the Vince lead tracker. Railway null-routes every
// outbound SMTP port (25/465/587/2525 all ETIMEDOUT), so the tracker POSTs
// here over HTTPS and this function does the actual Gmail send from Vercel,
// where port 465 is open. Auth = shared secret in the body; creds live in
// Vercel env (RELAY_SECRET, GMAIL_USER, GMAIL_APP_PASSWORD).
import tls from "node:tls";

function smtpSend({ user, pass, from, to, subject, text }) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect(465, "smtp.gmail.com", {
      servername: "smtp.gmail.com",
    });
    const rcpts = to.filter(Boolean);
    let buf = "";
    let step = 0;
    let rcptIdx = 0;
    const fail = (m) => {
      try {
        sock.destroy();
      } catch {}
      reject(new Error(m));
    };
    sock.setTimeout(20000, () => fail("smtp timeout"));
    sock.on("error", (e) => reject(e));
    const write = (line) => sock.write(line + "\r\n");
    const body =
      [
        `From: ${from}`,
        `To: ${rcpts.join(", ")}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(text)
          .toString("base64")
          .replace(/(.{76})/g, "$1\r\n"),
      ].join("\r\n") + "\r\n.";
    sock.on("data", (d) => {
      buf += d.toString();
      if (!/\r?\n$/.test(buf)) return;
      const code = Number(buf.slice(0, 3));
      if (
        new RegExp(`^${code}-`, "m").test(buf) &&
        !new RegExp(`^${code} `, "m").test(buf)
      )
        return;
      buf = "";
      if (code >= 400) return fail(`smtp ${code} at step ${step}`);
      if (step === 0) ((step = 1), write("EHLO vince-mail-relay.vercel.app"));
      else if (step === 1) ((step = 2), write("AUTH LOGIN"));
      else if (step === 2)
        ((step = 3), write(Buffer.from(user).toString("base64")));
      else if (step === 3)
        ((step = 4), write(Buffer.from(pass).toString("base64")));
      else if (step === 4) ((step = 5), write(`MAIL FROM:<${user}>`));
      else if (step === 5) {
        if (rcptIdx < rcpts.length) write(`RCPT TO:<${rcpts[rcptIdx++]}>`);
        if (rcptIdx >= rcpts.length) step = 6;
      } else if (step === 6) ((step = 7), write("DATA"));
      else if (step === 7) ((step = 8), write(body));
      else if (step === 8) ((step = 9), write("QUIT"), resolve(true));
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "POST only" });
  const { secret, to, subject, text } = req.body || {};
  if (!process.env.RELAY_SECRET || secret !== process.env.RELAY_SECRET)
    return res.status(401).json({ ok: false, error: "bad secret" });
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass)
    return res.status(500).json({ ok: false, error: "relay missing creds" });
  const rcpts = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!rcpts.length || !subject)
    return res.status(400).json({ ok: false, error: "need to + subject" });
  try {
    await smtpSend({
      user,
      pass,
      from: `"Vince Lead Tracker" <${user}>`,
      to: rcpts,
      subject: String(subject),
      text: String(text || ""),
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res
      .status(502)
      .json({ ok: false, error: e.message || e.constructor.name });
  }
}
