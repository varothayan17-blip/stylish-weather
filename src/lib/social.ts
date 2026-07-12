/**
 * Social platform configuration for Aeruvo.
 * All platform URLs live here — update this file when a new account is created.
 * Import { SOCIAL } wherever links are needed. Never hardcode URLs elsewhere.
 */
export const SOCIAL = {
  instagram: {
    label: "Instagram",
    handle: "@getaeruvo",
    url: null, // Add URL when Instagram account is created
  },
  tiktok: {
    label: "TikTok",
    handle: "@getaeruvo",
    url: null,
  },
  x: {
    label: "X (Twitter)",
    handle: "@getaeruvo",
    url: null,
  },
  linkedin: {
    label: "LinkedIn",
    handle: "Aeruvo",
    url: null,
  },
  youtube: {
    label: "YouTube",
    handle: "Aeruvo",
    url: null,
  },
  website: {
    label: "Website",
    handle: "aeruvo.app",
    url: null, // Add when domain is live
  },
} as const;

export const APP_CONFIG = {
  name: "Aeruvo",
  version: "1.0.0",
  tagline: "Know what to wear before you leave.",
  description:
    "Aeruvo is an AI-powered weather and outfit recommendation platform that helps people make smarter clothing decisions based on real-time weather, personal preferences, and daily activities.",
  supportEmail: "supportaeruvo@gmail.com",
  privacyEmail: "aeruvoprivacy@gmail.com",
} as const;
