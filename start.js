const { exec, spawn } = require("child_process");
const schedule = require("node-schedule");

const PORT = process.env.PORT || 8080;

console.log("🚀 Iniciando servidor...");

// Inicia el servidor SIEMPRE
const server = exec(`PORT=${PORT} node server.js`);

server.stdout.on("data", (data) => {
  console.log(`[SERVER] ${data}`);
});

server.stderr.on("data", (data) => {
  console.error(`[SERVER ERROR] ${data}`);
});

server.on("close", (code) => {
  console.log(`[SERVER] Proceso terminado con código ${code}`);
  process.exit(code);
});

// ====== BOT AUTO-RESPONDER (24/7) ======
console.log("🤖 Iniciando bot auto-responder (24/7)...");
const autoResponder = spawn("node", ["bot-autoresponder.js"], {
  env: { ...process.env },
});

autoResponder.stdout.on("data", (data) => {
  console.log(`[AUTO-RESPONDER] ${data}`);
});

autoResponder.stderr.on("data", (data) => {
  console.error(`[AUTO-RESPONDER ERROR] ${data}`);
});

autoResponder.on("close", (code) => {
  console.log(`[AUTO-RESPONDER] Proceso terminado con código ${code}`);
});

// ====== BOT PRINCIPAL (Solo viernes 7:30-11:00 AM) ======
let botProcess = null;

function shouldBotBeRunning() {
  const now = new Date();
  const peruTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const dayOfWeek = peruTime.getUTCDay();
  const hours = peruTime.getUTCHours();
  const minutes = peruTime.getUTCMinutes();
  const currentTimeInMinutes = hours * 60 + minutes;
  const startTime = 7 * 60 + 30;
  const endTime = 11 * 60;

  return (
    dayOfWeek === 5 &&
    currentTimeInMinutes >= startTime &&
    currentTimeInMinutes < endTime
  );
}

function startBot() {
  if (botProcess) {
    console.log("⚠️ Bot principal ya está corriendo");
    return;
  }

  console.log("🤖 INICIANDO BOT PRINCIPAL (Reservas)...");
  botProcess = spawn("node", ["bot.js"], {
    env: { ...process.env, SERVER_URL: `http://localhost:${PORT}` },
  });

  botProcess.stdout.on("data", (data) => {
    console.log(`[BOT-PRINCIPAL] ${data}`);
  });

  botProcess.stderr.on("data", (data) => {
    console.error(`[BOT-PRINCIPAL ERROR] ${data}`);
  });

  botProcess.on("close", (code) => {
    console.log(`[BOT-PRINCIPAL] Proceso terminado con código ${code}`);
    botProcess = null;
  });
}

function stopBot() {
  if (!botProcess) {
    console.log("⚠️ Bot principal no está corriendo");
    return;
  }

  console.log("🛑 DETENIENDO BOT PRINCIPAL...");
  botProcess.kill();
  botProcess = null;
}

setInterval(() => {
  const shouldRun = shouldBotBeRunning();
  const isRunning = botProcess !== null;

  if (shouldRun && !isRunning) {
    console.log(
      "✅ Es hora de iniciar el bot principal (Viernes 7:30-11:00 AM)"
    );
    startBot();
  } else if (!shouldRun && isRunning) {
    console.log("🔴 Fuera de horario, deteniendo bot principal...");
    stopBot();
  }
}, 60000);

console.log("⏰ Verificando si el bot principal debe estar corriendo...");
if (shouldBotBeRunning()) {
  console.log("✅ Horario válido, iniciando bot principal...");
  startBot();
} else {
  console.log(
    "🔴 Fuera de horario, bot principal NO se iniciará hasta el viernes 7:30 AM"
  );
}
