import { execSync } from "node:child_process";
import { getAppPort, loadEnvFile } from "./load-env-file.mjs";

loadEnvFile();
const port = getAppPort();

try {
  execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
  console.log(`[free-port] Port ${port} dibebaskan.`);
} catch {
  console.log(`[free-port] Port ${port} sudah kosong.`);
}
