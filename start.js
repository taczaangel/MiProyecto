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

// Variable para el proceso del bot
let botProcess = null;

// Función para verificar si es viernes 7:30-11:00 AM hora de Perú
function shouldBotBeRunning() {
  const now = new Date();
  const peruTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const dayOfWeek = peruTime.getUTCDay(); // 5 = viernes
  const hours = peruTime.getUTCHours();
  const minutes = peruTime.getUTCMinutes();
  const currentTimeInMinutes = hours * 60 + minutes;
  const startTime = 7 * 60 + 30; // 7:30 AM
  const endTime = 11 * 60; // 11:00 AM

  return (
    dayOfWeek === 5 &&
    currentTimeInMinutes >= startTime &&
    currentTimeInMinutes < endTime
  );
}

// Función para iniciar el bot
function startBot() {
  if (botProcess) {
    console.log("⚠️ Bot ya está corriendo");
    return;
  }

  console.log("🤖 INICIANDO BOT DE WHATSAPP...");
  botProcess = spawn("node", ["bot.js"], {
    env: { ...process.env, SERVER_URL: `http://localhost:${PORT}` },
  });

  botProcess.stdout.on("data", (data) => {
    console.log(`[BOT] ${data}`);
  });

  botProcess.stderr.on("data", (data) => {
    console.error(`[BOT ERROR] ${data}`);
  });

  botProcess.on("close", (code) => {
    console.log(`[BOT] Proceso terminado con código ${code}`);
    botProcess = null;
  });
}

// Función para detener el bot
function stopBot() {
  if (!botProcess) {
    console.log("⚠️ Bot no está corriendo");
    return;
  }

  console.log("🛑 DETENIENDO BOT DE WHATSAPP...");
  botProcess.kill();
  botProcess = null;
}

// Verificar cada minuto si el bot debe estar corriendo
setInterval(() => {
  const shouldRun = shouldBotBeRunning();
  const isRunning = botProcess !== null;

  if (shouldRun && !isRunning) {
    console.log("✅ Es hora de iniciar el bot (Viernes 7:30-11:00 AM)");
    startBot();
  } else if (!shouldRun && isRunning) {
    console.log("🔴 Fuera de horario, deteniendo bot...");
    stopBot();
  }
}, 60000); // Cada 1 minuto

// Verificar inmediatamente al iniciar
console.log("⏰ Verificando si el bot debe estar corriendo...");
if (shouldBotBeRunning()) {
  console.log("✅ Horario válido, iniciando bot...");
  startBot();
} else {
  console.log(
    "🔴 Fuera de horario, bot NO se iniciará hasta el viernes 7:30 AM"
  );
}
