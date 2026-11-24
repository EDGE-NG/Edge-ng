/**
 * Parse User-Agent strings into friendly device and browser names (PRD REQ-ID-1, 4.8).
 * Dependency-free and fast.
 */
export interface ParsedUserAgent {
  device: string;
  browser: string;
  os: string;
  isMobile: boolean;
}

export function parseUserAgent(uaString: string | null | undefined): ParsedUserAgent {
  if (!uaString) {
    return { device: "Unknown device", browser: "Web Browser", os: "Unknown OS", isMobile: false };
  }

  let os = "Unknown OS";
  let isMobile = false;

  if (/windows phone/i.test(uaString)) {
    os = "Windows Phone";
    isMobile = true;
  } else if (/win(dows|98|nt|xp)/i.test(uaString)) {
    os = "Windows";
  } else if (/iphone/i.test(uaString)) {
    os = "iPhone";
    isMobile = true;
  } else if (/ipad/i.test(uaString)) {
    os = "iPad";
    isMobile = true;
  } else if (/macintosh|mac os x/i.test(uaString)) {
    os = "macOS";
  } else if (/android/i.test(uaString)) {
    os = "Android";
    isMobile = true;
  } else if (/linux/i.test(uaString)) {
    os = "Linux";
  }

  let browser = "Web Browser";
  if (/edg\//i.test(uaString)) {
    browser = "Edge";
  } else if (/opr\/|opera/i.test(uaString)) {
    browser = "Opera";
  } else if (/chrome|crios/i.test(uaString)) {
    browser = "Chrome";
  } else if (/firefox|fxios/i.test(uaString)) {
    browser = "Firefox";
  } else if (/safari/i.test(uaString) && !/chrome|crios|android/i.test(uaString)) {
    browser = "Safari";
  }

  const device = `${browser} on ${os}`;
  return { device, browser, os, isMobile };
}
