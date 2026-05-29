const { spawn } = require("child_process");
const os = require("os");

function getLanIp() {
  const interfaces = os.networkInterfaces();
  const preferredNames = ["en0", "en1"];

  for (const name of preferredNames) {
    const match = interfaces[name]?.find((entry) => entry.family === "IPv4" && !entry.internal);
    if (match) return match.address;
  }

  for (const entries of Object.values(interfaces)) {
    const match = entries?.find((entry) => entry.family === "IPv4" && !entry.internal);
    if (match) return match.address;
  }

  throw new Error("Could not find a LAN IPv4 address for Expo Go.");
}

const lanIp = getLanIp();
const port = process.env.EXPO_PORT ?? "8082";

console.log(`Expo Go URL: exp://${lanIp}:${port}`);
console.log("Make sure your phone and this Mac are on the same Wi-Fi network.");

const child = spawn(
  "npx",
  ["expo", "start", "--go", "--host", "lan", "--port", port],
  {
    env: {
      ...process.env,
      REACT_NATIVE_PACKAGER_HOSTNAME: lanIp,
    },
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
