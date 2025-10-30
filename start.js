const { exec } = require('child_process');
const PORT = process.env.PORT || 8080;

console.log('🚀 Iniciando servidor y bot...');

// Inicia el servidor
const server = exec(`PORT=${PORT} node server.js`);

server.stdout.on('data', (data) => {
  console.log(`[SERVER] ${data}`);
});

server.stderr.on('data', (data) => {
  console.error(`[SERVER ERROR] ${data}`);
});

// Espera 5 segundos y luego inicia el bot
setTimeout(() => {
  console.log('🤖 Iniciando bot de WhatsApp...');
  
  const bot = exec(`SERVER_URL=http://localhost:${PORT} node bot.js`);
  
  bot.stdout.on('data', (data) => {
    console.log(`[BOT] ${data}`);
  });
  
  bot.stderr.on('data', (data) => {
    console.error(`[BOT ERROR] ${data}`);
  });
  
  bot.on('close', (code) => {
    console.log(`[BOT] Proceso terminado con código ${code}`);
  });
}, 5000);

server.on('close', (code) => {
  console.log(`[SERVER] Proceso terminado con código ${code}`);
  process.exit(code);
});