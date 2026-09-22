/**
 * Sites a vendor may list as its own without them saying anything about which app is
 * installed: social networks, link shorteners, documentation hosts and Salla itself.
 * Generating a fingerprint from one of these would match half the web.
 */
export const GENERIC_DEVELOPER_DOMAINS: ReadonlySet<string> = new Set([
  "apple.com",
  "bit.ly",
  "blogspot.com",
  "calendly.com",
  "canva.site",
  "facebook.com",
  "forms.gle",
  "gitbook.io",
  "github.com",
  "gmail.com",
  "google.com",
  "instagram.com",
  "intercom.help",
  "linkedin.com",
  "linktr.ee",
  "medium.com",
  "notion.site",
  "notion.so",
  "salla.com",
  "salla.dev",
  "salla.sa",
  "snapchat.com",
  "t.me",
  "tiktok.com",
  "twitter.com",
  "wa.me",
  "whatsapp.com",
  "wordpress.com",
  "x.com",
  "youtu.be",
  "youtube.com",
  "zendesk.com",
]);
