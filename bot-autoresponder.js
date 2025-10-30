const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const ADMIN_PHONE = "51959634347@c.us";
const BOT_START_TS = Math.floor(Date.now() / 1000);

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "./.wwebjs_auth_autoresponder",
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  },
});

client.on("qr", (qr) => {
  console.log("📱 Escanea este QR para el bot de auto-respuesta:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("🤖 Bot de auto-respuesta listo (24/7)");
});

client.on("auth_failure", (msg) =>
  console.error("Auth failure autoresponder:", msg)
);

function getCurrentPeruTime() {
  const now = new Date();
  const peruTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return peruTime;
}

function getAutoResponseMessage() {
  const peruTime = getCurrentPeruTime();
  const dayOfWeek = peruTime.getUTCDay();
  const hours = peruTime.getUTCHours();
  const minutes = peruTime.getUTCMinutes();
  const currentTimeInMinutes = hours * 60 + minutes;
  const startTime = 7 * 60 + 30;
  const endTime = 11 * 60;

  // Viernes 7:30-11:00 AM - No responde (el otro bot está activo)
  if (
    dayOfWeek === 5 &&
    currentTimeInMinutes >= startTime &&
    currentTimeInMinutes < endTime
  ) {
    return null; // No responder, el bot principal está activo
  }

  // Viernes antes de 7:30 AM
  if (dayOfWeek === 5 && currentTimeInMinutes < startTime) {
    return "Buenos días, escríbanos por favor en nuestro horario de atención exactamente a las *7:30 a. m.* ⏰";
  }

  // Viernes después de 11:00 AM
  if (dayOfWeek === 5 && currentTimeInMinutes >= endTime) {
    return "Los cupos de atención ya se agotaron para hoy. 😔\n\nPor favor, escríbenos el próximo *viernes a partir de las 7:30 a. m.* 📅";
  }

  // Lunes-Jueves, Sábado-Domingo
  return "Las citas se asignan únicamente los días *viernes desde las 7:30 a. m. hasta las 11:00 a. m.* 📅⏰\n\nPor favor, escríbenos el próximo viernes en ese horario.";
}

client.on("message", async (msg) => {
  try {
    if (msg.fromMe) return;
    if (msg.timestamp < BOT_START_TS) return;

    const chatId = msg.from;

    // Admin siempre tiene acceso al bot principal, no al autoresponder
    if (chatId === ADMIN_PHONE) {
      console.log("📞 Admin detectado, sin auto-respuesta");
      return;
    }

    const raw = (msg.body || "").trim();
    if (!raw) return;

    const autoResponse = getAutoResponseMessage();

    if (autoResponse) {
      await client.sendMessage(chatId, autoResponse);
      console.log(`📨 Auto-respuesta enviada a ${chatId}`);
    } else {
      console.log(
        `⏰ Horario activo, no auto-responder (bot principal activo)`
      );
    }
  } catch (err) {
    console.error("Error en auto-responder:", err);
  }
});

client.initialize();
console.log("🤖 BOT AUTO-RESPONDER INICIANDO...");