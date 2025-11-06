const { exec, spawn } = require("child_process");

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

// ✅ INICIA EL BOT UNA SOLA VEZ Y LO DEJA ENCENDIDO 24/7
console.log("🤖 INICIANDO BOT (24/7 - Siempre encendido)...");

const botProcess = spawn("node", ["bot.js"], {
  env: { ...process.env, SERVER_URL: `http://localhost:${PORT}` },
});

botProcess.stdout.on("data", (data) => {
  console.log(`[BOT] ${data}`);
});

botProcess.stderr.on("data", (data) => {
  console.error(`[BOT ERROR] ${data}`);
});

botProcess.on("close", (code) => {
  console.error(`[BOT] ⚠️ Proceso terminado con código ${code}`);
  console.error(`[BOT] 🔄 Reiniciando bot en 5 segundos...`);

  
  setTimeout(() => {
    console.log("🤖 Reiniciando bot...");
    const restartBot = spawn("node", ["bot.js"], {
      env: { ...process.env, SERVER_URL: `http://localhost:${PORT}` },
    });

    restartBot.stdout.on("data", (data) => {
      console.log(`[BOT] ${data}`);
    });

    restartBot.stderr.on("data", (data) => {
      console.error(`[BOT ERROR] ${data}`);
    });
  }, 5000);
});

console.log("✅ Sistema iniciado correctamente");
console.log("📱 Bot encendido 24/7");
console.log("🕐 Horario de reservas: Viernes 7:30-11:00 AM (Perú)");
console.log("📨 Respuestas automáticas: Resto del tiempo");
