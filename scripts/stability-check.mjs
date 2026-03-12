import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function mustExist(relPath) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) {
    failures.push(`MISSING FILE: ${relPath}`);
    return "";
  }
  return fs.readFileSync(abs, "utf8");
}

function mustContain(relPath, pattern, label) {
  const content = mustExist(relPath);
  if (!content) return;
  if (!pattern.test(content)) {
    failures.push(`MISSING PATTERN [${label}] in ${relPath}`);
  }
}

mustContain("functions/index.js", /export const createRoom\s*=\s*onCall/, "createRoom callable");
mustContain("functions/index.js", /export const joinRoom\s*=\s*onCall/, "joinRoom callable");
mustContain("functions/index.js", /export const leaveGroup\s*=\s*onCall/, "leaveGroup callable");
mustContain("functions/index.js", /export const dissolveRoom\s*=\s*onCall/, "dissolveRoom callable");
mustContain("functions/index.js", /export const approveCheckin\s*=\s*onCall/, "approveCheckin callable");
mustContain("functions/index.js", /export const rejectCheckin\s*=\s*onCall/, "rejectCheckin callable");
mustContain("functions/index.js", /export const runMaintenanceCleanup\s*=\s*onCall/, "runMaintenanceCleanup callable");

mustContain("group.js", /onSnapshot\(/, "group realtime");
mustContain("group.js", /httpsCallable\(functions,\s*"leaveGroup"\)/, "leaveGroup callable usage");
mustContain("group.js", /httpsCallable\(functions,\s*"dissolveRoom"\)/, "dissolveRoom callable usage");

mustContain("profile.html", /id="nicknameInput"/, "profile nickname input");
mustContain("profile.js", /currentChallengeStreak/, "profile streak field");

mustContain("index.html", /id="goProfileBtn"/, "profile nav from lobby");
mustContain("enter-room.html", /id="goProfileBtn"/, "profile nav from enter room");

mustContain("admin.html", /운영 대시보드/, "admin page");
mustContain("admin.js", /getCountFromServer/, "admin counters");

mustContain("firestore.rules", /match \/groups\/\{groupId\}/, "groups rules");
mustContain("firestore.rules", /match \/checkins\/\{checkinId\}/, "checkins rules");

if (failures.length) {
  console.error("Stability check FAILED");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Stability check PASSED");
