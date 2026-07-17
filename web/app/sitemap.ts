import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  // Rooms are ephemeral; the home page is the only indexable URL.
  return [{ url: siteUrl, changeFrequency: "weekly", priority: 1 }];
}
