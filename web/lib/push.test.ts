import { describe, expect, it } from "vitest";
import { allowedEndpoint } from "./push";

describe("allowedEndpoint: push only to real browser push services", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QAbc",
    "https://api.push.apple.com/3/device/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts %s", (u) => expect(allowedEndpoint(u)).toBe(true));

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc", // not https
    "https://evil.example.com/collect",
    "https://fcm.googleapis.com.evil.com/x", // look-alike host
    "https://evilpush.apple.com.attacker.net/x",
    "https://fcm.googleapis.com:8443/x", // custom port
    "https://user:pass@fcm.googleapis.com/x", // credentials
    "https://169.254.169.254/latest/meta-data", // cloud metadata address
    "not a url",
    "https://fcm.googleapis.com/" + "a".repeat(1000), // too long
  ])("refuses %s", (u) => expect(allowedEndpoint(u)).toBe(false));
});
