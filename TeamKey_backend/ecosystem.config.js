module.exports = {
  apps: [
    {
      name: "teamkey-backend",
      script: "uvicorn",
      args: "app.main:app --host=0.0.0.0 --port=8010",
      interpreter: "/root/zyx/TeamKey/TeamKey_backend/.venv/bin/python", // 或根据实际虚拟环境路径修改
      cwd: "/root/zyx/TeamKey/TeamKey_backend", // 项目根目录
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        ENV: "production",
        PYTHONUNBUFFERED: "1",
      },
      error_file: "/var/log/pm2/teamkey-error.log",
      out_file: "/var/log/pm2/teamkey-out.log",
      merge_logs: true,
      time: true
    }
  ]
};

