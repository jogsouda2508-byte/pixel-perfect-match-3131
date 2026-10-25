// Adds the microphone permission to the Android app so voice messages can ask for it.
// Run once from the project root:   node scripts/add-android-mic-permission.mjs
// then:                             npx cap sync android   (and rebuild / run the app)
// Safe to run more than once: it only adds what is missing and changes nothing else.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] ?? "android/app/src/main/AndroidManifest.xml";
if (!existsSync(file)) {
  console.error(`Cannot find ${file}. Run this from the project root (the folder that has the android folder).`);
  process.exit(1);
}

let xml = readFileSync(file, "utf8");
const wanted = [
  ['<uses-permission android:name="android.permission.RECORD_AUDIO" />', "android.permission.RECORD_AUDIO"],
  ['<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />', "android.permission.MODIFY_AUDIO_SETTINGS"],
  ['<uses-feature android:name="android.hardware.microphone" android:required="false" />', "android.hardware.microphone"],
];

const missing = wanted.filter(([, key]) => !xml.includes(key));
if (missing.length === 0) {
  console.log("Microphone permission is already in AndroidManifest.xml. Nothing to do.");
  process.exit(0);
}

const at = xml.search(/<application[\s>]/);
if (at === -1) {
  console.error("Could not find the <application> tag in AndroidManifest.xml. Add these lines by hand, above <application>:");
  for (const [line] of missing) console.error("  " + line);
  process.exit(1);
}

const block = missing.map(([line]) => `    ${line}\n`).join("");
xml = xml.slice(0, at).replace(/[ \t]*$/, "") + block + "\n    " + xml.slice(at).replace(/^\s+/, "");
writeFileSync(file, xml);
console.log(`Added ${missing.length} line(s) to ${file}. Now run: npx cap sync android`);
