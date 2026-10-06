const { spawn } = require("node:child_process");
const readline = require("node:readline");

class Backend {
  constructor(executable) {
    this.sequence = 0;
    this.pending = new Map();
    this.failure = null;
    this.process = spawn(executable, [], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.stderr.on("data", (data) =>
      console.error("[backend]", data.toString()),
    );
    this.lines = readline.createInterface({ input: this.process.stdout });
    this.lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line.replace(/^\uFEFF/, ""));
      } catch {
        this.fail(new Error("打包后端返回了无效数据，请重新启动应用"));
        return;
      }
      const task = this.pending.get(message.id);
      if (!task) return;
      this.pending.delete(message.id);
      if (message.ok) task.resolve(message.result);
      else task.reject(new Error(message.error));
    });
    this.process.on("error", (error) => this.fail(error));
    this.process.on("exit", (code) =>
      this.fail(new Error(`打包后端已退出（${code}），请重新启动应用`)),
    );
    this.process.stdin.on("error", (error) => this.fail(error));
  }
  fail(error) {
    this.failure = error;
    for (const task of this.pending.values()) task.reject(error);
    this.pending.clear();
  }
  call(method, args = {}) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(
        JSON.stringify({ id, method, args }) + "\n",
        "utf8",
      );
    });
  }
  close() {
    if (this.closing) return;
    this.closing = true;
    this.process.stdin.end();
    // Allow the backend to remove its own import/template directory before shutdown.
    const timer = setTimeout(() => this.process.kill(), 2000);
    timer.unref();
    this.process.once("exit", () => clearTimeout(timer));
  }
}
module.exports = { Backend };
