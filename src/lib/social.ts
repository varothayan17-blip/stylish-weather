/**
 * Social platform configuration.
 * All platform URLs live here — update this file when a new account is created.
 * Import { SOCIAL } wherever links are needed. Never hardcode URLs elsewhere.
 */
export const SOCIAL = {
  instagram: {
    label: "Instagram",
    handle: "@getwethra",
    url: "https://instagram.com/getwethra",
  },
  tiktok: {
    label: "TikTok",
    handle: "@getwethra",
    url: null, // Add URL when account is created
  },
  x: {
    label: "X (Twitter)",
    handle: "@getwethra",
    url: null,
  },
  linkedin: {
    label: "LinkedIn",
    handle: "Wethra",
    url: null,
  },
  youtube: {
    label: "YouTube",
    handle: "Wethra",
    url: null,
  },
  website: {
    label: "Website",
    handle: "getwethra.com",
    url: null, // Add when domain is live
  },
} as const;

export const APP_CONFIG = {
  name: "Wethra",
  version: "1.0.0",
  tagline: "Dress with confidence before you leave home.",
  supportEmail: "support@getwethra.com", // Update when email is active
  privacyEmail: "privacy@getwethra.com",
} as const;
