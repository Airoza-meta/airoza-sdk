module.exports = {
  apps: [{
    name: "airoza-bot",
    script: "./src/index.ts",
    interpreter: "node",
    interpreter_args: "-r ts-node/register",
    instances: 1, // Single instance because sessions are in-memory
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: "production",
      PORT: 3000
    }
  }]
}
