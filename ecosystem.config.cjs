module.exports = {
  apps: [
    {
      name: "dafit-canvas",
      script: "npm",
      args: "run preview -- --host 0.0.0.0 --port 4173",
      instances: 1,
      autorestart: true,
      watch: false,
    },
  ],
};
