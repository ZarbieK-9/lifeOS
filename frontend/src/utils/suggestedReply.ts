/**
 * Extract a suggested reply from AI output (e.g. notification_alert response).
 * Used by AiScreen (Copy reply button) and useNotificationListener (notification data).
 */
export function extractSuggestedReply(output: string): string | null {
  const patterns = [
    /suggested\s+reply[:\s]*["\u201c\u2018](.+?)["\u201d\u2019]/i,
    /you (?:could|can|might) (?:say|respond|reply)[:\s]*["\u201c\u2018](.+?)["\u201d\u2019]/i,
    /(?:try|here['\u2019]s?)\s*(?:saying|replying)?[:\s]*["\u201c\u2018](.+?)["\u201d\u2019]/i,
    /reply[:\s]*["\u201c\u2018](.+?)["\u201d\u2019]/i,
    /suggested\s+reply[:\s]*(.+?)(?:\n|$)/i,
    /^[-*]\s*["\u201c\u2018]?(.+?)["\u201d\u2019]?\s*$/m,
    /(?:suggest(?:ed|ion)?|reply)[:\s]*\n\s*["\u201c\u2018]?(.+?)["\u201d\u2019]?(?:\n|$)/im,
  ];
  for (const p of patterns) {
    const m = output.match(p);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}
